import { animateInterpolated } from '../interpolate/index.js';
import { materialToCss } from '../material/index.js';

const queues = new WeakMap();
const styleAnimationOwners = new WeakMap();
const dirtyElements = new Set();
let globalCommitScheduled = false;
let commitScheduler = 'microtask';
let rafId = null;
let scheduleGeneration = 0;

function queueFor(element) {
  let state = queues.get(element);
  if (!state) {
    state = {
      element,
      x: 0, y: 0, z: 0,
      scaleX: 1, scaleY: 1, scaleZ: 1,
      rotateX: 0, rotateY: 0, rotateZ: 0,
      opacity: null,
      transformDirty: false,
      opacityDirty: false,
      originalWillChange: element.style?.willChange ?? '',
      transformBindings: 0,
      opacityBindings: 0,
      direct: new Map(),
      attributes: new Map(),
      scheduled: false,
    };
    queues.set(element, state);
  }
  return state;
}

function formatTransform(state) {
  return `translate3d(${state.x}px, ${state.y}px, ${state.z}px) rotateX(${state.rotateX}deg) rotateY(${state.rotateY}deg) rotate(${state.rotateZ}deg) scale3d(${state.scaleX}, ${state.scaleY}, ${state.scaleZ})`;
}

function updateWillChange(state) {
  const active = [];
  if (state.transformBindings > 0) active.push('transform');
  if (state.opacityBindings > 0) active.push('opacity');
  state.element.style.willChange = active.length > 0 ? active.join(', ') : state.originalWillChange;
}

function commitState(state) {
  const element = state.element;
  state.scheduled = false;
  // Only touch compositor-affecting properties that changed. This matters on
  // power-constrained devices: direct style/attribute bindings should not
  // force a transform serialization or an extra style recalculation.
  if (state.transformDirty) {
    element.style.transform = formatTransform(state);
    state.transformDirty = false;
  }
  if (state.opacityDirty) {
    if (state.opacity != null) element.style.opacity = String(state.opacity);
    state.opacityDirty = false;
  }
  for (const [property, value] of state.direct) element.style[property] = value;
  for (const [name, value] of state.attributes) element.setAttribute?.(name, value);
  state.direct.clear();
  state.attributes.clear();
}

export function flushDomCommits() {
  scheduleGeneration += 1;
  globalCommitScheduled = false;
  rafId = null;
  if (dirtyElements.size === 0) return 0;
  const batch = Array.from(dirtyElements);
  dirtyElements.clear();
  for (const state of batch) commitState(state);
  return batch.length;
}

function scheduleGlobalCommit() {
  if (globalCommitScheduled) return;
  globalCommitScheduled = true;
  const generation = ++scheduleGeneration;
  const run = () => {
    if (generation !== scheduleGeneration) return;
    flushDomCommits();
  };
  if (commitScheduler === 'raf' && typeof globalThis.requestAnimationFrame === 'function') {
    rafId = globalThis.requestAnimationFrame(run);
  } else {
    queueMicrotask(run);
  }
}

function scheduleCommit(_element, state) {
  if (!state.scheduled) {
    state.scheduled = true;
    dirtyElements.add(state);
  }
  scheduleGlobalCommit();
}

export function configureDomBatching({ scheduler = 'microtask' } = {}) {
  if (scheduler !== 'microtask' && scheduler !== 'raf') throw new TypeError("DOM scheduler must be 'microtask' or 'raf'.");
  if (commitScheduler === scheduler) return;
  if (rafId != null && typeof globalThis.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(rafId);
  rafId = null;
  scheduleGeneration += 1;
  globalCommitScheduled = false;
  commitScheduler = scheduler;
  if (dirtyElements.size > 0) scheduleGlobalCommit();
}

function applyBinding(state, property, value) {
  switch (property) {
    case 'scale': state.scaleX = value; state.scaleY = value; state.scaleZ = value; state.transformDirty = true; break;
    case 'rotate': state.rotateZ = value; state.transformDirty = true; break;
    case 'x': case 'y': case 'z':
    case 'scaleX': case 'scaleY': case 'scaleZ':
    case 'rotateX': case 'rotateY': case 'rotateZ':
      state[property] = value;
      state.transformDirty = true;
      break;
    case 'opacity':
      state.opacity = value;
      state.opacityDirty = true;
      break;
    default: state.direct.set(property, String(value)); break;
  }
}

export function bindMotionStyles(element, bindings) {
  const state = queueFor(element);
  const unsubscribers = [];
  const willChange = new Set();
  for (const [property, motion] of Object.entries(bindings)) {
    if (!motion?.subscribe) continue;
    if (property === 'opacity') willChange.add('opacity');
    else if (property === 'scale' || property === 'rotate' || property === 'x' || property === 'y' || property === 'z'
      || property === 'scaleX' || property === 'scaleY' || property === 'scaleZ'
      || property === 'rotateX' || property === 'rotateY' || property === 'rotateZ') {
      willChange.add('transform');
    }
    unsubscribers.push((motion.subscribeValue ?? motion.subscribe).call(motion, (value) => {
      applyBinding(state, property, value);
      scheduleCommit(element, state);
    }));
  }
  if (willChange.has('transform')) state.transformBindings += 1;
  if (willChange.has('opacity')) state.opacityBindings += 1;
  if (willChange.size > 0) updateWillChange(state);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    if (willChange.has('transform')) state.transformBindings = Math.max(0, state.transformBindings - 1);
    if (willChange.has('opacity')) state.opacityBindings = Math.max(0, state.opacityBindings - 1);
    if (willChange.size > 0) updateWillChange(state);
  };
}

