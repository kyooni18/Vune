import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MotionEngine,
  decay,
  inertia,
  motionValue,
  stepDampedSpring,
} from '../src/index.js';

function engine() {
  return new MotionEngine({ autoStart: false, wasm: false, worker: false, frameBudgetMs: false });
}

function stepUntilIdle(runtime, maxFrames = 1200, dt = 1000 / 120) {
  for (let i = 0; i < maxFrames && runtime.kinetics.length; i += 1) runtime.step(dt);
}

test('decay is frame-rate independent and converges to its projected target', async () => {
  const a = engine();
  const b = engine();
  const xa = motionValue(0);
  const xb = motionValue(0);
  const spec = decay({ velocity: 1000, timeConstant: 0.3, restSpeed: 0.001 });
  const ca = a.animateVelocity(xa, spec);
  const cb = b.animateVelocity(xb, spec);

  for (let i = 0; i < 60; i += 1) a.step(1000 / 60);
  for (let i = 0; i < 144; i += 1) b.step(1000 / 144);
  assert(Math.abs(xa.get() - xb.get()) < 1e-6);
  assert(Math.abs(xa.getVelocity() - xb.getVelocity()) < 1e-5);

  stepUntilIdle(a);
  stepUntilIdle(b);
  assert(Math.abs(xa.get() - 300) < 1e-9);
  assert(Math.abs(xb.get() - 300) < 1e-9);
  assert.equal((await ca.finished).status, 'finished');
  assert.equal((await cb.finished).status, 'finished');
});

test('kinetic removal stays slot-indexed after swap removal', async () => {
  const runtime = engine();
  const a = motionValue(0), b = motionValue(0), c = motionValue(0);
  const spec = decay({ velocity: 1000, timeConstant: 1 });
  const controlsA = runtime.animateVelocity(a, spec);
  const controlsB = runtime.animateVelocity(b, spec);
  const controlsC = runtime.animateVelocity(c, spec);
  runtime.kinetics.indexOf = () => { throw new Error('kinetic removal performed a linear search'); };
  runtime.stop(b);
  assert.equal((await controlsB.finished).status, 'cancelled');
  assert.equal(runtime.kinetics[1].value, c);
  assert.equal(runtime.kinetics[1].index, 1);
  runtime.stop(c); runtime.stop(a);
  assert.equal((await controlsC.finished).status, 'cancelled');
  assert.equal((await controlsA.finished).status, 'cancelled');
  assert.equal(runtime.kinetics.length, 0);
});

test('inertia carries release velocity into a bounded spring and settles exactly', async () => {
  const runtime = engine();
  const x = motionValue(50);
  const controls = runtime.animateVelocity(x, inertia({
    velocity: 1200,
    min: 0,
    max: 100,
    timeConstant: 0.325,
    power: 0.8,
    bounceResponse: 0.25,
    bounceDampingRatio: 0.78,
  }));

  runtime.step(16.6667);
  assert(x.get() > 50);
  assert(x.getVelocity() > 0);
  stepUntilIdle(runtime, 1000, 1000 / 120);
  assert.equal(x.get(), 100);
  assert.equal(x.getVelocity(), 0);
  assert.equal((await controls.finished).status, 'finished');
});

test('inertia modifyTarget supports snapping without a second animation', async () => {
  const runtime = engine();
  const x = motionValue(40);
  const controls = runtime.animateVelocity(x, inertia({
    velocity: 800,
    min: 0,
    max: 500,
    modifyTarget: (target) => Math.round(target / 100) * 100,
    restSpeed: 0.01,
  }));
  stepUntilIdle(runtime, 1600, 1000 / 120);
  assert.equal(x.get(), 200);
  assert.equal((await controls.finished).status, 'finished');
});

test('exact damped spring step remains stable through a long frame', () => {
  const one = stepDampedSpring(180, 2500, 100, 25, 0.78, 0.2);
  let many = { position: 180, velocity: 2500 };
  for (let i = 0; i < 20; i += 1) many = stepDampedSpring(many.position, many.velocity, 100, 25, 0.78, 0.01);
  assert(Number.isFinite(one.position));
  assert(Number.isFinite(one.velocity));
  assert(Math.abs(one.position - many.position) < 1e-9);
  assert(Math.abs(one.velocity - many.velocity) < 1e-8);
});

test('starting inertia outside bounds immediately settles through the bounce spring', () => {
  const runtime = engine();
  const x = motionValue(-80);
  runtime.animateVelocity(x, inertia({ velocity: -400, min: 0, max: 300 }));
  runtime.step(100);
  assert(Number.isFinite(x.get()));
  stepUntilIdle(runtime);
  assert.equal(x.get(), 0);
});
