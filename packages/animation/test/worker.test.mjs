import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionEngine, motionValue, spring } from '../src/index.js';
import { JsSpringBatch } from '../src/core/js-spring-batch.js';
import { SharedSpringWorkerBackend } from '../src/worker/index.js';

function seed(batch, count) {
  for (let i = 0; i < count; i += 1) {
    batch.positions[i] = (i % 11) * 1.5;
    batch.velocities[i] = (i % 5) - 2;
    batch.targets[i] = 80 - (i % 13);
    batch.omegas[i] = 12 + (i % 4);
    batch.dampingRatios[i] = 0.75 + (i % 3) * 0.04;
  }
}

test('shared Worker + WASM kernel tracks JS without copying state buffers', async (t) => {
  if (!SharedSpringWorkerBackend.isSupported()) return t.skip('Shared WebAssembly memory unavailable');
  const count = 257;
  const js = new JsSpringBatch(count);
  const worker = await SharedSpringWorkerBackend.create(1024);
  t.after(() => worker.dispose());
  seed(js, count);
  seed(worker, count);
  for (let frame = 0; frame < 60; frame += 1) {
    js.step(count, 1 / 60);
    await worker.stepAsync(count, 1 / 60);
  }
  for (let i = 0; i < count; i += 1) {
    assert(Math.abs(js.positions[i] - worker.positions[i]) < 0.002, `position mismatch at ${i}`);
    assert(Math.abs(js.velocities[i] - worker.velocities[i]) < 0.01, `velocity mismatch at ${i}`);
  }
  assert(worker.batch.memory.buffer instanceof SharedArrayBuffer);
});

test('MotionEngine can promote to shared Worker backend for async stepping', async (t) => {
  if (!SharedSpringWorkerBackend.isSupported()) return t.skip('Shared WebAssembly memory unavailable');
  const engine = new MotionEngine({
    autoStart: false,
    wasm: false,
    worker: true,
    workerThreshold: 8,
    maxWasmMotions: 1024,
  });
  t.after(() => engine.dispose());
  await engine.prepareWorker();
  const values = Array.from({ length: 16 }, () => motionValue(0));
  for (const value of values) engine.animate(value, 100, spring());
  await engine.stepAsync(16.6667);
  assert.equal(engine.stats.promotedToWorker, true);
  assert.match(engine.stats.backend, /^worker-wasm-/);
  assert(values.every((value) => value.get() > 0));
});

test('shared Worker serializes overlapping stepAsync submissions', async (t) => {
  if (!SharedSpringWorkerBackend.isSupported()) return t.skip('Shared WebAssembly memory unavailable');
  const worker = await SharedSpringWorkerBackend.create(1024);
  t.after(() => worker.dispose());
  seed(worker, 64);
  const first = worker.stepAsync(64, 1 / 120);
  const second = worker.stepAsync(64, 1 / 120);
  await Promise.all([first, second]);
  assert(Number.isFinite(worker.positions[0]));
});
