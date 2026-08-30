export class MotionValue {
  #value;
  #velocity = 0;
  #listeners = new Set();
  #valueListeners = new Set();
  #version = 0;

  constructor(initial = 0) {
    if (!Number.isFinite(initial)) throw new TypeError('MotionValue requires a finite number.');
    this.#value = initial;
  }

  get() { return this.#value; }
  getVelocity() { return this.#velocity; }
  getVersion() { return this.#version; }

  set(value, velocity = 0) {
    if (!Number.isFinite(value)) return;
    this.#commit(value, velocity);
  }

  #commit(value, velocity) {
    if (Object.is(value, this.#value) && Object.is(velocity, this.#velocity)) return;
    const previous = this.#value;
    this.#value = value;
    this.#velocity = velocity;
    this.#version += 1;

    for (const listener of this.#valueListeners) listener(value);
    if (this.#listeners.size > 0) {
      const info = { previous, velocity, version: this.#version };
      for (const listener of this.#listeners) listener(value, info);
    }
  }

  _commit(value, velocity) { this.#commit(value, velocity); }

  subscribe(listener, { emitCurrent = true } = {}) {
    this.#listeners.add(listener);
    if (emitCurrent) listener(this.#value, { previous: this.#value, velocity: this.#velocity, version: this.#version });
    return () => this.#listeners.delete(listener);
  }

  subscribeValue(listener, { emitCurrent = true } = {}) {
    this.#valueListeners.add(listener);
    if (emitCurrent) listener(this.#value);
    return () => this.#valueListeners.delete(listener);
  }
}

export function motionValue(initial = 0) {
  return new MotionValue(initial);
}
