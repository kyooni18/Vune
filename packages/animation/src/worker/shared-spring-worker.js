import { SharedWasmSpringBatch } from '../wasm/shared-wasm-spring-batch.js';

function canUseSharedMemory() {
  try {
    if (typeof SharedArrayBuffer !== 'function' || typeof WebAssembly?.Memory !== 'function') return false;
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
    return memory.buffer instanceof SharedArrayBuffer;
  } catch {
    return false;
  }
}

async function createWorker(url) {
  if (typeof globalThis.Worker === 'function') return new globalThis.Worker(url, { type: 'module' });
  if (typeof process !== 'undefined' && process.versions?.node) {
    const nodeWorkers = ['node', 'worker_threads'].join(':');
    const { Worker } = await import(/* @vite-ignore */ nodeWorkers);
    const execArgv = process.execArgv.filter((arg) => !arg.startsWith('--input-type'));
    try {
      return new Worker(url, { type: 'module', execArgv });
    } catch (error) {
      // Desktop shells and test runners can inject V8 flags that are valid in
      // the parent process but rejected by worker_threads. Retrying without
      // inherited flags keeps the shared backend available instead of
      // silently forcing the slower main-thread solver.
      if (error?.code !== 'ERR_WORKER_INVALID_EXEC_ARGV') throw error;
      return new Worker(url, { type: 'module', execArgv: [] });
    }
  }
  throw new Error('Module Worker is unavailable.');
}

function onWorkerMessage(worker, handler) {
  if (typeof worker.addEventListener === 'function') {
    const listener = (event) => handler(event.data);
    worker.addEventListener('message', listener);
    return () => worker.removeEventListener('message', listener);
  }
  worker.on('message', handler);
  return () => worker.off?.('message', handler);
}

function onWorkerError(worker, handler) {
  if (typeof worker.addEventListener === 'function') {
    const listener = (event) => handler(event.error ?? new Error(event.message || 'Worker failed.'));
    worker.addEventListener('error', listener);
    return () => worker.removeEventListener('error', listener);
  }
  worker.on?.('error', handler);
  return () => worker.off?.('error', handler);
}

export class SharedSpringWorkerBackend {
  static isSupported() { return canUseSharedMemory(); }

