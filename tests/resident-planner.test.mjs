/* SPDX-License-Identifier: MIT */

import assert from "node:assert/strict"
import test from "node:test"
import { definePackedLayout, defineResidentRegion } from "../packages/core/dist/resident-execution.js"
import { defineParticleFieldGPUIslandIR } from "../packages/compiler/dist/gpu-island-ir.js"
import { planGPUIslandBackend, planResidentRegionChain } from "../packages/compiler/dist/resident-planner.js"

const load = name => ({ op: "load", path: [name] })
const binary = (operator, left, right) => ({ op: "binary", operator, left, right })
const layout = definePackedLayout([{ name: "x", type: "f32" }], 4096)
const region = (id, value) => defineResidentRegion({
  id,
  source: { kind: "packed", layout },
  kernels: [{
    kind: "map",
    itemName: "row",
    preserveInput: true,
    outputs: [{ name: "x", value }],
    captures: [],
    requiresTypeProof: true,
  }],
  sink: { kind: "packed", layout },
  typeProof: "numeric-packed",
  lifetime: "frame-persistent",
  inputResidency: "packed",
  outputResidency: "packed",
  estimatedTransferBytes: 0,
})

const packedBoundary = { residency: "packed", transferCost: 0, materializationCost: 0, synchronizationCost: 0 }
const capabilities = { wasm: true, simd: true, worker: true, sharedMemory: true, crossOriginIsolated: true, webgpu: true }

test("resident planner makes packed JS mandatory and native promotion measurement-driven", () => {
  const plan = planResidentRegionChain({
    regions: [region("load", load("x")), region("advance", binary("+", load("x"), { op: "const", value: 1 }))],
    boundaries: [packedBoundary],
    computeCostSaved: 30,
    capabilities,
    experimentalResidentCompute: true,
    frameBudget: { level: "comfortable", pressure: 0.4 },
  })
  assert.equal(plan.fusion.eligible, true)
  assert.equal(plan.selectionRule, "predict-then-calibrate-against-packed-js")
  assert.equal(plan.backends.find(item => item.backend === "packed-js").status, "ready")
  assert.equal(plan.backends.find(item => item.backend === "wasm-simd").status, "measurement-required")
  assert.equal(plan.backends.find(item => item.backend === "shared-worker-wasm").status, "blocked")
  assert.match(plan.backends.find(item => item.backend === "shared-worker-wasm").reason, /frame pressure/)
  assert.equal(plan.backends.find(item => item.backend === "webgpu").status, "blocked")
})

test("native and GPU planning are disabled unless explicitly opted in", () => {
  const plan = planResidentRegionChain({
    regions: [region("a", load("x")), region("b", load("x"))],
    boundaries: [packedBoundary],
    computeCostSaved: 20,
    capabilities,
  })
  assert.equal(plan.backends.find(item => item.backend === "packed-js").status, "ready")
  assert.equal(plan.backends.find(item => item.backend === "wasm-simd").status, "blocked")
  assert.match(plan.backends.find(item => item.backend === "wasm-simd").reason, /disabled/)
  const ir = defineParticleFieldGPUIslandIR({ id: "off", count: 64 })
  assert.equal(planGPUIslandBackend(ir, capabilities).backends.find(item => item.backend === "webgpu").status, "blocked")
  assert.equal(planGPUIslandBackend(ir, capabilities, true).backends.find(item => item.backend === "webgpu").status, "ready")
})

test("shared Worker becomes a measured candidate only under frame pressure", () => {
  const plan = planResidentRegionChain({
    regions: [region("a", load("x")), region("b", load("x"))],
    boundaries: [packedBoundary],
    computeCostSaved: 20,
    capabilities,
    experimentalResidentCompute: true,
    frameBudget: { level: "critical", pressure: 1.4 },
  })
  assert.equal(plan.backends.find(item => item.backend === "shared-worker-wasm").status, "measurement-required")
})

test("object materialization boundary dominates a large arithmetic estimate", () => {
  const plan = planResidentRegionChain({
    regions: [region("a", load("x")), region("b", load("x"))],
    boundaries: [{ residency: "objects", transferCost: 1, materializationCost: 1, synchronizationCost: 0 }],
    computeCostSaved: 500,
    capabilities,
  })
  assert.equal(plan.fusion.eligible, false)
  assert.equal(plan.backends.find(item => item.backend === "wasm-simd").status, "blocked")
})

test("GPU planner accepts only a no-readback GPUCanvas island", () => {
  const ir = defineParticleFieldGPUIslandIR({ id: "particles", count: 65_536 })
  const plan = planGPUIslandBackend(ir, capabilities, true)
  assert.equal(plan.backends.find(item => item.backend === "webgpu").status, "ready")
  assert.equal(plan.readbackBytes, 0)
  assert.equal(plan.backends.find(item => item.backend === "renderer-fallback").status, "ready")
  assert.throws(() => planGPUIslandBackend({ ...ir, outputResidency: "packed" }, capabilities, true), /gpu -> gpu/)
})
