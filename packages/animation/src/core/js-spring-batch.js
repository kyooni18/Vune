const MAX_STEP_SECONDS = 1 / 240;
const MAX_SUBSTEPS = 32;

export class JsSpringBatch {
  constructor(capacity = 256) {
    this.kind = 'js';
    this.capacity = capacity;
    this.positions = new Float32Array(capacity);
    this.velocities = new Float32Array(capacity);
    this.targets = new Float32Array(capacity);
    this.omegas = new Float32Array(capacity);
    this.dampingRatios = new Float32Array(capacity);
  }

  ensureCapacity(required) {
    if (required <= this.capacity) return;
    let next = this.capacity;
    while (next < required) next *= 2;
    for (const key of ['positions', 'velocities', 'targets', 'omegas', 'dampingRatios']) {
      const old = this[key];
      const replacement = new Float32Array(next);
      replacement.set(old);
      this[key] = replacement;
    }
    this.capacity = next;
  }

  copyInto(other, count) {
    other.positions.set(this.positions.subarray(0, count));
    other.velocities.set(this.velocities.subarray(0, count));
    other.targets.set(this.targets.subarray(0, count));
    other.omegas.set(this.omegas.subarray(0, count));
    other.dampingRatios.set(this.dampingRatios.subarray(0, count));
  }

  step(count, dtSeconds) {
    if (count === 0 || dtSeconds <= 0) return;
    let steps = 1;
    while (dtSeconds / steps > MAX_STEP_SECONDS && steps < MAX_SUBSTEPS) steps += 1;
    const h = dtSeconds / steps;

    for (let s = 0; s < steps; s += 1) {
      for (let i = 0; i < count; i += 1) {
        let x = this.positions[i];
        let v = this.velocities[i];
        const target = this.targets[i];
        const omega = this.omegas[i];
        const zeta = this.dampingRatios[i];
        const acceleration = omega * omega * (target - x) - 2 * zeta * omega * v;
        v += acceleration * h;
        x += v * h;
        this.positions[i] = x;
        this.velocities[i] = v;
      }
    }
  }
}
