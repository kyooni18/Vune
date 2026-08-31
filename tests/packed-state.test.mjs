/* SPDX-License-Identifier: MIT */

import assert from "node:assert/strict"
import test from "node:test"
import {
  PackedState,
  definePackedLayout,
  definePackedState,
  definePackedStorage,
  defineResidentRegion,
  executeResidentRegionPackedState,
} from "../packages/core/dist/resident-execution.js"

const load = name => ({ op: "load", path: [name] })
const capture = name => ({ op: "capture", name })
const binary = (operator, left, right) => ({ op: "binary", operator, left, right })

function mapKernel(outputs) {
  return {
    kind: "map",
    itemName: "row",
    preserveInput: true,
    outputs,
    captures: ["dt"],
    requiresTypeProof: true,
  }
}

test("PackedState owns stable authoritative columns and versions in-place dirty ranges", () => {
  const state = new PackedState(definePackedLayout([
    { name: "x", type: "f64" },
    { name: "active", type: "u8" },
  ], 4), { capacity: 16, version: 7 })
  const storage = state.storage
  const buffers = state.storage.buffers
  const backing = buffers.map(buffer => buffer.buffer)
  assert.deepEqual(state.consumeDirtyRanges(), [])
  const changes = []
  state.subscribe((observed, change) => {
    assert.equal(observed, state)
    changes.push(change)
  })

  const changed = state.mutate([
    { start: 1, end: 3, fields: ["x"] },
    { start: 1, end: 2, fields: ["active"] },
  ], view => {
    assert.equal(view.length, 4)
    assert.ok(view.column("x") instanceof Float64Array)
    view.column("x")[1] = 4.5
    view.column("x")[2] = 8
    view.column("active")[1] = 1
  })

  assert.equal(state.storage, storage)
  assert.equal(state.storage.buffers, buffers)
  assert.deepEqual(state.storage.buffers.map(buffer => buffer.buffer), backing)
  assert.deepEqual([...state.column("x")], [0, 4.5, 8, 0])
  assert.deepEqual([...state.column("active")], [0, 1, 0, 0])
  assert.equal(state.version, 8)
  assert.equal(changed, true)
  assert.equal(state.lastChange, changes[0])
  assert.deepEqual(changes[0].dirtyRanges.map(range => ({
    start: range.start,
    end: range.end,
    fields: range.fields,
    version: range.version,
  })), [
    { start: 1, end: 3, fields: ["active", "x"], version: 8 },
  ])
})

test("dirty acknowledgements preserve unacknowledged fields and row intervals", () => {
  const state = new PackedState(definePackedLayout([
    { name: "x", type: "f32" },
    { name: "y", type: "f32" },
  ], 6))
  state.consumeDirtyRanges()
  state.invalidate([{ start: 1, end: 5 }])

  state.clearDirtyRanges([{ start: 2, end: 4, fields: ["x"] }])

  assert.deepEqual(state.dirtyRanges.map(range => ({
    start: range.start,
    end: range.end,
    fields: range.fields,
  })), [
    { start: 1, end: 2, fields: undefined },
    { start: 2, end: 4, fields: ["y"] },
    { start: 4, end: 5, fields: undefined },
  ])
  state.clearDirtyRanges([{ start: 1, end: 5 }])
  assert.deepEqual(state.dirtyRanges, [])
})

test("capacity is reused across resize, growth is zeroed, and reserve invalidates storage", () => {
  const state = new PackedState(definePackedLayout([{ name: "value", type: "i32" }], 2), { capacity: 8 })
  state.consumeDirtyRanges()
  state.mutate({ start: 0, end: 2 }, view => view.column("value").set([6, 7]))
  state.consumeDirtyRanges()
  const originalBacking = state.column("value").buffer
  const changes = []
  state.subscribe((_state, change) => changes.push(change))

  assert.equal(state.resize(6), true)
  assert.equal(state.lastChange.kind, "resize")
  assert.equal(state.lastChange.storageChanged, true)
  assert.equal(state.capacity, 8)
  assert.equal(state.column("value").buffer, originalBacking)
  assert.deepEqual([...state.column("value")], [6, 7, 0, 0, 0, 0])

  state.mutate({ start: 5, end: 6 }, view => { view.column("value")[5] = 22 })
  state.resize(3)
  state.resize(6)
  assert.equal(state.column("value").buffer, originalBacking)
  assert.deepEqual([...state.column("value")], [6, 7, 0, 0, 0, 0])

  const versionBeforeReserve = state.version
  assert.equal(state.reserve(20), true)
  assert.equal(state.lastChange.kind, "reserve")
  assert.equal(state.lastChange.storageChanged, true)
  assert.equal(state.capacity, 20)
  assert.notEqual(state.column("value").buffer, originalBacking)
  assert.equal(state.version, versionBeforeReserve + 1)
  assert.deepEqual([...state.column("value")], [6, 7, 0, 0, 0, 0])
  assert.equal(state.reserve(10), false)
  assert.ok(changes.length >= 4)
})

