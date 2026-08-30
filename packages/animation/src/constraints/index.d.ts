import type { MotionEngine, MotionValue } from '../../index.js';

export class ConstraintNode {
  readonly graph: ConstraintGraph;
  readonly index: number;
  readonly name: string;
  get(): number;
  getVelocity(): number;
  set(value: number, velocity?: number): this;
}

export class ConstraintGraph {
  constructor(options?: { engine?: MotionEngine | null });
  readonly nodes: ConstraintNode[];
  readonly dirty: boolean;
  node(value?: number | MotionValue, options?: { name?: string }): ConstraintNode;
  constant(value: number, options?: { name?: string }): ConstraintNode;
  affine(target: ConstraintNode, source: ConstraintNode | number, options?: { scale?: number; offset?: number }): this;
  follow(target: ConstraintNode, source: ConstraintNode | number, options?: { scale?: number; offset?: number }): this;
  clamp(target: ConstraintNode, source: ConstraintNode | number, options?: { min?: number; max?: number }): this;
  sum(target: ConstraintNode, a: ConstraintNode | number, b: ConstraintNode | number, options?: { scaleA?: number; scaleB?: number; offset?: number }): this;
  mix(target: ConstraintNode, a: ConstraintNode | number, b: ConstraintNode | number, progress: ConstraintNode | number): this;
  map(target: ConstraintNode, inputs: Array<ConstraintNode | number>, compute: (values: Float64Array, velocities: Float64Array, graph: ConstraintGraph) => number | { value: number; velocity?: number }): this;
  compile(): this;
  set(node: ConstraintNode, value: number, velocity?: number): this;
  invalidate(): void;
  evaluate(): boolean;
  step(dtMs?: number): boolean;
  attach(engine: MotionEngine): this;
  detach(): this;
  dispose(): void;
}
export function createConstraintGraph(options?: ConstructorParameters<typeof ConstraintGraph>[0]): ConstraintGraph;
