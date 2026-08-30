import { defaultEngine } from '../core/default-engine.js';
import { motionValue } from '../core/motion-value.js';
import { smooth } from '../core/specs.js';
import {
  decomposeMatrix2D,
  identityMatrix2D,
  invertMatrix2D,
  multiplyMatrix2D,
  scaleMatrix2D,
  translationMatrix2D,
} from '../interpolate/transform.js';

const activeTransitions = new WeakMap();
const EPSILON = 1e-6;

function asElements(elements) {
  if (!elements) return [];
  if (typeof elements.getBoundingClientRect === 'function') return [elements];
  return Array.from(elements).filter((element) => element && typeof element.getBoundingClientRect === 'function');
}

function copyRect(rect) {
  const left = Number(rect.left ?? rect.x ?? 0);
  const top = Number(rect.top ?? rect.y ?? 0);
  const width = Number(rect.width ?? Math.max(0, Number(rect.right ?? left) - left));
  const height = Number(rect.height ?? Math.max(0, Number(rect.bottom ?? top) - top));
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function defaultMeasureScroll() {
  return {
    x: Number(globalThis.scrollX ?? globalThis.pageXOffset ?? 0),
    y: Number(globalThis.scrollY ?? globalThis.pageYOffset ?? 0),
  };
}

export function captureLayout(elements, { measureScroll = defaultMeasureScroll } = {}) {
  const scroll = measureScroll();
  return asElements(elements).map((element) => ({
    element,
    rect: copyRect(element.getBoundingClientRect()),
    scroll: { x: Number(scroll?.x ?? 0), y: Number(scroll?.y ?? 0) },
  }));
}

export function projectionMatrixForRects(firstRect, lastRect, { includeSize = true } = {}) {
  const first = copyRect(firstRect);
  const last = copyRect(lastRect);
  const sx = includeSize && Math.abs(last.width) > EPSILON ? first.width / last.width : 1;
  const sy = includeSize && Math.abs(last.height) > EPSILON ? first.height / last.height : 1;
  return multiplyMatrix2D(
    translationMatrix2D(first.left, first.top),
    multiplyMatrix2D(scaleMatrix2D(sx, sy), translationMatrix2D(-last.left, -last.top)),
  );
}

function matrixInElementSpace(worldMatrix, lastRect) {
  return multiplyMatrix2D(
    translationMatrix2D(-lastRect.left, -lastRect.top),
    multiplyMatrix2D(worldMatrix, translationMatrix2D(lastRect.left, lastRect.top)),
  );
}

function nearestSelectedAncestor(element, selected) {
  let parent = element.parentElement ?? null;
  while (parent) {
    if (selected.has(parent)) return parent;
    parent = parent.parentElement ?? null;
  }
  return null;
}

function adjustForScroll(first, currentScroll) {
  const dx = Number(currentScroll?.x ?? 0) - first.scroll.x;
  const dy = Number(currentScroll?.y ?? 0) - first.scroll.y;
  return {
    ...first.rect,
    left: first.rect.left - dx,
    right: first.rect.right - dx,
    top: first.rect.top - dy,
    bottom: first.rect.bottom - dy,
  };
}

function clean(value) {
  return Math.abs(value) < 1e-7 ? 0 : Math.round(value * 100000) / 100000;
}

function matrixAtProgress(decomposed, progress, out = new Float64Array(6)) {
  const remaining = 1 - progress;
  const tx = decomposed.x * remaining;
  const ty = decomposed.y * remaining;
  const rotation = decomposed.rotateZ * remaining * Math.PI / 180;
  const skew = decomposed.skewX * remaining * Math.PI / 180;
  const sx = 1 + (decomposed.scaleX - 1) * remaining;
  const sy = 1 + (decomposed.scaleY - 1) * remaining;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const tan = Math.tan(skew);
  out[0] = cos * sx;
  out[1] = sin * sx;
  out[2] = (cos * tan - sin) * sy;
  out[3] = (sin * tan + cos) * sy;
  out[4] = tx;
  out[5] = ty;
  return out;
}

function formatMatrix(matrix) {
  return `matrix(${clean(matrix[0])}, ${clean(matrix[1])}, ${clean(matrix[2])}, ${clean(matrix[3])}, ${clean(matrix[4])}, ${clean(matrix[5])})`;
}

function getStyleValue(element, property, fallback = '') {
  return element.style?.[property] ?? fallback;
}

function setStyleValue(element, property, value) {
  if (!element.style) return;
  element.style[property] = value;
}

export class LayoutTransition {
  constructor(elements, {
    engine = defaultEngine,
    spec = smooth(),
    includeSize = true,
    measureScroll = defaultMeasureScroll,
    preserveTransform = true,
  } = {}) {
    this.engine = engine;
    this.spec = spec;
    this.includeSize = includeSize;
    this.measureScroll = measureScroll;
    this.preserveTransform = preserveTransform;
    this.elements = asElements(elements);
    this.first = captureLayout(this.elements, { measureScroll });
    this.firstByElement = new Map(this.first.map((entry) => [entry.element, entry]));
    this.items = [];
    this.controls = null;
    this.cancelled = false;

    // Capture the currently rendered geometry before cancelling an older projection.
    for (const element of this.elements) {
      const previous = activeTransitions.get(element);
      if (previous && previous !== this) previous.cancel();
    }
  }

  play() {
    if (this.cancelled) return null;
    const currentScroll = this.measureScroll();
    const last = captureLayout(this.elements, { measureScroll: () => currentScroll });
    const lastByElement = new Map(last.map((entry) => [entry.element, entry]));
    const selected = new Set(this.elements);
    const desiredWorld = new Map();
    const localProjection = new Map();

    // READ phase is complete before any style writes happen.
    for (const element of this.elements) {
      const first = this.firstByElement.get(element);
      const lastEntry = lastByElement.get(element);
      if (!first || !lastEntry) continue;
      const adjustedFirst = adjustForScroll(first, currentScroll);
      desiredWorld.set(element, projectionMatrixForRects(adjustedFirst, lastEntry.rect, { includeSize: this.includeSize }));
    }

    for (const element of this.elements) {
      const world = desiredWorld.get(element) ?? [...identityMatrix2D];
      const parent = nearestSelectedAncestor(element, selected);
      const parentWorld = parent ? desiredWorld.get(parent) ?? identityMatrix2D : identityMatrix2D;
      const relativeWorld = multiplyMatrix2D(invertMatrix2D(parentWorld), world);
      const lastRect = lastByElement.get(element)?.rect;
      if (!lastRect) continue;
      localProjection.set(element, matrixInElementSpace(relativeWorld, lastRect));
    }

    this.items = this.elements.map((element) => {
      const matrix = localProjection.get(element) ?? [...identityMatrix2D];
      return {
        element,
        projection: decomposeMatrix2D(matrix),
        originalTransform: getStyleValue(element, 'transform', ''),
        originalTransformOrigin: getStyleValue(element, 'transformOrigin', ''),
        originalWillChange: getStyleValue(element, 'willChange', ''),
        matrixBuffer: new Float64Array(6),
        baseTransformSuffix: '',
      };
    });

    for (const item of this.items) {
      item.baseTransformSuffix = this.preserveTransform && item.originalTransform && item.originalTransform !== 'none'
        ? ` ${item.originalTransform}`
        : '';
      setStyleValue(item.element, 'transformOrigin', '0 0');
      setStyleValue(item.element, 'willChange', item.originalWillChange ? `${item.originalWillChange}, transform` : 'transform');
    }

    const progress = motionValue(0);
    this.progress = progress;
    const unsubscribe = (progress.subscribeValue ?? progress.subscribe).call(progress, (value) => this.#commit(value));
    this.unsubscribe = unsubscribe;

    for (const item of this.items) activeTransitions.set(item.element, this);
    this.controls = this.engine.animate(progress, 1, this.spec);
    this.controls.finished.then(() => this.#cleanup()).catch(() => this.#cleanup());
    return this.controls;
  }

  #commit(progress) {
    // WRITE phase: every measurement has already happened in play().
    for (const item of this.items) {
      const matrix = matrixAtProgress(item.projection, progress, item.matrixBuffer);
      setStyleValue(item.element, 'transform', `${formatMatrix(matrix)}${item.baseTransformSuffix}`);
    }
  }

  #cleanup() {
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = null;
    for (const item of this.items) {
      setStyleValue(item.element, 'transform', item.originalTransform);
      setStyleValue(item.element, 'transformOrigin', item.originalTransformOrigin);
      setStyleValue(item.element, 'willChange', item.originalWillChange);
      if (activeTransitions.get(item.element) === this) activeTransitions.delete(item.element);
    }
  }

  cancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    this.controls?.cancel();
    this.#cleanup();
  }
}

