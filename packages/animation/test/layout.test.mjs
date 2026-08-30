import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionEngine, timing, curves } from '../src/index.js';
import { createLayoutTransition, projectionMatrixForRects } from '../src/layout/index.js';

function fakeElement(rect, parentElement = null) {
  let current = { ...rect };
  return {
    parentElement,
    style: { transform: '', transformOrigin: '', willChange: '' },
    setRect(next) { current = { ...next }; },
    getBoundingClientRect() { return { ...current, right: current.left + current.width, bottom: current.top + current.height }; },
  };
}

test('projection matrix maps last bounds back to first bounds', () => {
  const matrix = projectionMatrixForRects(
    { left: 10, top: 20, width: 100, height: 50 },
    { left: 110, top: 70, width: 200, height: 100 },
  );
  assert.deepEqual(matrix.map((n) => Math.round(n * 1000) / 1000), [0.5, 0, 0, 0.5, -45, -15]);
});

test('layout transition applies FLIP then restores original transform', async () => {
  const engine = new MotionEngine({ autoStart: false, wasm: false });
  const element = fakeElement({ left: 0, top: 0, width: 100, height: 50 });
  element.style.transform = 'rotate(2deg)';
  const transition = createLayoutTransition(element, {
    engine,
    spec: timing({ duration: 0.1, curve: curves.linear }),
    measureScroll: () => ({ x: 0, y: 0 }),
  });
  element.setRect({ left: 100, top: 40, width: 200, height: 100 });
  const controls = transition.play();
  assert.match(element.style.transform, /^matrix\(0\.5, 0, 0, 0\.5, -100, -40\) rotate\(2deg\)$/);
  for (let i = 0; i < 8; i += 1) engine.step(1000 / 60);
  await controls.finished;
  await Promise.resolve();
  assert.equal(element.style.transform, 'rotate(2deg)');
});

test('nested FLIP removes parent projection from child projection', () => {
  const engine = new MotionEngine({ autoStart: false, wasm: false });
  const parent = fakeElement({ left: 0, top: 0, width: 100, height: 100 });
  const child = fakeElement({ left: 20, top: 20, width: 20, height: 20 }, parent);
  const transition = createLayoutTransition([parent, child], {
    engine,
    spec: timing({ duration: 1, curve: curves.linear }),
    measureScroll: () => ({ x: 0, y: 0 }),
  });
  parent.setRect({ left: 100, top: 0, width: 200, height: 200 });
  child.setRect({ left: 140, top: 40, width: 40, height: 40 });
  transition.play();
  assert.match(parent.style.transform, /^matrix\(0\.5, 0, 0, 0\.5, -100, 0\)/);
  assert.match(child.style.transform, /^matrix\(1, 0, 0, 1, 0, 0\)/);
  transition.cancel();
});

import { captureSharedLayout, createSharedLayoutTransition, SharedLayoutRegistry } from '../src/layout/index.js';

test('shared layout projects a new keyed element from an old element snapshot', async () => {
  const engine = new MotionEngine({ autoStart: false, wasm: false, respectReducedMotion: false });
  const source = fakeElement({ left: 10, top: 20, width: 80, height: 40 });
  source.id = 'hero';
  const snapshot = captureSharedLayout(source, { measureScroll: () => ({ x: 0, y: 0 }) });
  const target = fakeElement({ left: 210, top: 120, width: 160, height: 80 });
  target.id = 'hero';
  target.style.transform = 'rotate(3deg)';
  const transition = createSharedLayoutTransition(snapshot, target, {
    engine,
    spec: timing({ duration: 0.1, curve: curves.linear }),
    measureScroll: () => ({ x: 0, y: 0 }),
  });
  const controls = transition.play();
  assert.match(target.style.transform, /^matrix\(0\.5, 0, 0, 0\.5, -200, -100\) rotate\(3deg\)$/);
  for (let i = 0; i < 8; i += 1) engine.step(1000 / 60);
  await controls.finished;
  await Promise.resolve();
  assert.equal(target.style.transform, 'rotate(3deg)');
});

