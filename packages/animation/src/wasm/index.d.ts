export class WasmSpringBatch {
  static create(capacity?: number): Promise<WasmSpringBatch>;
  readonly kind: 'wasm';
  readonly variant: 'simd' | 'scalar';
  readonly capacity: number;
  readonly positions: Float32Array;
  readonly velocities: Float32Array;
  readonly targets: Float32Array;
  readonly omegas: Float32Array;
  readonly dampingRatios: Float32Array;
  step(count: number, dtSeconds: number): void;
}
export class SharedWasmSpringBatch {
  static create(capacity?: number, options?: { memory?: WebAssembly.Memory }): Promise<SharedWasmSpringBatch>;
  readonly kind: 'shared-wasm';
  readonly variant: 'simd' | 'scalar';
  readonly capacity: number;
  readonly memory: WebAssembly.Memory;
  readonly positions: Float32Array;
  readonly velocities: Float32Array;
  readonly targets: Float32Array;
  readonly omegas: Float32Array;
  readonly dampingRatios: Float32Array;
  step(count: number, dtSeconds: number): void;
}
export function loadSpringKernel(): Promise<unknown>;
export function loadSharedSpringKernel(options?: { memory?: WebAssembly.Memory; preferSimd?: boolean }): Promise<unknown>;
export function instantiateSharedSpringKernel(memory: WebAssembly.Memory, variant?: 'simd' | 'scalar'): Promise<unknown>;
export function createSharedWasmMemory(options?: { initialPages?: number; maximumPages?: number }): WebAssembly.Memory;