export function createLayoutTransition(elements, options) {
  return new LayoutTransition(elements, options);
}

export function animateLayout(elements, mutate, options) {
  const transition = new LayoutTransition(elements, options);
  if (typeof mutate === 'function') mutate();
  const controls = transition.play();
  return { transition, controls };
}

function defaultSharedKey(element) {
  return element?.dataset?.motionKey
    ?? element?.getAttribute?.('data-motion-key')
    ?? element?.id
    ?? null;
}

function resolveKeyGetter(key) {
  if (typeof key === 'function') return key;
  if (typeof key === 'string') return (element) => element?.getAttribute?.(key) ?? element?.dataset?.[key] ?? element?.[key];
  return defaultSharedKey;
}

export class SharedLayoutSnapshot {
  constructor(entries = []) {
    this.entries = new Map(entries.map((entry) => [entry.key, entry]));
  }
  get(key) { return this.entries.get(key); }
  has(key) { return this.entries.has(key); }
  get size() { return this.entries.size; }
  [Symbol.iterator]() { return this.entries[Symbol.iterator](); }
}

export function captureSharedLayout(elements, {
  key,
  measureScroll = defaultMeasureScroll,
} = {}) {
  const getKey = resolveKeyGetter(key);
  const scroll = measureScroll();
  const entries = [];
  const seen = new Set();
  for (const element of asElements(elements)) {
    const identity = getKey(element);
    if (identity == null || identity === '') continue;
    if (seen.has(identity)) throw new Error(`Duplicate shared-layout key: ${String(identity)}`);
    seen.add(identity);
    entries.push({
      key: identity,
      element,
      rect: copyRect(element.getBoundingClientRect()),
      scroll: { x: Number(scroll?.x ?? 0), y: Number(scroll?.y ?? 0) },
    });
  }
  return new SharedLayoutSnapshot(entries);
}

