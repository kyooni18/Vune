import { evaluateBezier } from './bezier.js';

const EASING_LUT_SIZE = 256;
const easingLutCache = new WeakMap();
const linearCompiledEasing = Object.freeze({ kind: 'linear' });

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

/**
 * Compile a timing curve once into a compact lookup plan. Bezier objects are
 * immutable in the public API, so a WeakMap safely shares the LUT across every
 * animation/timeline that uses the same curve object.
 */
export function compileEasing(easing) {
  if (typeof easing === 'function') return { kind: 'function', easing };
  if (!easing || easing.kind !== 'bezier' || (easing.x1 === easing.y1 && easing.x2 === easing.y2)) return linearCompiledEasing;
  const cached = easingLutCache.get(easing);
  if (cached) return cached;
  const values = new Float64Array(EASING_LUT_SIZE + 1);
  for (let i = 0; i <= EASING_LUT_SIZE; i += 1) values[i] = evaluateBezier(easing, i / EASING_LUT_SIZE);
  const compiled = Object.freeze({ kind: 'lut', values });
  easingLutCache.set(easing, compiled);
  return compiled;
}

export function evaluateCompiledEasing(compiled, progress) {
  const p = clamp01(progress);
  if (compiled.kind === 'linear') return p;
  if (compiled.kind === 'function') {
    const value = compiled.easing(p);
    return Number.isFinite(value) ? value : p;
  }
  const scaled = p * EASING_LUT_SIZE;
  const index = Math.min(EASING_LUT_SIZE - 1, Math.floor(scaled));
  const fraction = scaled - index;
  const values = compiled.values;
  return values[index] + (values[index + 1] - values[index]) * fraction;
}

export function derivativeCompiledEasing(compiled, progress) {
  const p = clamp01(progress);
  if (compiled.kind === 'linear') return 1;
  if (compiled.kind === 'function') {
    const epsilon = 1e-4;
    const lo = Math.max(0, p - epsilon);
    const hi = Math.min(1, p + epsilon);
    if (hi - lo <= Number.EPSILON) return 0;
    const a = compiled.easing(lo);
    const b = compiled.easing(hi);
    return Number.isFinite(a) && Number.isFinite(b) ? (b - a) / (hi - lo) : 0;
  }
  const scaled = p * EASING_LUT_SIZE;
  const index = Math.min(EASING_LUT_SIZE - 1, Math.floor(scaled));
  const values = compiled.values;
  return (values[index + 1] - values[index]) * EASING_LUT_SIZE;
}
