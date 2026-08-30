import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionEngine, motionValue, spring, smooth } from '../src/index.js';

test('spring converges and settles', async () => {
  const engine = new MotionEngine({ autoStart: false, wasm: false });
  const x = motionValue(0);
  const controls = engine.animate(x, 100, spring({ response: 0.35, dampingRatio: 0.82 }));
  for (let i = 0; i < 300 && engine.springs.length; i += 1) engine.step(1000 / 60);
  const result = await controls.finished;
  assert.equal(result.status, 'finished');
  assert.equal(x.get(), 100);
});

test('retargeting preserves non-zero velocity', async () => {
  const engine = new MotionEngine({ autoStart: false, wasm: false });
  const x = motionValue(0);
  const first = engine.animate(x, 100, spring({ response: 0.5, dampingRatio: 0.8 }));
  for (let i = 0; i < 5; i += 1) engine.step(1000 / 60);
  const before = x.getVelocity();
  assert.notEqual(before, 0);
  const second = engine.animate(x, -50, spring({ response: 0.4, dampingRatio: 0.85 }));
  assert.notEqual(x.getVelocity(), 0);
  assert.equal((await first.finished).status, 'interrupted');
  for (let i = 0; i < 400 && engine.springs.length; i += 1) engine.step(1000 / 60);
  assert.equal((await second.finished).status, 'finished');
  assert.equal(x.get(), -50);
});

test('adaptive smooth profile resolves and runs', () => {
  const engine = new MotionEngine({ autoStart: false, wasm: false });
  const x = motionValue(0);
  engine.animate(x, 800, smooth());
  engine.step(16.6667);
  assert(x.get() > 0);
});

test('large dt does not explode', () => {
  const engine = new MotionEngine({ autoStart: false, wasm: false });
  const x = motionValue(0);
  engine.animate(x, 100, spring({ response: 0.24, dampingRatio: 0.75 }));
  engine.step(140);
  assert(Number.isFinite(x.get()));
  assert(Number.isFinite(x.getVelocity()));
  assert(Math.abs(x.get()) < 10000);
});


test('stale controls cannot cancel a retargeted spring', async () => {
  const engine = new MotionEngine({ autoStart: false, wasm: false });
  const x = motionValue(0);
  const oldControls = engine.animate(x, 100, spring());
  engine.step(16.6667);
  const newControls = engine.animate(x, 200, spring());
  oldControls.cancel();
  assert.equal(engine.springs.length, 1);
  for (let i = 0; i < 400 && engine.springs.length; i += 1) engine.step(1000 / 60);
  assert.equal((await newControls.finished).status, 'finished');
  assert.equal(x.get(), 200);
});
