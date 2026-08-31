import {
  ExecutionTelemetry,
  FrameBudgetSignal,
  type ExecutionAggregate,
} from "./index.js";
import {
  markResidentWasmRanges,
  prepareResidentWasmExecution,
  type ResidentNativeDecisionReason,
  type ResidentNativeRejectionReason,
  type ResidentWasmBinding,
  type ResidentWasmExecutionOptions,
  type ResidentWasmVariant,
} from "./resident-wasm.js";

const CONTROL_REQUEST_SEQUENCE = 0;
const CONTROL_DONE_SEQUENCE = 1;
const CONTROL_STATUS = 2;
const CONTROL_STOP = 3;
const CONTROL_RANGE_COUNT = 4;
const CONTROL_ERROR_CODE = 5;
const CONTROL_COMPUTE_MICROS = 6;
const CONTROL_WASM_CALLS = 7;

export interface ResidentWorkerLike {
  postMessage(message: unknown): void;
  addEventListener?(type: "message" | "error", listener: (event: unknown) => void): void;
  removeEventListener?(type: "message" | "error", listener: (event: unknown) => void): void;
  on?(type: "message" | "error", listener: (value: unknown) => void): void;
  off?(type: "message" | "error", listener: (value: unknown) => void): void;
  terminate?(): void | Promise<number>;
}

export type ResidentWorkerFactory = (binding: ResidentWasmBinding) => ResidentWorkerLike | Promise<ResidentWorkerLike>;

export interface ResidentWorkerInitMessage {
  readonly type: "init";
  readonly memory: WebAssembly.Memory;
  readonly variant: ResidentWasmVariant;
  readonly programPointer: number;
  readonly programWords: number;
  readonly columnPointersPointer: number;
  readonly columnCount: number;
  readonly rangesPointer: number;
  readonly capturesPointer: number;
  readonly captureCount: number;
  readonly controlPointer: number;
  readonly directSimdModuleBytes?: Uint8Array;
  readonly directSimdEntrypoint?: "resident_execute_direct_simd";
}

export type ResidentWorkerControlMessage =
  | Readonly<{ type: "ready"; variant: ResidentWasmVariant }>
  | Readonly<{ type: "done"; sequence: number }>
  | Readonly<{ type: "error"; message: string; sequence?: number }>
  | Readonly<{ type: "stopped" }>;

export interface ResidentWorkerExecutionMetrics {
  readonly backend: "shared-worker-wasm";
  readonly computeMs: number;
  readonly transferBytes: 0;
  readonly transferMs: 0;
  readonly materializationBytes: 0;
  readonly materializationMs: 0;
  readonly readbackBytes: 0;
  readonly readbackMs: 0;
  readonly synchronizationBytes: number;
  readonly synchronizationMs: number;
  readonly totalMs: number;
  readonly wasmCalls: 1;
  readonly sequence: number;
}

function now(): number {
  const clock = (globalThis as { performance?: { now(): number } }).performance;
  return clock?.now() ?? Date.now();
}

/** Deterministic URL of the Worker entry copied into the published package. */
export function residentWorkerAssetUrl(): string {
  const URLConstructor = (globalThis as unknown as {
    URL: new (input: string, base?: string) => { readonly href: string };
  }).URL;
  return new URLConstructor("./wasm/resident-worker.mjs", import.meta.url).href;
}

