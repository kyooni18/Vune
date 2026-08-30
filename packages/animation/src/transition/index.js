import { defaultEngine } from '../core/default-engine.js';
import { motionValue } from '../core/motion-value.js';
import { smooth } from '../core/specs.js';
import { createInterpolator } from '../interpolate/index.js';

function isMotionValue(value) {
  return value && typeof value.get === 'function' && typeof value.set === 'function' && typeof value.subscribe === 'function';
}

function writerFor(target) {
  if (isMotionValue(target)) return (value, velocity = 0) => target.set(Number(value), velocity);
  if (typeof target === 'function') return target;
  if (target && typeof target.set === 'function') return (value) => target.set(value);
  throw new TypeError('Transition binding target must be a MotionValue, callback, or settable object.');
}

function normalizeBinding(binding) {
  if (isMotionValue(binding) || typeof binding === 'function' || (binding && typeof binding.set === 'function' && !('target' in binding))) {
    return { target: binding };
  }
  if (!binding || typeof binding !== 'object' || !('target' in binding)) {
    throw new TypeError('Transition binding requires a target.');
  }
  const { target, ...options } = binding;
  return { target, ...options };
}

function routeKey(from, to) { return `${String(from)}->${String(to)}`; }

function resolveRoute(routes, from, to, fallback) {
  if (!routes) return fallback;
  if (typeof routes === 'function') return routes(from, to) ?? fallback;
  return routes[routeKey(from, to)]
    ?? routes[routeKey('*', to)]
    ?? routes[routeKey(from, '*')]
    ?? routes['*->*']
    ?? fallback;
}

function deferred() {
  let resolve;
  let settled = false;
  const promise = new Promise((resolver) => { resolve = resolver; });
  return {
    promise,
    settle(value) {
      if (settled) return;
      settled = true;
      resolve(value);
    },
    get settled() { return settled; },
  };
}

function groupControls(controls, { onFinish } = {}) {
  const d = deferred();
  const live = controls.filter(Boolean);
  if (live.length === 0) {
    const result = { status: 'finished' };
    onFinish?.(result);
    d.settle(result);
  } else {
    Promise.all(live.map((control) => control.finished)).then((results) => {
      const status = results.some((result) => result?.status === 'cancelled')
        ? 'cancelled'
        : results.some((result) => result?.status === 'interrupted')
          ? 'interrupted'
          : 'finished';
      const result = { status, results };
      onFinish?.(result);
      d.settle(result);
    });
  }
  return {
    cancel() { for (const control of live) control.cancel?.(); },
    finish() { for (const control of live) control.finish?.(); },
    finished: d.promise,
  };
}

function stateValue(states, state, key) {
  const values = states[state];
  if (!values || typeof values !== 'object') throw new RangeError(`Unknown transition state: ${String(state)}`);
  if (!(key in values)) throw new TypeError(`Transition state ${String(state)} is missing binding ${key}.`);
  return values[key];
}

/**
 * Named-state motion graph. Numeric MotionValues are animated directly so each
 * property preserves its own physical velocity. Structured values share one
 * scalar progress channel per transition and precompile their interpolators.
 */
export class StateTransitionGraph {
  constructor(bindings, states, {
    initial,
    engine = defaultEngine,
    spec = smooth(),
    routes,
    onStateChange,
  } = {}) {
    if (!bindings || typeof bindings !== 'object') throw new TypeError('StateTransitionGraph requires bindings.');
    if (!states || typeof states !== 'object' || Object.keys(states).length === 0) throw new TypeError('StateTransitionGraph requires states.');
    this.engine = engine;
    this.defaultSpec = spec;
    this.routes = routes;
    this.onStateChange = typeof onStateChange === 'function' ? onStateChange : null;
    this.bindings = new Map(Object.entries(bindings).map(([key, binding]) => [key, normalizeBinding(binding)]));
    this.states = states;
    this.state = initial ?? Object.keys(states)[0];
    this.targetState = this.state;
    this.generation = 0;
    this.active = null;
    this.currentStructured = new Map();
    this.#applyImmediate(this.state);
  }

