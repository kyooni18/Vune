import test from 'node:test';
import assert from 'node:assert/strict';
import { materialToCss, materials, mixMaterial, resolveMaterial } from '../src/material/index.js';
import { MotionEngine, animateInterpolated, motionValue, smooth } from '../src/index.js';
import { animateMaterial, animatePath, applyMaterial } from '../src/dom/index.js';

test('material presets resolve to finite renderer-agnostic values', () => {
  for (const preset of Object.keys(materials)) {
    const value = resolveMaterial(preset);
    assert(Number.isFinite(value.blur));
    assert(Number.isFinite(value.saturation));
    assert(Number.isFinite(value.tint.a));
  }
});

test('material interpolation uses perceptual tint mixing and exact numeric endpoints', () => {
  const start = resolveMaterial('ultraThin');
  const end = resolveMaterial('thick');
  const middle = mixMaterial(start, end, 0.5);
  assert(middle.blur > start.blur && middle.blur < end.blur);
  assert(middle.saturation > start.saturation && middle.saturation < end.saturation);
  assert(Number.isFinite(middle.tint.r));
  const css = materialToCss(middle);
  assert.match(css.backdropFilter, /blur\(/);
  assert.match(css.backgroundColor, /^rgba\(/);
});

test('animateInterpolated supports material values through one numeric progress channel', async () => {
  const engine = new MotionEngine({ autoStart: false, wasm: false, worker: false });
  let current;
  const controls = animateInterpolated('clear', 'glass', smooth(), (value) => { current = value; }, { type: 'material', engine });
  for (let i = 0; i < 180; i += 1) engine.step(1000 / 120);
  assert(current.blur > 20);
  assert.equal((await controls.finished).status, 'finished');
  engine.dispose();
});

function fakeElement() {
  return {
    style: {},
    attrs: new Map(),
    setAttribute(name, value) { this.attrs.set(name, value); },
  };
}

test('DOM material and path adapters batch writes without owning the motion model', async () => {
  const element = fakeElement();
  applyMaterial(element, 'regular');
  await Promise.resolve();
  assert.match(element.style.backdropFilter, /blur\(24px\)/);

  const engine = new MotionEngine({ autoStart: false, wasm: false, worker: false });
  animateMaterial(element, 'clear', 'thin', smooth(), { engine });
  animatePath(element, 'M0 0 L10 0 Z', 'M0 0 L20 10 Z', smooth(), { engine });
  for (let i = 0; i < 160; i += 1) engine.step(1000 / 120);
  await Promise.resolve();
  assert.match(element.style.backdropFilter, /blur\(/);
  assert.equal(element.attrs.get('d'), 'M0 0 L20 10 Z');
  engine.dispose();
});

test('DOM adapter uses one global batch queue for many elements', async () => {
  const { bindMotionStyles, flushDomCommits } = await import('../src/dom/index.js');
  const engine = new MotionEngine({ autoStart: false, wasm: false, worker: false });
  const elements = Array.from({ length: 128 }, () => fakeElement());
  const progress = (await import('../src/index.js')).motionValue(0);
  const unbind = elements.map((element) => bindMotionStyles(element, { x: progress }));
  // Initial subscription emissions are all waiting in the same global queue.
  assert.equal(flushDomCommits(), 128);
  engine.animate(progress, 100, smooth());
  engine.step(16.67);
  assert.equal(flushDomCommits(), 128);
  for (const fn of unbind) fn();
  engine.dispose();
});

test('DOM adapter avoids transform work for direct and opacity-only bindings', async () => {
  const { bindMotionStyles, bindStyleValue, flushDomCommits } = await import('../src/dom/index.js');
  const engine = new MotionEngine({ autoStart: false, wasm: false, worker: false });
  const directElement = fakeElement();
  const direct = motionValue(12);
  const unbindDirect = bindStyleValue(directElement, 'filter', direct, { unit: 'px' });
  flushDomCommits();
  assert.equal(directElement.style.filter, '12px');
  assert.equal(directElement.style.transform, undefined);

  const opacityElement = fakeElement();
  const opacity = motionValue(0.7);
  const x = motionValue(4);
  const unbindOpacity = bindMotionStyles(opacityElement, { opacity });
  const unbindTransform = bindMotionStyles(opacityElement, { x });
  flushDomCommits();
  assert.equal(opacityElement.style.opacity, '0.7');
  assert.equal(opacityElement.style.willChange, 'transform, opacity');
  assert.match(opacityElement.style.transform, /translate3d\(4px/);

  unbindDirect();
  unbindOpacity();
  assert.equal(opacityElement.style.willChange, 'transform');
  unbindTransform();
  assert.equal(opacityElement.style.willChange, '');
  engine.dispose();
});

test('DOM style ownership replaces only overlapping properties', async () => {
  const { cancelStyleAnimations, ownStyleAnimation } = await import('../src/dom/index.js');
  const element = fakeElement();

  const deferredControl = () => {
    let resolve;
    let cancelled = 0;
    const finished = new Promise((done) => { resolve = done; });
    return {
      finished,
      cancel() {
        cancelled += 1;
        resolve({ status: 'cancelled', value: 0 });
      },
      get cancelled() { return cancelled; },
    };
  };

  const opacityA = deferredControl();
  const transform = deferredControl();
  const opacityB = deferredControl();

  ownStyleAnimation(element, 'opacity', opacityA);
  ownStyleAnimation(element, 'transform', transform);
  ownStyleAnimation(element, 'opacity', opacityB);

  assert.equal(opacityA.cancelled, 1);
  assert.equal(transform.cancelled, 0);
  assert.equal(opacityB.cancelled, 0);

  // Let the replaced control settle. Its cleanup must not erase opacityB.
  await Promise.resolve();
  assert.equal(cancelStyleAnimations(element, 'opacity'), 1);
  assert.equal(opacityB.cancelled, 1);
  assert.equal(transform.cancelled, 0);

  assert.equal(cancelStyleAnimations(element, 'transform'), 1);
  assert.equal(transform.cancelled, 1);
});

test('DOM style ownership cancels a multi-property control only once', async () => {
  const { cancelStyleAnimations, ownStyleAnimation } = await import('../src/dom/index.js');
  const element = fakeElement();
  let cancelled = 0;
  let resolve;
  const control = {
    finished: new Promise((done) => { resolve = done; }),
    cancel() {
      cancelled += 1;
      resolve({ status: 'cancelled', value: 0 });
    },
  };

  ownStyleAnimation(element, ['opacity', 'filter'], control);
  assert.equal(cancelStyleAnimations(element, ['opacity', 'filter']), 1);
  assert.equal(cancelled, 1);
  await control.finished;
});