/**
 * Matched-geometry transition across different element instances. Old geometry
 * is captured before a tree mutation; only the new/matched targets are written
 * during playback, so the source node does not need to stay mounted.
 *
 * All matched targets share one progress MotionValue. A 200-item route change
 * therefore costs one spring/timing animation rather than 200 solver entries.
 */
export class SharedLayoutTransition {
  constructor(snapshot, elements, {
    key,
    engine = defaultEngine,
    spec = smooth(),
    includeSize = true,
    measureScroll = defaultMeasureScroll,
    preserveTransform = true,
    fadeTarget = false,
  } = {}) {
    if (!(snapshot instanceof SharedLayoutSnapshot)) throw new TypeError('SharedLayoutTransition requires a SharedLayoutSnapshot.');
    this.snapshot = snapshot;
    this.elements = asElements(elements);
    this.getKey = resolveKeyGetter(key);
    this.engine = engine;
    this.spec = spec;
    this.includeSize = includeSize;
    this.measureScroll = measureScroll;
    this.preserveTransform = preserveTransform;
    this.fadeTarget = fadeTarget;
    this.items = [];
    this.controls = null;
    this.progress = null;
    this.unsubscribe = null;
    this.cancelled = false;
    this.interruptedVisual = new Map();

    // As with regular FLIP, capture the currently rendered geometry *before*
    // cancelling an older projection. A new shared-layout transition can then
    // continue from the visible in-flight position instead of jumping back to
    // the underlying layout rectangle.
    const interruptionScroll = this.measureScroll();
    for (const element of this.elements) {
      const previous = activeTransitions.get(element);
      if (previous && previous !== this) {
        const identity = this.getKey(element);
        if (identity != null && identity !== '') {
          this.interruptedVisual.set(identity, {
            key: identity,
            element,
            rect: copyRect(element.getBoundingClientRect()),
            scroll: { x: Number(interruptionScroll?.x ?? 0), y: Number(interruptionScroll?.y ?? 0) },
          });
        }
        previous.cancel();
      }
    }
  }

