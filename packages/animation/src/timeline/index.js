import { evaluateBezier } from '../core/bezier.js';
import { compileEasing, evaluateCompiledEasing, derivativeCompiledEasing } from '../core/easing.js';
import { defaultEngine } from '../core/default-engine.js';
import { motionValue } from '../core/motion-value.js';
import { inertia } from '../core/kinetics.js';
import { curves } from '../core/specs.js';
import { createInterpolator } from '../interpolate/index.js';

const EPSILON = 1e-9;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isMotionValue(value) {
  return value && typeof value.get === 'function' && typeof value._commit === 'function';
}

function easingValue(easing, progress) {
  const p = clamp(progress, 0, 1);
  if (typeof easing === 'function') {
    const value = easing(p);
    return Number.isFinite(value) ? value : p;
  }
  if (easing?.kind === 'bezier') return evaluateBezier(easing, p);
  return p;
}

function easingDerivative(easing, progress) {
  const p = clamp(progress, 0, 1);
  if (typeof easing === 'function') {
    const epsilon = 1e-4;
    const lo = Math.max(0, p - epsilon);
    const hi = Math.min(1, p + epsilon);
    if (hi - lo <= EPSILON) return 0;
    const a = easing(lo);
    const b = easing(hi);
    return Number.isFinite(a) && Number.isFinite(b) ? (b - a) / (hi - lo) : 0;
  }
  if (easing?.kind === 'bezier') return evaluateBezierDerivative(easing, p);
  return 1;
}

function normalizeFrames(frames, { duration, easing = curves.linear } = {}) {
  if (!Array.isArray(frames) || frames.length === 0) throw new TypeError('Timeline track requires at least one keyframe.');

  let normalized;
  const hasKeyframeMetadata = frames.some((frame) => frame && typeof frame === 'object' && !Array.isArray(frame)
    && ('value' in frame || 'at' in frame || 'time' in frame || 'offset' in frame));
  if (!hasKeyframeMetadata) {
    const total = Number(duration);
    if (!Number.isFinite(total) || total < 0) throw new TypeError('Shorthand keyframes require a finite non-negative options.duration.');
    const denominator = Math.max(1, frames.length - 1);
    normalized = frames.map((value, index) => ({
      at: total * index / denominator,
      value,
      easing,
      order: index,
    }));
  } else {
    normalized = frames.map((frame, index) => {
      if (!frame || typeof frame !== 'object' || !('value' in frame)) throw new TypeError('Keyframes must contain a value.');
      let at;
      if (Number.isFinite(frame.at)) at = Number(frame.at);
      else if (Number.isFinite(frame.time)) at = Number(frame.time);
      else if (Number.isFinite(frame.offset) && Number.isFinite(duration)) at = Number(frame.offset) * Number(duration);
      else throw new TypeError('Each keyframe requires at/time, or offset with options.duration.');
      if (at < 0) throw new RangeError('Keyframe time cannot be negative.');
      return { at, value: frame.value, easing: frame.easing ?? easing, order: index };
    });
    normalized.sort((a, b) => (a.at - b.at) || (a.order - b.order));
  }

  const collapsed = [];
  for (const frame of normalized) {
    const last = collapsed[collapsed.length - 1];
    if (last && Math.abs(last.at - frame.at) <= EPSILON) collapsed[collapsed.length - 1] = frame;
    else collapsed.push(frame);
  }
  return collapsed;
}

function findSegment(times, time) {
  let low = 0;
  let high = times.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >> 1;
    if (times[middle] <= time) low = middle;
    else high = middle;
  }
  return low;
}

class NumericKeyframeTrack {
  constructor(target, frames) {
    this.target = target;
    this.motionValue = isMotionValue(target) ? target : null;
    this.writer = this.motionValue
      ? (value, velocity) => this.motionValue._commit(value, velocity)
      : typeof target === 'function'
        ? target
        : target && typeof target.set === 'function'
          ? (value, velocity) => target.set(value, velocity)
          : null;
    if (!this.writer) throw new TypeError('Numeric timeline target must be a MotionValue, callback, or settable object.');

    this.times = new Float64Array(frames.length);
    this.values = new Float64Array(frames.length);
    this.easings = new Array(Math.max(0, frames.length - 1));
    for (let i = 0; i < frames.length; i += 1) {
      const value = Number(frames[i].value);
      if (!Number.isFinite(value)) throw new TypeError('Numeric keyframes require finite values.');
      this.times[i] = frames[i].at;
      this.values[i] = value;
      if (i < frames.length - 1) this.easings[i] = compileEasing(frames[i].easing);
    }
    this.duration = this.times[this.times.length - 1];
  }