export function bindStyleValue(element, property, motion, { unit = '' } = {}) {
  if (!motion?.subscribe) throw new TypeError('bindStyleValue() requires a MotionValue-like object.');
  const state = queueFor(element);
  const unsubscribe = (motion.subscribeValue ?? motion.subscribe).call(motion, (value) => {
    state.direct.set(property, `${value}${unit}`);
    scheduleCommit(element, state);
  });
  return unsubscribe;
}

export function animateStyle(element, property, from, to, spec, options = {}) {
  const state = queueFor(element);
  const inferredType = options.type ?? (property === 'transform' ? 'transform' : undefined);
  return animateInterpolated(from, to, spec, (value) => {
    state.direct.set(property, String(value));
    scheduleCommit(element, state);
  }, { ...options, type: inferredType });
}

function styleOwnerMap(element) {
  let owners = styleAnimationOwners.get(element);
  if (!owners) {
    owners = new Map();
    styleAnimationOwners.set(element, owners);
  }
  return owners;
}

export function cancelStyleAnimations(element, properties) {
  const owners = styleAnimationOwners.get(element);
  if (!owners) return 0;
  const requested = properties == null
    ? Array.from(owners.keys())
    : Array.isArray(properties) ? properties : [properties];
  const controls = new Set();
  for (const property of requested) {
    const control = owners.get(property);
    if (control) controls.add(control);
  }
  for (const control of controls) control.cancel?.();
  return controls.size;
}

/**
 * Give a control ownership of one or more CSS properties on an element.
 * Replacing opacity does not disturb transform, size, or any other property;
 * replacing a multi-property control cancels it once even if several keys point
 * at the same control. Ownership is released only if the finishing control is
 * still the current owner, so an old completion cannot erase a newer animation.
 */
export function ownStyleAnimation(element, properties, control) {
  if (!control || typeof control.cancel !== 'function' || !control.finished) {
    throw new TypeError('ownStyleAnimation() requires an animation control with cancel() and finished.');
  }
  const list = [...new Set((Array.isArray(properties) ? properties : [properties]).filter(Boolean))];
  if (list.length === 0) return control;
  cancelStyleAnimations(element, list);
  const owners = styleOwnerMap(element);
  for (const property of list) owners.set(property, control);
  const release = () => {
    const current = styleAnimationOwners.get(element);
    if (!current) return;
    for (const property of list) {
      if (current.get(property) === control) current.delete(property);
    }
    if (current.size === 0) styleAnimationOwners.delete(element);
  };
  void Promise.resolve(control.finished).then(release, release);
  return control;
}

export function animateStyleOwned(element, property, from, to, spec, options = {}) {
  return ownStyleAnimation(element, property, animateStyle(element, property, from, to, spec, options));
}


export function applyMaterial(element, material, { background = true } = {}) {
  const state = queueFor(element);
  const css = materialToCss(material);
  state.direct.set('backdropFilter', css.backdropFilter);
  state.direct.set('webkitBackdropFilter', css.backdropFilter);
  if (background) state.direct.set('backgroundColor', css.backgroundColor);
  scheduleCommit(element, state);
}

export function animateMaterial(element, from, to, spec, {
  background = true,
  colorSpace = 'oklab',
  ...options
} = {}) {
  return animateInterpolated(from, to, spec, (material) => {
    applyMaterial(element, material, { background });
  }, { ...options, type: 'material', material: { colorSpace } });
}

