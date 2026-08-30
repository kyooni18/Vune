import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionEngine, motionValue, spring, timing, curves } from '../src/index.js';
import { createStateTransitionGraph, createTransition } from '../src/transition/index.js';

function engine() { return new MotionEngine({ autoStart: false, wasm: false, respectReducedMotion: false }); }

function stepUntilIdle(runtime, frames = 240) {
  for (let i = 0; i < frames; i += 1) runtime.step(1000 / 60);
}

test('two-state transition reverses numeric motion without zeroing velocity', async () => {
  const runtime = engine();
  const opacity = motionValue(0);
  const transition = createTransition([
    { key: 'opacity', target: opacity, from: 0, to: 1 },
  ], {
    engine: runtime,
    enter: spring({ response: 0.35, dampingRatio: 0.78 }),
    exit: spring({ response: 0.28, dampingRatio: 0.82 }),
  });

  const entering = transition.enter();
  for (let i = 0; i < 4; i += 1) runtime.step(1000 / 60);
  const before = opacity.getVelocity();
  assert(before > 0);
  const exiting = transition.exit();
  assert.equal((await entering.finished).status, 'interrupted');
  // Retargeting the same MotionValue preserves its instantaneous positive velocity.
  assert(opacity.getVelocity() > 0);
  stepUntilIdle(runtime);
  assert.equal((await exiting.finished).status, 'finished');
  assert(Math.abs(opacity.get()) < 1e-9);
  assert.equal(transition.state, 'exited');
});

test('state graph resolves route-specific specs and commits named state after completion', async () => {
  const runtime = engine();
  const x = motionValue(0);
  const graph = createStateTransitionGraph({ x }, {
    closed: { x: 0 },
    open: { x: 100 },
  }, {
    initial: 'closed',
    engine: runtime,
    spec: timing({ duration: 1, curve: curves.linear }),
    routes: { 'closed->open': timing({ duration: 0.1, curve: curves.linear }) },
  });

  const controls = graph.to('open');
  for (let i = 0; i < 8; i += 1) runtime.step(1000 / 60);
  assert.equal((await controls.finished).status, 'finished');
  assert.equal(graph.state, 'open');
  assert.equal(x.get(), 100);
});

test('structured state bindings precompile interpolation and can be interrupted from their current output', async () => {
  const runtime = engine();
  let color = '';
  const graph = createStateTransitionGraph({
    color: { target: (value) => { color = value; }, type: 'color', color: { space: 'oklab' } },
  }, {
    cold: { color: '#0000ff' },
    hot: { color: '#ff0000' },
    neutral: { color: '#808080' },
  }, {
    initial: 'cold',
    engine: runtime,
    spec: timing({ duration: 1, curve: curves.linear }),
  });

  const first = graph.to('hot');
  runtime.step(400);
  const midway = color;
  assert.match(midway, /^rgba?\(/);
  const second = graph.to('neutral');
  assert.equal((await first.finished).status, 'cancelled');
  // The second transition starts from the already-rendered mixed value, not the original cold state.
  runtime.step(1);
  assert.notEqual(color, '#0000ff');
  stepUntilIdle(runtime, 120);
  assert.equal((await second.finished).status, 'finished');
  assert.equal(graph.state, 'neutral');
});

test('graph set performs an immediate state jump and cancels active work', async () => {
  const runtime = engine();
  const x = motionValue(0);
  const graph = createStateTransitionGraph({ x }, { a: { x: 0 }, b: { x: 10 }, c: { x: -5 } }, { initial: 'a', engine: runtime });
  const active = graph.to('b');
  runtime.step(16);
  graph.set('c');
  assert.equal((await active.finished).status, 'cancelled');
  assert.equal(x.get(), -5);
  assert.equal(graph.state, 'c');
});

test('presence keeps content rendered through exit and cancels pending unmount on re-enter', async () => {
  const { createPresence } = await import('../src/transition/index.js');
  const runtime = engine();
  const opacity = motionValue(1);
  const transition = createTransition([{ target: opacity, from: 0, to: 1 }], {
    present: true,
    engine: runtime,
    enter: timing({ duration: 0.1, curve: curves.linear }),
    exit: timing({ duration: 0.1, curve: curves.linear }),
  });
  const presence = createPresence(transition, { present: true });
  const exiting = presence.exit();
  assert.equal(presence.rendered, true);
  runtime.step(30);
  const entering = presence.enter();
  assert.equal((await exiting.finished).status, 'interrupted');
  for (let i = 0; i < 8; i += 1) runtime.step(1000 / 60);
  await entering.finished;
  assert.equal(presence.rendered, true);

  const finalExit = presence.exit();
  for (let i = 0; i < 8; i += 1) runtime.step(1000 / 60);
  assert.equal((await finalExit.finished).status, 'finished');
  await Promise.resolve();
  assert.equal(presence.rendered, false);
});


test('cancelling structured state motion snapshots the rendered value for the next transition', () => {
  const runtime = engine();
  let color = '';
  const graph = createStateTransitionGraph({
    color: { target: (value) => { color = value; }, type: 'color' },
  }, {
    a: { color: '#0000ff' },
    b: { color: '#ff0000' },
    c: { color: '#00ff00' },
  }, { initial: 'a', engine: runtime, spec: timing({ duration: 1, curve: curves.linear }) });
  graph.to('b');
  runtime.step(300);
  const rendered = color;
  graph.cancel();
  graph.to('c');
  runtime.step(1);
  assert.notEqual(color, '#0000ff');
  assert.notEqual(rendered, '#0000ff');
});
