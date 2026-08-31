import {
  BackendCapability,
  ExecutionRegion,
  ExecutionTelemetry,
  ResidentBuffer,
  type BufferLayout,
  type ExecutionAggregate,
  type WasmResidentBuffer,
} from "./index.js";

export const enum ResidentWasmOpcode {
  End = 0,
  Kernel = 1,
  ConstF32 = 2,
  LoadColumn = 3,
  Index = 4,
  Capture = 5,
  Positive = 6,
  Negative = 7,
  Not = 8,
  Add = 9,
  Subtract = 10,
  Multiply = 11,
  Divide = 12,
  LessThan = 13,
  LessEqual = 14,
  GreaterThan = 15,
  GreaterEqual = 16,
  Equal = 17,
  NotEqual = 18,
  And = 19,
  Or = 20,
  Select = 21,
  StoreTemp = 22,
  Commit = 23,
}

export type ResidentWasmVariant = "simd" | "scalar";

export type ResidentNativeRejectionReason =
  | "single-use-region"
  | "object-materialization"
  | "readback-required"
  | "storage-not-wasm-resident"
  | "storage-not-authoritative"
  | "storage-epoch-changed"
  | "layout-not-dense-f32"
  | "wasm-unavailable"
  | "packed-js-baseline-required"
  | "insufficient-measured-samples"
  | "no-measured-win"
  | "worker-frame-pressure-required"
  | "shared-memory-unavailable"
  | "worker-control-payload-invalid"
  | "experimental-disabled";

export type ResidentNativeDecisionReason = ResidentNativeRejectionReason
  | "measured-win"
  | "predicted-win"
  | "learned-win"
  | "crossover-calibration";

export interface ResidentWasmCostProfile {
  readonly loadOpsPerItem: number;
  readonly storeOpsPerItem: number;
  readonly scalarValueOpsPerItem: number;
  readonly arithmeticOpsPerItem: number;
  readonly divisionOpsPerItem: number;
  readonly comparisonOpsPerItem: number;
  readonly selectOpsPerItem: number;
  readonly weightedOpsPerItem: number;
  readonly simdSuitability: number;
  readonly branchPressure: number;
}

export interface ResidentWasmProgram {
  readonly version: 1;
  readonly regionId: string;
  readonly words: Uint32Array;
  readonly fieldNames: readonly string[];
  readonly captureNames: readonly string[];
  readonly operationCount: number;
  readonly maxStackDepth: number;
  readonly costProfile?: ResidentWasmCostProfile;
  readonly directModuleBytes?: Uint8Array;
  readonly directEntrypoint?: "resident_execute_direct";
  readonly directSimdModuleBytes?: Uint8Array;
  readonly directSimdEntrypoint?: "resident_execute_direct_simd";
  readonly directSharedSimdModuleBytes?: Uint8Array;
  readonly directSharedSimdEntrypoint?: "resident_execute_direct_simd";
}

export type ResidentWasmBackend = "wasm-aot-simd" | "wasm-aot-scalar" | "wasm-simd" | "wasm-scalar";

type ResidentDirectWasmExecute = (
  columnPointersPointer: number,
  rangesPointer: number,
  rangeCount: number,
  capturesPointer: number,
) => number;

interface ResidentWasmExports extends WebAssembly.Exports {
  resident_alloc(bytes: number, alignment: number): number;
  resident_reset_allocator(): void;
  resident_simd_enabled(): number;
  resident_execute(
    programPointer: number,
    programWords: number,
    columnPointersPointer: number,
    columnCount: number,
    rangesPointer: number,
    rangeCount: number,
    capturesPointer: number,
    captureCount: number,
  ): number;
}

export interface ResidentWasmRuntime {
  readonly memory: WebAssembly.Memory;
  readonly instance: WebAssembly.Instance;
  readonly exports: ResidentWasmExports;
  readonly variant: ResidentWasmVariant;
  readonly shared: boolean;
  readonly fixedByteLength: number;
  readonly sealed: boolean;
  allocate(bytes: number, alignment?: number): number;
  seal(): void;
}

