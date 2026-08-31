import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ExecutionRegion,
  FrameBudgetSignal,
  defineBufferLayout,
} from "../packages/execution/dist/index.js";
import {
  ResidentAdaptiveNativeScheduler,
  ResidentWasmPromotion,
  bindResidentWasmRegion,
  createResidentWasmMemory,
  executeResidentWasm,
  instantiateResidentWasmRuntime,
  loadDefaultResidentWasmRuntime,
} from "../packages/execution/dist/resident-wasm.js";
import {
  ResidentSharedWorkerExecutor,
  ResidentSharedWorkerPool,
  ResidentSharedWorkerPromotion,
  validateResidentWorkerControlMessage,
} from "../packages/execution/dist/resident-worker.js";
import {
  analyzeResidentWasmRegion,
  compileResidentWasmRegion,
} from "../packages/compiler/dist/resident-wasm.js";

function region(length, options = {}) {
  const fields = [
    { name: "x", type: "f32" },
    { name: "y", type: "f32" },
  ];
  const layout = { fields, length };
  return {
    version: 1,
    id: options.id ?? `resident-native-${length}`,
    source: { kind: "packed", layout },
    sink: { kind: "packed", layout },
    typeProof: "numeric-packed",
    lifetime: options.lifetime ?? "persistent",
    inputResidency: "packed",
    outputResidency: "packed",
    estimatedOpsPerItem: 10,
    estimatedTransferBytes: options.estimatedTransferBytes ?? 0,
    kernels: options.kernels ?? [
      {
        kind: "map",
        itemName: "row",
        indexName: "index",
        preserveInput: true,
        captures: ["offset", "scale", "threshold"],
        requiresTypeProof: true,
        outputs: [
          {
            name: "x",
            value: {
              op: "binary",
              operator: "+",
              left: {
                op: "binary",
                operator: "*",
                left: { op: "load", path: ["x"] },
                right: { op: "capture", name: "scale" },
              },
              right: { op: "index" },
            },
          },
          {
            name: "y",
            value: {
              op: "binary",
              operator: "+",
              left: { op: "load", path: ["y"] },
              right: { op: "capture", name: "offset" },
            },
          },
        ],
      },
      {
        kind: "map",
        itemName: "row",
        preserveInput: true,
        captures: ["threshold"],
        requiresTypeProof: true,
        outputs: [
          {
            name: "x",
            value: {
              op: "select",
              condition: {
                op: "binary",
                operator: ">",
                left: { op: "load", path: ["x"] },
                right: { op: "capture", name: "threshold" },
              },
              whenTrue: { op: "load", path: ["x"] },
              whenFalse: { op: "capture", name: "threshold" },
            },
          },
          {
            name: "y",
            value: {
              op: "binary",
              operator: "*",
              left: { op: "load", path: ["y"] },
              right: { op: "load", path: ["x"] },
            },
          },
        ],
      },
    ],
  };
}

function layout(length) {
  return defineBufferLayout([
    { name: "x", type: "f32", length },
    { name: "y", type: "f32", length },
  ]);
}

function views(binding) {
  return binding.buffer.cpuViews;
}

function seed(binding) {
  const [x, y] = views(binding);
  for (let index = 0; index < binding.length; index += 1) {
    x[index] = (index - 3) * 0.25;
    y[index] = index + 1;
  }
}

function jsExecute(binding, captures, ranges = [{ start: 0, end: binding.length }]) {
  const [x, y] = views(binding);
  const [offset, scale, threshold] = captures;
  for (const range of ranges) {
    for (let index = range.start; index < range.end; index += 1) {
      const nextX = x[index] * scale + index;
      const nextY = y[index] + offset;
      x[index] = nextX;
      y[index] = nextY;
      const secondX = x[index] > threshold ? x[index] : threshold;
      const secondY = y[index] * x[index];
      x[index] = secondX;
      y[index] = secondY;
    }
  }
}

async function bindingFor(candidate, bufferLayout, { shared = false, preferSimd = true } = {}) {
  const memory = createResidentWasmMemory(Math.max(2 * 65536, bufferLayout.byteLength + 256 * 1024), shared);
  const runtime = await loadDefaultResidentWasmRuntime({ memory, preferSimd });
  return bindResidentWasmRegion(runtime, bufferLayout, compileResidentWasmRegion(candidate));
}

test("resident compiler rejects boundary costs and unsupported expressions explicitly", () => {
  assert.deepEqual(analyzeResidentWasmRegion(region(8, { lifetime: "single-use" })).reasons, ["single-use-region"]);
  assert.deepEqual(analyzeResidentWasmRegion(region(8, { estimatedTransferBytes: 32 })).reasons, ["transfer-required"]);
  const unsupported = region(8);
  unsupported.kernels[0].outputs[0].value.operator = "%";
  assert.deepEqual(analyzeResidentWasmRegion(unsupported).reasons, ["unsupported-expression"]);
});

