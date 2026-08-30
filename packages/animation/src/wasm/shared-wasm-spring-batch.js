import { createSharedWasmMemory, loadSharedSpringKernel } from './loader.js';

export class SharedWasmSpringBatch {
  static async create(capacity = 65536, { memory } = {}) {
    const sharedMemory = memory ?? createSharedWasmMemory();
    const { instance, variant } = await loadSharedSpringKernel({ memory: sharedMemory });
    return new SharedWasmSpringBatch(instance.exports, variant, capacity, sharedMemory);
  }

  constructor(exports, variant, capacity, memory) {
    this.kind = 'shared-wasm';
    this.variant = variant;
    this.capacity = capacity;
    this.exports = exports;
    this.memory = memory;
    const bytes = capacity * 4;
    const alloc = (size) => exports.motion_alloc(size, 16);
    this.ptrs = {
      positions: alloc(bytes),
      velocities: alloc(bytes),
      targets: alloc(bytes),
      omegas: alloc(bytes),
      dampingRatios: alloc(bytes),
    };
    for (const [name, pointer] of Object.entries(this.ptrs)) {
      if (!pointer) throw new Error(`Shared WASM allocation failed for ${name}.`);
      this[name] = new Float32Array(memory.buffer, pointer, capacity);
    }
  }

  ensureCapacity(required) {
    if (required > this.capacity) throw new RangeError(`Shared WASM spring capacity exceeded (${required} > ${this.capacity}).`);
  }

  copyInto(other, count) {
    for (const key of ['positions', 'velocities', 'targets', 'omegas', 'dampingRatios']) {
      other[key].set(this[key].subarray(0, count));
    }
  }

  step(count, dtSeconds) {
    this.exports.step_springs(
      this.ptrs.positions,
      this.ptrs.velocities,
      this.ptrs.targets,
      this.ptrs.omegas,
      this.ptrs.dampingRatios,
      count,
      dtSeconds,
    );
  }
}