test('shared layout uses one progress animation for many matched targets and supports target fade', () => {
  const engine = new MotionEngine({ autoStart: false, wasm: false, respectReducedMotion: false });
  const a0 = fakeElement({ left: 0, top: 0, width: 20, height: 20 }); a0.id = 'a';
  const b0 = fakeElement({ left: 30, top: 0, width: 20, height: 20 }); b0.id = 'b';
  const snapshot = captureSharedLayout([a0, b0], { measureScroll: () => ({ x: 0, y: 0 }) });
  const a1 = fakeElement({ left: 100, top: 50, width: 20, height: 20 }); a1.id = 'a';
  const b1 = fakeElement({ left: 130, top: 50, width: 20, height: 20 }); b1.id = 'b';
  const transition = createSharedLayoutTransition(snapshot, [a1, b1], {
    engine,
    fadeTarget: true,
    spec: timing({ duration: 1, curve: curves.linear }),
    measureScroll: () => ({ x: 0, y: 0 }),
  });
  transition.play();
  assert.equal(engine.stats.activeSprings + engine.stats.activeDrivers + engine.timings.length, 1);
  assert.equal(a1.style.opacity, '0');
  engine.step(500);
  assert(Number(a1.style.opacity) > 0 && Number(a1.style.opacity) < 1);
  transition.cancel();
});

test('shared layout registry captures before mutation and plays after mutation', () => {
  const engine = new MotionEngine({ autoStart: false, wasm: false, respectReducedMotion: false });
  const before = fakeElement({ left: 0, top: 0, width: 40, height: 40 }); before.id = 'card';
  const after = fakeElement({ left: 80, top: 40, width: 80, height: 80 }); after.id = 'card';
  const registry = new SharedLayoutRegistry({ engine, measureScroll: () => ({ x: 0, y: 0 }) });
  assert.equal(registry.capture(before).size, 1);
  const { controls } = registry.play(after);
  assert(controls);
  registry.cancel();
});


test('shared layout capture rejects ambiguous duplicate keys', () => {
  const a = fakeElement({ left: 0, top: 0, width: 10, height: 10 }); a.id = 'same';
  const b = fakeElement({ left: 20, top: 0, width: 10, height: 10 }); b.id = 'same';
  assert.throws(() => captureSharedLayout([a, b], { measureScroll: () => ({ x: 0, y: 0 }) }), /Duplicate shared-layout key/);
});


test('shared layout playback rejects duplicate target keys', () => {
  const source = fakeElement({ left: 0, top: 0, width: 10, height: 10 }); source.id = 'same';
  const snapshot = captureSharedLayout(source, { measureScroll: () => ({ x: 0, y: 0 }) });
  const a = fakeElement({ left: 20, top: 0, width: 10, height: 10 }); a.id = 'same';
  const b = fakeElement({ left: 40, top: 0, width: 10, height: 10 }); b.id = 'same';
  const transition = createSharedLayoutTransition(snapshot, [a, b], { measureScroll: () => ({ x: 0, y: 0 }) });
  assert.throws(() => transition.play(), /Duplicate shared-layout target key/);
});


test('interrupting shared layout captures current target geometry before cancelling the old projection', () => {
  const engine = new MotionEngine({ autoStart: false, wasm: false, respectReducedMotion: false });
  const source = fakeElement({ left: 0, top: 0, width: 20, height: 20 }); source.id = 'hero';
  const snapshot = captureSharedLayout(source, { measureScroll: () => ({ x: 0, y: 0 }) });
  const target = fakeElement({ left: 100, top: 0, width: 20, height: 20 }); target.id = 'hero';
  const first = createSharedLayoutTransition(snapshot, target, {
    engine,
    spec: timing({ duration: 1, curve: curves.linear }),
    measureScroll: () => ({ x: 0, y: 0 }),
  });
  first.play();
  target.setRect({ left: 140, top: 0, width: 20, height: 20 });
  const second = createSharedLayoutTransition(snapshot, target, {
    engine,
    spec: timing({ duration: 1, curve: curves.linear }),
    measureScroll: () => ({ x: 0, y: 0 }),
  });
  target.setRect({ left: 200, top: 0, width: 20, height: 20 });
  second.play();
  assert.match(target.style.transform, /^matrix\(1, 0, 0, 1, -60, 0\)/);
  second.cancel();
});
