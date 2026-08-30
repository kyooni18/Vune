export class SharedSpringWorkerBackend {
  static isSupported(): boolean;
  static create(capacity?: number): Promise<SharedSpringWorkerBackend>;
  readonly kind: 'worker-wasm';
  readonly capacity: number;
  readonly variant: 'simd' | 'scalar';
  readonly atomicCompletion: boolean;
  readonly positions: Float32Array;
  readonly velocities: Float32Array;
  readonly targets: Float32Array;
  readonly omegas: Float32Array;
  readonly dampingRatios: Float32Array;
  ensureCapacity(required: number): void;
  step(count: number, dtSeconds: number): void;
  stepAsync(count: number, dtSeconds: number): Promise<void>;
  dispose(): void;
}
