import type { AnimationControls, MotionEngine, MotionSpec } from '../../index.js';
export type LayoutRect = { left: number; top: number; width: number; height: number; right?: number; bottom?: number };
export type LayoutOptions = {
  engine?: MotionEngine;
  spec?: MotionSpec;
  includeSize?: boolean;
  preserveTransform?: boolean;
  measureScroll?: () => { x: number; y: number };
};
export function captureLayout(elements: Element | Iterable<Element>, options?: Pick<LayoutOptions, 'measureScroll'>): Array<{ element: Element; rect: Required<LayoutRect>; scroll: { x: number; y: number } }>;
export function projectionMatrixForRects(first: LayoutRect, last: LayoutRect, options?: { includeSize?: boolean }): number[];
export class LayoutTransition {
  constructor(elements: Element | Iterable<Element>, options?: LayoutOptions);
  readonly first: Array<{ element: Element; rect: Required<LayoutRect>; scroll: { x: number; y: number } }>;
  play(): AnimationControls | null;
  cancel(): void;
}
export function createLayoutTransition(elements: Element | Iterable<Element>, options?: LayoutOptions): LayoutTransition;
export function animateLayout(elements: Element | Iterable<Element>, mutate: (() => void) | undefined, options?: LayoutOptions): { transition: LayoutTransition; controls: AnimationControls | null };

export type SharedLayoutKey = string | number;
export type SharedLayoutOptions = LayoutOptions & {
  key?: string | ((element: Element) => SharedLayoutKey | null | undefined);
  fadeTarget?: boolean;
};
export type SharedLayoutEntry = {
  key: SharedLayoutKey;
  element: Element;
  rect: Required<LayoutRect>;
  scroll: { x: number; y: number };
};
export class SharedLayoutSnapshot implements Iterable<[SharedLayoutKey, SharedLayoutEntry]> {
  constructor(entries?: SharedLayoutEntry[]);
  readonly size: number;
  get(key: SharedLayoutKey): SharedLayoutEntry | undefined;
  has(key: SharedLayoutKey): boolean;
  [Symbol.iterator](): MapIterator<[SharedLayoutKey, SharedLayoutEntry]>;
}
export function captureSharedLayout(elements: Element | Iterable<Element>, options?: Pick<SharedLayoutOptions, 'key' | 'measureScroll'>): SharedLayoutSnapshot;
export class SharedLayoutTransition {
  constructor(snapshot: SharedLayoutSnapshot, elements: Element | Iterable<Element>, options?: SharedLayoutOptions);
  readonly snapshot: SharedLayoutSnapshot;
  readonly progress: import('../../index.js').MotionValue | null;
  play(): AnimationControls | null;
  cancel(): void;
}
export function createSharedLayoutTransition(snapshot: SharedLayoutSnapshot, elements: Element | Iterable<Element>, options?: SharedLayoutOptions): SharedLayoutTransition;
export function animateSharedLayout(snapshot: SharedLayoutSnapshot, elements: Element | Iterable<Element>, options?: SharedLayoutOptions): { transition: SharedLayoutTransition; controls: AnimationControls | null };
export class SharedLayoutRegistry {
  constructor(options?: SharedLayoutOptions);
  snapshot: SharedLayoutSnapshot;
  active: SharedLayoutTransition | null;
  capture(elements: Element | Iterable<Element>, options?: SharedLayoutOptions): SharedLayoutSnapshot;
  play(elements: Element | Iterable<Element>, options?: SharedLayoutOptions): { transition: SharedLayoutTransition; controls: AnimationControls | null };
  cancel(): void;
}