  sample(time, velocityScale = 0) {
    const count = this.times.length;
    if (count === 1 || time <= this.times[0]) {
      this.writer(this.values[0], 0);
      return;
    }
    const last = count - 1;
    if (time >= this.times[last]) {
      this.writer(this.values[last], 0);
      return;
    }

    const index = findSegment(this.times, time);
    const startTime = this.times[index];
    const endTime = this.times[index + 1];
    const span = endTime - startTime;
    if (span <= EPSILON) {
      this.writer(this.values[index + 1], 0);
      return;
    }
    const progress = (time - startTime) / span;
    const easing = this.easings[index];
    const eased = evaluateCompiledEasing(easing, progress);
    const from = this.values[index];
    const delta = this.values[index + 1] - from;
    const value = from + delta * eased;
    const velocity = velocityScale === 0 ? 0 : delta * derivativeCompiledEasing(easing, progress) / span * velocityScale;
    this.writer(value, velocity);
  }

  zeroVelocity() {
    if (this.motionValue) this.motionValue._commit(this.motionValue.get(), 0);
  }

  owns(value) {
    return this.motionValue === value;
  }

  stopConflict(engine) {
    if (this.motionValue) engine.stop(this.motionValue, 'interrupted');
  }
}

class GenericKeyframeTrack {
  constructor(target, frames, interpolationOptions) {
    if (isMotionValue(target)) throw new TypeError('MotionValue timeline tracks require numeric keyframes. Use a callback for structured values.');
    this.writer = typeof target === 'function'
      ? target
      : target && typeof target.set === 'function'
        ? (value) => target.set(value)
        : null;
    if (!this.writer) throw new TypeError('Interpolated timeline target must be a callback or settable object.');

    this.times = new Float64Array(frames.length);
    this.values = frames.map((frame) => frame.value);
    this.easings = new Array(Math.max(0, frames.length - 1));
    this.mixers = new Array(Math.max(0, frames.length - 1));
    for (let i = 0; i < frames.length; i += 1) {
      this.times[i] = frames[i].at;
      if (i < frames.length - 1) {
        this.easings[i] = compileEasing(frames[i].easing);
        this.mixers[i] = createInterpolator(frames[i].value, frames[i + 1].value, interpolationOptions);
      }
    }
    this.duration = this.times[this.times.length - 1];
  }

  sample(time) {
    const count = this.times.length;
    if (count === 1 || time <= this.times[0]) {
      this.writer(this.values[0]);
      return;
    }
    const last = count - 1;
    if (time >= this.times[last]) {
      this.writer(this.values[last]);
      return;
    }
    const index = findSegment(this.times, time);
    const span = this.times[index + 1] - this.times[index];
    const progress = span <= EPSILON ? 1 : (time - this.times[index]) / span;
    this.writer(this.mixers[index](evaluateCompiledEasing(this.easings[index], progress)));
  }

  zeroVelocity() {}
  owns() { return false; }
  stopConflict() {}
}

class TimelineClip {
  constructor(timeline, { at = 0, speed = 1, fill = 'both' } = {}) {
    if (!(timeline instanceof Timeline)) throw new TypeError('Timeline.add() requires another Timeline.');
    if (!Number.isFinite(at) || at < 0) throw new RangeError('Clip start time must be finite and non-negative.');
    if (!Number.isFinite(speed) || speed <= 0) throw new RangeError('Clip speed must be a finite positive number.');
    if (!['none', 'forwards', 'backwards', 'both'].includes(fill)) throw new TypeError("Clip fill must be 'none', 'forwards', 'backwards', or 'both'.");
    this.timeline = timeline;
    this.at = at;
    this.speed = speed;
    this.fill = fill;
    this.duration = timeline.duration / speed;
    this.end = at + this.duration;
  }

  sample(parentTime, velocityScale) {
    if (parentTime < this.at) {
      if (this.fill === 'backwards' || this.fill === 'both') this.timeline.sample(0, { velocityScale: 0 });
      return;
    }
    if (parentTime > this.end) {
      if (this.fill === 'forwards' || this.fill === 'both') this.timeline.sample(this.timeline.duration, { velocityScale: 0 });
      return;
    }
    this.timeline.sample((parentTime - this.at) * this.speed, { velocityScale: velocityScale * this.speed });
  }

