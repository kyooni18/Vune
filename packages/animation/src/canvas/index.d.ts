import type { MotionValue } from '../../index.js';
export class CanvasMotionRenderer {
  constructor(context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | object, values: MotionValue[], draw: (context: any, values: Float64Array, time: number, renderer: CanvasMotionRenderer) => void, options?: {
    autoClear?: boolean;
    requestFrame?: (callback: FrameRequestCallback) => any;
    cancelFrame?: (id: any) => void;
    renderInitial?: boolean;
  });
  readonly snapshot: Float64Array;
  readonly frames: number;
  invalidate(): this;
  renderNow(time?: number): this;
  dispose(): void;
}
export function createCanvasRenderer(context: any, values: MotionValue[], draw: ConstructorParameters<typeof CanvasMotionRenderer>[2], options?: ConstructorParameters<typeof CanvasMotionRenderer>[3]): CanvasMotionRenderer;