function messageData(value: unknown): unknown {
  if (typeof value === "object" && value !== null && "data" in value) return (value as { data: unknown }).data;
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Reject row-bearing messages at the thread boundary. */
export function validateResidentWorkerControlMessage(value: unknown): asserts value is ResidentWorkerControlMessage {
  if (!isRecord(value) || typeof value.type !== "string") throw new TypeError("worker-control-payload-invalid");
  for (const forbidden of ["rows", "values", "buffers", "columns", "payload"]) {
    if (forbidden in value) throw new TypeError(`worker-control-payload-invalid: ${forbidden}`);
  }
  if (value.type === "ready") {
    if (value.variant !== "simd" && value.variant !== "scalar") throw new TypeError("worker-control-payload-invalid");
    return;
  }
  if (value.type === "done") {
    if (!Number.isSafeInteger(value.sequence)) throw new TypeError("worker-control-payload-invalid");
    return;
  }
  if (value.type === "error") {
    if (typeof value.message !== "string") throw new TypeError("worker-control-payload-invalid");
    return;
  }
  if (value.type !== "stopped") throw new TypeError("worker-control-payload-invalid");
}

function initMessage(binding: ResidentWasmBinding): ResidentWorkerInitMessage {
  return Object.freeze({
    type: "init",
    memory: binding.runtime.memory,
    variant: binding.runtime.variant,
    programPointer: binding.programPointer,
    programWords: binding.program.words.length,
    columnPointersPointer: binding.columnPointersPointer,
    columnCount: binding.columnPointers.length,
    rangesPointer: binding.rangesPointer,
    capturesPointer: binding.capturesPointer,
    captureCount: binding.program.captureNames.length,
    controlPointer: binding.controlPointer,
    ...(binding.program.directSharedSimdModuleBytes && binding.program.directSharedSimdEntrypoint ? {
      directSimdModuleBytes: binding.program.directSharedSimdModuleBytes,
      directSimdEntrypoint: binding.program.directSharedSimdEntrypoint,
    } : {}),
  });
}

function listen(worker: ResidentWorkerLike, handler: (message: unknown) => void): () => void {
  const browserHandler = (event: unknown): void => handler(messageData(event));
  if (worker.addEventListener) {
    worker.addEventListener("message", browserHandler);
    return () => worker.removeEventListener?.("message", browserHandler);
  }
  if (worker.on) {
    worker.on("message", handler);
    return () => worker.off?.("message", handler);
  }
  throw new TypeError("resident Worker transport cannot receive control messages");
}

/** One shared-memory worker. Requests are atomic sequence changes, not row messages. */
export class ResidentSharedWorkerExecutor {
  readonly binding: ResidentWasmBinding;
  readonly worker: ResidentWorkerLike;
  #ready: Promise<void>;
  #readyResolve!: () => void;
  #readyReject!: (reason: unknown) => void;
  #pending = new Map<number, Readonly<{
    started: number;
    synchronizationBytes: number;
    ranges: readonly Readonly<{ start: number; end: number }>[];
    resolve: (metrics: ResidentWorkerExecutionMetrics) => void;
    reject: (reason: unknown) => void;
  }>>();
  #removeListener: () => void;
  #closed = false;

  constructor(binding: ResidentWasmBinding, worker: ResidentWorkerLike) {
    if (!binding.runtime.shared || binding.buffer.kind !== "shared-wasm") throw new TypeError("shared-memory-unavailable");
    this.binding = binding;
    this.worker = worker;
    this.#ready = new Promise<void>((resolve, reject) => {
      this.#readyResolve = resolve;
      this.#readyReject = reject;
    });
    this.#removeListener = listen(worker, message => this.#handleMessage(message));
    worker.postMessage(initMessage(binding));
  }

  #handleMessage(message: unknown): void {
    try {
      validateResidentWorkerControlMessage(message);
    } catch (error) {
      this.#readyReject(error);
      for (const pending of this.#pending.values()) pending.reject(error);
      this.#pending.clear();
      return;
    }
    if (message.type === "ready") {
      if (message.variant !== this.binding.runtime.variant) this.#readyReject(new Error("worker WASM variant differs from the authoritative runtime"));
      else this.#readyResolve();
      return;
    }
    if (message.type === "error") {
      const error = new Error(message.message);
      if (message.sequence !== undefined) {
        this.#pending.get(message.sequence)?.reject(error);
        this.#pending.delete(message.sequence);
      } else {
        this.#readyReject(error);
        for (const pending of this.#pending.values()) pending.reject(error);
        this.#pending.clear();
      }
      return;
    }
    if (message.type !== "done") return;
    const pending = this.#pending.get(message.sequence);
    if (!pending) return;
    this.#pending.delete(message.sequence);
    const result = Atomics.load(this.binding.control, CONTROL_ERROR_CODE);
    if (result !== 0) {
      pending.reject(new Error(`shared resident WASM execution failed (${result})`));
      return;
    }
    markResidentWasmRanges(this.binding, pending.ranges);
    const totalMs = now() - pending.started;
    const computeMs = Atomics.load(this.binding.control, CONTROL_COMPUTE_MICROS) / 1000;
    pending.resolve(Object.freeze({
      backend: "shared-worker-wasm",
      computeMs,
      transferBytes: 0,
      transferMs: 0,
      materializationBytes: 0,
      materializationMs: 0,
      readbackBytes: 0,
      readbackMs: 0,
      synchronizationBytes: pending.synchronizationBytes,
      synchronizationMs: Math.max(0, totalMs - computeMs),
      totalMs,
      wasmCalls: 1,
      sequence: message.sequence,
    }));
  }

  async execute(options: ResidentWasmExecutionOptions = {}): Promise<ResidentWorkerExecutionMetrics> {
    if (this.#closed) throw new Error("resident shared Worker is closed");
    await this.#ready;
    if (this.#pending.size !== 0) throw new Error("resident shared Worker execution is already in flight");
    const metadata = prepareResidentWasmExecution(this.binding, options);
    const sequence = Atomics.load(this.binding.control, CONTROL_REQUEST_SEQUENCE) + 1;
    Atomics.store(this.binding.control, CONTROL_RANGE_COUNT, metadata.rangeCount);
    Atomics.store(this.binding.control, CONTROL_STATUS, 1);
    Atomics.store(this.binding.control, CONTROL_ERROR_CODE, 0);
    const started = now();
    const result = new Promise<ResidentWorkerExecutionMetrics>((resolve, reject) => {
      this.#pending.set(sequence, {
        started,
        synchronizationBytes: metadata.synchronizationBytes + 4,
        ranges: Object.freeze((options.ranges ?? [{ start: 0, end: this.binding.length }]).map(range => Object.freeze({ ...range }))),
        resolve,
        reject,
      });
    });
    Atomics.store(this.binding.control, CONTROL_REQUEST_SEQUENCE, sequence);
    Atomics.notify(this.binding.control, CONTROL_REQUEST_SEQUENCE, 1);
    return result;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    Atomics.store(this.binding.control, CONTROL_STOP, 1);
    Atomics.notify(this.binding.control, CONTROL_REQUEST_SEQUENCE, 1);
    this.#removeListener();
    await this.worker.terminate?.();
    for (const pending of this.#pending.values()) pending.reject(new Error("resident shared Worker closed"));
    this.#pending.clear();
  }
}

interface ResidentWorkerPoolEntry {
  readonly binding: ResidentWasmBinding;
  readonly executor: ResidentSharedWorkerExecutor;
  tail: Promise<void>;
  pending: number;
  lastUsed: number;
  idle: Promise<void>;
  resolveIdle?: () => void;
}

export interface ResidentSharedWorkerPoolSnapshot {
  readonly size: number;
  readonly maxWorkers: number;
  readonly queuedJobs: number;
  readonly activeBindings: number;
  readonly createdWorkers: number;
  readonly evictedWorkers: number;
}

/**
 * Bound the number of persistent shared-memory resident Workers. A hot binding
 * retains its initialized Worker and authoritative memory; cold idle bindings
 * are evicted LRU when a new region needs capacity. Jobs for the same binding
 * are serialized while different pool entries may execute concurrently.
 *
 * The pool intentionally does not choose Worker execution itself. Callers must
 * still use `ResidentSharedWorkerPromotion`, which requires measured frame
 * pressure and an end-to-end win over packed JavaScript.
 */
export class ResidentSharedWorkerPool {
  readonly maxWorkers: number;
  readonly workerFactory: ResidentWorkerFactory;
  #entries = new Map<ResidentWasmBinding, Promise<ResidentWorkerPoolEntry>>();
  #clock = 0;
  #closed = false;
  #createdWorkers = 0;
  #evictedWorkers = 0;
  #queuedJobs = 0;
  #activeBindings = 0;

  constructor(options: Readonly<{
    workerFactory: ResidentWorkerFactory;
    maxWorkers?: number;
  }>) {
    if (typeof options.workerFactory !== "function") throw new TypeError("resident Worker pool requires a workerFactory");
    const maxWorkers = Math.floor(options.maxWorkers ?? 2);
    if (!Number.isSafeInteger(maxWorkers) || maxWorkers < 1 || maxWorkers > 16) {
      throw new RangeError("resident Worker pool maxWorkers must be an integer in 1...16");
    }
    this.workerFactory = options.workerFactory;
    this.maxWorkers = maxWorkers;
  }

  async #createEntry(binding: ResidentWasmBinding): Promise<ResidentWorkerPoolEntry> {
    const worker = await this.workerFactory(binding);
    this.#createdWorkers += 1;
    return {
      binding,
      executor: new ResidentSharedWorkerExecutor(binding, worker),
      tail: Promise.resolve(),
      pending: 0,
      lastUsed: ++this.#clock,
      idle: Promise.resolve(),
    };
  }

  #reserve(entry: ResidentWorkerPoolEntry): ResidentWorkerPoolEntry {
    if (entry.pending === 0) {
      entry.idle = new Promise<void>(resolve => { entry.resolveIdle = resolve; });
      this.#activeBindings += 1;
    }
    entry.pending += 1;
    this.#queuedJobs += 1;
    entry.lastUsed = ++this.#clock;
    return entry;
  }

  #release(entry: ResidentWorkerPoolEntry): void {
    entry.pending = Math.max(0, entry.pending - 1);
    this.#queuedJobs = Math.max(0, this.#queuedJobs - 1);
    entry.lastUsed = ++this.#clock;
    if (entry.pending === 0) {
      this.#activeBindings = Math.max(0, this.#activeBindings - 1);
      entry.resolveIdle?.();
      entry.resolveIdle = undefined;
    }
  }

  async #acquire(binding: ResidentWasmBinding): Promise<ResidentWorkerPoolEntry> {
    if (this.#closed) throw new Error("resident shared Worker pool is closed");
    while (true) {
      const existing = this.#entries.get(binding);
      if (existing) return this.#reserve(await existing);

      if (this.#entries.size < this.maxWorkers) {
        const pending = this.#createEntry(binding);
        this.#entries.set(binding, pending);
        try {
          return this.#reserve(await pending);
        } catch (error) {
          if (this.#entries.get(binding) === pending) this.#entries.delete(binding);
          throw error;
        }
      }

      const entries = await Promise.all(this.#entries.values());
      const idle = entries.filter(entry => entry.pending === 0).sort((left, right) => left.lastUsed - right.lastUsed)[0];
      if (idle) {
        const current = this.#entries.get(idle.binding);
        if (current && await current === idle) this.#entries.delete(idle.binding);
        await idle.executor.close();
        this.#evictedWorkers += 1;
        continue;
      }
      await Promise.race(entries.map(entry => entry.idle));
    }
  }

  async execute(
    binding: ResidentWasmBinding,
    options: ResidentWasmExecutionOptions = {},
  ): Promise<ResidentWorkerExecutionMetrics> {
    const entry = await this.#acquire(binding);
    const run = entry.tail.then(() => entry.executor.execute(options));
    entry.tail = run.then(() => undefined, () => undefined);
    try {
      return await run;
    } finally {
      this.#release(entry);
    }
  }

  snapshot(): ResidentSharedWorkerPoolSnapshot {
    return Object.freeze({
      size: this.#entries.size,
      maxWorkers: this.maxWorkers,
      queuedJobs: this.#queuedJobs,
      activeBindings: this.#activeBindings,
      createdWorkers: this.#createdWorkers,
      evictedWorkers: this.#evictedWorkers,
    });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    const entries = await Promise.all(this.#entries.values());
    this.#entries.clear();
    await Promise.all(entries.map(async entry => {
      await entry.tail;
      await entry.executor.close();
    }));
  }
}

export interface ResidentWorkerPromotionSnapshot {
  readonly decision: "benchmarking" | "worker" | "packed-js";
  readonly reason: ResidentNativeDecisionReason;
  readonly baseline: ExecutionAggregate | null;
  readonly candidate: ExecutionAggregate | null;
  readonly measuredRatio: number | null;
  readonly framePressure: number;
  readonly frameSamples: number;
  readonly executions: number;
  readonly transferBytes: 0;
  readonly materializationBytes: 0;
  readonly readbackBytes: 0;
  readonly synchronizationBytes: number;
}

/** Worker promotion requires both a measured win and live main-thread pressure. */
export class ResidentSharedWorkerPromotion {
  readonly executor: ResidentSharedWorkerExecutor;
  readonly packedJs: () => void;
  readonly frameBudget: FrameBudgetSignal;
  readonly telemetry: ExecutionTelemetry;
  readonly minimumSamples: number;
  readonly minimumMargin: number;
  readonly experimental: boolean;
  #decision: "benchmarking" | "worker" | "packed-js" = "benchmarking";
  #reason: ResidentNativeDecisionReason = "worker-frame-pressure-required";
  #executions = 0;
  #synchronizationBytes = 0;

  constructor(options: Readonly<{
    executor: ResidentSharedWorkerExecutor;
    packedJs: () => void;
    frameBudget: FrameBudgetSignal;
    telemetry?: ExecutionTelemetry;
    minimumSamples?: number;
    minimumMargin?: number;
    /** Explicit opt-in; omitted means this experimental backend is disabled. */
    experimental?: boolean;
  }>) {
    if (typeof options.packedJs !== "function") throw new TypeError("packed-js-baseline-required");
    this.executor = options.executor;
    this.packedJs = options.packedJs;
    this.frameBudget = options.frameBudget;
    this.telemetry = options.telemetry ?? new ExecutionTelemetry();
    this.minimumSamples = Math.max(1, Math.floor(options.minimumSamples ?? 5));
    this.minimumMargin = Math.min(0.9, Math.max(0, options.minimumMargin ?? 0.10));
    this.experimental = options.experimental === true;
    if (!this.experimental) this.#reason = "experimental-disabled";
  }

  async execute(options: ResidentWasmExecutionOptions = {}): Promise<"packed-js" | "shared-worker-wasm"> {
    this.#executions += 1;
    if (!this.experimental) return this.#runPackedJs(options);
    const frame = this.frameBudget.snapshot();
    if (frame.samples === 0 || frame.pressure < 1) {
      this.#reason = "worker-frame-pressure-required";
      return this.#runPackedJs(options);
    }
    if (this.#decision === "worker") return this.#runWorker(options);
    if (this.#decision === "packed-js") return this.#runPackedJs(options);
    const baseline = this.telemetry.recentPackedJsBaseline();
    const candidate = this.telemetry.recentAggregate("shared-worker-wasm");
    const backend = !baseline || (candidate !== null && baseline.samples <= candidate.samples)
      ? this.#runPackedJs(options)
      : await this.#runWorker(options);
    this.#updateDecision();
    return backend;
  }

  #runPackedJs(options: ResidentWasmExecutionOptions): "packed-js" {
    const started = now();
    this.packedJs();
    const elapsed = now() - started;
    markResidentWasmRanges(this.executor.binding, options.ranges);
    this.telemetry.record({ backend: "packed-js", computeMs: elapsed, totalMs: elapsed });
    return "packed-js";
  }

  async #runWorker(options: ResidentWasmExecutionOptions): Promise<"shared-worker-wasm"> {
    const metrics = await this.executor.execute(options);
    this.#synchronizationBytes += metrics.synchronizationBytes;
    this.telemetry.record(metrics);
    return "shared-worker-wasm";
  }

  #updateDecision(): void {
    const baseline = this.telemetry.recentPackedJsBaseline();
    const candidate = this.telemetry.recentAggregate("shared-worker-wasm");
    if (!baseline || !candidate || baseline.samples < this.minimumSamples || candidate.samples < this.minimumSamples) {
      this.#reason = "insufficient-measured-samples";
      return;
    }
    const comparison = this.telemetry.compareRecentWithPackedJs("shared-worker-wasm");
    if (comparison.wins && (comparison.ratio ?? Number.POSITIVE_INFINITY) <= 1 - this.minimumMargin) {
      this.#decision = "worker";
      this.#reason = "measured-win";
    } else {
      this.#decision = "packed-js";
      this.#reason = "no-measured-win";
    }
  }

  snapshot(): ResidentWorkerPromotionSnapshot {
    const frame = this.frameBudget.snapshot();
    const comparison = this.telemetry.compareRecentWithPackedJs("shared-worker-wasm");
    return Object.freeze({
      decision: this.#decision,
      reason: this.#reason,
      baseline: this.telemetry.recentPackedJsBaseline(),
      candidate: this.telemetry.recentAggregate("shared-worker-wasm"),
      measuredRatio: comparison.ratio,
      framePressure: frame.pressure,
      frameSamples: frame.samples,
      executions: this.#executions,
      transferBytes: 0,
      materializationBytes: 0,
      readbackBytes: 0,
      synchronizationBytes: this.#synchronizationBytes,
    });
  }
}

export const residentWorkerControlSlots = Object.freeze({
  requestSequence: CONTROL_REQUEST_SEQUENCE,
  doneSequence: CONTROL_DONE_SEQUENCE,
  status: CONTROL_STATUS,
  stop: CONTROL_STOP,
  rangeCount: CONTROL_RANGE_COUNT,
  errorCode: CONTROL_ERROR_CODE,
  computeMicros: CONTROL_COMPUTE_MICROS,
  wasmCalls: CONTROL_WASM_CALLS,
});
