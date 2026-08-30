import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionEngine, motionValue, spring } from '../src/index.js';
import { SharedSpringWorkerBackend } from '../src/worker/index.js';

async function workerEngine(count = 32) {
  const engine = new MotionEngine({
    autoStart: false,
    wasm: false,
    worker: true,
    workerThreshold: 1,
    maxWasmMotions: 4096,
  });
  await engine.prepareWorker();
  const values = Array.from({ length: count }, (_, i) => motionValue(i * 0.01));
  for (const value of values) engine.animate(value, 100, spring({ response: 0.35, dampingRatio: 0.82 }));
  await engine.stepAsync(16.6667);
  return { engine, values };
}

test('retarget/remove/add are frame-boundary safe while Worker owns shared slots', async (t) => {
  if (!SharedSpringWorkerBackend.isSupported()) return t.skip('Shared WebAssembly memory unavailable');
  const { engine, values } = await workerEngine(64);
  t.after(() => engine.dispose());

  const backend = engine.workerBackend;
  const originalStepAsync = backend.stepAsync.bind(backend);
  let release;
  let enteredResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  backend.stepAsync = (count, dt) => new Promise((resolve, reject) => {
    enteredResolve();
    release = () => originalStepAsync(count, dt).then(resolve, reject);
  });

  const frame = engine.stepAsync(16.6667);
  await entered;
  assert.equal(engine.getBackendPlan().worker.inFlight, true);

  const oldRetarget = engine.byValue.get(values[0]).controlState.finished;
  engine.animate(values[0], -75, spring({ response: 0.28, dampingRatio: 0.78 }));

  engine.stop(values[1]);
  engine.animate(values[1], 240, spring({ response: 0.31, dampingRatio: 0.88 }));

  const cancelled = values[2];
  engine.stop(cancelled);

  assert(engine.stats.pendingMutations >= 2);
  release();
  await frame;

  assert.equal((await oldRetarget).status, 'interrupted');
  assert.equal(engine.getBackendPlan().worker.inFlight, false);
  assert.equal(engine.stats.pendingMutations, 0);
  assert.equal(engine.byValue.get(cancelled), undefined);

  const a0 = engine.byValue.get(values[0]);
  const a1 = engine.byValue.get(values[1]);
  assert(a0 && a0.active);
  assert(a1 && a1.active);
  assert.equal(engine.batch.targets[a0.index], -75);
  assert.equal(engine.batch.targets[a1.index], 240);

  backend.stepAsync = originalStepAsync;
  for (let i = 0; i < 240; i += 1) await engine.stepAsync(1000 / 120);
  assert(Math.abs(values[0].get() + 75) < 0.02);
  assert(Math.abs(values[1].get() - 240) < 0.02);
});

test('MotionEngine serializes overlapping async frames, not only backend calls', async (t) => {
  if (!SharedSpringWorkerBackend.isSupported()) return t.skip('Shared WebAssembly memory unavailable');
  const { engine } = await workerEngine(16);
  t.after(() => engine.dispose());

  const backend = engine.workerBackend;
  const originalStepAsync = backend.stepAsync.bind(backend);
  let concurrent = 0;
  let maxConcurrent = 0;
  backend.stepAsync = async (count, dt) => {
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise((resolve) => setTimeout(resolve, 3));
    try {
      return await originalStepAsync(count, dt);
    } finally {
      concurrent -= 1;
    }
  };

  await Promise.all([
    engine.stepAsync(8),
    engine.stepAsync(9),
    engine.stepAsync(10),
  ]);

  assert.equal(maxConcurrent, 1);
  assert.equal(engine.stats.asyncFrames >= 4, true);
});

test('finish during an in-flight Worker frame uses logical retarget, not stale shared target', async (t) => {
  if (!SharedSpringWorkerBackend.isSupported()) return t.skip('Shared WebAssembly memory unavailable');
  const { engine, values } = await workerEngine(8);
  t.after(() => engine.dispose());

  const backend = engine.workerBackend;
  const originalStepAsync = backend.stepAsync.bind(backend);
  let release;
  let enteredResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  backend.stepAsync = (count, dt) => new Promise((resolve, reject) => {
    enteredResolve();
    release = () => originalStepAsync(count, dt).then(resolve, reject);
  });

  const frame = engine.stepAsync(16.6667);
  await entered;
  const controls = engine.animate(values[0], 777, spring());
  controls.finish();
  assert.equal(values[0].get(), 777);
  release();
  await frame;
  assert.equal(values[0].get(), 777);
  assert.equal((await controls.finished).status, 'finished');
});

test('auto scheduler switches to async Worker frames once the backend is ready', async (t) => {
  if (!SharedSpringWorkerBackend.isSupported()) return t.skip('Shared WebAssembly memory unavailable');
  const savedRaf = globalThis.requestAnimationFrame;
  const savedCancel = globalThis.cancelAnimationFrame;
  const queue = [];
  let nextId = 1;
  globalThis.requestAnimationFrame = (callback) => {
    queue.push({ id: nextId, callback, cancelled: false });
    return nextId++;
  };
  globalThis.cancelAnimationFrame = (id) => {
    const entry = queue.find((item) => item.id === id);
    if (entry) entry.cancelled = true;
  };
  t.after(() => {
    globalThis.requestAnimationFrame = savedRaf;
    globalThis.cancelAnimationFrame = savedCancel;
  });

  const engine = new MotionEngine({
    autoStart: true,
    wasm: false,
    worker: true,
    workerThreshold: 1,
    maxWasmMotions: 1024,
  });
  t.after(() => engine.dispose());
  await engine.prepareWorker();
  const value = motionValue(0);
  engine.animate(value, 100, spring());

  const first = queue.shift();
  assert(first && !first.cancelled);
  first.callback(0);
  const second = queue.shift();
  assert(second && !second.cancelled);
  second.callback(16.6667);

  for (let i = 0; i < 100 && engine.stats.workerFrames === 0; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert(engine.stats.workerFrames >= 1);
  assert.match(engine.stats.backend, /^worker-wasm-/);
});