  zeroVelocities() { this.timeline.zeroVelocities(); }
  owns(value) { return this.timeline.hasMotionValue(value); }
  stopConflicts(engine) { this.timeline.stopConflicts(engine); }
}

export class Timeline {
  constructor({ duration = 0, easing = curves.linear } = {}) {
    if (!Number.isFinite(duration) || duration < 0) throw new RangeError('Timeline duration must be finite and non-negative.');
    this.defaultEasing = easing;
    this.explicitDuration = duration;
    this._duration = duration;
    this.tracks = [];
    this.clips = [];
  }

  get duration() { return this._duration; }

  track(target, frames, options = {}) {
    const normalized = normalizeFrames(frames, { duration: options.duration, easing: options.easing ?? this.defaultEasing });
    const numeric = normalized.every((frame) => typeof frame.value === 'number');
    const fastNumeric = numeric && options.type == null && typeof options.interpolate !== 'function';
    const track = fastNumeric && (isMotionValue(target) || typeof target === 'function' || typeof target?.set === 'function')
      ? new NumericKeyframeTrack(target, normalized)
      : new GenericKeyframeTrack(target, normalized, options);
    this.tracks.push(track);
    this._duration = Math.max(this._duration, track.duration);
    return this;
  }

  keyframes(target, frames, options = {}) {
    return this.track(target, frames, options);
  }

  fromTo(target, from, to, { at = 0, duration = 0.3, easing = this.defaultEasing, ...options } = {}) {
    const start = Number(at);
    const span = Number(duration);
    if (!Number.isFinite(start) || start < 0) throw new RangeError('Timeline fromTo() start must be finite and non-negative.');
    if (!Number.isFinite(span) || span < 0) throw new RangeError('Timeline fromTo() duration must be finite and non-negative.');
    return this.track(target, [
      { at: start, value: from, easing },
      { at: start + span, value: to },
    ], options);
  }

  to(target, to, { from, ...options } = {}) {
    let startValue = from;
    if (startValue === undefined) {
      if (isMotionValue(target)) startValue = target.get();
      else if (target && typeof target.get === 'function') startValue = target.get();
      else throw new TypeError('Timeline.to() requires options.from for callback-only targets.');
    }
    return this.fromTo(target, startValue, to, options);
  }

  add(child, options = {}) {
    const clip = new TimelineClip(child, options);
    this.clips.push(clip);
    this._duration = Math.max(this._duration, clip.end);
    return this;
  }

  sample(time, { velocityScale = 0 } = {}) {
    const local = clamp(Number.isFinite(time) ? time : 0, 0, this.duration);
    for (const track of this.tracks) track.sample(local, velocityScale);
    for (const clip of this.clips) clip.sample(local, velocityScale);
    return local;
  }

  zeroVelocities() {
    for (const track of this.tracks) track.zeroVelocity();
    for (const clip of this.clips) clip.zeroVelocities();
  }

  hasMotionValue(value) {
    for (const track of this.tracks) if (track.owns(value)) return true;
    for (const clip of this.clips) if (clip.owns(value)) return true;
    return false;
  }

  stopConflicts(engine) {
    for (const track of this.tracks) track.stopConflict(engine);
    for (const clip of this.clips) clip.stopConflicts(engine);
  }

  player(options = {}) {
    return new TimelinePlayer(this, options);
  }
}

function deferred() {
  let resolve;
  let settled = false;
  const promise = new Promise((resolver) => { resolve = resolver; });
  return {
    promise,
    settle(value) {
      if (settled) return;
      settled = true;
      resolve(value);
    },
    get settled() { return settled; },
  };
}

function validateDirection(direction) {
  if (!['normal', 'reverse', 'alternate', 'alternate-reverse'].includes(direction)) {
    throw new TypeError("Timeline direction must be 'normal', 'reverse', 'alternate', or 'alternate-reverse'.");
  }
  return direction;
}

function directionSign(direction, iteration) {
  switch (direction) {
    case 'reverse': return -1;
    case 'alternate': return iteration % 2 === 0 ? 1 : -1;
    case 'alternate-reverse': return iteration % 2 === 0 ? -1 : 1;
    default: return 1;
  }
}

