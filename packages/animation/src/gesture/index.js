import { defaultEngine } from '../core/default-engine.js';
import { inertia as inertiaSpec } from '../core/kinetics.js';
import { spring } from '../core/specs.js';

const DEFAULT_WINDOW_MS = 120;
const DEFAULT_MAX_SAMPLES = 12;

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

export class VelocityTracker {
  constructor({ windowMs = DEFAULT_WINDOW_MS, maxSamples = DEFAULT_MAX_SAMPLES, maxVelocity = 100000 } = {}) {
    this.windowMs = Math.max(16, finite(windowMs, DEFAULT_WINDOW_MS));
    this.maxSamples = Math.max(2, Math.floor(finite(maxSamples, DEFAULT_MAX_SAMPLES)));
    this.maxVelocity = Math.max(1, finite(maxVelocity, 100000));
    this.values = new Float64Array(this.maxSamples);
    this.times = new Float64Array(this.maxSamples);
    this.head = 0;
    this.count = 0;
  }

  #index(logicalIndex) {
    return (this.head + logicalIndex) % this.maxSamples;
  }

  reset(value, time = nowMs()) {
    this.head = 0;
    this.count = 0;
    this.add(value, time);
    return this;
  }

  add(value, time = nowMs()) {
    value = finite(value);
    time = finite(time, nowMs());
    if (this.count > 0) {
      const lastIndex = this.#index(this.count - 1);
      const lastTime = this.times[lastIndex];
      if (time < lastTime) return this;
      if (time === lastTime) {
        this.values[lastIndex] = value;
        return this;
      }
    }

    let index;
    if (this.count < this.maxSamples) {
      index = this.#index(this.count);
      this.count += 1;
    } else {
      this.head = (this.head + 1) % this.maxSamples;
      index = this.#index(this.count - 1);
    }
    this.values[index] = value;
    this.times[index] = time;

    const cutoff = time - this.windowMs;
    while (this.count > 2 && this.times[this.head] < cutoff) {
      this.head = (this.head + 1) % this.maxSamples;
      this.count -= 1;
    }
    return this;
  }

  get velocity() {
    if (this.count < 2) return 0;
    const latestIndex = this.#index(this.count - 1);
    const latest = this.times[latestIndex];
    const weightScale = Math.max(24, this.windowMs * 0.55);
    let weightSum = 0;
    let meanT = 0;
    let meanX = 0;

    for (let i = 0; i < this.count; i += 1) {
      const index = this.#index(i);
      const ageMs = latest - this.times[index];
      const weight = Math.exp(-ageMs / weightScale);
      const t = (this.times[index] - latest) / 1000;
      weightSum += weight;
      meanT += t * weight;
      meanX += this.values[index] * weight;
    }
    if (weightSum <= 0) return 0;
    meanT /= weightSum;
    meanX /= weightSum;

    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < this.count; i += 1) {
      const index = this.#index(i);
      const ageMs = latest - this.times[index];
      const weight = Math.exp(-ageMs / weightScale);
      const t = (this.times[index] - latest) / 1000 - meanT;
      const x = this.values[index] - meanX;
      numerator += weight * t * x;
      denominator += weight * t * t;
    }
    if (denominator < 1e-9) return 0;
    const velocity = numerator / denominator;
    return Math.max(-this.maxVelocity, Math.min(this.maxVelocity, velocity));
  }
}

export function rubberBandDistance(distance, dimension = 320, constant = 0.55) {
  const sign = Math.sign(distance);
  const d = Math.abs(finite(distance));
  const size = Math.max(1, Math.abs(finite(dimension, 320)));
  const c = Math.max(0, finite(constant, 0.55));
  if (d === 0 || c === 0) return 0;
  return sign * ((d * c * size) / (size + c * d));
}

export function constrainWithRubberBand(value, min = -Infinity, max = Infinity, {
  enabled = true,
  constant = 0.55,
  dimension,
} = {}) {
  if (min > max) throw new RangeError('min cannot be greater than max.');
  if (value < min) {
    if (!enabled) return min;
    const size = dimension ?? (Number.isFinite(max - min) ? max - min : 320);
    return min + rubberBandDistance(value - min, size, constant);
  }
  if (value > max) {
    if (!enabled) return max;
    const size = dimension ?? (Number.isFinite(max - min) ? max - min : 320);
    return max + rubberBandDistance(value - max, size, constant);
  }
  return value;
}