export interface ResidentWasmBinding {
  readonly runtime: ResidentWasmRuntime;
  readonly program: ResidentWasmProgram;
  readonly buffer: WasmResidentBuffer;
  readonly length: number;
  readonly programPointer: number;
  readonly columnPointersPointer: number;
  readonly columnPointers: Uint32Array;
  readonly rangesPointer: number;
  readonly ranges: Uint32Array;
  readonly capturesPointer: number;
  readonly captures: Float32Array;
  readonly controlPointer: number;
  readonly control: Int32Array;
  /** Region-specialized direct executor. Shared-memory Workers keep the generic ABI. */
  readonly directExecute?: ResidentDirectWasmExecute;
  readonly directBackend?: Extract<ResidentWasmBackend, "wasm-aot-simd" | "wasm-aot-scalar">;
  readonly boundStorageEpoch: number;
  readonly boundMemoryBuffer: ArrayBufferLike;
}

export interface ResidentWasmExecutionMetrics {
  readonly backend: ResidentWasmBackend;
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
  readonly storageEpoch: number;
  readonly contentVersion: number;
}

export interface ResidentWasmExecutionOptions {
  readonly ranges?: readonly Readonly<{ start: number; end: number }>[];
  readonly captures?: Float32Array;
}

export type ResidentAdaptiveBackendChoice = "packed-js" | "wasm" | "calibrate";

export interface ResidentAdaptiveSchedulerSnapshot {
  readonly choice: ResidentAdaptiveBackendChoice;
  readonly activeRows: number;
  readonly weightedWork: number;
  readonly predictedJsMs: number | null;
  readonly predictedWasmMs: number | null;
  readonly jsSamples: number;
  readonly wasmSamples: number;
}

interface ResidentCostSample {
  readonly work: number;
  readonly totalMs: number;
}

function activeResidentRows(binding: ResidentWasmBinding, ranges: ResidentWasmExecutionOptions["ranges"]): number {
  if (!ranges || ranges.length === 0) return binding.length;
  let rows = 0;
  for (const range of ranges) rows += Math.max(0, range.end - range.start);
  return rows;
}

function linearCostModel(samples: readonly ResidentCostSample[]): Readonly<{ fixed: number; perWork: number }> | null {
  if (samples.length < 2) return null;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  for (const sample of samples) {
    sumX += sample.work;
    sumY += sample.totalMs;
    sumXX += sample.work * sample.work;
    sumXY += sample.work * sample.totalMs;
  }
  const count = samples.length;
  const denominator = count * sumXX - sumX * sumX;
  if (Math.abs(denominator) < Number.EPSILON) return null;
  const perWork = Math.max(0, (count * sumXY - sumX * sumY) / denominator);
  const fixed = Math.max(0, (sumY - perWork * sumX) / count);
  return Object.freeze({ fixed, perWork });
}

/**
 * Predict JS vs AOT SIMD from compiler-known kernel cost and the actual dirty
 * row count. Only the uncertain crossover band is benchmarked. Measured
 * samples continuously replace the conservative bootstrap thresholds with a
 * per-region linear cost model.
 */
