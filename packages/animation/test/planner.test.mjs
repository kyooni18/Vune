import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MotionEngine,
  compileMotionPlan,
  curves,
  motionValue,
  resolveMotionPlan,
  smooth,
  spring,
  timing,
} from '../src/index.js';

test('motion planner caches invariant timing work and engine consumes the plan directly', async () => {
  const spec = timing({ duration: 0.2, curve: curves.easeInOut });
  const first = compileMotionPlan(spec);
  const second = compileMotionPlan(spec);
  assert.strictEqual(first, second);
  assert.equal(first.route, 'timing');
  assert.equal(first.durationMs, 200);
  assert.equal(first.easing.kind, 'lut');

  const engine = new MotionEngine({ autoStart: false, wasm: false });
  const value = motionValue(0);
  const controls = engine.animate(value, 10, first);
  for (let index = 0; index < 30; index += 1) engine.step(1000 / 60);
  assert.equal((await controls.finished).status, 'finished');
  assert.equal(value.get(), 10);
});

test('spring plans preserve physical retargeting and adaptive profiles resolve late', async () => {
  const plan = compileMotionPlan(spring({ response: 0.4, dampingRatio: 0.8 }));
  assert.equal(plan.route, 'spring');
  const profile = compileMotionPlan(smooth());
  assert.equal(profile.route, 'profile');
  const firstDistancePlan = resolveMotionPlan(profile, 0, 100);
  assert.equal(firstDistancePlan.route, 'spring');
  assert.strictEqual(resolveMotionPlan(profile, 300, 400), firstDistancePlan);
  assert.notEqual(resolveMotionPlan(profile, 0, 100).omega, resolveMotionPlan(profile, 0, 900).omega);

  const engine = new MotionEngine({ autoStart: false, wasm: false });
  const value = motionValue(0);
  const first = engine.animate(value, 100, plan);
  for (let index = 0; index < 5; index += 1) engine.step(1000 / 60);
  const velocity = value.getVelocity();
  assert.notEqual(velocity, 0);
  const second = engine.animate(value, -20, plan);
  assert.notEqual(value.getVelocity(), 0);
  assert.equal((await first.finished).status, 'interrupted');
  for (let index = 0; index < 400 && engine.springs.length; index += 1) engine.step(1000 / 60);
  assert.equal((await second.finished).status, 'finished');
  assert.equal(value.get(), -20);
});

test('spring retargets blend coefficients over the compiled blend duration', async () => {
  const engine = new MotionEngine({ autoStart: false, wasm: false });
  const value = motionValue(0);
  const slow = compileMotionPlan(spring({ response: 0.8, dampingRatio: 0.95 }));
  const fast = compileMotionPlan(spring({ response: 0.18, dampingRatio: 0.62, blendDuration: 0.1 }));
  assert.equal(fast.blendDurationMs, 100);

  const first = engine.animate(value, 1000, slow);
  engine.step(16);
  const beforeRetargetOmega = engine.springs[0].omega;
  const beforeRetargetDamping = engine.springs[0].dampingRatio;
  const second = engine.animate(value, -1000, fast);
  assert.equal((await first.finished).status, 'interrupted');
  assert.equal(engine.springs[0].omega, beforeRetargetOmega);
  assert.equal(engine.springs[0].dampingRatio, beforeRetargetDamping);

  engine.step(50);
  assert.ok(engine.springs[0].omega > Math.min(beforeRetargetOmega, fast.omega));
  assert.ok(engine.springs[0].omega < Math.max(beforeRetargetOmega, fast.omega));
  assert.ok(engine.springs[0].dampingRatio > Math.min(beforeRetargetDamping, fast.dampingRatio));
  assert.ok(engine.springs[0].dampingRatio < Math.max(beforeRetargetDamping, fast.dampingRatio));

  engine.step(50);
  assert.equal(engine.springs[0].omega, fast.omega);
  assert.equal(engine.springs[0].dampingRatio, fast.dampingRatio);
  assert.equal(engine.springs[0].blendDurationMs, 0);

  for (let index = 0; index < 1000 && engine.springs.length; index += 1) engine.step(1000 / 60);
  assert.equal((await second.finished).status, 'finished');
  assert.equal(value.get(), -1000);
});
