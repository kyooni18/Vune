import { FrameBatcher } from '../render/frame-batcher.js';

function normalizeValues(input) {
  return Array.isArray(input) ? input : [input];
}

function inferType(length) {
  if (length === 1) return '1f';
  if (length >= 2 && length <= 4) return `${length}fv`;
  if (length === 16) return 'matrix4fv';
  throw new RangeError('WebGL uniform bindings support 1, 2, 3, 4, or 16 scalar values.');
}

export class WebGLUniformBinder {
  constructor(gl, program, bindings = [], {
    autoUseProgram = true,
    requestFrame,
    cancelFrame,
    flushInitial = true,
  } = {}) {
    if (!gl) throw new TypeError('WebGLUniformBinder requires a WebGL-like context.');
    this.gl = gl;
    this.program = program;
    this.autoUseProgram = autoUseProgram;
    this.entries = [];
    this.unsubscribers = [];
    this.dirtyCount = 0;
    this.disposed = false;
    this.batcher = new FrameBatcher(() => this.flush(), { requestFrame, cancelFrame });
    for (const binding of bindings) this.add(binding);
    if (flushInitial && this.entries.length) this.batcher.invalidate();
  }

  add({ name, location, values, value, type } = {}) {
    const motions = normalizeValues(values ?? value);
    if (motions.length === 0 || motions.some((motion) => !motion?.get)) throw new TypeError('WebGL uniform binding requires MotionValue-like values.');
    const resolvedLocation = location ?? this.gl.getUniformLocation?.(this.program, name);
    if (resolvedLocation == null) throw new Error(`WebGL uniform '${name ?? '<unnamed>'}' was not found.`);
    const resolvedType = type ?? inferType(motions.length);
    const data = new Float32Array(motions.length);
    const entry = { name, location: resolvedLocation, values: motions, type: resolvedType, data, dirty: true };
    this.entries.push(entry);
    this.dirtyCount += 1;

    motions.forEach((motion, index) => {
      data[index] = Number(motion.get()) || 0;
      const subscribe = motion.subscribeValue ?? motion.subscribe;
      this.unsubscribers.push(subscribe.call(motion, (next) => {
        data[index] = Number(next) || 0;
        if (!entry.dirty) { entry.dirty = true; this.dirtyCount += 1; }
        this.batcher.invalidate();
      }, { emitCurrent: false }));
    });
    return this;
  }

  flush() {
    if (this.disposed || this.dirtyCount === 0) return 0;
    const gl = this.gl;
    if (this.autoUseProgram && typeof gl.useProgram === 'function') gl.useProgram(this.program);
    let writes = 0;
    for (const entry of this.entries) {
      if (!entry.dirty) continue;
      switch (entry.type) {
        case '1f': gl.uniform1f(entry.location, entry.data[0]); break;
        case '2fv': gl.uniform2fv(entry.location, entry.data); break;
        case '3fv': gl.uniform3fv(entry.location, entry.data); break;
        case '4fv': gl.uniform4fv(entry.location, entry.data); break;
        case 'matrix4fv': gl.uniformMatrix4fv(entry.location, false, entry.data); break;
        default: throw new TypeError(`Unsupported WebGL uniform type '${entry.type}'.`);
      }
      entry.dirty = false;
      writes += 1;
    }
    this.dirtyCount = 0;
    return writes;
  }

  flushNow() { this.batcher.flushNow(); return this; }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.batcher.dispose();
    for (const unsubscribe of this.unsubscribers) unsubscribe?.();
    this.unsubscribers.length = 0;
    this.entries.length = 0;
    this.dirtyCount = 0;
  }
}

export function createWebGLUniformBinder(gl, program, bindings, options) {
  return new WebGLUniformBinder(gl, program, bindings, options);
}