test("resident compiler emits a region-specialized direct WASM module without interpreter dispatch", async () => {
  const length = 4096;
  const candidate = region(length);
  const program = compileResidentWasmRegion(candidate);
  assert.equal(program.directEntrypoint, "resident_execute_direct");
  assert.ok(program.directModuleBytes instanceof Uint8Array);
  assert.ok(program.directModuleBytes.byteLength > 8);
  assert.equal(WebAssembly.validate(program.directModuleBytes), true);
  assert.equal(program.directSimdEntrypoint, "resident_execute_direct_simd");
  assert.ok(program.directSimdModuleBytes instanceof Uint8Array);
  assert.ok(program.directSimdModuleBytes.byteLength > program.directModuleBytes.byteLength);
  assert.equal(WebAssembly.validate(program.directSimdModuleBytes), true);
  assert.equal(program.directSharedSimdEntrypoint, "resident_execute_direct_simd");
  assert.ok(program.directSharedSimdModuleBytes instanceof Uint8Array);
  assert.equal(WebAssembly.validate(program.directSharedSimdModuleBytes), true);
  assert.ok(program.costProfile.weightedOpsPerItem > program.operationCount);
  assert.ok(program.costProfile.simdSuitability >= 0.75);
  assert.ok(program.costProfile.loadOpsPerItem > 0);
  assert.ok(program.costProfile.storeOpsPerItem > 0);

  const binding = await bindingFor(candidate, layout(length));
  assert.equal(typeof binding.directExecute, "function");
  assert.equal(binding.directBackend, "wasm-aot-simd");
  seed(binding);
  const captures = new Float32Array([1.25, 1.5, 2.75]);
  const metrics = executeResidentWasm(binding, { captures });
  assert.equal(metrics.backend, "wasm-aot-simd");

  const reference = await bindingFor(candidate, layout(length), { preferSimd: false });
  seed(reference);
  jsExecute(reference, captures);
  assert.deepEqual([...views(binding)[0]], [...views(reference)[0]]);
  assert.deepEqual([...views(binding)[1]], [...views(reference)[1]]);
});

test("scalar and real SIMD modules keep authoritative memory and fused results in parity", async () => {
  const length = 1027;
  const candidate = region(length);
  const bufferLayout = layout(length);
  const scalar = await bindingFor(candidate, bufferLayout, { preferSimd: false });
  const simd = await bindingFor(candidate, bufferLayout, { preferSimd: true });
  assert.equal(scalar.runtime.variant, "scalar");
  assert.equal(simd.runtime.variant, "simd");
  seed(scalar);
  seed(simd);
  const scalarBuffer = scalar.runtime.memory.buffer;
  const simdBuffer = simd.runtime.memory.buffer;
  const scalarViews = views(scalar);
  const simdViews = views(simd);
  const captures = new Float32Array([1.25, 1.5, 2.75]); // compiler order: offset, scale, threshold
  const ranges = [{ start: 0, end: 511 }, { start: 600, end: length }];
  const scalarMetrics = executeResidentWasm(scalar, { captures, ranges });
  const simdMetrics = executeResidentWasm(simd, { captures, ranges });
  assert.equal(scalarMetrics.wasmCalls, 1);
  assert.equal(simdMetrics.wasmCalls, 1);
  assert.equal(simd.runtime.exports.resident_simd_enabled(), 1);
  assert.equal(scalar.runtime.memory.buffer, scalarBuffer);
  assert.equal(simd.runtime.memory.buffer, simdBuffer);
  assert.equal(views(scalar)[0], scalarViews[0]);
  assert.equal(views(simd)[0], simdViews[0]);
  assert.deepEqual([...views(simd)[0]], [...views(scalar)[0]]);
  assert.deepEqual([...views(simd)[1]], [...views(scalar)[1]]);
  assert.equal(simdMetrics.transferBytes, 0);
  assert.equal(simdMetrics.materializationBytes, 0);
  assert.equal(simdMetrics.readbackBytes, 0);
  const dirty = simd.buffer.consumeDirtyRanges();
  assert.ok(dirty.length >= 2);
  assert.ok(dirty.every(range => range.end > range.start));
  assert.ok(dirty.reduce((total, range) => total + range.end - range.start, 0) < simd.buffer.byteLength);
  assert.throws(() => simd.runtime.memory.grow(1), /maximum|grow/i);
});