function resolveBounds(bounds) {
  const source = typeof bounds === 'function' ? bounds() : bounds;
  return {
    minX: Number.isFinite(source?.minX) ? source.minX : -Infinity,
    maxX: Number.isFinite(source?.maxX) ? source.maxX : Infinity,
    minY: Number.isFinite(source?.minY) ? source.minY : -Infinity,
    maxY: Number.isFinite(source?.maxY) ? source.maxY : Infinity,
  };
}

function nearestSnap(target, points) {
  if (typeof points === 'function') {
    const value = Number(points(target));
    return Number.isFinite(value) ? value : target;
  }
  if (!Array.isArray(points) || points.length === 0) return target;
  let best = target;
  let bestDistance = Infinity;
  for (const point of points) {
    if (!Number.isFinite(point)) continue;
    const distance = Math.abs(point - target);
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return best;
}

function groupControls(controls) {
  const active = controls.filter(Boolean);
  return {
    cancel() { for (const control of active) control.cancel(); },
    finish() { for (const control of active) control.finish(); },
    finished: Promise.all(active.map((control) => control.finished)),
  };
}

export class DragController {
  constructor({
    x = null,
    y = null,
    axis = 'both',
    engine = defaultEngine,
    bounds = null,
    momentum = true,
    inertia = {},
    rubberBand = true,
    rubberBandConstant = 0.55,
    rubberBandDimension,
    directionLock = false,
    directionLockThreshold = 8,
    snapX = null,
    snapY = null,
    settle = {},
    velocity = {},
    onStart,
    onMove,
    onEnd,
  } = {}) {
    if (!['x', 'y', 'both'].includes(axis)) throw new TypeError("axis must be 'x', 'y', or 'both'.");
    if ((axis === 'x' || axis === 'both') && !x?.set) throw new TypeError('DragController requires x MotionValue for the selected axis.');
    if ((axis === 'y' || axis === 'both') && !y?.set) throw new TypeError('DragController requires y MotionValue for the selected axis.');
    this.x = x;
    this.y = y;
    this.axis = axis;
    this.engine = engine;
    this.boundsSource = bounds;
    this.momentum = momentum;
    this.inertiaOptions = inertia;
    this.rubberBand = rubberBand;
    this.rubberBandConstant = rubberBandConstant;
    this.rubberBandDimension = rubberBandDimension;
    this.directionLock = directionLock;
    this.directionLockThreshold = Math.max(0, directionLockThreshold);
    this.snapX = snapX;
    this.snapY = snapY;
    this.settleOptions = settle;
    this.onStart = onStart;
    this.onMove = onMove;
    this.onEnd = onEnd;
    this.trackerX = new VelocityTracker(velocity);
    this.trackerY = new VelocityTracker(velocity);
    this.active = false;
    this.lockedAxis = null;
    this.startPoint = { x: 0, y: 0 };
    this.startValue = { x: 0, y: 0 };
    this.lastPoint = { x: 0, y: 0 };
  }

  #axisEnabled(axis) {
    if (this.lockedAxis) return this.lockedAxis === axis;
    return this.axis === 'both' || this.axis === axis;
  }

  #rubberOptions(axis, bounds) {
    const enabled = this.rubberBand !== false;
    const constant = typeof this.rubberBand === 'number' ? this.rubberBand : this.rubberBandConstant;
    const dimension = typeof this.rubberBandDimension === 'object'
      ? this.rubberBandDimension?.[axis]
      : this.rubberBandDimension;
    return { enabled, constant, dimension };
  }

  start(point, time = nowMs()) {
    const px = finite(point?.x);
    const py = finite(point?.y);
    if (this.x) this.engine.stop(this.x, 'interrupted');
    if (this.y) this.engine.stop(this.y, 'interrupted');
    this.active = true;
    this.lockedAxis = null;
    this.startPoint = { x: px, y: py };
    this.lastPoint = { x: px, y: py };
    this.startValue = { x: this.x?.get?.() ?? 0, y: this.y?.get?.() ?? 0 };
    this.trackerX.reset(px, time);
    this.trackerY.reset(py, time);
    const state = this.getState();
    this.onStart?.(state);
    return state;
  }

  move(point, time = nowMs()) {
    if (!this.active) return this.getState();
    const px = finite(point?.x, this.lastPoint.x);
    const py = finite(point?.y, this.lastPoint.y);
    this.lastPoint = { x: px, y: py };
    this.trackerX.add(px, time);
    this.trackerY.add(py, time);

    const dx = px - this.startPoint.x;
    const dy = py - this.startPoint.y;
    if (this.directionLock && !this.lockedAxis) {
      if (Math.hypot(dx, dy) < this.directionLockThreshold) {
        const state = this.getState();
        this.onMove?.(state);
        return state;
      }
      this.lockedAxis = this.axis === 'both'
        ? (Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y')
        : this.axis;
    }

    const bounds = resolveBounds(this.boundsSource);
    if (this.x && this.#axisEnabled('x')) {
      const raw = this.startValue.x + dx;
      const next = constrainWithRubberBand(raw, bounds.minX, bounds.maxX, this.#rubberOptions('x', bounds));
      this.x.set(next, this.trackerX.velocity);
    }
    if (this.y && this.#axisEnabled('y')) {
      const raw = this.startValue.y + dy;
      const next = constrainWithRubberBand(raw, bounds.minY, bounds.maxY, this.#rubberOptions('y', bounds));
      this.y.set(next, this.trackerY.velocity);
    }

    const state = this.getState();
    this.onMove?.(state);
    return state;
  }

  #releaseAxis(axis, motion, velocity, min, max, snap) {
    if (!motion || !this.#axisEnabled(axis)) return null;
    const current = motion.get();
    const outside = current < min || current > max;
    if (!this.momentum && !outside) {
      motion.set(current, 0);
      return null;
    }

    if (!this.momentum && outside) {
      const target = Math.max(min, Math.min(max, current));
      return this.engine.animate(motion, target, spring({
        response: this.settleOptions.response ?? 0.28,
        dampingRatio: this.settleOptions.dampingRatio ?? 0.82,
        initialVelocity: velocity,
      }));
    }

    const userModify = this.inertiaOptions.modifyTarget;
    const modifyTarget = (target) => {
      const modified = typeof userModify === 'function' ? userModify(target, axis) : target;
      return nearestSnap(modified, snap);
    };
    return this.engine.animateVelocity(motion, inertiaSpec({
      ...this.inertiaOptions,
      velocity,
      min,
      max,
      modifyTarget,
    }));
  }

  end(time = nowMs()) {
    if (!this.active) return { ...this.getState(), controls: groupControls([]) };
    this.trackerX.add(this.lastPoint.x, time);
    this.trackerY.add(this.lastPoint.y, time);
    this.active = false;
    const velocity = { x: this.trackerX.velocity, y: this.trackerY.velocity };
    const bounds = resolveBounds(this.boundsSource);
    const controls = [
      this.#releaseAxis('x', this.x, velocity.x, bounds.minX, bounds.maxX, this.snapX),
      this.#releaseAxis('y', this.y, velocity.y, bounds.minY, bounds.maxY, this.snapY),
    ];
    const result = { ...this.getState(), velocity, controls: groupControls(controls) };
    this.onEnd?.(result);
    return result;
  }

  cancel({ settle = true } = {}) {
    if (!this.active) return this.getState();
    this.active = false;
    if (settle) {
      const bounds = resolveBounds(this.boundsSource);
      for (const [axis, motion, min, max] of [
        ['x', this.x, bounds.minX, bounds.maxX],
        ['y', this.y, bounds.minY, bounds.maxY],
      ]) {
        if (!motion || !this.#axisEnabled(axis)) continue;
        const target = Math.max(min, Math.min(max, motion.get()));
        if (target !== motion.get()) this.engine.animate(motion, target, spring({ response: 0.25, dampingRatio: 0.9 }));
        else motion.set(motion.get(), 0);
      }
    }
    return this.getState();
  }

  getState() {
    return {
      active: this.active,
      axis: this.axis,
      lockedAxis: this.lockedAxis,
      point: { ...this.lastPoint },
      value: { x: this.x?.get?.() ?? null, y: this.y?.get?.() ?? null },
      velocity: { x: this.trackerX.velocity, y: this.trackerY.velocity },
    };
  }
}

export function createDragController(options) {
  return new DragController(options);
}
