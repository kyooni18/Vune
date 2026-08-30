import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionEngine, motionValue, spring } from '../src/index.js';

test('engine promotes a dense spring batch to WASM', async () => {
  const engine = new MotionEngine({ autoStart: false, wasm: 'auto', wasmThreshold: 8, maxWasmMotions: 1024 });
  await engine.prepareWasm();
  const values = Array.from({ length: 16 }, () => motionValue(0));
  for (const value of values) engine.animate(value, 100, spring());
  engine.step(16.6667);
  assert.equal(engine.stats.promotedToWasm, true);
  assert.match(engine.stats.backend, /^wasm-/);
  assert(values.every((value) => value.get() > 0));
});

test('auto WASM mode is truly lazy until the promotion threshold is reached', async () => {
  const engine = new MotionEngine({ autoStart: false, wasm: 'auto', wasmThreshold: 8, worker: false, maxWasmMotions: 1024 });
  assert.equal(engine.wasmPromise, null);
  const values = Array.from({ length: 8 }, () => motionValue(0));
  for (let i = 0; i < 7; i += 1) engine.animate(values[i], 100, spring());
  assert.equal(engine.wasmPromise, null);
  engine.animate(values[7], 100, spring());
  assert(engine.wasmPromise instanceof Promise);
  await engine.wasmPromise;
  engine.step(16.6667);
  assert.equal(engine.stats.promotedToWasm, true);
  engine.dispose();
});
