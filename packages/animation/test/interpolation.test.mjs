import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MotionEngine,
  animateInterpolated,
  formatColor,
  interpolateColor,
  interpolateTransform,
  mixColor,
  parseColor,
  parseTransform,
  timing,
  curves,
} from '../src/index.js';

const close = (actual, expected, epsilon = 1e-5) => assert(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

test('color parser handles hex, rgb percentages, and hsl', () => {
  assert.deepEqual(parseColor('#fff'), { r: 1, g: 1, b: 1, a: 1 });
  const rgb = parseColor('rgb(100% 0% 50% / 25%)');
  close(rgb.r, 1); close(rgb.g, 0); close(rgb.b, 0.5); close(rgb.a, 0.25);
  const hsl = parseColor('hsl(120deg 100% 50%)');
  close(hsl.r, 0); close(hsl.g, 1); close(hsl.b, 0);
});

test('OKLab color interpolation preserves exact endpoints and produces finite midpoint', () => {
  const start = mixColor('#ff0000', '#0000ff', 0);
  const end = mixColor('#ff0000', '#0000ff', 1);
  close(start.r, 1); close(start.g, 0); close(start.b, 0);
  close(end.r, 0); close(end.g, 0); close(end.b, 1);
  const mid = mixColor('#ff0000', '#0000ff', 0.5, { space: 'oklab' });
  assert(Object.values(mid).every(Number.isFinite));
  assert.match(formatColor(mid), /^rgba\(/);
  assert.equal(interpolateColor('transparent', '#fff')(0.5), 'rgba(255, 255, 255, 0.5)');
});

test('transform interpolation decomposes 2D transforms and uses shortest rotation', () => {
  const start = parseTransform('translateX(10px) rotate(350deg) scale(2)');
  close(start.x, 10);
  close(start.scaleX, 2);
  const mid = interpolateTransform(
    'translateX(10px) rotate(350deg)',
    'translateX(30px) rotate(10deg)',
  )(0.5);
  assert.equal(mid, 'translate3d(20px, 0px, 0px)');
});

test('animateInterpolated drives structured output through the numeric engine', async () => {
  const engine = new MotionEngine({ autoStart: false, wasm: false });
  let last = null;
  const controls = animateInterpolated(
    '#000', '#fff', timing({ duration: 0.1, curve: curves.linear }),
    (value) => { last = value; },
    { engine, type: 'color' },
  );
  for (let i = 0; i < 8; i += 1) engine.step(1000 / 60);
  assert.equal((await controls.finished).status, 'finished');
  assert.equal(last, 'rgba(255, 255, 255, 1)');
});