export class TimelinePlayer {
  constructor(timeline, {
    engine = defaultEngine,
    autoplay = false,
    playbackRate = 1,
    iterations = 1,
    direction = 'normal',
    onUpdate,
    onRepeat,
    onComplete,
  } = {}) {
    if (!(timeline instanceof Timeline)) throw new TypeError('TimelinePlayer requires a Timeline.');
    if (!engine || typeof engine.addDriver !== 'function') throw new TypeError('TimelinePlayer requires a MotionEngine-like engine.');
    if (!Number.isFinite(playbackRate)) throw new TypeError('playbackRate must be finite.');
    if (!(iterations === Infinity || (Number.isFinite(iterations) && iterations >= 1))) throw new RangeError('iterations must be >= 1 or Infinity.');

    this.timeline = timeline;
    this.engine = engine;
    this.playbackRate = playbackRate;
    this.iterations = iterations === Infinity ? Infinity : Math.floor(iterations);
    this.direction = validateDirection(direction);
    this.onUpdate = typeof onUpdate === 'function' ? onUpdate : null;
    this.onRepeat = typeof onRepeat === 'function' ? onRepeat : null;
    this.onComplete = typeof onComplete === 'function' ? onComplete : null;

    this.state = 'idle';
    this.elapsedTime = 0;
    this.currentTime = 0;
    this.progress = 0;
    this.iteration = 0;
    this._registered = false;
    this._deferred = deferred();

    this._sampleRaw(0, 0);
    if (autoplay) this.play();
  }

  get duration() { return this.timeline.duration; }
  get totalDuration() { return this.iterations === Infinity ? Infinity : this.duration * this.iterations; }
  get finished() { return this._deferred.promise; }
  get running() { return this.state === 'running'; }

  _resetDeferredIfNeeded() {
    if (this._deferred.settled) this._deferred = deferred();
  }

  _register() {
    if (this._registered) return;
    this._registered = true;
    this.engine.addDriver(this);
  }

  _unregister() {
    if (!this._registered) return;
    this._registered = false;
    this.engine.removeDriver(this);
  }

  _mapping(rawTime, traversal = 1) {
    const duration = this.duration;
    if (duration <= EPSILON) return { iteration: 0, local: 0, sign: 1 };

    let raw = Math.max(0, rawTime);
    const total = this.totalDuration;
    if (Number.isFinite(total)) raw = Math.min(raw, total);

    let iteration;
    let phase;
    if (Number.isFinite(total) && raw >= total - EPSILON) {
      iteration = Math.max(0, this.iterations - 1);
      phase = duration;
    } else {
      const boundary = Math.round(raw / duration);
      const onBoundary = raw > 0 && Math.abs(raw - boundary * duration) <= EPSILON;
      if (traversal < 0 && onBoundary) {
        iteration = Math.max(0, boundary - 1);
        phase = duration;
      } else {
        iteration = Math.max(0, Math.floor(raw / duration));
        phase = raw - iteration * duration;
      }
    }
    const sign = directionSign(this.direction, iteration);
    const local = sign > 0 ? phase : duration - phase;
    return { iteration, local: clamp(local, 0, duration), sign };
  }

  _sampleRaw(rawTime, realTimeScale) {
    const mapping = this._mapping(rawTime, realTimeScale);
    this.elapsedTime = rawTime;
    this.iteration = mapping.iteration;
    this.currentTime = mapping.local;
    this.progress = this.duration <= EPSILON ? 1 : mapping.local / this.duration;
    this.timeline.sample(mapping.local, { velocityScale: mapping.sign * realTimeScale });
    this.onUpdate?.(this);
  }

  _stop(status, { preserveVelocity = false } = {}) {
    this._unregister();
    if (!preserveVelocity) this.timeline.zeroVelocities();
    this.state = status;
    const result = {
      status,
      currentTime: this.currentTime,
      elapsedTime: this.elapsedTime,
      progress: this.progress,
      iteration: this.iteration,
    };
    this._deferred.settle(result);
    if (status === 'finished') this.onComplete?.(this);
    return result;
  }

  play() {
    if (this.state === 'running') return this;
    this._resetDeferredIfNeeded();
    this.timeline.stopConflicts(this.engine);

    const total = this.totalDuration;
    if (this.playbackRate >= 0 && Number.isFinite(total) && this.elapsedTime >= total - EPSILON) this.elapsedTime = 0;
    if (this.playbackRate < 0 && this.elapsedTime <= EPSILON) {
      this.elapsedTime = Number.isFinite(total) ? total : this.duration;
    }

    this.state = 'running';
    this._sampleRaw(this.elapsedTime, this.playbackRate);
    if (this.duration <= EPSILON || this.playbackRate === 0) {
      if (this.duration <= EPSILON) this._stop('finished');
      else this.pause();
      return this;
    }
    this._register();
    return this;
  }

