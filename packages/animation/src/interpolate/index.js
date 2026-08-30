import { AnimationControls } from '../core/controls.js';
import { defaultEngine } from '../core/default-engine.js';
import { motionValue } from '../core/motion-value.js';
import { interpolateColor } from './color.js';
import { interpolateTransform } from './transform.js';
import { interpolatePath } from '../path/index.js';
import { interpolateMaterial } from '../material/index.js';

export * from './color.js';
export * from './transform.js';

export function interpolateNumber(from, to) {
  const a = Number(from);
  const b = Number(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) throw new TypeError('Numeric interpolation requires finite numbers.');
  return (progress) => a + (b - a) * progress;
}

export function createInterpolator(from, to, options = {}) {
  if (typeof options.interpolate === 'function') return (progress) => options.interpolate(from, to, progress);
  if (typeof from === 'number' && typeof to === 'number') return interpolateNumber(from, to);
  if (options.type === 'transform' || (typeof from === 'object' && typeof to === 'object' && ('x' in from || 'scale' in from || 'rotate' in from))) {
    return interpolateTransform(from, to, options.transform);
  }
  if (options.type === 'color') return interpolateColor(from, to, options.color);
  if (options.type === 'path') return interpolatePath(from, to, options.path);
  if (options.type === 'material') return interpolateMaterial(from, to, options.material);
  if (typeof from === 'string' && typeof to === 'string') {
    try { return interpolateColor(from, to, options.color); } catch {}
    try { return interpolateTransform(from, to, options.transform); } catch {}
  }
  throw new TypeError('No interpolator is available for these values. Pass options.type or options.interpolate.');
}

export function animateInterpolated(from, to, spec, onUpdate, {
  engine = defaultEngine,
  interpolate,
  type,
  color,
  transform,
  path,
  material,
} = {}) {
  if (typeof onUpdate !== 'function') throw new TypeError('animateInterpolated() requires an onUpdate callback.');
  const mixer = interpolate ? (progress) => interpolate(from, to, progress) : createInterpolator(from, to, { type, color, transform, path, material });
  const progress = motionValue(0);
  const unsubscribe = (progress.subscribeValue ?? progress.subscribe).call(progress, (value) => onUpdate(mixer(value), value));
  const inner = engine.animate(progress, 1, spec);
  const finished = inner.finished.finally(unsubscribe);
  return new AnimationControls(
    () => inner.cancel(),
    () => inner.finish(),
    finished,
  );
}