export class ResidentAdaptiveNativeScheduler {
  readonly lowWorkThreshold: number;
  readonly highWorkThreshold: number;
  readonly minimumPredictionMargin: number;
  readonly sampleCapacity: number;
  #jsSamples: ResidentCostSample[] = [];
  #wasmSamples: ResidentCostSample[] = [];
  #last: ResidentAdaptiveSchedulerSnapshot = Object.freeze({
    choice: "calibrate",
    activeRows: 0,
    weightedWork: 0,
    predictedJsMs: null,
    predictedWasmMs: null,
    jsSamples: 0,
    wasmSamples: 0,
  });

  constructor(options: Readonly<{
    lowWorkThreshold?: number;
    highWorkThreshold?: number;
    minimumPredictionMargin?: number;
    sampleCapacity?: number;
  }> = {}) {
    this.lowWorkThreshold = Math.max(1, Number(options.lowWorkThreshold ?? 4_000));
    this.highWorkThreshold = Math.max(this.lowWorkThreshold + 1, Number(options.highWorkThreshold ?? 12_000));
    this.minimumPredictionMargin = Math.min(0.5, Math.max(0, Number(options.minimumPredictionMargin ?? 0.08)));
    this.sampleCapacity = Math.max(4, Math.floor(options.sampleCapacity ?? 24));
  }

  work(binding: ResidentWasmBinding, options: ResidentWasmExecutionOptions = {}): Readonly<{ activeRows: number; weightedWork: number }> {
    const activeRows = activeResidentRows(binding, options.ranges);
    const profile = binding.program.costProfile;
    const weightedOps = Math.max(1, profile?.weightedOpsPerItem ?? binding.program.operationCount);
    const suitability = Math.max(0.25, profile?.simdSuitability ?? (binding.directBackend === "wasm-aot-simd" ? 1 : 0.5));
    const branchPenalty = 1 + (profile?.branchPressure ?? 0) * 0.35;
    return Object.freeze({
      activeRows,
      weightedWork: activeRows * weightedOps * branchPenalty / suitability,
    });
  }

  choose(binding: ResidentWasmBinding, options: ResidentWasmExecutionOptions = {}): ResidentAdaptiveBackendChoice {
    const { activeRows, weightedWork } = this.work(binding, options);
    const jsModel = linearCostModel(this.#jsSamples);
    const wasmModel = linearCostModel(this.#wasmSamples);
    let predictedJsMs: number | null = null;
    let predictedWasmMs: number | null = null;
    let choice: ResidentAdaptiveBackendChoice;

    if (jsModel && wasmModel) {
      predictedJsMs = jsModel.fixed + jsModel.perWork * weightedWork;
      predictedWasmMs = wasmModel.fixed + wasmModel.perWork * weightedWork;
      const smaller = Math.min(predictedJsMs, predictedWasmMs);
      const margin = smaller <= 0 ? 0 : Math.abs(predictedJsMs - predictedWasmMs) / smaller;
      choice = margin < this.minimumPredictionMargin
        ? "calibrate"
        : predictedWasmMs < predictedJsMs ? "wasm" : "packed-js";
    } else if (binding.directBackend !== "wasm-aot-simd") {
      choice = "calibrate";
    } else if (weightedWork <= this.lowWorkThreshold) {
      choice = "packed-js";
    } else if (weightedWork >= this.highWorkThreshold) {
      choice = "wasm";
    } else {
      choice = "calibrate";
    }

    this.#last = Object.freeze({
      choice,
      activeRows,
      weightedWork,
      predictedJsMs,
      predictedWasmMs,
      jsSamples: this.#jsSamples.length,
      wasmSamples: this.#wasmSamples.length,
    });
    return choice;
  }

  record(backend: "packed-js" | "wasm", binding: ResidentWasmBinding, options: ResidentWasmExecutionOptions, totalMs: number): void {
    const { weightedWork } = this.work(binding, options);
    const target = backend === "packed-js" ? this.#jsSamples : this.#wasmSamples;
    target.push(Object.freeze({ work: weightedWork, totalMs }));
    if (target.length > this.sampleCapacity) target.splice(0, target.length - this.sampleCapacity);
  }

  snapshot(): ResidentAdaptiveSchedulerSnapshot {
    return this.#last;
  }
}

const ERROR_MESSAGES: Readonly<Record<number, string>> = Object.freeze({
  1: "program ended without an End opcode",
  2: "nested or malformed kernel group",
  3: "kernel output count exceeds the resident ABI",
  4: "operand stack underflow or overflow",
  5: "column index is outside the bound layout",
  6: "capture index is outside the bound capture table",
  7: "program contains an unsupported opcode",
  8: "kernel output commit is malformed",
  9: "resident pointer table is invalid",
  10: "resident dirty range is invalid",
});

function now(): number {
  const clock = (globalThis as { performance?: { now(): number } }).performance;
  return clock?.now() ?? Date.now();
}

function asBytes(bytes: Uint8Array | ArrayBuffer): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

function isSharedMemory(memory: WebAssembly.Memory): boolean {
  return typeof SharedArrayBuffer !== "undefined" && memory.buffer instanceof SharedArrayBuffer;
}

function pagesFor(byteLength: number): number {
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0) throw new RangeError("resident WASM byteLength must be positive");
  return Math.max(2, Math.ceil(byteLength / 65536));
}

/** A fixed-size memory cannot detach resident views through `memory.grow()`. */
export function createResidentWasmMemory(byteLength: number, shared = false): WebAssembly.Memory {
  const pages = pagesFor(byteLength);
  if (shared && typeof SharedArrayBuffer === "undefined") throw new Error("SharedArrayBuffer is unavailable");
  return new WebAssembly.Memory({ initial: pages, maximum: pages, ...(shared ? { shared: true } : {}) });
}