  pause() {
    if (this.state !== 'running') return this;
    this._unregister();
    this.timeline.zeroVelocities();
    this.state = 'paused';
    return this;
  }

  cancel() {
    if (this.state === 'finished' || this.state === 'cancelled' || this.state === 'interrupted') return this;
    this._resetDeferredIfNeeded();
    this._stop('cancelled');
    return this;
  }

  interruptValue(value, status = 'interrupted') {
    if (!this.owns(value) || this.state !== 'running') return false;
    const resolved = status === 'cancelled' ? 'cancelled' : 'interrupted';
    this._stop(resolved, { preserveVelocity: true });
    return true;
  }

  owns(value) {
    return this.timeline.hasMotionValue(value);
  }

  finish() {
    if (this.state === 'finished') return this;
    this._resetDeferredIfNeeded();
    const duration = this.duration;
    if (duration <= EPSILON) {
      this._sampleRaw(0, 0);
      this._stop('finished');
      return this;
    }
    if (this.playbackRate < 0) this._sampleRaw(0, 0);
    else if (Number.isFinite(this.totalDuration)) this._sampleRaw(this.totalDuration, 0);
    else {
      const sign = directionSign(this.direction, this.iteration);
      const local = sign > 0 ? duration : 0;
      this.currentTime = local;
      this.progress = local / duration;
      this.elapsedTime = (this.iteration + 1) * duration;
      this.timeline.sample(local, { velocityScale: 0 });
      this.onUpdate?.(this);
    }
    this._stop('finished');
    return this;
  }

  reverse() {
    this.playbackRate = this.playbackRate === 0 ? -1 : -this.playbackRate;
    return this;
  }

  setPlaybackRate(rate) {
    if (!Number.isFinite(rate)) throw new TypeError('playbackRate must be finite.');
    this.playbackRate = rate;
    if (rate === 0 && this.state === 'running') this.pause();
    return this;
  }

  seek(timeSeconds, { iteration = this.iteration } = {}) {
    const duration = this.duration;
    if (duration <= EPSILON) {
      this._sampleRaw(0, 0);
      return this;
    }
    const maxIteration = this.iterations === Infinity ? Math.max(0, Math.floor(iteration)) : this.iterations - 1;
    const resolvedIteration = clamp(Math.floor(iteration), 0, maxIteration);
    const local = clamp(Number(timeSeconds) || 0, 0, duration);
    const sign = directionSign(this.direction, resolvedIteration);
    const rawPhase = sign > 0 ? local : duration - local;
    const raw = resolvedIteration * duration + rawPhase;
    this._sampleRaw(raw, 0);
    return this;
  }

  seekProgress(progress, options) {
    return this.seek(clamp(Number(progress) || 0, 0, 1) * this.duration, options);
  }

  scrub(progress, options) {
    return this.seekProgress(progress, options);
  }

  seekElapsed(elapsedSeconds) {
    let raw = Math.max(0, Number(elapsedSeconds) || 0);
    if (Number.isFinite(this.totalDuration)) raw = Math.min(raw, this.totalDuration);
    this._sampleRaw(raw, 0);
    return this;
  }

  step(dtMs) {
    if (this.state !== 'running') return false;
    if (!Number.isFinite(dtMs) || dtMs <= 0) return true;
    const duration = this.duration;
    if (duration <= EPSILON) {
      this.finish();
      return false;
    }

    const previousIteration = this.iteration;
    const deltaSeconds = dtMs / 1000 * this.playbackRate;
    let next = this.elapsedTime + deltaSeconds;
    const total = this.totalDuration;

    if (this.playbackRate > 0 && Number.isFinite(total) && next >= total - EPSILON) {
      this._sampleRaw(total, 0);
      this._stop('finished');
      return false;
    }
    if (this.playbackRate < 0 && next <= EPSILON) {
      this._sampleRaw(0, 0);
      this._stop('finished');
      return false;
    }

    if (next < 0) next = 0;
    this._sampleRaw(next, this.playbackRate);

    if (this.onRepeat && this.iteration !== previousIteration) {
      this.onRepeat(this.iteration, this, this.iteration - previousIteration);
    }
    return true;
  }

