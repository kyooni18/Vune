import { FrameBatcher } from '../render/frame-batcher.js';

function isMotionValue(value) {
  return value && typeof value.get === 'function' && (typeof value.subscribeValue === 'function' || typeof value.subscribe === 'function');
}

/**
 * Coalesces any number of MotionValue changes into one Canvas draw per frame.
 * The Float64Array passed to draw() is retained and reused for the lifetime of
 * the renderer.
 */
export class CanvasMotionRenderer {
  constructor(context, values, draw, {
    autoClear = false,
    requestFrame,
    cancelFrame,
    renderInitial = true,
  } = {}) {
    if (!context || typeof draw !== 'function') throw new TypeError('CanvasMotionRenderer requires a context and draw callback.');
    if (!Array.isArray(values)) throw new TypeError('CanvasMotionRenderer values must be an array.');
    this.context = context;
    this.values = values;
    this.draw = draw;
    this.autoClear = autoClear;
    this.snapshot = new Float64Array(values.length);
    this.unsubscribers = [];
    this.frames = 0;
    this.disposed = false;
    this.batcher = new FrameBatcher((time) => this.#render(time), { requestFrame, cancelFrame });

    values.forEach((value, index) => {
      if (!isMotionValue(value)) throw new TypeError(`Canvas motion value at index ${index} is not MotionValue-like.`);
      this.snapshot[index] = Number(value.get()) || 0;
      const subscribe = value.subscribeValue ?? value.subscribe;
      this.unsubscribers.push(subscribe.call(value, (next) => {
        this.snapshot[index] = Number(next) || 0;
        this.invalidate();
      }, { emitCurrent: false }));
    });
    if (renderInitial) this.invalidate();
  }

  #render(time) {
    if (this.disposed) return;
    if (this.autoClear) {
      const canvas = this.context.canvas;
      if (canvas && typeof this.context.clearRect === 'function') this.context.clearRect(0, 0, canvas.width, canvas.height);
    }
    this.frames += 1;
    this.draw(this.context, this.snapshot, time, this);
  }

  invalidate() { this.batcher.invalidate(); return this; }
  renderNow(time) { this.batcher.flushNow(time); return this; }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.batcher.dispose();
    for (const unsubscribe of this.unsubscribers) unsubscribe?.();
    this.unsubscribers.length = 0;
  }
}

export function createCanvasRenderer(context, values, draw, options) {
  return new CanvasMotionRenderer(context, values, draw, options);
}