async function instantiateVariant(
  bytes: Uint8Array | ArrayBuffer,
  memory: WebAssembly.Memory,
): Promise<WebAssembly.Instance> {
  const result = await WebAssembly.instantiate(asBytes(bytes), { env: { memory } }) as
    | WebAssembly.Instance
    | WebAssembly.WebAssemblyInstantiatedSource;
  return "instance" in result ? result.instance : result;
}

/**
 * Instantiate SIMD when the engine validates it, otherwise use the checked-in
 * scalar module. Both variants import the caller's already-resident memory.
 */
export async function instantiateResidentWasmRuntime(options: Readonly<{
  memory: WebAssembly.Memory;
  simdBytes: Uint8Array | ArrayBuffer;
  scalarBytes: Uint8Array | ArrayBuffer;
  preferSimd?: boolean;
}>): Promise<ResidentWasmRuntime> {
  const shared = isSharedMemory(options.memory);
  let instance: WebAssembly.Instance | undefined;
  let variant: ResidentWasmVariant = "scalar";
  if (options.preferSimd !== false) {
    try {
      instance = await instantiateVariant(options.simdBytes, options.memory);
      variant = "simd";
    } catch {
      // Scalar remains the required correctness fallback.
    }
  }
  instance ??= await instantiateVariant(options.scalarBytes, options.memory);
  const exports = instance.exports as ResidentWasmExports;
  if (typeof exports.resident_execute !== "function" || typeof exports.resident_alloc !== "function") {
    throw new TypeError("resident WASM module does not implement the execution ABI");
  }
  if ((exports.resident_simd_enabled() === 1) !== (variant === "simd")) {
    throw new TypeError("resident WASM module variant does not match its capability export");
  }
  let sealed = false;
  const runtime: ResidentWasmRuntime = {
    memory: options.memory,
    instance,
    exports,
    variant,
    shared,
    fixedByteLength: options.memory.buffer.byteLength,
    get sealed() { return sealed; },
    allocate(bytes, alignment = 16) {
      if (sealed) throw new Error("resident WASM memory is sealed; create a new region instead of rebinding it");
      if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new RangeError("resident allocation must be positive");
      const pointer = exports.resident_alloc(bytes, alignment);
      if (pointer === 0) throw new RangeError(`resident WASM memory capacity exceeded while allocating ${bytes} bytes`);
      return pointer;
    },
    seal() { sealed = true; },
  };
  return runtime;
}

export type ResidentWasmAssetReader = (url: string) => Promise<Uint8Array | ArrayBuffer>;