  onEngineDispose() {
    if (this.state === 'running') {
      this._registered = false;
      this.timeline.zeroVelocities();
      this.state = 'cancelled';
      this._deferred.settle({
        status: 'cancelled',
        currentTime: this.currentTime,
        elapsedTime: this.elapsedTime,
        progress: this.progress,
        iteration: this.iteration,
      });
    }
  }
}

export class PhaseTimeline {
  constructor(targets, phases, {
    defaultDuration = 0.2,
    easing = curves.smooth,
  } = {}) {
    if (!targets || typeof targets !== 'object') throw new TypeError('PhaseTimeline targets must be an object.');
    if (!Array.isArray(phases) || phases.length === 0) throw new TypeError('PhaseTimeline requires at least one phase.');
    if (!Number.isFinite(defaultDuration) || defaultDuration < 0) throw new RangeError('defaultDuration must be non-negative.');

    this.names = phases.map((phase, index) => String(phase.name ?? index));
    this.arrivals = new Float64Array(phases.length);
    this.timeline = new Timeline({ easing });

    const entries = Object.entries(targets).map(([key, entry]) => {
      if (entry && typeof entry === 'object' && 'target' in entry) return [key, entry.target, entry];
      return [key, entry, {}];
    });
    const framesByKey = new Map(entries.map(([key]) => [key, []]));
    const current = new Map();

    for (const [key, target] of entries) {
      const initial = phases[0].values?.[key];
      if (initial === undefined) {
        if (isMotionValue(target)) current.set(key, target.get());
        else throw new TypeError(`Initial phase is missing a value for '${key}'.`);
      } else current.set(key, initial);
      framesByKey.get(key).push({ at: 0, value: current.get(key), easing: phases[1]?.easing ?? easing });
    }

    let time = 0;
    const firstHold = Math.max(0, Number(phases[0].hold) || 0);
    if (firstHold > 0) {
      time += firstHold;
      for (const [key] of entries) framesByKey.get(key).push({ at: time, value: current.get(key), easing: phases[1]?.easing ?? easing });
    }

    for (let index = 1; index < phases.length; index += 1) {
      const phase = phases[index];
      const transition = phase.duration == null ? defaultDuration : Math.max(0, Number(phase.duration) || 0);
      const phaseEasing = phase.easing ?? easing;
      for (const [key] of entries) {
        const frames = framesByKey.get(key);
        if (frames.length) frames[frames.length - 1].easing = phaseEasing;
      }
      time += transition;
      this.arrivals[index] = time;
      for (const [key] of entries) {
        if (phase.values?.[key] !== undefined) current.set(key, phase.values[key]);
        framesByKey.get(key).push({ at: time, value: current.get(key), easing: phases[index + 1]?.easing ?? easing });
      }
      const hold = Math.max(0, Number(phase.hold) || 0);
      if (hold > 0) {
        time += hold;
        for (const [key] of entries) framesByKey.get(key).push({ at: time, value: current.get(key), easing: phases[index + 1]?.easing ?? easing });
      }
    }

    for (const [key, target, options] of entries) this.timeline.track(target, framesByKey.get(key), options);
  }

  get duration() { return this.timeline.duration; }

  phaseAt(timeSeconds) {
    const time = clamp(Number(timeSeconds) || 0, 0, this.duration);
    let index = 0;
    for (let i = 1; i < this.arrivals.length; i += 1) {
      if (this.arrivals[i] <= time + EPSILON) index = i;
      else break;
    }
    return this.names[index];
  }

  player(options = {}) { return this.timeline.player(options); }
  sample(time, options) { return this.timeline.sample(time, options); }
}

export function timeline(options) {
  return new Timeline(options);
}

export function createPhaseTimeline(targets, phases, options) {
  return new PhaseTimeline(targets, phases, options);
}

