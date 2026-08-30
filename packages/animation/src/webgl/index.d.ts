import type { MotionValue } from '../../index.js';
export type WebGLUniformType = '1f' | '2fv' | '3fv' | '4fv' | 'matrix4fv';
export type WebGLUniformBinding = {
  name?: string;
  location?: WebGLUniformLocation | unknown;
  value?: MotionValue;
  values?: MotionValue[];
  type?: WebGLUniformType;
};
export class WebGLUniformBinder {
  constructor(gl: WebGLRenderingContext | WebGL2RenderingContext | any, program: WebGLProgram | unknown, bindings?: WebGLUniformBinding[], options?: {
    autoUseProgram?: boolean;
    requestFrame?: (callback: FrameRequestCallback) => any;
    cancelFrame?: (id: any) => void;
    flushInitial?: boolean;
  });
  add(binding: WebGLUniformBinding): this;
  flush(): number;
  flushNow(): this;
  dispose(): void;
}
export function createWebGLUniformBinder(gl: any, program: unknown, bindings?: WebGLUniformBinding[], options?: ConstructorParameters<typeof WebGLUniformBinder>[3]): WebGLUniformBinder;
