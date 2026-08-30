import { MotionEngine } from './engine.js';
import { decay as decaySpec, inertia as inertiaSpec } from './kinetics.js';

export const defaultEngine = new MotionEngine();

export function animate(value, to, spec) {
  return defaultEngine.animate(value, to, spec);
}

export function animateVelocity(value, spec) {
  return defaultEngine.animateVelocity(value, spec);
}

export function animateDecay(value, options = {}) {
  return defaultEngine.animateVelocity(value, decaySpec(options));
}

export function animateInertia(value, options = {}) {
  return defaultEngine.animateVelocity(value, inertiaSpec(options));
}
