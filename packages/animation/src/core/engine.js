import { evaluateCompiledEasing } from './easing.js';
import { AnimationControls, deferredControls } from './controls.js';
import { FrameBudgetGovernor } from './frame-budget.js';
import { JsSpringBatch } from './js-spring-batch.js';
import { resolveMotionPlan } from './planner.js';
import { inertia as inertiaSpec, projectDecayTarget, nearestBound, clampToBounds, stepDecay, stepDampedSpring } from './kinetics.js';

const DEFAULT_EPSILON = 0.001;
const DEFAULT_VELOCITY_EPSILON = 0.01;

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function defaultRaf(callback) {
  if (typeof globalThis.requestAnimationFrame === 'function') return globalThis.requestAnimationFrame(callback);
  return setTimeout(() => callback(nowMs()), 16);
}

function defaultCancelRaf(id) {
  if (typeof globalThis.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(id);
  else clearTimeout(id);
}

export class MotionEngine {
  constructor({
    autoStart = true,
    wasm = 'auto',
    wasmThreshold = 256,
    maxWasmMotions = 65536,
    worker = 'auto',
    workerThreshold = 4096,
    gpu = 'auto',
    gpuThreshold = 4096,
    gpuDevice = null,
    autoWorkerScheduler = true,
    adaptiveBackends = true,
    frameBudgetMs = 8,
    respectReducedMotion = true,
  } = {}) {
    this.autoStart = autoStart;
    this.wasmMode = wasm;
    this.wasmThreshold = Math.max(1, Math.floor(wasmThreshold));
    this.maxWasmMotions = Math.max(1, Math.floor(maxWasmMotions));
    this.workerMode = worker;
    this.workerThreshold = Math.max(1, Math.floor(workerThreshold));
    this.gpuMode = gpu;
    this.gpuThreshold = Math.max(1, Math.floor(gpuThreshold));
    this.gpuDevice = gpuDevice;
    this.autoWorkerScheduler = autoWorkerScheduler;
    this.adaptiveBackends = adaptiveBackends;
    this.respectReducedMotion = respectReducedMotion;
    this.frameBudget = frameBudgetMs === false ? null : new FrameBudgetGovernor({ budgetMs: frameBudgetMs });

    this.batch = new JsSpringBatch(256);
    this.springs = [];
    this.activeSpringCount = 0;
    this.timings = [];
    this.kinetics = [];
    this.kineticScratch = { position: 0, velocity: 0 };
    this.byValue = new Map();
    this.drivers = new Set();

    this.running = false;
    this.frameId = null;
    this.lastTime = null;
    this.disposed = false;

    this.wasmBatch = null;
    this.wasmPromise = null;
    this.workerBackend = null;
    this.workerPromise = null;
    this.workerUnavailable = false;
    this.gpuBackend = null;
    this.gpuPromise = null;
    this.gpuUnavailable = false;

    // While an asynchronous backend is stepping spring memory, mutable
    // commands that touch an in-flight slot are buffered until that frame
    // completes. Adds beyond the submitted count can be initialized now.
    this.workerFrameInFlight = false;
    this.gpuFrameInFlight = false;
    this.inFlightSpringCount = 0;
    this.pendingSpringSync = new Set();
    this.deferredSpringRemovals = new Set();
    this.asyncStepChain = Promise.resolve();

    this.stats = {
      frames: 0,
      syncFrames: 0,
      asyncFrames: 0,
      workerFrames: 0,
      workerFailures: 0,
      gpuFrames: 0,
      gpuFailures: 0,
      promotedToWasm: false,
      promotedToWorker: false,
      promotedToGpu: false,
      backend: 'js',
      lastDtMs: 0,
      lastStepWallMs: 0,
      lastMainThreadMs: 0,
      emaMainThreadMs: 0,
      budgetPressure: 0,
      budgetLevel: 'idle',
      effectiveWasmThreshold: this.wasmThreshold,
      effectiveWorkerThreshold: this.workerThreshold,
      effectiveGpuThreshold: this.gpuThreshold,
      activeSprings: 0,
      activeKinetics: 0,
      activeDrivers: 0,
      pendingMutations: 0,
    };

    if (wasm === true) this.prepareWasm().catch(() => {});
    if (worker === true) this.prepareWorker().catch(() => {});
    if (gpu === true) this.prepareGpu().catch(() => {});
  }

  addDriver(driver) {
    if (this.disposed) throw new Error('MotionEngine is disposed.');
    if (!driver || typeof driver.step !== 'function') throw new TypeError('MotionEngine driver requires a step(dtMs) method.');
    this.drivers.add(driver);
    this.#updateThresholdStats();
    this.#ensureRunning();
    return () => this.removeDriver(driver);
  }

  removeDriver(driver) {
    const removed = this.drivers.delete(driver);
    if (removed) {
      this.#updateThresholdStats();
      if (!this.#hasWork()) this.#stopLoop();
    }
    return removed;
  }

  prefersReducedMotion() {
    return this.respectReducedMotion
      && typeof globalThis.matchMedia === 'function'
      && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  async prepareWasm() {
    if (this.wasmMode === false || this.disposed) return null;
    if (this.wasmBatch) return this.wasmBatch;
    if (this.wasmPromise) return this.wasmPromise;
    this.wasmPromise = import('../wasm/wasm-spring-batch.js')
      .then(({ WasmSpringBatch }) => WasmSpringBatch.create(this.maxWasmMotions))
      .then((batch) => {
        if (this.disposed) return null;
        this.wasmBatch = batch;
        return batch;
      })
      .finally(() => {
        this.wasmPromise = null;
      });
    return this.wasmPromise;
  }

  async prepareWorker() {
    if (this.workerMode === false || this.workerUnavailable || this.disposed) return null;
    if (this.workerBackend) return this.workerBackend;
    if (this.workerPromise) return this.workerPromise;
    this.workerPromise = import('../worker/shared-spring-worker.js')
      .then(({ SharedSpringWorkerBackend }) => SharedSpringWorkerBackend.create(this.maxWasmMotions))
      .then((backend) => {
        if (this.disposed) {
          backend.dispose();
          return null;
        }
        this.workerBackend = backend;
        return backend;
      })
      .catch((error) => {
        if (this.workerMode === true) throw error;
        this.workerUnavailable = true;
        return null;
      })
      .finally(() => {
        this.workerPromise = null;
      });
    return this.workerPromise;
  }

  async prepareGpu() {
    if (this.gpuMode === false || this.gpuUnavailable || this.disposed) return null;
    if (this.gpuBackend) return this.gpuBackend;
    if (this.gpuPromise) return this.gpuPromise;
    this.gpuPromise = import('../webgpu/spring-batch.js')
      .then(({ WebGPUSpringBatch }) => WebGPUSpringBatch.create(this.maxWasmMotions, this.gpuDevice))
      .then((backend) => {
        if (this.disposed) {
          backend.dispose();
          return null;
        }
        this.gpuBackend = backend;
        return backend;
      })
      .catch((error) => {
        if (this.gpuMode === true) throw error;
        this.gpuUnavailable = true;
        return null;
      })
      .finally(() => {
        this.gpuPromise = null;
      });
    return this.gpuPromise;
  }

  #effectiveWasmThreshold() {
    if (!this.adaptiveBackends || !this.frameBudget) return this.wasmThreshold;
    return this.frameBudget.wasmThreshold(this.wasmThreshold, this.activeSpringCount);
  }

  #effectiveWorkerThreshold() {
    if (!this.adaptiveBackends || !this.frameBudget) return this.workerThreshold;
    return this.frameBudget.workerThreshold(this.workerThreshold, this.activeSpringCount);
  }

  #effectiveGpuThreshold() {
    if (!this.adaptiveBackends || !this.frameBudget) return this.gpuThreshold;
    return this.frameBudget.workerThreshold(this.gpuThreshold, this.activeSpringCount);
  }

  #updateThresholdStats() {
    this.stats.effectiveWasmThreshold = this.#effectiveWasmThreshold();
    this.stats.effectiveWorkerThreshold = this.#effectiveWorkerThreshold();
    this.stats.effectiveGpuThreshold = this.#effectiveGpuThreshold();
    this.stats.activeSprings = this.activeSpringCount;
    this.stats.activeKinetics = this.kinetics.length;
    this.stats.activeDrivers = this.drivers.size;
    this.stats.pendingMutations = this.pendingSpringSync.size + this.deferredSpringRemovals.size;
  }

  maybePrepareWasm() {
    if (this.wasmMode === false || this.wasmBatch || this.wasmPromise || this.disposed) return;
    if (this.activeSpringCount < this.#effectiveWasmThreshold()) return;
    this.prepareWasm().catch(() => {});
  }

  maybePromoteToWasm() {
    if (!this.wasmBatch || this.batch.kind !== 'js' || this.workerFrameInFlight) return false;
    const threshold = this.#effectiveWasmThreshold();
    if (this.activeSpringCount < threshold) return false;
    if (this.springs.length > this.wasmBatch.capacity) return false;
    this.batch.ensureCapacity(this.springs.length);
    this.batch.copyInto(this.wasmBatch, this.springs.length);
    this.batch = this.wasmBatch;
    this.stats.promotedToWasm = true;
    this.stats.backend = `wasm-${this.wasmBatch.variant}`;
    this.#updateThresholdStats();
    return true;
  }

  maybePrepareWorker() {
    if (this.workerMode === false || this.workerUnavailable || this.workerBackend || this.workerPromise || this.disposed) return;
    if (this.activeSpringCount < this.#effectiveWorkerThreshold()) return;
    this.prepareWorker().catch(() => {});
  }

  maybePrepareGpu() {
    if (this.gpuMode === false || this.gpuUnavailable || this.gpuBackend || this.gpuPromise || this.disposed) return;
    if (this.activeSpringCount < this.#effectiveGpuThreshold()) return;
    this.prepareGpu().catch(() => {});
  }

  maybePromoteToWorker() {
    if (!this.workerBackend || this.batch === this.workerBackend || this.batch.kind === 'webgpu' || this.workerFrameInFlight || this.gpuFrameInFlight) return false;
    if (this.activeSpringCount < this.#effectiveWorkerThreshold()) return false;
    if (this.springs.length > this.workerBackend.capacity) return false;
    this.batch.ensureCapacity(this.springs.length);
    this.batch.copyInto(this.workerBackend, this.springs.length);
    this.batch = this.workerBackend;
    this.stats.promotedToWorker = true;
    this.stats.backend = `shared-wasm-${this.workerBackend.variant}`;
    this.#updateThresholdStats();
    return true;
  }

  maybePromoteToGpu() {
    if (!this.gpuBackend || this.batch === this.gpuBackend || this.workerFrameInFlight || this.gpuFrameInFlight) return false;
    if (this.activeSpringCount < this.#effectiveGpuThreshold()) return false;
    if (this.springs.length > this.gpuBackend.capacity) return false;
    this.batch.ensureCapacity(this.springs.length);
    this.batch.copyInto(this.gpuBackend, this.springs.length);
    this.batch = this.gpuBackend;
    this.stats.promotedToGpu = true;
    this.stats.backend = 'webgpu-compute';
    this.#updateThresholdStats();
    return true;
  }

  #demoteGpuToJs() {
    if (this.batch.kind !== 'webgpu') return false;
    const next = new JsSpringBatch(Math.max(256, this.springs.length));
    this.batch.copyInto(next, this.springs.length);
    this.batch = next;
    this.stats.backend = 'js';
    this.#updateThresholdStats();
    return true;
  }

  #interruptDriversForValue(value, status = 'interrupted') {
    if (this.drivers.size === 0) return;
    for (const driver of this.drivers) {
      if (driver.owns?.(value)) driver.interruptValue?.(value, status);
    }
  }

  animate(value, to, requestedSpec) {
    if (this.disposed) throw new Error('MotionEngine is disposed.');
    if (!Number.isFinite(to)) throw new TypeError('animate() target must be a finite number.');
    this.#interruptDriversForValue(value);
    const from = value.get();
    const plan = resolveMotionPlan(requestedSpec, from, to);

    if (this.prefersReducedMotion()) {
      this.stop(value, 'interrupted');
      value.set(to, 0);
      const d = deferredControls();
      d.settle({ status: 'finished', value: to, reducedMotion: true });
      return new AnimationControls(() => {}, () => {}, d.finished);
    }

    if (plan.route === 'spring') return this.#animateSpring(value, to, plan);
    if (plan.route === 'timing') return this.#animateTiming(value, to, plan);
    throw new TypeError(`Unknown motion plan route: ${plan.route}`);
  }

  animateVelocity(value, requestedSpec) {
    if (this.disposed) throw new Error('MotionEngine is disposed.');
    this.#interruptDriversForValue(value);
    const spec = requestedSpec?.kind === 'inertia'
      ? requestedSpec
      : requestedSpec?.kind === 'decay'
        ? requestedSpec
        : inertiaSpec(requestedSpec ?? {});

    if (this.prefersReducedMotion()) {
      this.stop(value, 'interrupted');
      const velocity = Number.isFinite(spec.velocity) ? spec.velocity : value.getVelocity();
      const projected = projectDecayTarget(value.get(), velocity, spec);
      const finalValue = spec.kind === 'inertia'
        ? clampToBounds(projected, spec.min, spec.max)
        : projected;
      value.set(finalValue, 0);
      const d = deferredControls();
      d.settle({ status: 'finished', value: finalValue, reducedMotion: true });
      return new AnimationControls(() => {}, () => {}, d.finished);
    }

    return this.#animateKinetic(value, spec);
  }

  #animateKinetic(value, requestedSpec) {
    const existing = this.byValue.get(value);
    if (existing) this.#removeAnimation(existing, 'interrupted');

    const spec = requestedSpec;
    const from = value.get();
    const sourceVelocity = Number.isFinite(spec.velocity) ? spec.velocity : value.getVelocity();
    const projectedTarget = projectDecayTarget(from, sourceVelocity, spec);
    const initialVelocity = spec.timeConstant > 0
      ? (projectedTarget - from) / spec.timeConstant
      : sourceVelocity * spec.power;
    const outside = spec.kind === 'inertia' ? nearestBound(from, spec.min, spec.max) : null;
    const finalTarget = spec.kind === 'inertia'
      ? clampToBounds(projectedTarget, spec.min, spec.max)
      : projectedTarget;
    const index = this.kinetics.length;

    const animation = {
      type: 'kinetic',
      index,
      kind: spec.kind,
      value,
      mode: outside == null ? 'decay' : 'spring',
      position: from,
      velocity: initialVelocity,
      projectedTarget,
      finalTarget: outside ?? finalTarget,
      timeConstant: spec.timeConstant,
      restSpeed: spec.restSpeed,
      restDelta: spec.kind === 'inertia' ? spec.restDelta : 0.5,
      min: spec.kind === 'inertia' ? spec.min : -Infinity,
      max: spec.kind === 'inertia' ? spec.max : Infinity,
      bounceOmega: spec.kind === 'inertia' ? spec.bounceOmega : 0,
      bounceDampingRatio: spec.kind === 'inertia' ? spec.bounceDampingRatio : 1,
      controlState: deferredControls(),
    };

    this.kinetics.push(animation);
    this.byValue.set(value, animation);
    value._commit(from, initialVelocity);
    this.#updateThresholdStats();
    this.#ensureRunning();
    return this.#controlsFor(animation);
  }

  #slotIsAsyncLocked(index) {
    return ((this.workerFrameInFlight && this.batch.kind === 'worker-wasm')
      || (this.gpuFrameInFlight && this.batch.kind === 'webgpu'))
      && index >= 0
      && index < this.inFlightSpringCount;
  }

  #syncSpringParameters(animation) {
    if (!animation.active || animation.index < 0) return;
    const index = animation.index;
    this.batch.targets[index] = animation.target;
    this.batch.omegas[index] = animation.omega;
    this.batch.dampingRatios[index] = animation.dampingRatio;
    if (Number.isFinite(animation.pendingVelocityOverride)) {
      this.batch.velocities[index] = animation.pendingVelocityOverride;
      animation.pendingVelocityOverride = undefined;
    }
  }

  #animateSpring(value, to, plan) {
    const existing = this.byValue.get(value);
    if (existing?.type === 'spring') {
      existing.controlState.settle({ status: 'interrupted', value: value.get() });
      existing.controlState = deferredControls();
      existing.target = to;
      const blendDurationMs = Math.max(0, plan.blendDurationMs || 0);
      if (blendDurationMs > 0
        && (existing.omega !== plan.omega || existing.dampingRatio !== plan.dampingRatio)) {
        existing.blendFromOmega = existing.omega;
        existing.blendFromDampingRatio = existing.dampingRatio;
        existing.blendToOmega = plan.omega;
        existing.blendToDampingRatio = plan.dampingRatio;
        existing.blendElapsedMs = 0;
        existing.blendDurationMs = blendDurationMs;
      } else {
        existing.omega = plan.omega;
        existing.dampingRatio = plan.dampingRatio;
        existing.blendDurationMs = 0;
        existing.blendElapsedMs = 0;
      }
      if (Number.isFinite(plan.initialVelocity)) existing.pendingVelocityOverride = plan.initialVelocity;

      if (this.#slotIsAsyncLocked(existing.index)) this.pendingSpringSync.add(existing);
      else this.#syncSpringParameters(existing);

      this.#updateThresholdStats();
      this.#ensureRunning();
      return this.#controlsFor(existing);
    }

    if (existing) this.#removeAnimation(existing, 'interrupted');

    const index = this.springs.length;
    this.batch.ensureCapacity(index + 1);
    const initialVelocity = Number.isFinite(plan.initialVelocity) ? plan.initialVelocity : value.getVelocity();
    const animation = {
      type: 'spring',
      value,
      index,
      active: true,
      pendingRemoval: null,
      target: to,
      omega: plan.omega,
      dampingRatio: plan.dampingRatio,
      blendFromOmega: plan.omega,
      blendFromDampingRatio: plan.dampingRatio,
      blendToOmega: plan.omega,
      blendToDampingRatio: plan.dampingRatio,
      blendElapsedMs: 0,
      blendDurationMs: 0,
      pendingVelocityOverride: undefined,
      controlState: deferredControls(),
      epsilon: DEFAULT_EPSILON,
      velocityEpsilon: DEFAULT_VELOCITY_EPSILON,
    };
    this.springs.push(animation);
    this.activeSpringCount += 1;
    this.byValue.set(value, animation);
    this.batch.positions[index] = value.get();
    this.batch.velocities[index] = initialVelocity;
    this.batch.targets[index] = to;
    this.batch.omegas[index] = plan.omega;
    this.batch.dampingRatios[index] = plan.dampingRatio;

    this.maybePrepareWasm();
    this.maybePromoteToWasm();
    this.maybePrepareWorker();
    this.maybePrepareGpu();
    this.#updateThresholdStats();
    this.#ensureRunning();
    return this.#controlsFor(animation);
  }

  #animateTiming(value, to, plan) {
    const existing = this.byValue.get(value);
    if (existing) this.#removeAnimation(existing, 'interrupted');

    if (plan.durationMs === 0) {
      value.set(to, 0);
      const d = deferredControls();
      d.settle({ status: 'finished', value: to });
      return new AnimationControls(() => {}, () => {}, d.finished);
    }

    const index = this.timings.length;
    const animation = {
      type: 'timing',
      index,
      value,
      from: value.get(),
      to,
      durationMs: plan.durationMs,
      elapsedMs: 0,
      easing: plan.easing,
      previous: value.get(),
      startAfterFrame: (this.workerFrameInFlight || this.gpuFrameInFlight) ? this.stats.frames + 1 : this.stats.frames,
      controlState: deferredControls(),
    };
    this.timings.push(animation);
    this.byValue.set(value, animation);
    this.#ensureRunning();
    return this.#controlsFor(animation);
  }

  #controlsFor(animation) {
    const state = animation.controlState;
    return new AnimationControls(
      () => {
        if (this.byValue.get(animation.value) === animation && animation.controlState === state) {
          this.#removeAnimation(animation, 'cancelled');
        }
      },
      () => {
        if (this.byValue.get(animation.value) !== animation || animation.controlState !== state) return;
        if (animation.type === 'spring') animation.value.set(animation.target, 0);
        else if (animation.type === 'timing') animation.value.set(animation.to, 0);
        else animation.value.set(animation.finalTarget, 0);
        this.#removeAnimation(animation, 'finished');
      },
      state.finished,
    );
  }

  stop(value, status = 'cancelled') {
    this.#interruptDriversForValue(value, status);
    const existing = this.byValue.get(value);
    if (existing) this.#removeAnimation(existing, status);
  }

  #logicalRemoveSpring(animation, status) {
    if (!animation.active) return;
    animation.active = false;
    animation.pendingRemoval = status;
    this.activeSpringCount -= 1;
    if (this.byValue.get(animation.value) === animation) this.byValue.delete(animation.value);
    animation.controlState.settle({ status, value: animation.value.get() });
  }

  #physicalRemoveSpring(animation) {
    const index = animation.index;
    if (index < 0 || this.springs[index] !== animation) return;
    const lastIndex = this.springs.length - 1;
    if (index !== lastIndex) {
      const moved = this.springs[lastIndex];
      this.springs[index] = moved;
      moved.index = index;
      for (const key of ['positions', 'velocities', 'targets', 'omegas', 'dampingRatios']) {
        this.batch[key][index] = this.batch[key][lastIndex];
      }
    }
    this.springs.pop();
    animation.index = -1;
    animation.pendingRemoval = null;
  }

  #removeAnimation(animation, status) {
    if (animation.type === 'spring') {
      if (!animation.active) return;
      if (this.#slotIsAsyncLocked(animation.index)) {
        this.#logicalRemoveSpring(animation, status);
        this.pendingSpringSync.delete(animation);
        this.deferredSpringRemovals.add(animation);
        this.#updateThresholdStats();
        return;
      }
      this.#logicalRemoveSpring(animation, status);
      this.#physicalRemoveSpring(animation);
    } else {
      const list = animation.type === 'timing' ? this.timings : this.kinetics;
      const index = animation.index;
      if (index >= 0 && list[index] === animation) {
        const last = list.pop();
        if (last !== animation && last) {
          list[index] = last;
          last.index = index;
        }
        animation.index = -1;
      }
      if (this.byValue.get(animation.value) === animation) this.byValue.delete(animation.value);
      animation.controlState.settle({ status, value: animation.value.get() });
    }

    this.#updateThresholdStats();
    if (!this.#hasWork()) this.#stopLoop();
  }

  #flushDeferredSpringMutations() {
    if (this.deferredSpringRemovals.size > 0) {
      for (const animation of this.deferredSpringRemovals) this.#physicalRemoveSpring(animation);
      this.deferredSpringRemovals.clear();
    }
    if (this.pendingSpringSync.size > 0) {
      for (const animation of this.pendingSpringSync) {
        if (animation.active) this.#syncSpringParameters(animation);
      }
      this.pendingSpringSync.clear();
    }
    this.#updateThresholdStats();
  }

  #restoreBatchFromMotionValues() {
    for (const animation of this.springs) {
      if (!animation.active || animation.index < 0) continue;
      const index = animation.index;
      this.batch.positions[index] = animation.value.get();
      this.batch.velocities[index] = animation.value.getVelocity();
      this.#syncSpringParameters(animation);
    }
  }

  #prepareStep(dtMs, { preferWorker = false } = {}) {
    if (!Number.isFinite(dtMs) || dtMs <= 0 || this.disposed) return 0;
    const clampedDt = Math.min(dtMs, 250);
    this.stats.frames += 1;
    this.stats.lastDtMs = clampedDt;
    this.maybePrepareWasm();
    this.maybePrepareGpu();

    if (preferWorker && this.gpuBackend && this.activeSpringCount >= this.#effectiveGpuThreshold()) {
      this.maybePromoteToGpu();
    } else if (preferWorker && this.workerBackend && this.activeSpringCount >= this.#effectiveWorkerThreshold()) {
      this.maybePromoteToWorker();
    } else {
      this.maybePromoteToWasm();
    }
    this.maybePrepareWorker();
    this.maybePrepareGpu();
    this.#updateThresholdStats();
    return clampedDt;
  }

  #advanceSpringBlends(clampedDt) {
    if (clampedDt <= 0) return;
    for (const animation of this.springs) {
      if (!animation.active || animation.blendDurationMs <= 0) continue;
      animation.blendElapsedMs = Math.min(animation.blendDurationMs, animation.blendElapsedMs + clampedDt);
      const progress = animation.blendDurationMs > 0 ? animation.blendElapsedMs / animation.blendDurationMs : 1;
      animation.omega = animation.blendFromOmega + (animation.blendToOmega - animation.blendFromOmega) * progress;
      animation.dampingRatio = animation.blendFromDampingRatio
        + (animation.blendToDampingRatio - animation.blendFromDampingRatio) * progress;
      if (progress >= 1) {
        animation.omega = animation.blendToOmega;
        animation.dampingRatio = animation.blendToDampingRatio;
        animation.blendDurationMs = 0;
        animation.blendElapsedMs = 0;
      }
      this.#syncSpringParameters(animation);
    }
  }

  #commitSpringValues() {
    for (let i = this.springs.length - 1; i >= 0; i -= 1) {
      const animation = this.springs[i];
      if (!animation.active) continue;
      const x = this.batch.positions[i];
      const v = this.batch.velocities[i];
      const target = animation.target;
      if (Math.abs(target - x) <= animation.epsilon && Math.abs(v) <= animation.velocityEpsilon) {
        animation.value.set(target, 0);
        this.#removeAnimation(animation, 'finished');
      } else {
        animation.value._commit(x, v);
      }
    }
  }

  #stepTimings(clampedDt) {
    for (let i = this.timings.length - 1; i >= 0; i -= 1) {
      const animation = this.timings[i];
      if (animation.startAfterFrame > this.stats.frames) continue;
      animation.elapsedMs += clampedDt;
      const progress = Math.min(1, animation.elapsedMs / animation.durationMs);
      const eased = evaluateCompiledEasing(animation.easing, progress);
      const next = animation.from + (animation.to - animation.from) * eased;
      const velocity = clampedDt > 0 ? (next - animation.previous) / (clampedDt / 1000) : 0;
      animation.previous = next;
      animation.value._commit(next, velocity);
      if (progress >= 1) {
        animation.value.set(animation.to, 0);
        this.#removeAnimation(animation, 'finished');
      }
    }
  }

  #stepKinetics(clampedDt) {
    const dtSeconds = clampedDt / 1000;
    for (let i = this.kinetics.length - 1; i >= 0; i -= 1) {
      const animation = this.kinetics[i];
      let next;

      if (animation.mode === 'decay') {
        next = stepDecay(animation.position, animation.velocity, dtSeconds, animation.timeConstant, this.kineticScratch);
        animation.position = next.position;
        animation.velocity = next.velocity;

        if (animation.kind === 'inertia') {
          const crossed = nearestBound(animation.position, animation.min, animation.max);
          if (crossed != null) {
            animation.mode = 'spring';
            animation.finalTarget = crossed;
          }
        }

        if (animation.mode === 'decay' && Math.abs(animation.velocity) <= animation.restSpeed) {
          animation.position = animation.finalTarget;
          animation.velocity = 0;
          animation.value.set(animation.finalTarget, 0);
          this.#removeAnimation(animation, 'finished');
          continue;
        }
      }

      if (animation.mode === 'spring') {
        next = stepDampedSpring(
          animation.position,
          animation.velocity,
          animation.finalTarget,
          animation.bounceOmega,
          animation.bounceDampingRatio,
          dtSeconds,
          this.kineticScratch,
        );
        animation.position = next.position;
        animation.velocity = next.velocity;

        if (Math.abs(animation.finalTarget - animation.position) <= animation.restDelta
          && Math.abs(animation.velocity) <= animation.restSpeed) {
          animation.position = animation.finalTarget;
          animation.velocity = 0;
          animation.value.set(animation.finalTarget, 0);
          this.#removeAnimation(animation, 'finished');
          continue;
        }
      }

      animation.value._commit(animation.position, animation.velocity);
    }
  }

  #stepDrivers(clampedDt) {
    if (this.drivers.size === 0) return;
    for (const driver of this.drivers) {
      if (driver.step(clampedDt) === false) this.drivers.delete(driver);
    }
    this.#updateThresholdStats();
    if (!this.#hasWork()) this.#stopLoop();
  }

  #hasWork() {
    return this.activeSpringCount > 0 || this.timings.length > 0 || this.kinetics.length > 0 || this.drivers.size > 0;
  }

  #recordPerformance(mainThreadMs, wallMs, { async = false, worker = false } = {}) {
    this.stats.lastMainThreadMs = mainThreadMs;
    this.stats.lastStepWallMs = wallMs;
    if (async) this.stats.asyncFrames += 1;
    else this.stats.syncFrames += 1;
    if (worker) this.stats.workerFrames += 1;

    if (this.frameBudget) {
      const budget = this.frameBudget.observe(mainThreadMs);
      this.stats.emaMainThreadMs = budget.emaMainThreadMs;
      this.stats.budgetPressure = budget.pressure;
      this.stats.budgetLevel = budget.level;
    }
    this.#updateThresholdStats();
  }

  step(dtMs) {
    if (this.disposed) return;
    if (this.workerFrameInFlight || this.gpuFrameInFlight) throw new Error('Cannot call step() while an asynchronous frame is in flight. Use stepAsync() or wait for the current frame.');
    this.#demoteGpuToJs();
    const started = nowMs();
    const clampedDt = this.#prepareStep(dtMs);
    if (clampedDt <= 0) return;
    const driverDt = dtMs;
    this.#advanceSpringBlends(clampedDt);
    const springCount = this.springs.length;
    if (springCount > 0) {
      this.batch.step(springCount, clampedDt / 1000);
      if (this.batch.kind === 'worker-wasm') this.stats.backend = `shared-wasm-${this.batch.variant}`;
      this.#commitSpringValues();
    }
    this.#stepTimings(clampedDt);
    this.#stepKinetics(clampedDt);
    this.#stepDrivers(driverDt);
    const elapsed = nowMs() - started;
    this.#recordPerformance(elapsed, elapsed);
  }

  stepAsync(dtMs) {
    if (this.disposed) return Promise.resolve();
    const run = () => this.#stepAsyncFrame(dtMs);
    const result = this.asyncStepChain.then(run, run);
    this.asyncStepChain = result.catch(() => {});
    return result;
  }

  async #stepAsyncFrame(dtMs) {
    if (this.disposed) return;
    const started = nowMs();
    const clampedDt = this.#prepareStep(dtMs, { preferWorker: true });
    if (clampedDt <= 0) return;
    const driverDt = dtMs;
    this.#advanceSpringBlends(clampedDt);

    if (this.gpuBackend) this.maybePromoteToGpu();
    if (this.workerBackend) this.maybePromoteToWorker();
    const springCount = this.springs.length;
    let usedWorker = false;
    let dispatchCost = 0;

    if (springCount > 0) {
      if (this.batch.kind === 'webgpu' && this.gpuBackend === this.batch && !this.gpuUnavailable) {
        this.stats.backend = 'webgpu-compute';
        this.gpuFrameInFlight = true;
        this.inFlightSpringCount = springCount;
        const dispatchStart = nowMs();
        const gpuPromise = this.batch.stepAsync(springCount, clampedDt / 1000);
        dispatchCost = nowMs() - dispatchStart;

        try {
          await gpuPromise;
        } catch (error) {
          this.gpuFrameInFlight = false;
          this.inFlightSpringCount = 0;
          this.stats.gpuFailures += 1;
          this.gpuUnavailable = true;
          this.gpuBackend?.dispose();
          this.gpuBackend = null;
          this.#demoteGpuToJs();
          this.#flushDeferredSpringMutations();
          if (!this.disposed) this.#restoreBatchFromMotionValues();
          this.stats.backend = this.batch?.variant ? `wasm-${this.batch.variant}` : this.batch?.kind ?? 'js';
          throw error;
        }

        const resumed = nowMs();
        this.gpuFrameInFlight = false;
        this.inFlightSpringCount = 0;
        this.#flushDeferredSpringMutations();
        if (!this.disposed) this.#commitSpringValues();
        if (!this.disposed) this.#stepTimings(clampedDt);
        if (!this.disposed) this.#stepKinetics(clampedDt);
        if (!this.disposed) this.#stepDrivers(driverDt);
        const ended = nowMs();
        const mainThreadMs = dispatchCost + (ended - resumed);
        this.#recordPerformance(mainThreadMs, ended - started, { async: true, worker: false });
        this.stats.gpuFrames += 1;
        if (!this.#hasWork()) this.#stopLoop();
        return;
      }

      if (this.batch.kind === 'worker-wasm' && this.workerBackend === this.batch && !this.workerUnavailable) {
        usedWorker = true;
        this.stats.backend = `worker-wasm-${this.batch.variant}`;
        this.workerFrameInFlight = true;
        this.inFlightSpringCount = springCount;
        const dispatchStart = nowMs();
        const workerPromise = this.batch.stepAsync(springCount, clampedDt / 1000);
        dispatchCost = nowMs() - dispatchStart;

        try {
          await workerPromise;
        } catch (error) {
          this.workerFrameInFlight = false;
          this.inFlightSpringCount = 0;
          this.stats.workerFailures += 1;
          this.workerUnavailable = true;
          this.workerBackend?.dispose();
          this.workerBackend = null;
          this.#flushDeferredSpringMutations();
          if (!this.disposed) this.#restoreBatchFromMotionValues();
          this.stats.backend = this.batch?.variant ? `shared-wasm-${this.batch.variant}` : this.batch?.kind ?? 'js';
          throw error;
        }

        const resumed = nowMs();
        this.workerFrameInFlight = false;
        this.inFlightSpringCount = 0;
        this.#flushDeferredSpringMutations();
        if (!this.disposed) this.#commitSpringValues();
        if (!this.disposed) this.#stepTimings(clampedDt);
        if (!this.disposed) this.#stepKinetics(clampedDt);
        if (!this.disposed) this.#stepDrivers(driverDt);
        const ended = nowMs();
        const mainThreadMs = dispatchCost + (ended - resumed);
        this.#recordPerformance(mainThreadMs, ended - started, { async: true, worker: true });
        if (!this.#hasWork()) this.#stopLoop();
        return;
      }

      this.batch.step(springCount, clampedDt / 1000);
      this.#commitSpringValues();
    }

    this.#stepTimings(clampedDt);
    this.#stepKinetics(clampedDt);
    this.#stepDrivers(driverDt);
    const ended = nowMs();
    this.#recordPerformance(ended - started, ended - started, { async: true, worker: usedWorker });
  }

  #shouldAutoUseWorker() {
    if (!this.autoWorkerScheduler) return false;
    if (this.gpuBackend && !this.gpuUnavailable && this.activeSpringCount >= this.#effectiveGpuThreshold()) return true;
    if (this.workerMode === false || this.workerUnavailable || !this.workerBackend) return false;
    return this.activeSpringCount >= this.#effectiveWorkerThreshold();
  }

  #ensureRunning() {
    if (!this.autoStart || this.running || this.disposed) return;
    this.running = true;
    // Seed the clock when work is scheduled instead of burning the first RAF
    // solely to establish a timestamp. Real RAF timestamps and performance.now()
    // share the same time origin, so the first visible frame can advance motion.
    this.lastTime = nowMs();

    const tick = (time) => {
      if (!this.running || this.disposed) return;
      const dt = time - this.lastTime;
      this.lastTime = time;
      // Synthetic schedulers/tests may use a different timestamp origin. Rebase
      // once rather than feeding a negative/invalid delta into the integrators.
      if (!Number.isFinite(dt) || dt <= 0) {
        if (this.running) this.frameId = defaultRaf(tick);
        return;
      }

      if (this.#shouldAutoUseWorker() || this.workerFrameInFlight || this.gpuFrameInFlight) {
        this.stepAsync(dt)
          .catch(() => {})
          .finally(() => {
            if (this.running && !this.disposed) this.frameId = defaultRaf(tick);
          });
        return;
      }

      try {
        this.step(dt);
      } catch {
        // A manual async step may have acquired the Worker between the check
        // above and this synchronous step. Serialize behind it instead.
        this.stepAsync(dt).catch(() => {});
      }
      if (this.running && !this.disposed) this.frameId = defaultRaf(tick);
    };

    this.frameId = defaultRaf(tick);
  }

  #stopLoop() {
    if (!this.running) return;
    this.running = false;
    this.lastTime = null;
    if (this.frameId != null) defaultCancelRaf(this.frameId);
    this.frameId = null;
  }

  getBackendPlan() {
    this.#updateThresholdStats();
    return {
      current: this.stats.backend,
      activeSprings: this.activeSpringCount,
      activeKinetics: this.kinetics.length,
      wasm: {
        mode: this.wasmMode,
        ready: Boolean(this.wasmBatch),
        threshold: this.stats.effectiveWasmThreshold,
      },
      worker: {
        mode: this.workerMode,
        ready: Boolean(this.workerBackend),
        unavailable: this.workerUnavailable,
        threshold: this.stats.effectiveWorkerThreshold,
        inFlight: this.workerFrameInFlight,
      },
      gpu: {
        mode: this.gpuMode,
        ready: Boolean(this.gpuBackend),
        unavailable: this.gpuUnavailable,
        threshold: this.stats.effectiveGpuThreshold,
        inFlight: this.gpuFrameInFlight,
      },
      budget: this.frameBudget?.snapshot() ?? null,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.#stopLoop();
    for (const animation of [...this.springs, ...this.timings, ...this.kinetics]) {
      if (animation.active !== false) animation.controlState.settle({ status: 'cancelled', value: animation.value.get() });
    }
    this.springs.length = 0;
    this.activeSpringCount = 0;
    this.timings.length = 0;
    this.kinetics.length = 0;
    this.byValue.clear();
    for (const driver of this.drivers) driver.onEngineDispose?.();
    this.drivers.clear();
    this.pendingSpringSync.clear();
    this.deferredSpringRemovals.clear();
    this.workerBackend?.dispose();
    this.workerBackend = null;
    this.gpuBackend?.dispose();
    this.gpuBackend = null;
    this.#updateThresholdStats();
  }
}
