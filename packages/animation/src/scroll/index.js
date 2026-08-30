import { motionValue } from '../core/motion-value.js';
import { VelocityTracker } from '../gesture/index.js';

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function resolveBound(bound, context) {
  const value = typeof bound === 'function' ? bound(context) : bound;
  return finite(value);
}

export class ScrollTracker {
  constructor({
    start = 0,
    end = 1,
    clamp: shouldClamp = true,
    velocity = {},
    initialOffset = 0,
  } = {}) {
    this.startSource = start;
    this.endSource = end;
    this.clamp = shouldClamp !== false;
    this.offset = motionValue(finite(initialOffset));
    this.progress = motionValue(0);
    this.velocityTracker = new VelocityTracker(velocity);
    this.velocityTracker.reset(this.offset.get(), nowMs());
    this.lastRange = { start: 0, end: 1, span: 1 };
    this.sampleContext = {};
    this.sample(this.offset.get(), nowMs(), { resetVelocity: true });
  }

  setRange(start, end) {
    this.startSource = start;
    this.endSource = end;
    this.sample(this.offset.get(), nowMs(), { resetVelocity: true });
    return this;
  }

  resolveRange(context = {}) {
    const start = resolveBound(this.startSource, context);
    const end = resolveBound(this.endSource, context);
    const span = end - start;
    this.lastRange.start = start;
    this.lastRange.end = end;
    this.lastRange.span = span;
    return this.lastRange;
  }

  sample(offset, time = nowMs(), {
    context = {},
    resetVelocity = false,
  } = {}) {
    const nextOffset = finite(offset, this.offset.get());
    if (resetVelocity) this.velocityTracker.reset(nextOffset, time);
    else this.velocityTracker.add(nextOffset, time);
    const velocity = resetVelocity ? 0 : this.velocityTracker.velocity;
    const resolvedContext = context && typeof context === 'object' ? context : this.sampleContext;
    resolvedContext.offset = nextOffset;
    const range = this.resolveRange(resolvedContext);
    const raw = Math.abs(range.span) <= 1e-12 ? 0 : (nextOffset - range.start) / range.span;
    const progress = this.clamp ? clamp(raw, 0, 1) : raw;
    const progressVelocity = Math.abs(range.span) <= 1e-12 ? 0 : velocity / range.span;
    this.offset.set(nextOffset, velocity);
    this.progress.set(progress, this.clamp && (raw < 0 || raw > 1) ? 0 : progressVelocity);
    return progress;
  }

  reset(offset = this.offset.get(), time = nowMs(), context = {}) {
    return this.sample(offset, time, { context, resetVelocity: true });
  }

  getState() {
    return {
      offset: this.offset.get(),
      velocity: this.offset.getVelocity(),
      progress: this.progress.get(),
      progressVelocity: this.progress.getVelocity(),
      start: this.lastRange.start,
      end: this.lastRange.end,
    };
  }
}

export function createScrollTracker(options) {
  return new ScrollTracker(options);
}

function isWindowLike(target) {
  return target && (target === globalThis.window || ('document' in target && ('scrollX' in target || 'scrollY' in target)));
}

export function readScrollMetrics(target, axis = 'y') {
  if (!target) throw new TypeError('readScrollMetrics() requires a scroll target.');
  if (axis !== 'x' && axis !== 'y') throw new TypeError("scroll axis must be 'x' or 'y'.");
  if (isWindowLike(target)) {
    const documentElement = target.document?.documentElement;
    if (axis === 'x') {
      const offset = finite(target.scrollX ?? target.pageXOffset);
      const viewport = finite(target.innerWidth ?? documentElement?.clientWidth);
      const extent = Math.max(finite(documentElement?.scrollWidth), viewport);
      return { offset, viewport, extent, max: Math.max(0, extent - viewport) };
    }
    const offset = finite(target.scrollY ?? target.pageYOffset);
    const viewport = finite(target.innerHeight ?? documentElement?.clientHeight);
    const extent = Math.max(finite(documentElement?.scrollHeight), viewport);
    return { offset, viewport, extent, max: Math.max(0, extent - viewport) };
  }
  if (axis === 'x') {
    const offset = finite(target.scrollLeft);
    const viewport = finite(target.clientWidth);
    const extent = Math.max(finite(target.scrollWidth), viewport);
    return { offset, viewport, extent, max: Math.max(0, extent - viewport) };
  }
  const offset = finite(target.scrollTop);
  const viewport = finite(target.clientHeight);
  const extent = Math.max(finite(target.scrollHeight), viewport);
  return { offset, viewport, extent, max: Math.max(0, extent - viewport) };
}

