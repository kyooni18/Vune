import type { AnimationResult, InertiaOptions, MotionEngine, MotionValue } from '../../index.js';

export type Point = { x: number; y: number };
export type DragBounds = { minX?: number; maxX?: number; minY?: number; maxY?: number };
export type DragAxis = 'x' | 'y' | 'both';
export type DragState = {
  active: boolean;
  axis: DragAxis;
  lockedAxis: 'x' | 'y' | null;
  point: Point;
  value: { x: number | null; y: number | null };
  velocity: Point;
};
export type GroupAnimationControls = {
  cancel(): void;
  finish(): void;
  finished: Promise<Array<AnimationResult>>;
};

export class VelocityTracker {
  constructor(options?: { windowMs?: number; maxSamples?: number; maxVelocity?: number });
  readonly velocity: number;
  reset(value: number, time?: number): this;
  add(value: number, time?: number): this;
}

export function rubberBandDistance(distance: number, dimension?: number, constant?: number): number;
export function constrainWithRubberBand(value: number, min?: number, max?: number, options?: {
  enabled?: boolean;
  constant?: number;
  dimension?: number;
}): number;

export type DragControllerOptions = {
  x?: MotionValue | null;
  y?: MotionValue | null;
  axis?: DragAxis;
  engine?: MotionEngine;
  bounds?: DragBounds | (() => DragBounds) | null;
  momentum?: boolean;
  inertia?: InertiaOptions;
  rubberBand?: boolean | number;
  rubberBandConstant?: number;
  rubberBandDimension?: number | { x?: number; y?: number };
  directionLock?: boolean;
  directionLockThreshold?: number;
  snapX?: number[] | ((target: number) => number) | null;
  snapY?: number[] | ((target: number) => number) | null;
  settle?: { response?: number; dampingRatio?: number };
  velocity?: { windowMs?: number; maxSamples?: number; maxVelocity?: number };
  onStart?: (state: DragState) => void;
  onMove?: (state: DragState) => void;
  onEnd?: (state: DragState & { controls: GroupAnimationControls }) => void;
};

export class DragController {
  constructor(options?: DragControllerOptions);
  readonly active: boolean;
  readonly lockedAxis: 'x' | 'y' | null;
  start(point: Point, time?: number): DragState;
  move(point: Point, time?: number): DragState;
  end(time?: number): DragState & { controls: GroupAnimationControls };
  cancel(options?: { settle?: boolean }): DragState;
  getState(): DragState;
}
export function createDragController(options?: DragControllerOptions): DragController;