export async function defaultResidentWasmAssetReader(url: string): Promise<Uint8Array | ArrayBuffer> {
  const URLConstructor = (globalThis as unknown as {
    URL: new (input: string, base?: string) => { readonly protocol: string; readonly href: string };
  }).URL;
  const parsed = new URLConstructor(url);
  if (parsed.protocol === "file:") {
    const moduleName = "node:fs/promises";
    const fileSystem = await import(moduleName) as { readFile(path: unknown): Promise<Uint8Array> };
    return fileSystem.readFile(parsed);
  }
  const fetchFunction = (globalThis as unknown as {
    fetch?: (input: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;
  }).fetch;
  if (!fetchFunction) throw new Error(`No resident WASM asset reader is available for ${parsed.href}`);
  const response = await fetchFunction(parsed.href);
  if (!response.ok) throw new Error(`Failed to load resident WASM (${response.status}): ${parsed.href}`);
  return response.arrayBuffer();
}

/** Load the copied package assets without making every consumer inject bytes. */
export async function loadDefaultResidentWasmRuntime(options: Readonly<{
  memory: WebAssembly.Memory;
  preferSimd?: boolean;
  assetReader?: ResidentWasmAssetReader;
}>): Promise<ResidentWasmRuntime> {
  const URLConstructor = (globalThis as unknown as {
    URL: new (input: string, base?: string) => { readonly href: string };
  }).URL;
  const shared = isSharedMemory(options.memory);
  const prefix = shared ? "resident-kernel-shared-" : "resident-kernel-";
  const assetReader = options.assetReader ?? defaultResidentWasmAssetReader;
  const simdUrl = new URLConstructor(`./wasm/${prefix}simd.wasm`, import.meta.url).href;
  const scalarUrl = new URLConstructor(`./wasm/${prefix}scalar.wasm`, import.meta.url).href;
  const [simdBytes, scalarBytes] = await Promise.all([assetReader(simdUrl), assetReader(scalarUrl)]);
  return instantiateResidentWasmRuntime({
    memory: options.memory,
    simdBytes,
    scalarBytes,
    preferSimd: options.preferSimd,
  });
}

function assertDenseF32Layout(layout: BufferLayout): number {
  if (layout.fields.length === 0 || layout.fields.length > 64) throw new TypeError("resident WASM supports 1 through 64 columns");
  const length = layout.fields[0]!.length;
  for (const field of layout.fields) {
    if (field.type !== "f32" || field.byteStride !== 4 || field.length !== length) {
      throw new TypeError("resident WASM requires equal-length dense f32 columns");
    }
  }
  return length;
}

function instantiateDirectResidentExecutor(
  bytes: Uint8Array,
  entrypoint: string,
  memory: WebAssembly.Memory,
): ResidentDirectWasmExecute | undefined {
  try {
    const directBytes = bytes.buffer instanceof ArrayBuffer
      ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      : Uint8Array.from(bytes);
    const module = new WebAssembly.Module(directBytes as BufferSource);
    const instance = new WebAssembly.Instance(module, { env: { memory } });
    const candidate = instance.exports[entrypoint];
    return typeof candidate === "function" ? candidate as ResidentDirectWasmExecute : undefined;
  } catch {
    return undefined;
  }
}

/** Allocate the authoritative columns and all fixed ABI metadata in one memory. */
export function bindResidentWasmRegion(
  runtime: ResidentWasmRuntime,
  layout: BufferLayout,
  program: ResidentWasmProgram,
  options: Readonly<{ maxRanges?: number }> = {},
): ResidentWasmBinding {
  if (runtime.sealed) throw new Error("resident WASM runtime is already bound");
  const length = assertDenseF32Layout(layout);
  if (program.fieldNames.length !== layout.fields.length
    || program.fieldNames.some((name, index) => layout.fields[index]?.name !== name)) {
    throw new TypeError("resident WASM program fields do not match the authoritative BufferLayout");
  }
  const maxRanges = options.maxRanges ?? 64;
  if (!Number.isSafeInteger(maxRanges) || maxRanges <= 0) throw new RangeError("maxRanges must be positive");

  const storagePointer = runtime.allocate(layout.byteLength, layout.alignment);
  const views = layout.fields.map(field => new Float32Array(runtime.memory.buffer, storagePointer + field.byteOffset, field.length));
  const columnPointersPointer = runtime.allocate(layout.fields.length * 4, 4);
  const columnPointers = new Uint32Array(runtime.memory.buffer, columnPointersPointer, layout.fields.length);
  layout.fields.forEach((field, index) => { columnPointers[index] = storagePointer + field.byteOffset; });
  const programPointer = runtime.allocate(program.words.byteLength, 4);
  new Uint32Array(runtime.memory.buffer, programPointer, program.words.length).set(program.words);
  const rangesPointer = runtime.allocate(maxRanges * 2 * 4, 4);
  const ranges = new Uint32Array(runtime.memory.buffer, rangesPointer, maxRanges * 2);
  const captureSlots = Math.max(1, program.captureNames.length);
  const capturesPointer = runtime.allocate(captureSlots * 4, 4);
  const captures = new Float32Array(runtime.memory.buffer, capturesPointer, captureSlots);
  const controlPointer = runtime.allocate(16 * 4, 4);
  const control = new Int32Array(runtime.memory.buffer, controlPointer, 16);
  const buffer = runtime.shared
    ? ResidentBuffer.sharedWasm(layout, runtime.memory, views)
    : ResidentBuffer.wasm(layout, runtime.memory, views);
  let directExecute: ResidentDirectWasmExecute | undefined;
  let directBackend: ResidentWasmBinding["directBackend"];
  if (!runtime.shared && runtime.variant === "simd"
    && program.directSimdModuleBytes && program.directSimdEntrypoint === "resident_execute_direct_simd") {
    directExecute = instantiateDirectResidentExecutor(program.directSimdModuleBytes, program.directSimdEntrypoint, runtime.memory);
    if (directExecute) directBackend = "wasm-aot-simd";
  }
  if (!runtime.shared && !directExecute && program.directModuleBytes && program.directEntrypoint === "resident_execute_direct") {
    directExecute = instantiateDirectResidentExecutor(program.directModuleBytes, program.directEntrypoint, runtime.memory);
    if (directExecute) directBackend = "wasm-aot-scalar";
  }
  runtime.seal();
  return Object.freeze({
    runtime,
    program,
    buffer,
    length,
    programPointer,
    columnPointersPointer,
    columnPointers,
    rangesPointer,
    ranges,
    capturesPointer,
    captures,
    controlPointer,
    control,
    ...(directExecute ? { directExecute } : {}),
    ...(directBackend ? { directBackend } : {}),
    boundStorageEpoch: buffer.storageEpoch,
    boundMemoryBuffer: runtime.memory.buffer,
  });
}

function validateBinding(binding: ResidentWasmBinding): void {
  if (binding.runtime.memory.buffer !== binding.boundMemoryBuffer) {
    throw new Error("storage-epoch-changed: WebAssembly.Memory grew after resident binding");
  }
  if (binding.buffer.storageEpoch !== binding.boundStorageEpoch) {
    throw new Error("storage-epoch-changed: ResidentBuffer views were rebound");
  }
}

export function prepareResidentWasmExecution(binding: ResidentWasmBinding, options: ResidentWasmExecutionOptions): Readonly<{
  rangeCount: number;
  synchronizationBytes: number;
  synchronizationMs: number;
}> {
  const started = now();
  const ranges = options.ranges ?? [{ start: 0, end: binding.length }];
  if (ranges.length * 2 > binding.ranges.length) throw new RangeError("resident execution exceeds the bound dirty-range capacity");
  ranges.forEach((range, index) => {
    if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end)
      || range.start < 0 || range.end < range.start || range.end > binding.length) {
      throw new RangeError("resident execution range is outside authoritative storage");
    }
    binding.ranges[index * 2] = range.start;
    binding.ranges[index * 2 + 1] = range.end;
  });
  const captures = options.captures;
  if (binding.program.captureNames.length > 0) {
    if (!(captures instanceof Float32Array) || captures.length !== binding.program.captureNames.length) {
      throw new TypeError("resident WASM captures must be a compiler-ordered Float32Array");
    }
    binding.captures.set(captures);
  } else if (captures && captures.length !== 0) {
    throw new TypeError("resident WASM program declares no captures");
  }
  return Object.freeze({
    rangeCount: ranges.length,
    synchronizationBytes: (ranges.length * 2 + binding.program.captureNames.length) * 4,
    synchronizationMs: now() - started,
  });
}

