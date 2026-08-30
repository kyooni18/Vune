import type { MotionEngine, MotionSpec, MotionValue, InterpolatorOptions, AnimationResult } from '../../index.js';

export type TransitionTarget<T = unknown> = MotionValue | ((value: T) => void) | { set(value: T, velocity?: number): void };
export type StateBinding<T = unknown> = TransitionTarget<T> | ({ target: TransitionTarget<T>; spec?: MotionSpec } & InterpolatorOptions);
export type TransitionGroupResult = { status: AnimationResult['status']; results?: unknown[] };
export type TransitionGroupControls = {
  cancel(): void;
  finish(): void;
  readonly finished: Promise<TransitionGroupResult>;
};
export type TransitionRoutes = Record<string, MotionSpec> | ((from: string, to: string) => MotionSpec | undefined);

export class StateTransitionGraph {
  constructor(
    bindings: Record<string, StateBinding>,
    states: Record<string, Record<string, unknown>>,
    options?: {
      initial?: string;
      engine?: MotionEngine;
      spec?: MotionSpec;
      routes?: TransitionRoutes;
      onStateChange?: (state: string, previous: string, info: { immediate: boolean; graph: StateTransitionGraph }) => void;
    },
  );
  readonly engine: MotionEngine;
  state: string;
  targetState: string;
  active: TransitionGroupControls | null;
  set(state: string): this;
  to(state: string, spec?: MotionSpec): TransitionGroupControls;
  cancel(): void;
  finish(): void;
}

export function createStateTransitionGraph(
  bindings: Record<string, StateBinding>,
  states: Record<string, Record<string, unknown>>,
  options?: ConstructorParameters<typeof StateTransitionGraph>[2],
): StateTransitionGraph;

export type TransitionBinding<T = unknown> = {
  key?: string;
  target: TransitionTarget<T>;
  from: T;
  to: T;
  spec?: MotionSpec;
} & InterpolatorOptions;

export class TransitionController {
  constructor(bindings: TransitionBinding[], options?: {
    present?: boolean;
    engine?: MotionEngine;
    enter?: MotionSpec;
    exit?: MotionSpec;
    onEnter?: (controller: TransitionController) => void;
    onExit?: (controller: TransitionController) => void;
    onEntered?: (controller: TransitionController) => void;
    onExited?: (controller: TransitionController) => void;
  });
  present: boolean;
  readonly graph: StateTransitionGraph;
  readonly state: 'entered' | 'exited' | 'entering' | 'exiting';
  enter(spec?: MotionSpec): TransitionGroupControls;
  exit(spec?: MotionSpec): TransitionGroupControls;
  setPresent(present: boolean, spec?: MotionSpec): TransitionGroupControls;
  cancel(): void;
  finish(): void;
  dispose(): void;
}

export function createTransition(bindings: TransitionBinding[], options?: ConstructorParameters<typeof TransitionController>[1]): TransitionController;

export class PresenceController {
  constructor(transition: TransitionController, options?: {
    present?: boolean;
    onRenderChange?: (rendered: boolean, controller: PresenceController) => void;
  });
  readonly transition: TransitionController;
  present: boolean;
  rendered: boolean;
  setPresent(present: boolean, spec?: MotionSpec): TransitionGroupControls;
  enter(spec?: MotionSpec): TransitionGroupControls;
  exit(spec?: MotionSpec): TransitionGroupControls;
  cancel(): void;
  finish(): void;
  dispose(): void;
}
export function createPresence(transition: TransitionController, options?: ConstructorParameters<typeof PresenceController>[1]): PresenceController;
