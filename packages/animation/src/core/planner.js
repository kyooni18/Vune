import { compileEasing } from './easing.js';
import { resolveMotionSpec, smooth } from './specs.js';

const compiledPlans = new WeakMap();
const resolvedProfilePlans = new WeakMap();
const maximumResolvedProfilePlans = 64;
const defaultProfile = smooth();

function freezePlan(plan) {
  return Object.freeze({ kind: 'motion-plan', ...plan });
}

function compileResolvedSpec(spec) {
  if (!spec || typeof spec !== 'object') throw new TypeError('Motion spec must be an object.');
  if (spec.kind === 'spring') {
    return freezePlan({
      route: 'spring',
      spec,
      omega: spec.omega,
      dampingRatio: spec.dampingRatio,
      initialVelocity: spec.initialVelocity,
      blendDurationMs: Math.max(0, Number(spec.blendDuration) || 0) * 1000,
    });
  }
  if (spec.kind === 'timing') {
    return freezePlan({
      route: 'timing',
      spec,
      durationMs: Math.max(0, spec.duration) * 1000,
      easing: compileEasing(spec.curve),
    });
  }
  if (spec.kind === 'profile') return freezePlan({ route: 'profile', spec });
  throw new TypeError(`Unknown motion spec kind: ${String(spec.kind)}`);
}

export function isMotionExecutionPlan(value) {
  return Boolean(value && typeof value === 'object' && value.kind === 'motion-plan');
}

/**
 * Compile the invariant half of a motion request once. Spring coefficients and
 * timing easing tables are frozen into the returned plan; adaptive profiles
 * intentionally retain a tiny dynamic resolver because their response depends
 * on the current travel distance.
 */
export function compileMotionPlan(requestedSpec) {
  if (isMotionExecutionPlan(requestedSpec)) return requestedSpec;
  const spec = requestedSpec ?? defaultProfile;
  if (!spec || typeof spec !== 'object') throw new TypeError('Motion spec must be an object.');
  const cached = compiledPlans.get(spec);
  if (cached) return cached;
  const plan = compileResolvedSpec(spec);
  compiledPlans.set(spec, plan);
  return plan;
}

/** Resolve only the distance-sensitive portion of a compiled plan. */
export function resolveMotionPlan(requestedPlan, from, to) {
  const plan = compileMotionPlan(requestedPlan);
  if (plan.route !== 'profile') return plan;
  const distance = Math.abs(to - from);
  let cache = resolvedProfilePlans.get(plan.spec);
  if (!cache) { cache = new Map(); resolvedProfilePlans.set(plan.spec, cache); }
  const cached = cache.get(distance);
  if (cached) { cache.delete(distance); cache.set(distance, cached); return cached; }
  const resolved = resolveMotionSpec(plan.spec, from, to);
  const compiled = compileResolvedSpec(resolved);
  cache.set(distance, compiled);
  while (cache.size > maximumResolvedProfilePlans) cache.delete(cache.keys().next().value);
  return compiled;
}
