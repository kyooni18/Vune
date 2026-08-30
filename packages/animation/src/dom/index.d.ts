import type {
  AnimationControls,
  MotionSpec,
  MotionValue,
  MotionEngine,
  InterpolatorOptions,
  MaterialInput,
  ColorSpace,
  PathMorphOptions,
} from '../../index.js';
export function configureDomBatching(options?: { scheduler?: 'microtask' | 'raf' }): void;
export function flushDomCommits(): number;
export function bindMotionStyles(element: HTMLElement, bindings: Record<string, MotionValue>): () => void;
export function bindStyleValue(element: HTMLElement, property: string, motion: MotionValue, options?: { unit?: string }): () => void;
export function animateStyle(element: HTMLElement, property: string, from: unknown, to: unknown, spec?: MotionSpec, options?: InterpolatorOptions & { engine?: MotionEngine }): AnimationControls;
export function cancelStyleAnimations(element: Element, properties?: string | string[]): number;
export function ownStyleAnimation<T extends { cancel(): void; readonly finished: Promise<unknown> }>(element: Element, properties: string | string[], control: T): T;
export function animateStyleOwned(element: HTMLElement, property: string, from: unknown, to: unknown, spec?: MotionSpec, options?: InterpolatorOptions & { engine?: MotionEngine }): AnimationControls;
export function applyMaterial(element: HTMLElement, material: MaterialInput, options?: { background?: boolean }): void;
export function animateMaterial(element: HTMLElement, from: MaterialInput, to: MaterialInput, spec?: MotionSpec, options?: { background?: boolean; colorSpace?: ColorSpace; engine?: MotionEngine }): AnimationControls;
export function animateAttribute(element: Element, name: string, from: unknown, to: unknown, spec?: MotionSpec, options?: InterpolatorOptions & { engine?: MotionEngine }): AnimationControls;
export function animatePath(element: Element, from: string, to: string, spec?: MotionSpec, options?: PathMorphOptions & { engine?: MotionEngine }): AnimationControls;
export function animateNative(element: Element, keyframes: Keyframe[] | PropertyIndexedKeyframes, options?: { duration?: number; easing?: string; fill?: FillMode }): Animation;

export function bindPointerDrag(
  element: HTMLElement,
  controller: {
    start(point: { x: number; y: number }, time?: number): unknown;
    move(point: { x: number; y: number }, time?: number): unknown;
    end(time?: number): unknown;
    cancel(options?: { settle?: boolean }): unknown;
  },
  options?: {
    button?: number;
    pointerCapture?: boolean;
    preventDefault?: boolean;
    touchAction?: string | null;
    coalesced?: boolean;
    filter?: (event: PointerEvent) => boolean;
  },
): () => void;
