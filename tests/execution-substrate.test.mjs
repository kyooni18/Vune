import assert from "node:assert/strict";
import test from "node:test";

import {
  BackendCapability,
  ExecutionRegion,
  ExecutionTelemetry,
  FrameBudgetGovernor,
  GpuResidentBuffer,
  ResidentBuffer,
  SerializedExecutionQueue,
  defineBufferLayout,
  resolveResidentComputeExperimental,
} from "../packages/execution/dist/index.js";

test("Resident Compute is explicitly opt-in and supports per-backend switches", () => {
  assert.deepEqual(resolveResidentComputeExperimental(), { enabled: false, wasm: false, worker: false, gpu: false });
  assert.deepEqual(resolveResidentComputeExperimental(true), { enabled: true, wasm: true, worker: true, gpu: true });
  assert.deepEqual(resolveResidentComputeExperimental({ enabled: true, worker: false }), { enabled: true, wasm: true, worker: false, gpu: true });
});

test("resident buffers expose CPU views only on CPU variants and track storage epochs", () => {
  const layout = defineBufferLayout([
    { name: "x", type: "f32", length: 4 },
    { name: "color", type: "u32", length: 4 },
  ]);
  const cpu = ResidentBuffer.js(layout, [new Float32Array(4), new Uint32Array(4)]);
  assert.equal(cpu.kind, "js");
  assert.equal(cpu.cpuViews.length, 2);
  assert.equal(cpu.storageEpoch, 0);
  cpu.markWritten();
  assert.equal(cpu.contentVersion, 1);
  cpu.markWritten(4, 12);
  cpu.markWritten(8, 16);
  assert.deepEqual(cpu.consumeDirtyRanges(), [{ start: 0, end: layout.byteLength, version: 3 }]);
  cpu.rebindCpuViews([new Float32Array(4), new Uint32Array(4)]);
  assert.equal(cpu.storageEpoch, 1);
  assert.deepEqual(cpu.dirtyRanges, [{ start: 0, end: layout.byteLength, version: 4 }]);

  const gpu = ResidentBuffer.gpu(layout, { label: "positions" });
  assert.ok(gpu instanceof GpuResidentBuffer);
  assert.equal("cpuViews" in gpu, false);
  assert.deepEqual(gpu.resource, { label: "positions" });
});

test("execution regions require resident no-materialization and no-readback invariants", () => {
  const layout = defineBufferLayout([{ name: "value", type: "f32", length: 2 }]);
  const source = ResidentBuffer.js(layout, [new Float32Array(2)]);
  const sink = ResidentBuffer.gpu(layout, { label: "render-storage" });
  const region = new ExecutionRegion({
    id: "particles",
    inputs: [source],
    outputs: [sink],
    lifetime: "frame-persistent",
    noMaterialization: true,
    noReadback: true,
    entrypoints: { webgpu: context => context },
  });
  const capability = new BackendCapability({
    backend: "webgpu",
    available: true,
    residentKinds: ["js", "gpu"],
    supportsPersistentMemory: true,
    supportsSharedMemory: false,
    supportsGpuSink: true,
    webgpuLimits: { maxStorageBufferBindingSize: 65536 },
    requiredWebgpuLimits: { maxStorageBufferBindingSize: 32768 },
  });
  assert.equal(capability.supports(region), true);
  assert.equal(region.execute("webgpu", "draw"), "draw");
  const lost = new BackendCapability({
    ...capability,
    available: true,
    deviceState: "lost",
    deviceLossReason: "device-reset",
  });
  assert.equal(lost.rejectionReason(region), "device-reset");
  const limited = new BackendCapability({
    ...capability,
    available: true,
    webgpuLimits: { maxStorageBufferBindingSize: 1024 },
  });
  assert.equal(limited.rejectionReason(region), "webgpu-limit-maxStorageBufferBindingSize");
  assert.throws(() => new ExecutionRegion({ ...region, id: "bad", noReadback: false }), /cannot read GPU results back/u);
});