/** Convert logical row ranges to byte ranges for every resident SoA column. */
export function markResidentWasmRanges(
  binding: ResidentWasmBinding,
  ranges: readonly Readonly<{ start: number; end: number }>[] = [{ start: 0, end: binding.length }],
): number {
  const byteRanges: Array<{ start: number; end: number }> = [];
  for (const field of binding.buffer.layout.fields) {
    for (const range of ranges) {
      const start = field.byteOffset + range.start * field.byteStride;
      const end = range.start === range.end
        ? start
        : field.byteOffset + (range.end - 1) * field.byteStride + 4;
      byteRanges.push({ start, end });
    }
  }
  return binding.buffer.markWrittenRanges(byteRanges);
}

/** Execute one fused program call without packing rows or reconstructing objects. */
export function executeResidentWasm(
  binding: ResidentWasmBinding,
  options: ResidentWasmExecutionOptions = {},
): ResidentWasmExecutionMetrics {
  validateBinding(binding);
  const totalStarted = now();
  const metadata = prepareResidentWasmExecution(binding, options);
  const computeStarted = now();
  const result = binding.directExecute
    ? binding.directExecute(
      binding.columnPointersPointer,
      binding.rangesPointer,
      metadata.rangeCount,
      binding.capturesPointer,
    )
    : binding.runtime.exports.resident_execute(
      binding.programPointer,
      binding.program.words.length,
      binding.columnPointersPointer,
      binding.columnPointers.length,
      binding.rangesPointer,
      metadata.rangeCount,
      binding.capturesPointer,
      binding.program.captureNames.length,
    );
  const computeMs = now() - computeStarted;
  if (result !== 0) throw new Error(`resident WASM execution failed (${result}): ${ERROR_MESSAGES[result] ?? "unknown ABI error"}`);
  const contentVersion = markResidentWasmRanges(binding, options.ranges);
  return Object.freeze({
    backend: binding.directBackend ?? (binding.runtime.variant === "simd" ? "wasm-simd" : "wasm-scalar"),
    computeMs,
    transferBytes: 0,
    transferMs: 0,
    materializationBytes: 0,
    materializationMs: 0,
    readbackBytes: 0,
    readbackMs: 0,
    synchronizationBytes: metadata.synchronizationBytes,
    synchronizationMs: metadata.synchronizationMs,
    totalMs: now() - totalStarted,
    wasmCalls: 1,
    storageEpoch: binding.buffer.storageEpoch,
    contentVersion,
  });
}