  static async create(capacity = 65536) {
    if (!canUseSharedMemory()) throw new Error('Shared WebAssembly memory is unavailable in this environment.');
    const batch = await SharedWasmSpringBatch.create(capacity);
    const worker = await createWorker(new URL('./shared-worker.js', import.meta.url));
    const controlBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 8);
    const backend = new SharedSpringWorkerBackend(batch, worker, controlBuffer);
    try {
      await backend.#initialize();
      return backend;
    } catch (error) {
      backend.dispose();
      throw error;
    }
  }

  constructor(batch, worker, controlBuffer) {
    this.kind = 'worker-wasm';
    this.batch = batch;
    this.worker = worker;
    this.controlBuffer = controlBuffer;
    this.control = new Int32Array(controlBuffer);
    this.controlFloat = new Float32Array(controlBuffer);
    this.pending = new Map();
    this.sequence = 0;
    this.atomicCompletion = typeof Atomics.waitAsync === 'function';
    this.workerFailure = null;
    this.stepChain = Promise.resolve();
    this.ready = false;
    this.disposed = false;
    this.removeListener = onWorkerMessage(worker, (message) => this.#onMessage(message));
    this.removeErrorListener = onWorkerError(worker, (error) => this.#onWorkerError(error));
  }

  get capacity() { return this.batch.capacity; }
  get variant() { return this.batch.variant; }
  get positions() { return this.batch.positions; }
  get velocities() { return this.batch.velocities; }
  get targets() { return this.batch.targets; }
  get omegas() { return this.batch.omegas; }
  get dampingRatios() { return this.batch.dampingRatios; }

  ensureCapacity(required) { this.batch.ensureCapacity(required); }
  copyInto(other, count) { this.batch.copyInto(other, count); }

  async #initialize() {
    const ready = new Promise((resolve, reject) => {
      this.readyResolver = resolve;
      this.readyRejecter = reject;
    });
    this.worker.postMessage({
      type: 'init',
      memory: this.batch.memory,
      variant: this.batch.variant,
      ptrs: this.batch.ptrs,
      controlBuffer: this.controlBuffer,
      atomicCompletion: this.atomicCompletion,
    });
    await ready;
  }

  #onWorkerError(error) {
    this.workerFailure = error;
    Atomics.store(this.control, 5, 3);
    Atomics.store(this.control, 1, this.sequence);
    Atomics.notify(this.control, 1);
    if (!this.ready) this.readyRejecter?.(error);
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }

  #onMessage(message) {
    if (message?.type === 'ready') {
      this.ready = true;
      this.readyResolver?.(message);
      this.readyResolver = null;
      this.readyRejecter = null;
      return;
    }
    if (message?.type === 'error') {
      const error = new Error(message.message || 'Shared spring worker failed.');
      this.workerFailure = error;
      Atomics.store(this.control, 5, 3);
      Atomics.store(this.control, 1, this.sequence);
      Atomics.notify(this.control, 1);
      if (!this.ready) this.readyRejecter?.(error);
      for (const { reject } of this.pending.values()) reject(error);
      this.pending.clear();
      return;
    }
    if (message?.type === 'done') {
      const pending = this.pending.get(message.sequence);
      if (pending) {
        this.pending.delete(message.sequence);
        pending.resolve();
      }
    }
  }

  step(count, dtSeconds) {
    // Synchronous/manual stepping keeps deterministic semantics and uses the
    // shared WASM instance on the caller thread. Auto mode can use stepAsync().
    this.batch.step(count, dtSeconds);
  }

  stepAsync(count, dtSeconds) {
    if (this.disposed) return Promise.reject(new Error('Shared spring worker is disposed.'));
    if (count === 0 || dtSeconds <= 0) return Promise.resolve();
    const dispatch = () => this.#dispatchStep(count, dtSeconds);
    const result = this.stepChain.then(dispatch, dispatch);
    this.stepChain = result.catch(() => {});
    return result;
  }

  #dispatchStep(count, dtSeconds) {
    if (this.disposed) return Promise.reject(new Error('Shared spring worker is disposed.'));
    const sequence = ++this.sequence;
    Atomics.store(this.control, 2, count);
    Atomics.store(this.control, 5, 0);
    this.controlFloat[4] = dtSeconds;

    let promise;
    if (this.atomicCompletion) {
      promise = this.#waitForSequence(sequence);
    } else {
      promise = new Promise((resolve, reject) => this.pending.set(sequence, { resolve, reject }));
    }

    Atomics.store(this.control, 0, sequence);
    Atomics.notify(this.control, 0);
    return promise;
  }

  async #waitForSequence(sequence) {
    while (true) {
      if (this.disposed) throw new Error('Shared spring worker is disposed.');
      if (this.workerFailure) throw this.workerFailure;
      const completed = Atomics.load(this.control, 1);
      if (completed >= sequence) {
        const errorCode = Atomics.load(this.control, 5);
        if (errorCode !== 0) throw new Error(`Shared spring worker failed with code ${errorCode}.`);
        return;
      }
      const waiter = Atomics.waitAsync(this.control, 1, completed);
      if (waiter.async) await waiter.value;
      else await Promise.resolve();
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    Atomics.store(this.control, 3, 1);
    Atomics.store(this.control, 5, 2);
    Atomics.store(this.control, 1, this.sequence);
    Atomics.notify(this.control, 0);
    Atomics.notify(this.control, 1);
    for (const { reject } of this.pending.values()) reject(new Error('Shared spring worker disposed.'));
    this.pending.clear();
    this.removeListener?.();
    this.removeErrorListener?.();
    this.worker.terminate?.();
  }
}
