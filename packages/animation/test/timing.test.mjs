import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionEngine, motionValue, timing, curves } from '../src/index.js';

test('timing reaches exact target', async () => {
  const engine = new MotionEngine({ autoStart: false, wasm: false });
  const x = motionValue(10);
  const controls = engine.animate(x, 20, timing({ duration: 0.2, curve: curves.easeInOut }));
  for (let i = 0; i < 20; i += 1) engine.step(1000 / 60);
  const result = await controls.finished;
  assert.equal(result.status, 'finished');
  assert.equal(x.get(), 20);
});

test('timing removal stays slot-indexed after swap removal', async () => {
  const engine = new MotionEngine({ autoStart: false, wasm: false });
  const a = motionValue(0), b = motionValue(0), c = motionValue(0);
  const spec = timing({ duration: 1, curve: curves.linear });
  const controlsA = engine.animate(a, 1, spec), controlsB = engine.animate(b, 1, spec), controlsC = engine.animate(c, 1, spec);
  engine.timings.indexOf = () => { throw new Error('timing removal performed a linear search'); };
  engine.stop(b);
  assert.equal((await controlsB.finished).status, 'cancelled');
  assert.equal(engine.timings[1].value, c);
  assert.equal(engine.timings[1].index, 1);
  engine.stop(c); engine.stop(a);
  assert.equal((await controlsC.finished).status, 'cancelled');
  assert.equal((await controlsA.finished).status, 'cancelled');
  assert.equal(engine.timings.length, 0);
});