export function stagger(interval, {
  start = 0,
  from = 'first',
  easing,
} = {}) {
  const spacing = Number(interval);
  if (!Number.isFinite(spacing) || spacing < 0) throw new RangeError('stagger interval must be a finite non-negative number.');
  const base = Number(start);
  if (!Number.isFinite(base)) throw new TypeError('stagger start must be finite.');

  return (index, total) => {
    const count = Math.max(1, Math.floor(total));
    const i = clamp(Math.floor(index), 0, count - 1);
    let rank;
    if (typeof from === 'number' && Number.isFinite(from)) rank = Math.abs(i - clamp(Math.floor(from), 0, count - 1));
    else if (from === 'last') rank = count - 1 - i;
    else if (from === 'center') rank = Math.abs(i - (count - 1) / 2);
    else rank = i;

    if (!easing || count <= 1) return base + rank * spacing;
    const maxRank = from === 'center' ? Math.max(0.5, (count - 1) / 2) : count - 1;
    const normalized = maxRank <= EPSILON ? 0 : rank / maxRank;
    return base + easingValue(easing, normalized) * maxRank * spacing;
  };
}


function nearestSnap(value, points) {
  if (!Array.isArray(points) || points.length === 0) return value;
  let best = Number(points[0]);
  let distance = Math.abs(value - best);
  for (let index = 1; index < points.length; index += 1) {
    const candidate = Number(points[index]);
    if (!Number.isFinite(candidate)) continue;
    const nextDistance = Math.abs(value - candidate);
    if (nextDistance < distance) {
      best = candidate;
      distance = nextDistance;
    }
  }
  return Number.isFinite(best) ? best : value;
}

/**
 * Maps an ordinary numeric MotionValue onto TimelinePlayer progress. The input
 * domain can be pixels or any other scalar range, which lets DragController
 * drive a timeline without the timeline package depending on DOM/gestures.
 */
export class TimelineScrubber {
  constructor(player, {
    progress,
    engine = player?.engine ?? defaultEngine,
    min = 0,
    max = 1,
    snapPoints = [min, max],
    pauseOnBind = true,
    inertiaOptions = {},
  } = {}) {
    if (!(player instanceof TimelinePlayer)) throw new TypeError('TimelineScrubber requires a TimelinePlayer.');
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) throw new RangeError('TimelineScrubber max must be greater than min.');
    this.player = player;
    this.engine = engine;
    this.min = Number(min);
    this.max = Number(max);
    this.snapPoints = Array.from(snapPoints ?? [], Number).filter(Number.isFinite);
    this.inertiaOptions = { ...inertiaOptions };
    this.progress = progress ?? motionValue(this.min + player.progress * (this.max - this.min));
    if (!isMotionValue(this.progress)) throw new TypeError('TimelineScrubber progress must be a MotionValue.');
    if (pauseOnBind) player.pause();
    this.unsubscribe = this.progress.subscribeValue((value) => this.#sample(value));
    this.controls = null;
  }

  #sample(value) {
    const normalized = clamp((value - this.min) / (this.max - this.min), 0, 1);
    this.player.seekProgress(normalized);
  }

  set(value, velocity = 0) {
    this.controls?.cancel?.();
    this.controls = null;
    this.progress.set(clamp(Number(value) || 0, this.min, this.max), Number(velocity) || 0);
    return this;
  }

  seekProgress(progress, velocity = 0) {
    const normalized = clamp(Number(progress) || 0, 0, 1);
    return this.set(this.min + normalized * (this.max - this.min), velocity * (this.max - this.min));
  }

  release({
    velocity = this.progress.getVelocity(),
    snapPoints = this.snapPoints,
    ...options
  } = {}) {
    this.player.pause();
    const snaps = Array.from(snapPoints ?? [], Number).filter(Number.isFinite);
    const userModify = options.modifyTarget ?? this.inertiaOptions.modifyTarget;
    const spec = inertia({
      ...this.inertiaOptions,
      ...options,
      velocity,
      min: this.min,
      max: this.max,
      modifyTarget: (target) => {
        const modified = typeof userModify === 'function' ? Number(userModify(target)) : target;
        return nearestSnap(Number.isFinite(modified) ? modified : target, snaps);
      },
    });
    this.controls = this.engine.animateVelocity(this.progress, spec);
    return this.controls;
  }

  play({ direction } = {}) {
    this.controls?.cancel?.();
    this.controls = null;
    if (direction === 'forward') this.player.setPlaybackRate(Math.abs(this.player.playbackRate || 1));
    else if (direction === 'reverse') this.player.setPlaybackRate(-Math.abs(this.player.playbackRate || 1));
    this.player.play();
    return this.player;
  }

  dispose() {
    this.controls?.cancel?.();
    this.controls = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}

export function createTimelineScrubber(player, options) {
  return new TimelineScrubber(player, options);
}