test("shared-WASM capability rejects missing isolation before worker promotion", () => {
  const layout = defineBufferLayout([{ name: "value", type: "f32", length: 2 }]);
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
  const shared = ResidentBuffer.sharedWasm(layout, memory, [new Float32Array(memory.buffer, 0, 2)]);
  const region = new ExecutionRegion({
    id: "worker",
    inputs: [shared],
    outputs: [shared],
    lifetime: "persistent",
    noMaterialization: true,
    noReadback: true,
  });
  const capability = new BackendCapability({
    backend: "shared-worker-wasm",
    available: true,
    residentKinds: ["shared-wasm"],
    supportsPersistentMemory: true,
    supportsSharedMemory: true,
    supportsGpuSink: false,
    supportsSimd: true,
    requiresCrossOriginIsolated: true,
    crossOriginIsolated: false,
    sharedMemoryAvailable: true,
  });
  assert.equal(capability.supportsSimd, true);
  assert.equal(capability.rejectionReason(region), "cross-origin-isolation-required");
});

test("execution telemetry compares complete native cost with its packed-JS baseline", () => {
  const telemetry = new ExecutionTelemetry();
  assert.equal(telemetry.compareWithPackedJs("wasm-simd").ready, false);
  telemetry.record({ backend: "packed-js", computeMs: 7 });
  telemetry.record({ backend: "packed-js", computeMs: 5 });
  telemetry.record({ backend: "wasm-simd", computeMs: 2, transferMs: 1, synchronizationBytes: 16, synchronizationMs: 0.5 });
  const comparison = telemetry.compareWithPackedJs("wasm-simd");
  assert.equal(comparison.ready, true);
  assert.equal(comparison.wins, true);
  assert.equal(comparison.savedMs, 2.5);
  assert.equal(telemetry.aggregate("wasm-simd").synchronizationBytes, 16);
  assert.equal(telemetry.packedJsBaseline().totalMs, 6);
});

test("recent execution telemetry uses a bounded median so cold outliers do not pin backend policy", () => {
  const telemetry = new ExecutionTelemetry();
  telemetry.record({ backend: "packed-js", computeMs: 50 });
  telemetry.record({ backend: "packed-js", computeMs: 5 });
  telemetry.record({ backend: "packed-js", computeMs: 5.2 });
  telemetry.record({ backend: "packed-js", computeMs: 4.8 });
  telemetry.record({ backend: "wasm-simd", computeMs: 30 });
  telemetry.record({ backend: "wasm-simd", computeMs: 3 });
  telemetry.record({ backend: "wasm-simd", computeMs: 3.2 });
  telemetry.record({ backend: "wasm-simd", computeMs: 2.8 });

  assert.equal(telemetry.recentPackedJsBaseline().totalMs, 5.1);
  assert.equal(telemetry.recentAggregate("wasm-simd").totalMs, 3.1);
  const comparison = telemetry.compareRecentWithPackedJs("wasm-simd");
  assert.equal(comparison.ready, true);
  assert.equal(comparison.wins, true);
  assert.ok(comparison.ratio < 0.7);
});

test("shared frame budget reports pressure while policy stays outside the substrate", () => {
  const budget = new FrameBudgetGovernor({ budgetMs: 4, alpha: 1 });
  assert.equal("wasmThreshold" in budget, false);
  assert.equal(budget.observe(5).level, "critical");
  assert.equal(budget.snapshot().pressure, 1.25);
});

test("serialized execution queue preserves order across async failures", async () => {
  const queue = new SerializedExecutionQueue();
  const order = [];
  const first = queue.enqueue(async () => { order.push("first"); return 1; });
  const failed = queue.enqueue(async () => { order.push("failed"); throw new Error("expected"); });
  const last = queue.enqueue(async () => { order.push("last"); return 3; });
  assert.equal(await first, 1);
  await assert.rejects(failed, /expected/u);
  assert.equal(await last, 3);
  await queue.idle();
  assert.deepEqual(order, ["first", "failed", "last"]);
  assert.equal(queue.pending, 0);
});
