import { FrameBatcher } from '../render/frame-batcher.js';
export { WebGPUSpringBatch } from './spring-batch.js';

function normalizeBinding(binding, fallbackIndex) {
  if (binding?.get) return { value: binding, index: fallbackIndex };
  if (binding?.value?.get) return { value: binding.value, index: Number.isInteger(binding.index) ? binding.index : fallbackIndex };
  throw new TypeError('WebGPU binding requires a MotionValue or { value, index } entry.');
}

export class WebGPUBufferBinder {
  constructor(device, buffer, bindings, {
    byteOffset = 0,
    floatCount,
    requestFrame,
    cancelFrame,
    flushInitial = true,
  } = {}) {
    if (!device?.queue?.writeBuffer) throw new TypeError('WebGPUBufferBinder requires a GPUDevice-like object with queue.writeBuffer().');
    if (!buffer) throw new TypeError('WebGPUBufferBinder requires a GPUBuffer-like target.');
    if (!Array.isArray(bindings) || bindings.length === 0) throw new TypeError('WebGPUBufferBinder requires at least one binding.');
    this.device = device;
    this.buffer = buffer;
    this.byteOffset = Math.max(0, Math.floor(Number(byteOffset) || 0));
    this.bindings = bindings.map(normalizeBinding);
    const required = this.bindings.reduce((max, entry) => Math.max(max, entry.index + 1), 0);
    const count = floatCount == null ? required : Math.max(required, Math.floor(floatCount));
    this.data = new Float32Array(count);
    this.unsubscribers = [];
    this.writes = 0;
    this.disposed = false;
    this.dirty = true;
    this.batcher = new FrameBatcher(() => this.flush(), { requestFrame, cancelFrame });

    for (const entry of this.bindings) {
      this.data[entry.index] = Number(entry.value.get()) || 0;
      const subscribe = entry.value.subscribeValue ?? entry.value.subscribe;
      this.unsubscribers.push(subscribe.call(entry.value, (next) => {
        this.data[entry.index] = Number(next) || 0;
        this.dirty = true;
        this.batcher.invalidate();
      }, { emitCurrent: false }));
    }
    if (flushInitial) this.batcher.invalidate();
  }

  flush() {
    if (this.disposed || !this.dirty) return false;
    this.device.queue.writeBuffer(
      this.buffer,
      this.byteOffset,
      this.data.buffer,
      this.data.byteOffset,
      this.data.byteLength,
    );
    this.dirty = false;
    this.writes += 1;
    return true;
  }

  flushNow() { this.batcher.flushNow(); return this; }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.batcher.dispose();
    for (const unsubscribe of this.unsubscribers) unsubscribe?.();
    this.unsubscribers.length = 0;
  }
}

export function createWebGPUBufferBinder(device, buffer, bindings, options) {
  return new WebGPUBufferBinder(device, buffer, bindings, options);
}
