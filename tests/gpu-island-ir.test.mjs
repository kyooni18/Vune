/* SPDX-License-Identifier: MIT */

import assert from "node:assert/strict"
import test from "node:test"
import { defineLineChartGPUIslandIR, defineParticleFieldGPUIslandIR } from "../packages/compiler/dist/gpu-island-ir.js"

test("GPU Island IR proves compute-to-render residency without a readback usage", () => {
  const ir = defineParticleFieldGPUIslandIR({ id: "stars", count: 65_536 })
  assert.equal(ir.inputResidency, "gpu")
  assert.equal(ir.outputResidency, "gpu")
  assert.equal(ir.readback, "forbidden")
  assert.equal(ir.materialization, "renderer-owned")
  assert.equal(ir.compute.writes[0], "particles")
  assert.equal(ir.render.reads[0], "particles")
  assert.equal(ir.compute.dispatchCount, 1024)
  assert.equal(ir.render.vertexCount, 65_536)
  assert.equal(ir.estimatedUploadBytesPerFrame, 16)
  const particles = ir.buffers.find(buffer => buffer.name === "particles")
  assert.deepEqual(particles.usages, ["storage", "vertex", "copy-dst"])
  assert.equal(particles.cpuReadable, false)
  assert.equal(Object.isFrozen(ir), true)
})

test("GPU Island IR rejects layouts and shader identifiers that cannot be proven", () => {
  assert.throws(() => defineParticleFieldGPUIslandIR({ id: "", count: 1 }), /non-empty id/)
  assert.throws(() => defineParticleFieldGPUIslandIR({ id: "x", count: 0 }), /positive safe integer/)
  assert.throws(() => defineParticleFieldGPUIslandIR({ id: "x", count: 1, particleStride: 30 }), /four-byte aligned/)
  assert.throws(() => defineParticleFieldGPUIslandIR({ id: "x", count: 1, workgroupSize: 257 }), /portable WebGPU limit/)
  assert.throws(() => defineParticleFieldGPUIslandIR({ id: "x", count: 1, workgroupSize: 32 }), /fixed 64-thread runtime workgroup/)
  assert.throws(() => defineParticleFieldGPUIslandIR({ id: "x", count: 1, computeEntryPoint: "bad-name" }), /WGSL identifier/)
})

test("LineChart GPU Island proves a second compute-to-render resident workload", () => {
  const ir = defineLineChartGPUIslandIR({ id: "timeline", count: 4097 })
  assert.equal(ir.kind, "line-chart")
  assert.equal(ir.inputResidency, "gpu")
  assert.equal(ir.outputResidency, "gpu")
  assert.equal(ir.readback, "forbidden")
  assert.equal(ir.compute.dispatchCount, 65)
  assert.deepEqual(ir.compute.writes, ["points"])
  assert.equal(ir.render.topology, "line-strip")
  assert.deepEqual(ir.render.reads, ["points"])
  assert.equal(ir.estimatedUploadBytesPerFrame, 16)
  const points = ir.buffers.find(buffer => buffer.name === "points")
  assert.equal(points.stride, 16)
  assert.deepEqual(points.usages, ["storage", "vertex", "copy-dst"])
  assert.equal(points.cpuReadable, false)
  assert.throws(() => defineLineChartGPUIslandIR({ id: "bad", count: 1 }), /at least two points/)
})