export function animateAttribute(element, name, from, to, spec, options = {}) {
  if (typeof element?.setAttribute !== 'function') throw new TypeError('animateAttribute() requires an Element-like object.');
  const state = queueFor(element);
  return animateInterpolated(from, to, spec, (value) => {
    state.attributes.set(name, String(value));
    scheduleCommit(element, state);
  }, options);
}

export function animatePath(element, from, to, spec, options = {}) {
  return animateAttribute(element, 'd', from, to, spec, { ...options, type: 'path' });
}

export function animateNative(element, keyframes, { duration = 0.3, easing = 'cubic-bezier(.22, 1, .36, 1)', fill = 'both' } = {}) {
  if (typeof element.animate !== 'function') throw new Error('Web Animations API is not available.');
  return element.animate(keyframes, { duration: duration * 1000, easing, fill });
}

export function bindPointerDrag(element, controller, {
  button = 0,
  pointerCapture = true,
  preventDefault = true,
  touchAction = 'none',
  coalesced = true,
  filter,
} = {}) {
  if (!element?.addEventListener || !controller?.start || !controller?.move || !controller?.end) {
    throw new TypeError('bindPointerDrag() requires an Element-like target and DragController-like object.');
  }

  let activePointer = null;
  const style = element.style;
  const previousTouchAction = style?.touchAction;
  if (style && touchAction != null) style.touchAction = touchAction;

  const stopEvent = (event) => {
    if (preventDefault && event.cancelable) event.preventDefault();
  };

  const onPointerDown = (event) => {
    if (activePointer != null) return;
    if (event.button != null && event.button !== button) return;
    if (filter && !filter(event)) return;
    activePointer = event.pointerId ?? 1;
    stopEvent(event);
    controller.start({ x: event.clientX, y: event.clientY }, event.timeStamp);
    if (pointerCapture && typeof element.setPointerCapture === 'function' && event.pointerId != null) {
      try { element.setPointerCapture(event.pointerId); } catch { /* detached/unsupported target */ }
    }
  };

  const onPointerMove = (event) => {
    if (activePointer == null || (event.pointerId ?? 1) !== activePointer) return;
    stopEvent(event);
    const samples = coalesced && typeof event.getCoalescedEvents === 'function'
      ? event.getCoalescedEvents()
      : null;
    if (samples?.length) {
      for (const sample of samples) {
        controller.move({ x: sample.clientX, y: sample.clientY }, sample.timeStamp);
      }
    } else {
      controller.move({ x: event.clientX, y: event.clientY }, event.timeStamp);
    }
  };

  const release = (event, cancelled = false) => {
    if (activePointer == null || (event.pointerId ?? 1) !== activePointer) return;
    stopEvent(event);
    const pointerId = activePointer;
    activePointer = null;
    if (cancelled) controller.cancel({ settle: true });
    else {
      controller.move({ x: event.clientX, y: event.clientY }, event.timeStamp);
      controller.end(event.timeStamp);
    }
    if (pointerCapture && typeof element.releasePointerCapture === 'function' && event.pointerId != null) {
      try {
        if (typeof element.hasPointerCapture !== 'function' || element.hasPointerCapture(pointerId)) {
          element.releasePointerCapture(pointerId);
        }
      } catch { /* already released */ }
    }
  };

  const onPointerUp = (event) => release(event, false);
  const onPointerCancel = (event) => release(event, true);
  const onLostPointerCapture = (event) => {
    if (activePointer == null || (event.pointerId ?? 1) !== activePointer) return;
    activePointer = null;
    controller.cancel({ settle: true });
  };

  element.addEventListener('pointerdown', onPointerDown, { passive: false });
  element.addEventListener('pointermove', onPointerMove, { passive: false });
  element.addEventListener('pointerup', onPointerUp, { passive: false });
  element.addEventListener('pointercancel', onPointerCancel, { passive: false });
  element.addEventListener('lostpointercapture', onLostPointerCapture);

  return () => {
    element.removeEventListener('pointerdown', onPointerDown);
    element.removeEventListener('pointermove', onPointerMove);
    element.removeEventListener('pointerup', onPointerUp);
    element.removeEventListener('pointercancel', onPointerCancel);
    element.removeEventListener('lostpointercapture', onLostPointerCapture);
    if (activePointer != null) controller.cancel({ settle: false });
    activePointer = null;
    if (style && touchAction != null) style.touchAction = previousTouchAction ?? '';
  };
}
