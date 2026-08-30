import { clamp, springParamsFromResponse } from './math.js';

const DEFAULT_TAU = 0.325;
const DEFAULT_REST_SPEED = 5;
const DEFAULT_REST_DELTA = 0.5;

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function optionalBound(value, fallback) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

export function decay(options = {}) {
  return Object.freeze({
    kind: 'decay',
    velocity: Number.isFinite(options.velocity) ? Number(options.velocity) : undefined,
    timeConstant: Math.max(0.016, finiteOr(options.timeConstant, DEFAULT_TAU)),
    power: Math.max(0, finiteOr(options.power, 1)),
    restSpeed: Math.max(0, finiteOr(options.restSpeed, DEFAULT_REST_SPEED)),
    modifyTarget: typeof options.modifyTarget === 'function' ? options.modifyTarget : undefined,
  });
}

export function inertia(options = {}) {
  const bounce = options.bounce && options.bounce.kind === 'spring'
    ? options.bounce
    : { kind: 'spring', ...springParamsFromResponse(
      finiteOr(options.bounceResponse, 0.28),
      finiteOr(options.bounceDampingRatio, 0.82),
    ) };

  const min = optionalBound(options.min, -Infinity);
  const max = optionalBound(options.max, Infinity);
  if (min > max) throw new RangeError('inertia() min cannot be greater than max.');

  return Object.freeze({
    kind: 'inertia',
    velocity: Number.isFinite(options.velocity) ? Number(options.velocity) : undefined,
    timeConstant: Math.max(0.016, finiteOr(options.timeConstant, DEFAULT_TAU)),
    power: Math.max(0, finiteOr(options.power, 0.8)),
    restSpeed: Math.max(0, finiteOr(options.restSpeed, DEFAULT_REST_SPEED)),
    restDelta: Math.max(0, finiteOr(options.restDelta, DEFAULT_REST_DELTA)),
    min,
    max,
    bounceOmega: bounce.omega,
    bounceDampingRatio: bounce.dampingRatio,
    modifyTarget: typeof options.modifyTarget === 'function' ? options.modifyTarget : undefined,
  });
}

export function projectDecayTarget(value, velocity, spec) {
  const base = value + velocity * spec.timeConstant * spec.power;
  const modified = spec.modifyTarget ? Number(spec.modifyTarget(base)) : base;
  return Number.isFinite(modified) ? modified : base;
}

export function nearestBound(value, min = -Infinity, max = Infinity) {
  if (value < min) return min;
  if (value > max) return max;
  return null;
}

export function clampToBounds(value, min = -Infinity, max = Infinity) {
  if (!Number.isFinite(min) && !Number.isFinite(max)) return value;
  return clamp(value, min, max);
}

// Exact exponential integration for dv/dt = -v/tau. This is frame-rate
// independent and lands asymptotically at x + v*tau.
export function stepDecay(position, velocity, dtSeconds, timeConstant, out = undefined) {
  const result = out ?? { position: 0, velocity: 0 };
  if (!(dtSeconds > 0) || !(timeConstant > 0)) {
    result.position = position;
    result.velocity = velocity;
    return result;
  }
  const attenuation = Math.exp(-dtSeconds / timeConstant);
  result.position = position + velocity * timeConstant * (1 - attenuation);
  result.velocity = velocity * attenuation;
  return result;
}

// Exact solution of y'' + 2*zeta*omega*y' + omega^2*y = 0 around target.
// Used for low-count interaction settling so it remains stable across long or
// irregular pointer frames without sub-stepping.
export function stepDampedSpring(position, velocity, target, omega, dampingRatio, dtSeconds, out = undefined) {
  const result = out ?? { position: 0, velocity: 0 };
  if (!(dtSeconds > 0) || !(omega > 0)) {
    result.position = position;
    result.velocity = velocity;
    return result;
  }
  const y0 = position - target;
  const v0 = velocity;
  const zeta = Math.max(0, dampingRatio);
  const criticalEpsilon = 1e-4;

  if (zeta < 1 - criticalEpsilon) {
    const alpha = zeta * omega;
    const wd = omega * Math.sqrt(1 - zeta * zeta);
    const exp = Math.exp(-alpha * dtSeconds);
    const sin = Math.sin(wd * dtSeconds);
    const cos = Math.cos(wd * dtSeconds);
    const b = (v0 + alpha * y0) / wd;
    const y = exp * (y0 * cos + b * sin);
    const v = exp * (
      -alpha * (y0 * cos + b * sin)
      + (-y0 * wd * sin + b * wd * cos)
    );
    result.position = target + y;
    result.velocity = v;
    return result;
  }

  if (zeta > 1 + criticalEpsilon) {
    const root = Math.sqrt(zeta * zeta - 1);
    const r1 = -omega * (zeta - root);
    const r2 = -omega * (zeta + root);
    const denominator = r1 - r2;
    const c1 = (v0 - r2 * y0) / denominator;
    const c2 = y0 - c1;
    const e1 = Math.exp(r1 * dtSeconds);
    const e2 = Math.exp(r2 * dtSeconds);
    const y = c1 * e1 + c2 * e2;
    const v = c1 * r1 * e1 + c2 * r2 * e2;
    result.position = target + y;
    result.velocity = v;
    return result;
  }

  const exp = Math.exp(-omega * dtSeconds);
  const b = v0 + omega * y0;
  const y = exp * (y0 + b * dtSeconds);
  const v = exp * (b - omega * (y0 + b * dtSeconds));
  result.position = target + y;
  result.velocity = v;
  return result;
}