  #applyImmediate(state) {
    for (const [key, binding] of this.bindings) {
      const value = stateValue(this.states, state, key);
      if (isMotionValue(binding.target) && typeof value === 'number' && binding.type == null && typeof binding.interpolate !== 'function') {
        this.engine.stop(binding.target, 'interrupted');
        binding.target.set(value, 0);
      } else {
        writerFor(binding.target)(value, 0);
        this.currentStructured.set(key, value);
      }
    }
  }

  set(state) {
    if (!(state in this.states)) throw new RangeError(`Unknown transition state: ${String(state)}`);
    this.generation += 1;
    this.active?.cancel?.();
    this.active = null;
    this.#applyImmediate(state);
    const previous = this.state;
    this.state = state;
    this.targetState = state;
    this.onStateChange?.(state, previous, { immediate: true, graph: this });
    return this;
  }

  to(state, specOverride) {
    if (!(state in this.states)) throw new RangeError(`Unknown transition state: ${String(state)}`);
    const fromState = this.targetState ?? this.state;
    const spec = specOverride ?? resolveRoute(this.routes, fromState, state, this.defaultSpec);
    const generation = ++this.generation;
    this.targetState = state;

    // Structured progress is private to each transition. Cancelling it is safe;
    // numeric MotionValues are deliberately *not* cancelled here because the
    // next engine.animate() call interrupts/retargets them while retaining velocity.
    this.active?._cancelStructured?.();

    const controls = [];
    const structured = [];
    for (const [key, binding] of this.bindings) {
      const targetValue = stateValue(this.states, state, key);
      if (isMotionValue(binding.target) && typeof targetValue === 'number' && binding.type == null && typeof binding.interpolate !== 'function') {
        controls.push(this.engine.animate(binding.target, targetValue, binding.spec ?? spec));
        continue;
      }
      const current = this.currentStructured.has(key)
        ? this.currentStructured.get(key)
        : stateValue(this.states, this.state, key);
      const fastNumber = typeof current === 'number'
        && typeof targetValue === 'number'
        && binding.type == null
        && typeof binding.interpolate !== 'function';
      structured.push({
        key,
        binding,
        writer: writerFor(binding.target),
        mixer: fastNumber ? null : createInterpolator(current, targetValue, binding),
        from: fastNumber ? current : 0,
        delta: fastNumber ? targetValue - current : 0,
        current,
        targetValue,
      });
    }

    let structuredControls = null;
    let unsubscribe = null;
    if (structured.length > 0) {
      const progress = motionValue(0);
      unsubscribe = progress.subscribeValue((value) => {
        for (const item of structured) {
          const mixed = item.mixer ? item.mixer(value) : item.from + item.delta * value;
          item.writer(mixed);
          item.current = mixed;
        }
      });
      structuredControls = this.engine.animate(progress, 1, spec);
      controls.push(structuredControls);
    }

    const group = groupControls(controls, {
      onFinish: (result) => {
        unsubscribe?.();
        for (const item of structured) {
          this.currentStructured.set(item.key, result.status === 'finished' ? item.targetValue : item.current);
        }
        if (generation !== this.generation) return;
        if (result.status === 'finished') {
          const previous = this.state;
          this.state = state;
          this.targetState = state;
          this.onStateChange?.(state, previous, { immediate: false, graph: this });
        }
        if (this.active === group) this.active = null;
      },
    });
    group._cancelStructured = () => {
      for (const item of structured) this.currentStructured.set(item.key, item.current);
      if (structuredControls) structuredControls.cancel();
      unsubscribe?.();
      unsubscribe = null;
    };
    this.active = group;
    return group;
  }

  cancel() {
    this.generation += 1;
    this.active?._cancelStructured?.();
    this.active?.cancel?.();
    this.active = null;
    this.targetState = this.state;
  }

  finish() { this.active?.finish?.(); }
}

export function createStateTransitionGraph(bindings, states, options) {
  return new StateTransitionGraph(bindings, states, options);
}

/**
 * Two-state enter/exit convenience wrapper. It is intentionally implemented on
 * top of the same named-state graph so rapid enter -> exit reversals retarget
 * numeric MotionValues instead of restarting them from rest.
 */