function defaultRequestFrame(callback) {
  if (typeof globalThis.requestAnimationFrame === 'function') return globalThis.requestAnimationFrame(callback);
  return setTimeout(() => callback(nowMs()), 16);
}

function defaultCancelFrame(id) {
  if (typeof globalThis.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(id);
  else clearTimeout(id);
}

/**
 * DOM/window adapter that turns arbitrarily many scroll events into one metric
 * read and one ScrollTracker sample per animation frame.
 */
export class ScrollObserver {
  constructor(target, {
    tracker,
    axis = 'y',
    start = 0,
    end = (metrics) => metrics.max,
    clamp: shouldClamp = true,
    requestFrame = defaultRequestFrame,
    cancelFrame = defaultCancelFrame,
    passive = true,
    velocity,
    autoStart = true,
  } = {}) {
    if (!target?.addEventListener || !target?.removeEventListener) throw new TypeError('ScrollObserver requires an EventTarget-like scroll source.');
    if (axis !== 'x' && axis !== 'y') throw new TypeError("scroll axis must be 'x' or 'y'.");
    this.target = target;
    this.axis = axis;
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
    this.frameId = null;
    this.pending = false;
    this.disposed = false;
    this.metrics = { offset: 0, viewport: 0, extent: 0, max: 0 };
    this.context = { metrics: this.metrics, target: this.target, axis: this.axis, offset: 0 };
    this.tracker = tracker ?? new ScrollTracker({
      start: typeof start === 'function' ? (context) => start(context.metrics ?? context) : start,
      end: typeof end === 'function' ? (context) => end(context.metrics ?? context) : end,
      clamp: shouldClamp,
      velocity,
    });
    this.onScroll = () => this.schedule();
    target.addEventListener('scroll', this.onScroll, { passive });
    if (autoStart) this.update(nowMs(), { resetVelocity: true });
  }

  get offset() { return this.tracker.offset; }
  get progress() { return this.tracker.progress; }

  schedule() {
    if (this.disposed || this.pending) return;
    this.pending = true;
    this.frameId = this.requestFrame((time) => {
      this.pending = false;
      this.frameId = null;
      this.update(time);
    });
  }

  update(time = nowMs(), { resetVelocity = false } = {}) {
    if (this.disposed) return this.tracker.getState();
    this.metrics = readScrollMetrics(this.target, this.axis);
    this.context.metrics = this.metrics;
    this.context.offset = this.metrics.offset;
    this.tracker.sample(this.metrics.offset, time, { resetVelocity, context: this.context });
    return this.tracker.getState();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.target.removeEventListener('scroll', this.onScroll);
    if (this.pending && this.frameId != null) this.cancelFrame(this.frameId);
    this.pending = false;
    this.frameId = null;
  }
}

export function observeScroll(target, options) {
  return new ScrollObserver(target, options);
}

export class ScrollTimelineLink {
  constructor(player, source, { pause = true } = {}) {
    if (!player?.seekProgress) throw new TypeError('ScrollTimelineLink requires a TimelinePlayer-like target.');
    const progress = source?.progress ?? source;
    if (!progress?.subscribeValue && !progress?.subscribe) throw new TypeError('ScrollTimelineLink requires a ScrollTracker/Observer or MotionValue-like progress source.');
    this.player = player;
    this.source = source;
    if (pause) player.pause?.();
    this.unsubscribe = (progress.subscribeValue ?? progress.subscribe).call(progress, (value) => player.seekProgress(value));
  }

  dispose() {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}

export function bindScrollTimeline(player, source, options) {
  return new ScrollTimelineLink(player, source, options);
}
