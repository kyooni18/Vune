import type { BezierCurve, MotionEngine, MotionValue, ColorSpace, InterpolatorOptions } from '../../index.js';

export type TimelineEasing = BezierCurve | ((progress: number) => number);
export type TimelineKeyframe<T> = {
  at?: number;
  time?: number;
  offset?: number;
  value: T;
  easing?: TimelineEasing;
};
export type TimelineTrackOptions = InterpolatorOptions & {
  duration?: number;
  easing?: TimelineEasing;
};
export type TimelineDirection = 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';
export type TimelineFill = 'none' | 'forwards' | 'backwards' | 'both';
export type TimelineStatus = 'finished' | 'cancelled' | 'interrupted';
export type TimelineResult = {
  status: TimelineStatus;
  currentTime: number;
  elapsedTime: number;
  progress: number;
  iteration: number;
};
export type TimelinePlayerOptions = {
  engine?: MotionEngine;
  autoplay?: boolean;
  playbackRate?: number;
  iterations?: number;
  direction?: TimelineDirection;
  onUpdate?: (player: TimelinePlayer) => void;
  onRepeat?: (iteration: number, player: TimelinePlayer, crossedIterations: number) => void;
  onComplete?: (player: TimelinePlayer) => void;
};

export class Timeline {
  constructor(options?: { duration?: number; easing?: TimelineEasing });
  readonly duration: number;
  track(target: MotionValue, frames: Array<number | TimelineKeyframe<number>>, options?: { duration?: number; easing?: TimelineEasing }): this;
  track<T>(target: ((value: T, velocity?: number) => void) | { set(value: T, velocity?: number): void }, frames: Array<T | TimelineKeyframe<T>>, options?: TimelineTrackOptions): this;
  keyframes(target: MotionValue, frames: Array<number | TimelineKeyframe<number>>, options?: { duration?: number; easing?: TimelineEasing }): this;
  keyframes<T>(target: ((value: T, velocity?: number) => void) | { set(value: T, velocity?: number): void }, frames: Array<T | TimelineKeyframe<T>>, options?: TimelineTrackOptions): this;
  fromTo(target: MotionValue, from: number, to: number, options?: { at?: number; duration?: number; easing?: TimelineEasing }): this;
  fromTo<T>(target: ((value: T, velocity?: number) => void) | { set(value: T, velocity?: number): void }, from: T, to: T, options?: TimelineTrackOptions & { at?: number }): this;
  to(target: MotionValue, to: number, options?: { at?: number; duration?: number; easing?: TimelineEasing; from?: number }): this;
  to<T>(target: ((value: T, velocity?: number) => void) | { get?(): T; set(value: T, velocity?: number): void }, to: T, options?: TimelineTrackOptions & { at?: number; from?: T }): this;
  add(child: Timeline, options?: { at?: number; speed?: number; fill?: TimelineFill }): this;
  sample(time: number, options?: { velocityScale?: number }): number;
  zeroVelocities(): void;
  hasMotionValue(value: MotionValue): boolean;
  stopConflicts(engine: MotionEngine): void;
  player(options?: TimelinePlayerOptions): TimelinePlayer;
}

export class TimelinePlayer {
  constructor(timeline: Timeline, options?: TimelinePlayerOptions);
  readonly timeline: Timeline;
  readonly engine: MotionEngine;
  readonly duration: number;
  readonly totalDuration: number;
  readonly finished: Promise<TimelineResult>;
  readonly running: boolean;
  state: 'idle' | 'running' | 'paused' | TimelineStatus;
  playbackRate: number;
  readonly iterations: number;
  readonly direction: TimelineDirection;
  elapsedTime: number;
  currentTime: number;
  progress: number;
  iteration: number;
  play(): this;
  pause(): this;
  cancel(): this;
  finish(): this;
  reverse(): this;
  setPlaybackRate(rate: number): this;
  seek(timeSeconds: number, options?: { iteration?: number }): this;
  seekProgress(progress: number, options?: { iteration?: number }): this;
  scrub(progress: number, options?: { iteration?: number }): this;
  seekElapsed(elapsedSeconds: number): this;
  step(dtMs: number): boolean;
  owns(value: MotionValue): boolean;
  interruptValue(value: MotionValue, status?: 'cancelled' | 'interrupted'): boolean;
}

export type PhaseTarget<T = unknown> =
  | MotionValue
  | ((value: T) => void)
  | { set(value: T): void }
  | ({ target: MotionValue | ((value: T) => void) | { set(value: T): void } } & TimelineTrackOptions);
export type PhaseDefinition = {
  name?: string;
  duration?: number;
  hold?: number;
  easing?: TimelineEasing;
  values?: Record<string, unknown>;
};

export class PhaseTimeline {
  constructor(
    targets: Record<string, PhaseTarget>,
    phases: PhaseDefinition[],
    options?: { defaultDuration?: number; easing?: TimelineEasing },
  );
  readonly names: string[];
  readonly arrivals: Float64Array;
  readonly timeline: Timeline;
  readonly duration: number;
  phaseAt(timeSeconds: number): string;
  player(options?: TimelinePlayerOptions): TimelinePlayer;
  sample(time: number, options?: { velocityScale?: number }): number;
}

export function timeline(options?: { duration?: number; easing?: TimelineEasing }): Timeline;
export function createPhaseTimeline(
  targets: Record<string, PhaseTarget>,
  phases: PhaseDefinition[],
  options?: { defaultDuration?: number; easing?: TimelineEasing },
): PhaseTimeline;
export function stagger(
  interval: number,
  options?: { start?: number; from?: 'first' | 'last' | 'center' | number; easing?: TimelineEasing },
): (index: number, total: number) => number;

export class TimelineScrubber {
  constructor(player: TimelinePlayer, options?: {
    progress?: MotionValue;
    engine?: MotionEngine;
    min?: number;
    max?: number;
    snapPoints?: number[];
    pauseOnBind?: boolean;
    inertiaOptions?: import('../../index.js').InertiaOptions;
  });
  readonly player: TimelinePlayer;
  readonly engine: MotionEngine;
  readonly progress: MotionValue;
  readonly min: number;
  readonly max: number;
  controls: import('../../index.js').AnimationControls | null;
  set(value: number, velocity?: number): this;
  seekProgress(progress: number, velocity?: number): this;
  release(options?: import('../../index.js').InertiaOptions & { velocity?: number; snapPoints?: number[] }): import('../../index.js').AnimationControls;
  play(options?: { direction?: 'forward' | 'reverse' }): TimelinePlayer;
  dispose(): void;
}
export function createTimelineScrubber(player: TimelinePlayer, options?: ConstructorParameters<typeof TimelineScrubber>[1]): TimelineScrubber;
