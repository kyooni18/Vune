function defaultRequestFrame(callback) {
  if (typeof globalThis.requestAnimationFrame === 'function') return globalThis.requestAnimationFrame(callback);
  return setTimeout(() => callback(globalThis.performance?.now?.() ?? Date.now()), 16);
}

function defaultCancelFrame(id) {
  if (typeof globalThis.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(id);
  else clearTimeout(id);
}

export class FrameBatcher {
  constructor(flush, {
    requestFrame = defaultRequestFrame,
    cancelFrame = defaultCancelFrame,
  } = {}) {
    if (typeof flush !== 'function') throw new TypeError('FrameBatcher requires a flush callback.');
    this.flushCallback = flush;
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
    this.pending = false;
    this.frameId = null;
    this.disposed = false;
  }

  invalidate() {
    if (this.disposed || this.pending) return false;
    this.pending = true;
    this.frameId = this.requestFrame((time) => {
      this.pending = false;
      this.frameId = null;
      if (!this.disposed) this.flushCallback(time);
    });
    return true;
  }

  flushNow(time = globalThis.performance?.now?.() ?? Date.now()) {
    if (this.disposed) return false;
    if (this.pending && this.frameId != null) this.cancelFrame(this.frameId);
    this.pending = false;
    this.frameId = null;
    this.flushCallback(time);
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.pending && this.frameId != null) this.cancelFrame(this.frameId);
    this.pending = false;
    this.frameId = null;
  }
}
