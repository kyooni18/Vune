import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionEngine, motionValue } from '../src/index.js';
import {
  VelocityTracker,
  constrainWithRubberBand,
  createDragController,
  rubberBandDistance,
} from '../src/gesture/index.js';
import { bindPointerDrag } from '../src/dom/index.js';

function engine() {
  return new MotionEngine({ autoStart: false, wasm: false, worker: false, frameBudgetMs: false });
}

function settle(runtime, maxFrames = 1600) {
  for (let i = 0; i < maxFrames && (runtime.kinetics.length || runtime.springs.length); i += 1) runtime.step(1000 / 120);
}

test('velocity tracker uses a short regression window instead of one noisy event delta', () => {
  const tracker = new VelocityTracker({ windowMs: 120 });
  tracker.reset(0, 0);
  for (let i = 1; i <= 10; i += 1) {
    const jitter = i % 2 ? 0.7 : -0.5;
    tracker.add(i * 10 + jitter, i * 10);
  }
  assert(Math.abs(tracker.velocity - 1000) < 35);
});

test('rubber band is monotonic, resistant, and asymptotically bounded', () => {
  const a = rubberBandDistance(50, 200, 0.55);
  const b = rubberBandDistance(200, 200, 0.55);
  const huge = rubberBandDistance(1e9, 200, 0.55);
  assert(a > 0 && a < 50);
  assert(b > a && b < 200);
  assert(huge < 200 && huge > 199);
  assert.equal(constrainWithRubberBand(40, 0, 100), 40);
  assert(constrainWithRubberBand(-100, 0, 100) < 0);
  assert(constrainWithRubberBand(-100, 0, 100) > -100);
});

test('drag release preserves gesture velocity, uses inertia, then settles at bounds', async () => {
  const runtime = engine();
  const x = motionValue(0);
  const drag = createDragController({ x, axis: 'x', engine: runtime, bounds: { minX: 0, maxX: 300 } });
  drag.start({ x: 0, y: 0 }, 0);
  drag.move({ x: 50, y: 0 }, 50);
  drag.move({ x: 100, y: 0 }, 100);
  const release = drag.end(100);
  assert(release.velocity.x > 900);
  assert(runtime.kinetics.length === 1);
  settle(runtime);
  assert.equal(x.get(), 300);
  const results = await release.controls.finished;
  assert.equal(results[0].status, 'finished');
});

test('drag snapping modifies the inertia target before integration', () => {
  const runtime = engine();
  const x = motionValue(0);
  const drag = createDragController({
    x,
    axis: 'x',
    engine: runtime,
    bounds: { minX: 0, maxX: 500 },
    snapX: [0, 100, 200, 300, 400, 500],
  });
  drag.start({ x: 0, y: 0 }, 0);
  drag.move({ x: 120, y: 0 }, 100);
  drag.end(100);
  settle(runtime);
  assert.equal(x.get() % 100, 0);
  assert.equal(x.get(), 400);
});

test('direction lock commits to the dominant axis without moving the other value', () => {
  const runtime = engine();
  const x = motionValue(0);
  const y = motionValue(0);
  const drag = createDragController({ x, y, engine: runtime, directionLock: true, directionLockThreshold: 8, momentum: false });
  drag.start({ x: 0, y: 0 }, 0);
  const state = drag.move({ x: 30, y: 7 }, 16);
  assert.equal(state.lockedAxis, 'x');
  assert.equal(x.get(), 30);
  assert.equal(y.get(), 0);
});



test('direction lock waits for threshold before committing either axis', () => {
  const runtime = engine();
  const x = motionValue(0);
  const y = motionValue(0);
  const drag = createDragController({ x, y, engine: runtime, directionLock: true, directionLockThreshold: 10, momentum: false });
  drag.start({ x: 0, y: 0 }, 0);
  const early = drag.move({ x: 5, y: 3 }, 8);
  assert.equal(early.lockedAxis, null);
  assert.equal(x.get(), 0);
  assert.equal(y.get(), 0);
  const locked = drag.move({ x: 14, y: 4 }, 16);
  assert.equal(locked.lockedAxis, 'x');
  assert.equal(x.get(), 14);
  assert.equal(y.get(), 0);
});

test('drag beyond bounds gets rubber-band resistance before release', () => {
  const runtime = engine();
  const x = motionValue(0);
  const drag = createDragController({ x, axis: 'x', engine: runtime, bounds: { minX: 0, maxX: 300 }, momentum: false });
  drag.start({ x: 0, y: 0 }, 0);
  drag.move({ x: -120, y: 0 }, 50);
  assert(x.get() < 0 && x.get() > -120);
  drag.end(50);
  settle(runtime);
  assert.equal(x.get(), 0);
});

class FakeElement {
  constructor() {
    this.style = { touchAction: 'pan-y' };
    this.listeners = new Map();
    this.captured = new Set();
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  setPointerCapture(id) { this.captured.add(id); }
  releasePointerCapture(id) { this.captured.delete(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
  dispatch(type, init = {}) {
    const event = {
      pointerId: 1,
      button: 0,
      clientX: 0,
      clientY: 0,
      timeStamp: 0,
      cancelable: true,
      preventDefault() { this.defaultPrevented = true; },
      ...init,
    };
    for (const fn of this.listeners.get(type) ?? []) fn(event);
    return event;
  }
}



test('DOM pointer binding consumes coalesced pointer samples when available', () => {
  const runtime = engine();
  const x = motionValue(0);
  const drag = createDragController({ x, axis: 'x', engine: runtime, momentum: false });
  const element = new FakeElement();
  const unbind = bindPointerDrag(element, drag, { coalesced: true });
  element.dispatch('pointerdown', { clientX: 0, timeStamp: 0 });
  element.dispatch('pointermove', {
    clientX: 60,
    timeStamp: 30,
    getCoalescedEvents() {
      return [
        { clientX: 20, clientY: 0, timeStamp: 10 },
        { clientX: 40, clientY: 0, timeStamp: 20 },
        { clientX: 60, clientY: 0, timeStamp: 30 },
      ];
    },
  });
  assert.equal(x.get(), 60);
  assert(drag.getState().velocity.x > 1500);
  element.dispatch('pointerup', { clientX: 60, timeStamp: 30 });
  unbind();
});

test('DOM pointer binding captures one pointer and restores touch-action on teardown', () => {
  const runtime = engine();
  const x = motionValue(0);
  const drag = createDragController({ x, axis: 'x', engine: runtime, momentum: false });
  const element = new FakeElement();
  const unbind = bindPointerDrag(element, drag);
  assert.equal(element.style.touchAction, 'none');
  element.dispatch('pointerdown', { clientX: 10, timeStamp: 0 });
  assert(element.captured.has(1));
  element.dispatch('pointermove', { clientX: 70, timeStamp: 60 });
  assert.equal(x.get(), 60);
  element.dispatch('pointerup', { clientX: 90, timeStamp: 80 });
  assert.equal(x.get(), 80);
  assert.equal(drag.active, false);
  assert.equal(element.captured.has(1), false);
  unbind();
  assert.equal(element.style.touchAction, 'pan-y');
});
