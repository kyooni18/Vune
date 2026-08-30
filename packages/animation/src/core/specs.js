import { clamp, springParamsFromPhysics, springParamsFromResponse } from './math.js';

export function spring(options = {}) {
  const { response = 0.38, dampingRatio = 0.82, initialVelocity, blendDuration = 0 } = options;
  const params = springParamsFromResponse(response, dampingRatio);
  return Object.freeze({ kind: 'spring', ...params, initialVelocity, blendDuration: Math.max(0, Number(blendDuration) || 0), source: 'response' });
}

spring.physics = function physics(options = {}) {
  const params = springParamsFromPhysics(options);
  return Object.freeze({
    kind: 'spring',
    ...params,
    initialVelocity: options.initialVelocity,
    blendDuration: Math.max(0, Number(options.blendDuration) || 0),
    source: 'physics',
  });
};

export function cubicBezier(x1, y1, x2, y2) {
  return Object.freeze({ kind: 'bezier', x1, y1, x2, y2 });
}

export const curves = Object.freeze({
  linear: cubicBezier(0, 0, 1, 1),
  easeIn: cubicBezier(0.42, 0, 1, 1),
  easeOut: cubicBezier(0, 0, 0.58, 1),
  easeInOut: cubicBezier(0.42, 0, 0.58, 1),
  smooth: cubicBezier(0.22, 1, 0.36, 1),
});

export function timing({ duration = 0.3, curve = curves.easeInOut } = {}) {
  return Object.freeze({
    kind: 'timing',
    duration: Math.max(0, duration),
    curve,
  });
}

function profile(name, options = {}) {
  return Object.freeze({ kind: 'profile', name, options: Object.freeze({ ...options }) });
}

export const smooth = (options) => profile('smooth', options);
export const snappy = (options) => profile('snappy', options);
export const bouncy = (options) => profile('bouncy', options);
export const gentle = (options) => profile('gentle', options);
export const interactive = (options) => profile('interactive', options);

export function resolveMotionSpec(spec, from, to) {
  if (!spec || spec.kind !== 'profile') return spec || smooth();

  const distance = Math.abs(to - from);
  const normalized = clamp(Math.log1p(distance) / Math.log1p(1000), 0, 1);
  const bias = Number(spec.options?.responseBias || 0);

  switch (spec.name) {
    case 'snappy':
      return spring({ response: 0.19 + normalized * 0.08 + bias, dampingRatio: 0.88 });
    case 'bouncy':
      return spring({ response: 0.31 + normalized * 0.09 + bias, dampingRatio: 0.67 });
    case 'gentle':
      return spring({ response: 0.43 + normalized * 0.12 + bias, dampingRatio: 0.98 });
    case 'interactive':
      return spring({ response: 0.20 + normalized * 0.09 + bias, dampingRatio: 0.84 });
    case 'smooth':
    default:
      return spring({ response: 0.26 + normalized * 0.16 + bias, dampingRatio: 0.92 });
  }
}