test("PackedState copies adopted storage and snapshots without sharing authority", () => {
  const layout = definePackedLayout([
    { name: "x", type: "f64" },
    { name: "flags", type: "u8" },
  ], 3)
  const source = definePackedStorage(layout, [
    new Float64Array([1, 2, 3]),
    new Uint8Array([1, 0, 1]),
  ], 11)
  const state = definePackedState(source, { capacity: 12 })
  const snapshot = state.snapshot()

  state.mutate({ start: 0, end: 1, fields: ["x"] }, view => { view.column("x")[0] = 9 })
  assert.equal(source.buffers[0][0], 1)
  assert.equal(snapshot.buffers[0][0], 1)
  assert.equal(state.column("x")[0], 9)
  assert.equal(state.capacity, 12)
  assert.equal(state.version, 12)
})

test("packed-state resident execution consumes dirty ranges and advances one version", () => {
  const state = new PackedState(definePackedLayout([
    { name: "position", type: "f64" },
    { name: "velocity", type: "f64" },
  ], 4), { capacity: 12, version: 3 })
  state.consumeDirtyRanges()
  state.mutate({ start: 1, end: 3 }, view => {
    view.column("position").set([1, 2, 3, 4])
    view.column("velocity").set([4, 5, 6, 7])
  })
  const region = defineResidentRegion({
    id: "packed-state-frame",
    source: { kind: "packed", layout: state.layout },
    kernels: [mapKernel([{
      name: "position",
      value: binary("+", load("position"), binary("*", load("velocity"), capture("dt"))),
    }])],
    sink: { kind: "packed", layout: state.layout },
    typeProof: "numeric-packed",
    lifetime: "frame-persistent",
    inputResidency: "packed",
    outputResidency: "packed",
    estimatedTransferBytes: 0,
  })
  const beforeVersion = state.version
  const beforeBuffers = state.storage.buffers
  const changes = []
  state.subscribe((_state, change) => changes.push(change))

  const change = executeResidentRegionPackedState(region, state, state, { captures: { dt: 0.5 } })

  assert.equal(state.version, beforeVersion + 1)
  assert.equal(state.storage.buffers, beforeBuffers)
  assert.deepEqual([...state.column("position")], [1, 4.5, 6, 4])
  assert.equal(change, changes[0])
  assert.deepEqual(change.dirtyRanges.map(range => [range.start, range.end, range.fields, range.version]), [
    [1, 3, undefined, beforeVersion + 1],
  ])
})

test("layouts, storage, fields, ranges, and capacity are strictly validated", () => {
  assert.throws(() => definePackedLayout([{ name: "x", type: "wat" }], 1), /unsupported packed field type/)
  const layout = definePackedLayout([
    { name: "count", type: "u8" },
    { name: "signed", type: "i32" },
  ], 2)
  assert.throws(() => new PackedState(layout, { capacity: 1 }), /cannot be smaller/)
  assert.throws(() => definePackedStorage(layout, [new Uint8Array(2), new Uint32Array(2)]), /does not match/)
  const state = new PackedState(layout)
  assert.throws(() => state.column("missing"), /unknown packed field/)
  assert.throws(() => state.invalidate([{ start: 0, end: 3 }]), /exceeds the logical extent/)
  assert.throws(() => state.invalidate([{ start: 0, end: 1, fields: ["missing"] }]), /unknown packed field/)
  assert.throws(() => state.invalidate([{ start: 0, end: 1, fields: ["count", "count"] }]), /duplicate packed field/)
  assert.throws(() => state.invalidate([{ start: 0, end: 1, fields: [] }]), /non-empty array/)
  assert.throws(() => state.mutate([], () => {}), /non-empty dirty range/)
})

test("subscriber failures do not starve peers and failed mutations still invalidate", () => {
  const state = new PackedState(definePackedLayout([{ name: "x", type: "f64" }], 2))
  state.consumeDirtyRanges()
  const observed = []
  state.subscribe(() => { throw new Error("listener failed") })
  state.subscribe((_state, change) => observed.push(change.version))

  assert.throws(() => state.mutate({ start: 0, end: 1 }, view => {
    view.column("x")[0] = 12
    throw new Error("kernel failed")
  }), error => {
    assert.ok(error instanceof AggregateError)
    assert.deepEqual(error.errors.map(item => item.message), ["kernel failed", "listener failed"])
    return true
  })
  assert.equal(state.version, 1)
  assert.equal(state.column("x")[0], 12)
  assert.deepEqual(observed, [1])
  assert.equal(state.lastChange.dirtyRanges[0].version, 1)
})

test("emitCurrent returns an immutable full snapshot and unsubscribe is idempotent", () => {
  const state = new PackedState(definePackedLayout([{ name: "x", type: "f32" }], 3), { version: 4 })
  const changes = []
  const unsubscribe = state.subscribe((_state, change) => changes.push(change), { emitCurrent: true })
  assert.equal(changes[0].kind, "snapshot")
  assert.equal(changes[0].version, 4)
  assert.deepEqual(changes[0].dirtyRanges.map(range => [range.start, range.end, range.version]), [[0, 3, 4]])
  assert.equal(Object.isFrozen(changes[0]), true)
  assert.equal(Object.isFrozen(changes[0].dirtyRanges), true)
  unsubscribe()
  unsubscribe()
  state.invalidate([{ start: 0, end: 1 }])
  assert.equal(changes.length, 1)
})
