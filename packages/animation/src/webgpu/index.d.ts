import type { MotionValue } from '../../index.js';
export class WebGPUSpringBatch {
  constructor(device: unknown, capacity?: number);
  static isSupported(device?: unknown): boolean;
  static create(capacity?: number, device?: unknown): Promise<WebGPUSpringBatch>;
  readonly kind: 'webgpu';
  readonly variant: 'compute';
  readonly capacity: number;
  readonly positions: Float32Array;
  readonly velocities: Float32Array;
  readonly targets: Float32Array;
  readonly omegas: Float32Array;
  readonly dampingRatios: Float32Array;
  ensureCapacity(required: number): void;
  step(count: number, dtSeconds: number): never;
  stepAsync(count: number, dtSeconds: number): Promise<void>;
  copyInto(other: { positions: Float32Array; velocities: Float32Array; targets: Float32Array; omegas: Float32Array; dampingRatios: Float32Array }, count: number): void;
  dispose(): void;
}
export type WebGPUValueBinding = MotionValue | { value: MotionValue; index?: number };
export class WebGPUBufferBinder {
  constructor(device: { queue: { writeBuffer(...args: any[]): void } }, buffer: unknown, bindings: WebGPUValueBinding[], options?: {
    byteOffset?: number;
    floatCount?: number;
    requestFrame?: (callback: FrameRequestCallback) => any;
    cancelFrame?: (id: any) => void;
    flushInitial?: boolean;
  });
  readonly data: Float32Array;
  readonly writes: number;
  flush(): boolean;
  flushNow(): this;
  dispose(): void;
}
export function createWebGPUBufferBinder(device: ConstructorParameters<typeof WebGPUBufferBinder>[0], buffer: unknown, bindings: WebGPUValueBinding[], options?: ConstructorParameters<typeof WebGPUBufferBinder>[3]): WebGPUBufferBinder;