  play() {
    if (this.cancelled) return null;
    const currentScroll = this.measureScroll();
    const selected = new Set();
    const desiredWorld = new Map();
    const lastByElement = new Map();
    const sourceByElement = new Map();

    // READ phase: collect every target rect and desired viewport projection.
    const seenTargetKeys = new Set();
    for (const element of this.elements) {
      const identity = this.getKey(element);
      if (identity != null && identity !== '') {
        if (seenTargetKeys.has(identity)) throw new Error(`Duplicate shared-layout target key: ${String(identity)}`);
        seenTargetKeys.add(identity);
      }
      const source = identity == null ? null : (this.interruptedVisual.get(identity) ?? this.snapshot.get(identity));
      if (!source) continue;
      const lastRect = copyRect(element.getBoundingClientRect());
      const adjustedFirst = adjustForScroll(source, currentScroll);
      selected.add(element);
      sourceByElement.set(element, source);
      lastByElement.set(element, lastRect);
      desiredWorld.set(element, projectionMatrixForRects(adjustedFirst, lastRect, { includeSize: this.includeSize }));
    }

    // Remove projection already supplied by a matched target ancestor.
    const localProjection = new Map();
    for (const element of selected) {
      const parent = nearestSelectedAncestor(element, selected);
      const parentWorld = parent ? desiredWorld.get(parent) ?? identityMatrix2D : identityMatrix2D;
      const relativeWorld = multiplyMatrix2D(invertMatrix2D(parentWorld), desiredWorld.get(element) ?? identityMatrix2D);
      localProjection.set(element, matrixInElementSpace(relativeWorld, lastByElement.get(element)));
    }

    this.items = [];
    for (const element of selected) {
      const originalOpacity = getStyleValue(element, 'opacity', '');
      const numericOpacity = originalOpacity === '' ? 1 : Number(originalOpacity);
      this.items.push({
        element,
        sourceElement: sourceByElement.get(element)?.element ?? null,
        projection: decomposeMatrix2D(localProjection.get(element) ?? identityMatrix2D),
        originalTransform: getStyleValue(element, 'transform', ''),
        originalTransformOrigin: getStyleValue(element, 'transformOrigin', ''),
        originalWillChange: getStyleValue(element, 'willChange', ''),
        originalOpacity,
        targetOpacity: Number.isFinite(numericOpacity) ? numericOpacity : 1,
        matrixBuffer: new Float64Array(6),
        baseTransformSuffix: '',
      });
    }

    if (this.items.length === 0) return null;
    for (const item of this.items) {
      item.baseTransformSuffix = this.preserveTransform && item.originalTransform && item.originalTransform !== 'none'
        ? ` ${item.originalTransform}`
        : '';
      setStyleValue(item.element, 'transformOrigin', '0 0');
      setStyleValue(item.element, 'willChange', item.originalWillChange ? `${item.originalWillChange}, transform` : 'transform');
    }
    const progress = motionValue(0);
    this.progress = progress;
    this.unsubscribe = progress.subscribeValue((value) => this.#commit(value));
    for (const item of this.items) activeTransitions.set(item.element, this);
    this.controls = this.engine.animate(progress, 1, this.spec);
    this.controls.finished.then(() => this.#cleanup()).catch(() => this.#cleanup());
    return this.controls;
  }

  #commit(progress) {
    for (const item of this.items) {
      const matrix = matrixAtProgress(item.projection, progress, item.matrixBuffer);
      setStyleValue(item.element, 'transform', `${formatMatrix(matrix)}${item.baseTransformSuffix}`);
      if (this.fadeTarget && item.sourceElement !== item.element) {
        setStyleValue(item.element, 'opacity', String(item.targetOpacity * progress));
      }
    }
  }

  #cleanup() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const item of this.items) {
      setStyleValue(item.element, 'transform', item.originalTransform);
      setStyleValue(item.element, 'transformOrigin', item.originalTransformOrigin);
      setStyleValue(item.element, 'willChange', item.originalWillChange);
      if (this.fadeTarget && item.sourceElement !== item.element) setStyleValue(item.element, 'opacity', item.originalOpacity);
      if (activeTransitions.get(item.element) === this) activeTransitions.delete(item.element);
    }
  }

  cancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    this.controls?.cancel();
    this.#cleanup();
  }
}

export function createSharedLayoutTransition(snapshot, elements, options) {
  return new SharedLayoutTransition(snapshot, elements, options);
}

export function animateSharedLayout(snapshot, elements, options) {
  const transition = new SharedLayoutTransition(snapshot, elements, options);
  const controls = transition.play();
  return { transition, controls };
}

export class SharedLayoutRegistry {
  constructor(options = {}) {
    this.options = { ...options };
    this.snapshot = new SharedLayoutSnapshot();
    this.active = null;
  }

  capture(elements, options = {}) {
    this.snapshot = captureSharedLayout(elements, { ...this.options, ...options });
    return this.snapshot;
  }

  play(elements, options = {}) {
    this.active?.cancel();
    const transition = new SharedLayoutTransition(this.snapshot, elements, { ...this.options, ...options });
    this.active = transition;
    const controls = transition.play();
    controls?.finished.finally(() => { if (this.active === transition) this.active = null; });
    return { transition, controls };
  }

  cancel() {
    this.active?.cancel();
    this.active = null;
  }
}