export class TransitionController {
  constructor(bindings, {
    present = false,
    engine = defaultEngine,
    enter = smooth(),
    exit = enter,
    onEnter,
    onExit,
    onEntered,
    onExited,
  } = {}) {
    if (!Array.isArray(bindings)) throw new TypeError('TransitionController bindings must be an array.');
    const graphBindings = {};
    const exited = {};
    const entered = {};
    bindings.forEach((raw, index) => {
      if (!raw || typeof raw !== 'object' || !('target' in raw) || !('from' in raw) || !('to' in raw)) {
        throw new TypeError('Each transition binding requires target, from, and to.');
      }
      const key = raw.key ?? `binding${index}`;
      const { from, to, key: _key, ...binding } = raw;
      graphBindings[key] = binding;
      exited[key] = from;
      entered[key] = to;
    });
    this.onEnter = typeof onEnter === 'function' ? onEnter : null;
    this.onExit = typeof onExit === 'function' ? onExit : null;
    this.onEntered = typeof onEntered === 'function' ? onEntered : null;
    this.onExited = typeof onExited === 'function' ? onExited : null;
    this.graph = new StateTransitionGraph(graphBindings, { exited, entered }, {
      initial: present ? 'entered' : 'exited',
      engine,
      spec: enter,
      routes: {
        '*->entered': enter,
        '*->exited': exit,
      },
      onStateChange: (state, previous, info) => {
        if (!info.immediate && state === 'entered') this.onEntered?.(this);
        if (!info.immediate && state === 'exited') this.onExited?.(this);
      },
    });
    this.present = Boolean(present);
  }

  get state() {
    const target = this.graph.targetState;
    if (this.graph.active) return target === 'entered' ? 'entering' : 'exiting';
    return this.graph.state;
  }

  enter(spec) {
    this.present = true;
    this.onEnter?.(this);
    return this.graph.to('entered', spec);
  }

  exit(spec) {
    this.present = false;
    this.onExit?.(this);
    return this.graph.to('exited', spec);
  }

  setPresent(present, spec) { return present ? this.enter(spec) : this.exit(spec); }
  cancel() { this.graph.cancel(); }
  finish() { this.graph.finish(); }
  dispose() { this.cancel(); }
}

export function createTransition(bindings, options) {
  return new TransitionController(bindings, options);
}

/**
 * Lifecycle wrapper that keeps content logically rendered until its exit motion
 * finishes. Framework adapters can observe `rendered` and unmount only after
 * the promise resolves, while an enter during exit cancels that pending unmount.
 */
export class PresenceController {
  constructor(transition, {
    present = transition?.present ?? false,
    onRenderChange,
  } = {}) {
    if (!(transition instanceof TransitionController)) throw new TypeError('PresenceController requires a TransitionController.');
    this.transition = transition;
    this.present = Boolean(present);
    this.rendered = Boolean(present);
    this.onRenderChange = typeof onRenderChange === 'function' ? onRenderChange : null;
    this.generation = 0;
    if (this.present !== transition.present) {
      transition.graph.set(this.present ? 'entered' : 'exited');
      transition.present = this.present;
    }
  }

  #setRendered(value) {
    if (this.rendered === value) return;
    this.rendered = value;
    this.onRenderChange?.(value, this);
  }

  setPresent(present, spec) {
    const next = Boolean(present);
    const generation = ++this.generation;
    this.present = next;
    if (next) {
      this.#setRendered(true);
      return this.transition.enter(spec);
    }
    const controls = this.transition.exit(spec);
    controls.finished.then((result) => {
      if (generation !== this.generation || this.present) return;
      if (result.status === 'finished') this.#setRendered(false);
    });
    return controls;
  }

  enter(spec) { return this.setPresent(true, spec); }
  exit(spec) { return this.setPresent(false, spec); }
  cancel() { this.generation += 1; this.transition.cancel(); }
  finish() { this.transition.finish(); }
  dispose() { this.cancel(); }
}

export function createPresence(transition, options) {
  return new PresenceController(transition, options);
}
