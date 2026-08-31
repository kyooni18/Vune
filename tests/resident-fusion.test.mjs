import assert from "node:assert/strict"
import test from "node:test"
import {
  definePackedLayout,
  definePackedStorage,
  defineResidentRegion,
  executeResidentRegionJS,
} from "../packages/core/dist/resident-execution.js"
import {
  estimateResidentFusionCost,
  optimizeResidentKernelSequence,
  planResidentRegionFusion,
} from "../packages/compiler/dist/resident-fusion.js"
import { emitResidentRegionJS } from "../packages/compiler/dist/resident-js.js"

const load = name => ({ op: "load", path: [name] })
const constant = value => ({ op: "const", value })
const binary = (operator, left, right) => ({ op: "binary", operator, left, right })

function mapKernel(outputs, preserveInput = true) {
  return {
    kind: "map",
    itemName: "row",
    preserveInput,
    outputs,
    captures: [],
    requiresTypeProof: true,
  }
}

function region(id, layout, kernels, overrides = {}) {
  return defineResidentRegion({
    id,
    source: { kind: "packed", layout },
    kernels,
    sink: { kind: "packed", layout },
    typeProof: "numeric-packed",
    lifetime: "persistent",
    inputResidency: "packed",
    outputResidency: "packed",
    estimatedTransferBytes: 0,
    ...overrides,
  })
}

const packedBoundary = (costs = {}) => ({
  residency: "packed",
  transferCost: 0,
  materializationCost: 0,
  synchronizationCost: 0,
  ...costs,
})

test("resident fusion cost includes every connection boundary", () => {
  const cost = estimateResidentFusionCost({
    computeCostSaved: 120,
    boundaries: [
      packedBoundary({ transferCost: 5, synchronizationCost: 2 }),
      packedBoundary({ transferCost: 7, materializationCost: 11, synchronizationCost: 3 }),
    ],
  })
  assert.deepEqual(cost, {
    computeCostSaved: 120,
    transferCost: 12,
    materializationCost: 11,
    synchronizationCost: 5,
    benefit: 92,
    boundaryCount: 2,
    packedBoundaryCount: 2,
    objectBoundaryCount: 0,
    gpuBoundaryCount: 0,
  })
  assert.ok(Object.isFrozen(cost))
})

test("fusion retains map-kernel boundaries and matches sequential snapshot semantics", () => {
  const layout = definePackedLayout([
    { name: "x", type: "f64" },
    { name: "previous", type: "f64" },
  ], 2)
  const advance = region("advance", layout, [mapKernel([
    { name: "x", value: binary("+", load("x"), constant(1)) },
    { name: "previous", value: load("x") },
  ])])
  const consume = region("consume", layout, [mapKernel([
    { name: "previous", value: binary("+", load("previous"), load("x")) },
  ])])
  const plan = planResidentRegionFusion({
    regions: [advance, consume],
    boundaries: [packedBoundary()],
    computeCostSaved: 8,
  })

  assert.equal(plan.eligible, true)
  assert.equal(plan.fusedRegion.id, "resident-fusion:7:advance|7:consume")
  assert.deepEqual(plan.fusedRegion.kernels, [advance.kernels[0], consume.kernels[0]])
  assert.equal(plan.fusedRegion.estimatedOpsPerItem, advance.estimatedOpsPerItem + consume.estimatedOpsPerItem)
  assert.deepEqual(plan.rejections, [])
  assert.ok(Object.isFrozen(plan))
  assert.ok(Object.isFrozen(plan.rejections))
  assert.deepEqual(plan, planResidentRegionFusion({
    regions: [advance, consume],
    boundaries: [packedBoundary()],
    computeCostSaved: 8,
  }))

  const makeStorage = () => definePackedStorage(layout, [
    new Float64Array([2, 5]),
    new Float64Array([0, 0]),
  ])
  const sequential = makeStorage()
  executeResidentRegionJS(advance, sequential)
  executeResidentRegionJS(consume, sequential)

  const referenceFused = makeStorage()
  executeResidentRegionJS(plan.fusedRegion, referenceFused)
  assert.deepEqual(
    referenceFused.buffers.map(buffer => [...buffer]),
    sequential.buffers.map(buffer => [...buffer]),
  )

  const compiledFused = makeStorage()
  const executorName = "__residentFusionSemantics"
  const executor = Function(`"use strict"; ${emitResidentRegionJS(plan.fusedRegion, executorName)}; return ${executorName}`)()
  executor(compiledFused)
  assert.deepEqual(
    compiledFused.buffers.map(buffer => [...buffer]),
    sequential.buffers.map(buffer => [...buffer]),
  )
  assert.deepEqual(compiledFused.buffers.map(buffer => [...buffer]), [[3, 6], [5, 11]])
})

test("residency is a hard gate even when estimated arithmetic savings are enormous", () => {
  const layout = definePackedLayout([{ name: "x", type: "f64" }], 4)
  const first = region("first", layout, [mapKernel([{ name: "x", value: load("x") }])])
  const second = region("second", layout, [mapKernel([{ name: "x", value: load("x") }])])
  const plan = planResidentRegionFusion({
    regions: [first, second],
    boundaries: [{
      residency: "objects",
      transferCost: 0,
      materializationCost: 0,
      synchronizationCost: 0,
    }],
    computeCostSaved: 1_000_000,
  })

  assert.equal(plan.eligible, false)
  assert.equal(plan.fusedRegion, null)
  assert.deepEqual(plan.rejections.map(reason => reason.code), ["boundary-residency"])
  assert.match(plan.rejections[0].message, /cannot cross object materialization or GPU authority/)
  assert.equal(plan.cost.objectBoundaryCount, 1)
  assert.equal(plan.cost.benefit, 1_000_000)
})

