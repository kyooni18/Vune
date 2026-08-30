import { loadSpringKernel } from './loader.js';

export class WasmSpringBatch {
  static async create(capacity = 65536) {
    const { instance, variant } = await loadSpringKernel();
    return new WasmSpringBatch(instance.exports, variant, capacity);
  }

  constructor(exports, variant, capacity) {
    this.kind = 'wasm';
    this.variant = variant;
    this.capacity = capacity;
    this.exports = exports;
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
      if (!pointer) throw new Error(`WASM allocation failed for ${name}.`);
      this[name] = new Float32Array(exports.memory.buffer, pointer, capacity);
    }
  }

  ensureCapacity(required) {
    if (required > this.capacity) throw new RangeError(`WASM spring capacity exceeded (${required} > ${this.capacity}).`);
  }

  copyInto(other, count) {
    other.positions.set(this.positions.subarray(0, count));
    other.velocities.set(this.velocities.subarray(0, count));
    other.targets.set(this.targets.subarray(0, count));
    other.omegas.set(this.omegas.subarray(0, count));
    other.dampingRatios.set(this.dampingRatios.subarray(0, count));
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
