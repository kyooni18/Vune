import type { MotionValue } from '../../index.js';
import type { TimelinePlayer } from '../timeline/index.js';

export type ScrollMetrics = { offset: number; viewport: number; extent: number; max: number };
export type ScrollRangeContext = { offset?: number; metrics?: ScrollMetrics; target?: unknown; axis?: 'x' | 'y' };
export type ScrollBound = number | ((context: ScrollRangeContext | ScrollMetrics) => number);

export class ScrollTracker {
  constructor(options?: {
    start?: ScrollBound;
    end?: ScrollBound;
    clamp?: boolean;
    velocity?: { windowMs?: number; maxSamples?: number; maxVelocity?: number };
    initialOffset?: number;
  });
  readonly offset: MotionValue;
  readonly progress: MotionValue;
  readonly lastRange: { start: number; end: number; span: number };
  setRange(start: ScrollBound, end: ScrollBound): this;
  resolveRange(context?: ScrollRangeContext): { start: number; end: number; span: number };
  sample(offset: number, time?: number, options?: { context?: ScrollRangeContext; resetVelocity?: boolean }): number;
  reset(offset?: number, time?: number, context?: ScrollRangeContext): number;
  getState(): { offset: number; velocity: number; progress: number; progressVelocity: number; start: number; end: number };
}
export function createScrollTracker(options?: ConstructorParameters<typeof ScrollTracker>[0]): ScrollTracker;
export function readScrollMetrics(target: Window | Element | object, axis?: 'x' | 'y'): ScrollMetrics;

export class ScrollObserver {
  constructor(target: EventTarget & object, options?: {
    tracker?: ScrollTracker;
    axis?: 'x' | 'y';
    start?: ScrollBound;
    end?: ScrollBound;
    clamp?: boolean;
    requestFrame?: (callback: FrameRequestCallback) => number;
    cancelFrame?: (id: number) => void;
    passive?: boolean;
    velocity?: { windowMs?: number; maxSamples?: number; maxVelocity?: number };
    autoStart?: boolean;
  });
  readonly tracker: ScrollTracker;
  readonly offset: MotionValue;
  readonly progress: MotionValue;
  metrics: ScrollMetrics;
  schedule(): void;
  update(time?: number, options?: { resetVelocity?: boolean }): ReturnType<ScrollTracker['getState']>;
  dispose(): void;
}
export function observeScroll(target: EventTarget & object, options?: ConstructorParameters<typeof ScrollObserver>[1]): ScrollObserver;

export class ScrollTimelineLink {
  constructor(player: TimelinePlayer, source: ScrollTracker | ScrollObserver | MotionValue, options?: { pause?: boolean });
  dispose(): void;
}
export function bindScrollTimeline(player: TimelinePlayer, source: ScrollTracker | ScrollObserver | MotionValue, options?: { pause?: boolean }): ScrollTimelineLink;