test("a forged object-backed region is rejected before economics", () => {
  const layout = definePackedLayout([{ name: "x", type: "f64" }], 1)
  const packed = region("packed", layout, [mapKernel([{ name: "x", value: load("x") }])])
  const objectBacked = Object.freeze({ ...packed, id: "object-backed", inputResidency: "objects" })
  const plan = planResidentRegionFusion({
    regions: [objectBacked, packed],
    boundaries: [packedBoundary()],
    computeCostSaved: 1_000_000,
  })

  assert.equal(plan.eligible, false)
  assert.deepEqual(plan.rejections.map(reason => reason.code), ["region-residency"])
  assert.equal(plan.rejections[0].regionIndex, 0)
})

test("summed boundary costs can reject a large operation candidate", () => {
  const layout = definePackedLayout([{ name: "x", type: "f64" }], 1)
  const regions = ["one", "two", "three"].map(id => region(
    id,
    layout,
    [mapKernel([{ name: "x", value: binary("*", load("x"), constant(2)) }])],
    { estimatedOpsPerItem: 500 },
  ))
  const plan = planResidentRegionFusion({
    regions,
    boundaries: [
      packedBoundary({ transferCost: 160, materializationCost: 80, synchronizationCost: 20 }),
      packedBoundary({ transferCost: 150, materializationCost: 70, synchronizationCost: 30 }),
    ],
    computeCostSaved: 500,
  })

  assert.equal(plan.eligible, false)
  assert.equal(plan.cost.benefit, -10)
  assert.deepEqual(plan.rejections.map(reason => reason.code), ["non-positive-benefit"])
})

test("a smaller zero-copy packed chain is eligible when its end-to-end benefit is positive", () => {
  const layout = definePackedLayout([{ name: "x", type: "f64" }], 1)
  const first = region("small-a", layout, [mapKernel([{ name: "x", value: binary("+", load("x"), constant(1)) }])])
  const second = region("small-b", layout, [mapKernel([{ name: "x", value: binary("*", load("x"), constant(2)) }])])
  const plan = planResidentRegionFusion({
    id: "small-packed-chain",
    regions: [first, second],
    boundaries: [packedBoundary()],
    computeCostSaved: 3,
  })

  assert.equal(plan.eligible, true)
  assert.equal(plan.fusedRegion.id, "small-packed-chain")
  assert.equal(plan.cost.benefit, 3)
})

test("structural incompatibilities return deterministic explicit rejection reasons", () => {
  const leftLayout = definePackedLayout([{ name: "x", type: "f64" }], 1)
  const rightLayout = definePackedLayout([{ name: "x", type: "f32" }], 1)
  const first = region("left", leftLayout, [mapKernel([{ name: "x", value: load("x") }])])
  const second = region("right", rightLayout, [mapKernel([{ name: "x", value: load("x") }])], {
    lifetime: "frame-persistent",
  })
  const plan = planResidentRegionFusion({
    regions: [first, second],
    boundaries: [],
    computeCostSaved: 100,
  })

  assert.equal(plan.eligible, false)
  assert.deepEqual(plan.rejections.map(reason => reason.code), [
    "boundary-count-mismatch",
    "lifetime-mismatch",
    "connection-layout-mismatch",
  ])
  assert.deepEqual(plan.rejections.map(reason => ({
    regionIndex: reason.regionIndex,
    boundaryIndex: reason.boundaryIndex,
  })), [
    { regionIndex: undefined, boundaryIndex: undefined },
    { regionIndex: 1, boundaryIndex: undefined },
    { regionIndex: undefined, boundaryIndex: 0 },
  ])
})

test("invalid normalized cost inputs fail before producing a misleading plan", () => {
  assert.throws(() => estimateResidentFusionCost({
    computeCostSaved: Number.NaN,
    boundaries: [],
  }), /finite non-negative/)
  assert.throws(() => estimateResidentFusionCost({
    computeCostSaved: 1,
    boundaries: [packedBoundary({ synchronizationCost: -1 })],
  }), /finite non-negative/)
})

test("resident optimizer removes overwritten fields and folds safe arithmetic identities", () => {
  const layout = definePackedLayout([
    { name: "x", type: "f32" },
    { name: "y", type: "f32" },
  ], 4)
  const kernels = [
    mapKernel([
      { name: "x", value: binary("+", load("x"), constant(0)) },
      { name: "y", value: binary("*", load("y"), constant(1)) },
    ]),
    mapKernel([{ name: "x", value: binary("+", load("y"), constant(2)) }]),
  ]
  const optimized = optimizeResidentKernelSequence(kernels, layout)
  assert.equal(optimized.stats.eliminatedOutputs, 1)
  assert.deepEqual(optimized.stats.liveInputFields, ["y"])
  assert.deepEqual(optimized.kernels[0].outputs.map(output => output.name), ["y"])
  assert.deepEqual(optimized.kernels[0].outputs[0].value, load("y"))
  assert.ok(optimized.stats.estimatedOpsPerItem < 7)
})