test("invalid SIMD bytes deterministically fall back to the checked-in scalar module", async () => {
  const scalarBytes = await readFile(new URL("../packages/execution/dist/wasm/resident-kernel-scalar.wasm", import.meta.url));
  const runtime = await instantiateResidentWasmRuntime({
    memory: createResidentWasmMemory(2 * 65536),
    simdBytes: new Uint8Array([0, 1, 2, 3]),
    scalarBytes,
  });
  assert.equal(runtime.variant, "scalar");
  assert.equal(runtime.exports.resident_simd_enabled(), 0);
});

test("runtime promotion skips trial execution for an obvious large SIMD win", async () => {
  const length = 16_384;
  const candidate = region(length);
  const binding = await bindingFor(candidate, layout(length));
  seed(binding);
  const captures = new Float32Array([1.25, 1.001, 2.75]);
  const executionRegion = new ExecutionRegion({
    id: candidate.id,
    inputs: [binding.buffer],
    outputs: [binding.buffer],
    lifetime: "persistent",
    noMaterialization: true,
    noReadback: true,
  });
  const promotion = new ResidentWasmPromotion({
    binding,
    region: executionRegion,
    minimumSamples: 2,
    minimumMargin: 0,
    experimental: true,
    packedJs: () => {
      jsExecute(binding, captures);
      const end = performance.now() + 2;
      while (performance.now() < end) {}
    },
  });
  assert.equal(promotion.execute({ captures }), "wasm-aot-simd");
  const snapshot = promotion.snapshot();
  assert.equal(snapshot.decision, "wasm");
  assert.equal(snapshot.reason, "predicted-win");
  assert.equal(snapshot.baseline, null);
  assert.equal(snapshot.candidate.samples, 1);
  assert.equal(snapshot.scheduler.choice, "wasm");
  assert.equal(snapshot.scheduler.activeRows, length);
  assert.equal(snapshot.transferBytes, 0);
  assert.equal(snapshot.materializationBytes, 0);
  assert.equal(snapshot.readbackBytes, 0);
});

test("runtime keeps tiny resident work on packed JS without paying a WASM trial", async () => {
  const length = 8;
  const identityKernels = [{
    kind: "map",
    itemName: "row",
    preserveInput: true,
    captures: [],
    requiresTypeProof: true,
    outputs: [
      { name: "x", value: { op: "load", path: ["x"] } },
      { name: "y", value: { op: "load", path: ["y"] } },
    ],
  }];
  const candidate = region(length, { kernels: identityKernels });
  const binding = await bindingFor(candidate, layout(length));
  seed(binding);
  const executionRegion = new ExecutionRegion({
    id: candidate.id,
    inputs: [binding.buffer],
    outputs: [binding.buffer],
    lifetime: "persistent",
    noMaterialization: true,
    noReadback: true,
  });
  const promotion = new ResidentWasmPromotion({
    binding,
    region: executionRegion,
    minimumSamples: 1,
    minimumMargin: 0,
    experimental: true,
    packedJs: () => {},
  });
  promotion.execute();
  const snapshot = promotion.snapshot();
  assert.equal(snapshot.decision, "packed-js");
  assert.equal(snapshot.reason, "predicted-win");
  assert.equal(snapshot.candidate, null);
  assert.equal(snapshot.scheduler.choice, "packed-js");
  assert.equal(promotion.execute(), "packed-js");
});

test("uncertain crossover work still calibrates against packed JS and learns the winner", async () => {
  const length = 1024;
  const candidate = region(length);
  const binding = await bindingFor(candidate, layout(length));
  seed(binding);
  const captures = new Float32Array([1.25, 1.001, 2.75]);
  const executionRegion = new ExecutionRegion({
    id: `${candidate.id}-calibration`,
    inputs: [binding.buffer],
    outputs: [binding.buffer],
    lifetime: "persistent",
    noMaterialization: true,
    noReadback: true,
  });
  const promotion = new ResidentWasmPromotion({
    binding,
    region: executionRegion,
    minimumSamples: 2,
    minimumMargin: 0,
    experimental: true,
    scheduler: new ResidentAdaptiveNativeScheduler({ lowWorkThreshold: 1, highWorkThreshold: 1_000_000_000 }),
    packedJs: () => {
      jsExecute(binding, captures);
      const end = performance.now() + 1;
      while (performance.now() < end) {}
    },
  });
  for (let sample = 0; sample < 4; sample += 1) promotion.execute({ captures });
  const snapshot = promotion.snapshot();
  assert.equal(snapshot.decision, "wasm");
  assert.equal(snapshot.reason, "measured-win");
  assert.ok(snapshot.baseline.samples >= 2);
  assert.ok(snapshot.candidate.samples >= 2);
  assert.ok(snapshot.measuredRatio < 1);
});