export type ResidentWasmPromotionDecision = "benchmarking" | "wasm" | "packed-js" | "rejected";

export interface ResidentWasmPromotionSnapshot {
  readonly decision: ResidentWasmPromotionDecision;
  readonly reason: ResidentNativeDecisionReason;
  readonly variant: ResidentWasmVariant;
  readonly backend: ResidentWasmBackend;
  readonly baseline: ExecutionAggregate | null;
  readonly candidate: ExecutionAggregate | null;
  readonly measuredRatio: number | null;
  readonly executions: number;
  readonly scheduler: ResidentAdaptiveSchedulerSnapshot;
  readonly transferBytes: 0;
  readonly materializationBytes: 0;
  readonly readbackBytes: 0;
  readonly synchronizationBytes: number;
}

/**
 * Alternate the mandatory packed-JS and WASM executors over the same
 * authoritative TypedArrays, then cache promotion only after a measured win.
 */
export class ResidentWasmPromotion {
  readonly telemetry: ExecutionTelemetry;
  readonly binding: ResidentWasmBinding;
  readonly region: ExecutionRegion;
  readonly packedJs: () => void;
  readonly minimumSamples: number;
  readonly minimumMargin: number;
  readonly experimental: boolean;
  readonly scheduler: ResidentAdaptiveNativeScheduler;
  #decision: ResidentWasmPromotionDecision = "benchmarking";
  #reason: ResidentNativeDecisionReason = "insufficient-measured-samples";
  #executions = 0;
  #synchronizationBytes = 0;

  constructor(options: Readonly<{
    binding: ResidentWasmBinding;
    region: ExecutionRegion;
    packedJs: () => void;
    telemetry?: ExecutionTelemetry;
    minimumSamples?: number;
    minimumMargin?: number;
    scheduler?: ResidentAdaptiveNativeScheduler;
    /** Explicit opt-in; omitted means this experimental backend is disabled. */
    experimental?: boolean;
  }>) {
    if (typeof options.packedJs !== "function") throw new TypeError("packed-js-baseline-required");
    this.binding = options.binding;
    this.region = options.region;
    this.packedJs = options.packedJs;
    this.telemetry = options.telemetry ?? new ExecutionTelemetry();
    this.minimumSamples = Math.max(1, Math.floor(options.minimumSamples ?? 5));
    this.minimumMargin = Math.min(0.9, Math.max(0, options.minimumMargin ?? 0.10));
    this.scheduler = options.scheduler ?? new ResidentAdaptiveNativeScheduler();
    this.experimental = options.experimental === true;
    const rejection = this.#eligibilityRejection();
    if (rejection) {
      this.#decision = "rejected";
      this.#reason = rejection;
    }
  }

