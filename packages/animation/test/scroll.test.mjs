import test from 'node:test';
import assert from 'node:assert/strict';
import { ScrollTracker, observeScroll, bindScrollTimeline } from '../src/scroll/index.js';
import { MotionEngine, motionValue } from '../src/index.js';
import { timeline } from '../src/timeline/index.js';

class FakeScrollTarget {
  constructor() {
    this.scrollTop = 0;
    this.clientHeight = 200;
    this.scrollHeight = 1000;
    this.listeners = new Map();
  }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  removeEventListener(type, fn) { if (this.listeners.get(type) === fn) this.listeners.delete(type); }
  emit(type) { this.listeners.get(type)?.({ type }); }
}

test('ScrollTracker maps offset and velocity into normalized progress', () => {
  const tracker = new ScrollTracker({ start: 100, end: 500 });
  tracker.reset(100, 0);
  tracker.sample(300, 100);
  assert.equal(tracker.progress.get(), 0.5);
  assert(tracker.offset.getVelocity() > 1900 && tracker.offset.getVelocity() < 2100);
  assert(tracker.progress.getVelocity() > 4.7 && tracker.progress.getVelocity() < 5.3);
});

test('ScrollTracker can keep overscroll progress unclamped', () => {
  const tracker = new ScrollTracker({ start: 0, end: 100, clamp: false });
  tracker.reset(0, 0);
  tracker.sample(140, 100);
  assert.equal(tracker.progress.get(), 1.4);
});

test('ScrollObserver coalesces many scroll events into one frame read', () => {
  const target = new FakeScrollTarget();
  let scheduled = null;
  let requests = 0;
  const observer = observeScroll(target, {
    autoStart: false,
    requestFrame(callback) { requests += 1; scheduled = callback; return requests; },
    cancelFrame() {},
  });
  target.scrollTop = 120;
  target.emit('scroll');
  target.scrollTop = 240;
  target.emit('scroll');
  target.scrollTop = 400;
  target.emit('scroll');
  assert.equal(requests, 1);
  scheduled(100);
  assert.equal(observer.offset.get(), 400);
  assert.equal(observer.progress.get(), 0.5); // max = 800
  observer.dispose();
});

test('scroll progress can scrub a timeline without adding a running player driver', () => {
  const engine = new MotionEngine({ autoStart: false, wasm: false, respectReducedMotion: false });
  const x = motionValue(0);
  const player = timeline().fromTo(x, 0, 100, { duration: 1 }).player({ engine });
  const tracker = new ScrollTracker({ start: 0, end: 1000 });
  const link = bindScrollTimeline(player, tracker);
  tracker.reset(0, 0);
  tracker.sample(250, 16);
  assert(Math.abs(x.get() - 25) < 1e-9);
  assert.equal(player.running, false);
  link.dispose();
  engine.dispose();
});