test("shared Worker receives control metadata only and executes the same authoritative memory", async () => {
  const length = 1027;
  const candidate = region(length);
  const binding = await bindingFor(candidate, layout(length), { shared: true });
  seed(binding);
  const sent = [];
  const worker = new Worker(new URL("../packages/execution/dist/wasm/resident-worker.mjs", import.meta.url), { type: "module" });
  const transport = {
    postMessage(message) { sent.push(message); worker.postMessage(message); },
    on(type, listener) { worker.on(type, listener); },
    off(type, listener) { worker.off(type, listener); },
    terminate() { return worker.terminate(); },
  };
  const executor = new ResidentSharedWorkerExecutor(binding, transport);
  const captures = new Float32Array([1.25, 1.5, 2.75]);
  const reference = await bindingFor(candidate, layout(length), { preferSimd: false });
  seed(reference);
  executeResidentWasm(reference, { captures });
  try {
    const metrics = await executor.execute({ captures });
    assert.equal(metrics.wasmCalls, 1);
    assert.equal(metrics.transferBytes, 0);
    assert.equal(metrics.materializationBytes, 0);
    assert.equal(metrics.readbackBytes, 0);
    assert.equal(Atomics.load(binding.control, 7), 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, "init");
    assert.equal(sent[0].memory, binding.runtime.memory);
    assert.equal("rows" in sent[0], false);
    assert.equal("values" in sent[0], false);
    assert.equal("buffers" in sent[0], false);
    assert.deepEqual([...views(binding)[0]], [...views(reference)[0]]);
    assert.deepEqual([...views(binding)[1]], [...views(reference)[1]]);

    const frameBudget = new FrameBudgetSignal({ budgetMs: 8, alpha: 1 });
    const promotion = new ResidentSharedWorkerPromotion({
      executor,
      frameBudget,
      packedJs: () => jsExecute(binding, captures),
      minimumSamples: 1,
      minimumMargin: 0,
      experimental: true,
    });
    const beforeCalls = Atomics.load(binding.control, 7);
    assert.equal(await promotion.execute({ captures }), "packed-js");
    assert.equal(Atomics.load(binding.control, 7), beforeCalls);
    assert.equal(promotion.snapshot().reason, "worker-frame-pressure-required");
    frameBudget.observe(16);
    assert.equal(await promotion.execute({ captures }), "shared-worker-wasm");
    assert.equal(Atomics.load(binding.control, 7), beforeCalls + 1);
    assert.ok(promotion.snapshot().framePressure >= 1);
  } finally {
    await executor.close();
  }
});

test("worker control validator rejects row payloads", () => {
  assert.doesNotThrow(() => validateResidentWorkerControlMessage({ type: "done", sequence: 1 }));
  assert.throws(
    () => validateResidentWorkerControlMessage({ type: "done", sequence: 1, rows: new Float32Array(4) }),
    /worker-control-payload-invalid/,
  );
});

test("resident Worker pool retains hot bindings and caps persistent Worker count", async () => {
  const first = await bindingFor(region(257, { id: "pool-first" }), layout(257), { shared: true });
  const second = await bindingFor(region(257, { id: "pool-second" }), layout(257), { shared: true });
  seed(first);
  seed(second);
  const captures = new Float32Array([1.25, 1.5, 2.75]);
  let created = 0;
  const pool = new ResidentSharedWorkerPool({
    maxWorkers: 1,
    workerFactory: () => {
      created += 1;
      const worker = new Worker(new URL("../packages/execution/dist/wasm/resident-worker.mjs", import.meta.url), { type: "module" });
      return {
        postMessage(message) { worker.postMessage(message); },
        on(type, listener) { worker.on(type, listener); },
        off(type, listener) { worker.off(type, listener); },
        terminate() { return worker.terminate(); },
      };
    },
  });
  try {
    assert.equal((await pool.execute(first, { captures })).backend, "shared-worker-wasm");
    assert.equal((await pool.execute(first, { captures })).backend, "shared-worker-wasm");
    assert.equal(created, 1, "the initialized Worker is retained for the hot binding");
    assert.equal(pool.snapshot().size, 1);
    assert.equal((await pool.execute(second, { captures })).backend, "shared-worker-wasm");
    const snapshot = pool.snapshot();
    assert.equal(created, 2);
    assert.equal(snapshot.size, 1);
    assert.equal(snapshot.maxWorkers, 1);
    assert.equal(snapshot.evictedWorkers, 1);
    assert.equal(snapshot.queuedJobs, 0);
    assert.equal(snapshot.activeBindings, 0);
  } finally {
    await pool.close();
  }
});