  #eligibilityRejection(): ResidentNativeRejectionReason | null {
    if (!this.experimental) return "experimental-disabled";
    if (this.region.lifetime === "single-use") return "single-use-region";
    if (!this.region.noMaterialization) return "object-materialization";
    if (!this.region.noReadback) return "readback-required";
    if (this.region.source !== this.binding.buffer || this.region.sink !== this.binding.buffer) return "storage-not-authoritative";
    const capability = new BackendCapability({
      backend: "wasm-simd",
      available: true,
      residentKinds: ["wasm", "shared-wasm"],
      supportsPersistentMemory: true,
      supportsSharedMemory: true,
      supportsGpuSink: false,
    });
    return capability.supports(this.region) ? null : "storage-not-wasm-resident";
  }

  execute(options: ResidentWasmExecutionOptions = {}): "packed-js" | ResidentWasmBackend {
    if (this.#decision === "rejected") throw new Error(`resident WASM promotion rejected: ${this.#reason}`);
    this.#executions += 1;
    const predicted = this.scheduler.choose(this.binding, options);
    if (predicted === "packed-js") {
      this.#decision = "packed-js";
      this.#reason = this.scheduler.snapshot().predictedJsMs === null ? "predicted-win" : "learned-win";
      return this.#runPackedJs(options);
    }
    if (predicted === "wasm") {
      this.#decision = "wasm";
      this.#reason = this.scheduler.snapshot().predictedWasmMs === null ? "predicted-win" : "learned-win";
      return this.#runWasm(options);
    }

    this.#decision = "benchmarking";
    this.#reason = "crossover-calibration";
    const baseline = this.telemetry.recentPackedJsBaseline();
    const wasmBackend = this.binding.directBackend ?? (this.binding.runtime.variant === "simd" ? "wasm-simd" : "wasm-scalar");
    const candidate = this.telemetry.recentAggregate(wasmBackend);
    const backend = !baseline || (candidate !== null && baseline.samples <= candidate.samples)
      ? this.#runPackedJs(options)
      : this.#runWasm(options);
    this.#updateDecision();
    return backend;
  }

  #runPackedJs(options: ResidentWasmExecutionOptions): "packed-js" {
    const started = now();
    this.packedJs();
    const elapsed = now() - started;
    markResidentWasmRanges(this.binding, options.ranges);
    this.telemetry.record({
      backend: "packed-js",
      computeMs: elapsed,
      transferBytes: 0,
      transferMs: 0,
      materializationMs: 0,
      readbackBytes: 0,
      readbackMs: 0,
      synchronizationMs: 0,
      totalMs: elapsed,
    });
    this.scheduler.record("packed-js", this.binding, options, elapsed);
    return "packed-js";
  }

  #runWasm(options: ResidentWasmExecutionOptions): ResidentWasmBackend {
    const metrics = executeResidentWasm(this.binding, options);
    this.#synchronizationBytes += metrics.synchronizationBytes;
    this.telemetry.record(metrics);
    this.scheduler.record("wasm", this.binding, options, metrics.totalMs);
    return metrics.backend;
  }

  #updateDecision(): void {
    const wasmBackend = this.binding.directBackend ?? (this.binding.runtime.variant === "simd" ? "wasm-simd" : "wasm-scalar");
    const baseline = this.telemetry.recentPackedJsBaseline();
    const candidate = this.telemetry.recentAggregate(wasmBackend);
    if (!baseline || !candidate || baseline.samples < this.minimumSamples || candidate.samples < this.minimumSamples) return;
    const comparison = this.telemetry.compareRecentWithPackedJs(wasmBackend);
    const measuredRatio = comparison.ratio ?? Number.POSITIVE_INFINITY;
    if (comparison.wins && measuredRatio <= 1 - this.minimumMargin) {
      this.#decision = "wasm";
      this.#reason = "measured-win";
    } else {
      this.#decision = "packed-js";
      this.#reason = "no-measured-win";
    }
  }

  snapshot(): ResidentWasmPromotionSnapshot {
    const wasmBackend = this.binding.directBackend ?? (this.binding.runtime.variant === "simd" ? "wasm-simd" : "wasm-scalar");
    const comparison = this.telemetry.compareRecentWithPackedJs(wasmBackend);
    return Object.freeze({
      decision: this.#decision,
      reason: this.#reason,
      variant: this.binding.runtime.variant,
      backend: wasmBackend,
      baseline: this.telemetry.recentPackedJsBaseline(),
      candidate: this.telemetry.recentAggregate(wasmBackend),
      measuredRatio: comparison.ratio,
      executions: this.#executions,
      scheduler: this.scheduler.snapshot(),
      transferBytes: 0,
      materializationBytes: 0,
      readbackBytes: 0,
      synchronizationBytes: this.#synchronizationBytes,
    });
  }
}
