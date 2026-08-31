export type BufferScalarType = "f32" | "f64" | "i32" | "u32" | "u8";

/** Explicit opt-in switches for the experimental Resident Compute backends. */
export interface ResidentComputeExperimentalOptions {
  readonly enabled?: boolean;
  readonly wasm?: boolean;
  readonly worker?: boolean;
  readonly gpu?: boolean;
}

export interface ResidentComputeExperimentalState {
  readonly enabled: boolean;
  readonly wasm: boolean;
  readonly worker: boolean;
  readonly gpu: boolean;
}

/** Resolve the public toggle. The default is deliberately completely disabled. */
export function resolveResidentComputeExperimental(
  options?: boolean | ResidentComputeExperimentalOptions | ResidentComputeExperimentalState,
): ResidentComputeExperimentalState {
  const value = typeof options === "boolean" ? { enabled: options } : (options ?? {});
  const enabled = value.enabled === true;
  return Object.freeze({
    enabled,
    wasm: enabled && value.wasm !== false,
    worker: enabled && value.worker !== false,
    gpu: enabled && value.gpu !== false,
  });
}

export function residentComputeExperimentalEnabled(
  options?: boolean | ResidentComputeExperimentalOptions | ResidentComputeExperimentalState,
): boolean {
  return resolveResidentComputeExperimental(options).enabled;
}

export interface BufferField {
  readonly name: string;
  readonly type: BufferScalarType;
  readonly byteOffset: number;
  readonly length: number;
  readonly byteStride: number;
}

export interface BufferLayout {
  readonly version: 1;
  readonly fields: readonly BufferField[];
  readonly byteLength: number;
  readonly alignment: number;
}

const SCALAR_BYTES: Readonly<Record<BufferScalarType, number>> = Object.freeze({
  f32: 4,
  f64: 8,
  i32: 4,
  u32: 4,
  u8: 1,
});

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

export function defineBufferLayout(
  fields: readonly Readonly<{ name: string; type: BufferScalarType; length: number; byteStride?: number; byteOffset?: number }>[],
  options: Readonly<{ alignment?: number }> = {},
): BufferLayout {
  if (fields.length === 0) throw new TypeError("BufferLayout requires at least one field");
  const alignment = positiveInteger(options.alignment ?? 16, "BufferLayout alignment");
  const names = new Set<string>();
  let cursor = 0;
  const normalized = fields.map((field, index): BufferField => {
    if (!/^[A-Za-z_$][\w$]*$/u.test(field.name) || names.has(field.name)) {
      throw new TypeError(`BufferLayout field ${index} has an invalid or duplicate name`);
    }
    names.add(field.name);
    const scalarBytes = SCALAR_BYTES[field.type];
    if (scalarBytes === undefined) throw new TypeError(`Unsupported BufferLayout scalar type: ${String(field.type)}`);
    const length = nonNegativeInteger(field.length, `BufferLayout field ${field.name} length`);
    const byteStride = positiveInteger(field.byteStride ?? scalarBytes, `BufferLayout field ${field.name} byteStride`);
    if (byteStride < scalarBytes) throw new RangeError(`BufferLayout field ${field.name} byteStride is smaller than its scalar`);
    const byteOffset = field.byteOffset === undefined
      ? align(cursor, Math.min(alignment, scalarBytes))
      : nonNegativeInteger(field.byteOffset, `BufferLayout field ${field.name} byteOffset`);
    if (byteOffset % scalarBytes !== 0) throw new RangeError(`BufferLayout field ${field.name} is not scalar-aligned`);
    const fieldEnd = byteOffset + (length === 0 ? 0 : ((length - 1) * byteStride) + scalarBytes);
    if (byteOffset < cursor && field.byteOffset === undefined) throw new RangeError(`BufferLayout field ${field.name} overlaps a previous field`);
    cursor = Math.max(cursor, fieldEnd);
    return Object.freeze({ name: field.name, type: field.type, byteOffset, length, byteStride });
  });
  return Object.freeze({
    version: 1 as const,
    fields: Object.freeze(normalized),
    byteLength: align(cursor, alignment),
    alignment,
  });
}

export type ResidentBufferKind = "js" | "wasm" | "shared-wasm" | "gpu";
export type CpuResidentBufferKind = Exclude<ResidentBufferKind, "gpu">;

export interface WasmMemory {
  readonly buffer: ArrayBuffer | SharedArrayBuffer;
  grow?(deltaPages: number): number;
}

export interface DirtyRange {
  readonly start: number;
  readonly end: number;
  readonly version: number;
}

export abstract class ResidentBuffer {
  readonly layout: BufferLayout;
  readonly byteLength: number;
  abstract readonly kind: ResidentBufferKind;
  #storageEpoch = 0;
  #contentVersion = 0;
  #dirtyRanges: DirtyRange[] = [];

  protected constructor(layout: BufferLayout, byteLength = layout.byteLength) {
    this.layout = layout;
    this.byteLength = nonNegativeInteger(byteLength, "ResidentBuffer byteLength");
    if (this.byteLength < layout.byteLength) throw new RangeError("ResidentBuffer is smaller than its BufferLayout");
  }

  get storageEpoch(): number {
    return this.#storageEpoch;
  }

  get contentVersion(): number {
    return this.#contentVersion;
  }

  get dirtyRanges(): readonly DirtyRange[] {
    return Object.freeze(this.#dirtyRanges.map(range => Object.freeze({ ...range })));
  }

  markWritten(start = 0, end = this.byteLength): number {
    return this.markWrittenRanges([{ start, end }]);
  }

  markWrittenRanges(ranges: readonly Readonly<{ start: number; end: number }>[]): number {
    for (const range of ranges) {
      nonNegativeInteger(range.start, "ResidentBuffer dirty range start");
      nonNegativeInteger(range.end, "ResidentBuffer dirty range end");
      if (range.start > range.end || range.end > this.byteLength) throw new RangeError("ResidentBuffer dirty range is outside storage");
    }
    this.#contentVersion += 1;
    const next = ranges
      .filter(range => range.start !== range.end)
      .map(range => ({ ...range, version: this.#contentVersion }));
    if (next.length > 0) {
      const merged: DirtyRange[] = [];
      for (const range of [...this.#dirtyRanges, ...next].sort((left, right) => left.start - right.start)) {
        const previous = merged.at(-1);
        if (previous && range.start <= previous.end) {
          merged[merged.length - 1] = {
            start: previous.start,
            end: Math.max(previous.end, range.end),
            version: Math.max(previous.version, range.version),
          };
        } else {
          merged.push({ ...range });
        }
      }
      this.#dirtyRanges = merged;
    }
    return this.#contentVersion;
  }

  consumeDirtyRanges(): readonly DirtyRange[] {
    const ranges = this.dirtyRanges;
    this.#dirtyRanges = [];
    return ranges;
  }

  protected markStorageRebound(): number {
    this.#storageEpoch += 1;
    this.markWritten();
    return this.#storageEpoch;
  }

  static js(layout: BufferLayout, views: readonly ArrayBufferView[]): CpuResidentBuffer {
    return new CpuResidentBuffer("js", layout, views);
  }

  static wasm(layout: BufferLayout, memory: WasmMemory, views: readonly ArrayBufferView[]): WasmResidentBuffer {
    return new WasmResidentBuffer("wasm", layout, memory, views);
  }

  static sharedWasm(layout: BufferLayout, memory: WasmMemory, views: readonly ArrayBufferView[]): WasmResidentBuffer {
    return new WasmResidentBuffer("shared-wasm", layout, memory, views);
  }

  static gpu(layout: BufferLayout, resource: unknown, byteLength = layout.byteLength): GpuResidentBuffer {
    return new GpuResidentBuffer(layout, resource, byteLength);
  }
}

function validateCpuViews(layout: BufferLayout, views: readonly ArrayBufferView[]): readonly ArrayBufferView[] {
  if (views.length !== layout.fields.length) {
    throw new TypeError(`ResidentBuffer expected ${layout.fields.length} CPU views, received ${views.length}`);
  }
  for (let index = 0; index < views.length; index += 1) {
    const view = views[index];
    const field = layout.fields[index];
    if (view.byteLength < field.length * SCALAR_BYTES[field.type]) {
      throw new RangeError(`ResidentBuffer view ${field.name} is smaller than its field`);
    }
  }
  return Object.freeze([...views]);
}

export class CpuResidentBuffer extends ResidentBuffer {
  readonly kind: CpuResidentBufferKind;
  #views: readonly ArrayBufferView[];

  constructor(kind: CpuResidentBufferKind, layout: BufferLayout, views: readonly ArrayBufferView[]) {
    const normalized = validateCpuViews(layout, views);
    super(layout, Math.max(layout.byteLength, ...normalized.map(view => view.byteLength)));
    this.kind = kind;
    this.#views = normalized;
  }

  get cpuViews(): readonly ArrayBufferView[] {
    return this.#views;
  }

  rebindCpuViews(views: readonly ArrayBufferView[]): number {
    this.#views = validateCpuViews(this.layout, views);
    return this.markStorageRebound();
  }
}

export class WasmResidentBuffer extends CpuResidentBuffer {
  #memory: WasmMemory;

  constructor(kind: "wasm" | "shared-wasm", layout: BufferLayout, memory: WasmMemory, views: readonly ArrayBufferView[]) {
    super(kind, layout, views);
    const shared = typeof SharedArrayBuffer !== "undefined" && memory.buffer instanceof SharedArrayBuffer;
    if ((kind === "shared-wasm") !== shared) {
      throw new TypeError(`${kind} requires ${kind === "shared-wasm" ? "shared" : "unshared"} WebAssembly.Memory`);
    }
    for (const view of views) {
      if (view.buffer !== memory.buffer) throw new TypeError(`${kind} CPU views must reference its WebAssembly.Memory`);
    }
    this.#memory = memory;
  }

  get memory(): WasmMemory {
    return this.#memory;
  }

  rebindMemory(memory: WasmMemory, views: readonly ArrayBufferView[]): number {
    const shared = typeof SharedArrayBuffer !== "undefined" && memory.buffer instanceof SharedArrayBuffer;
    if ((this.kind === "shared-wasm") !== shared) throw new TypeError("WebAssembly.Memory sharing mode changed");
    for (const view of views) {
      if (view.buffer !== memory.buffer) throw new TypeError("CPU views must reference the replacement WebAssembly.Memory");
    }
    this.#memory = memory;
    return this.rebindCpuViews(views);
  }
}

export class GpuResidentBuffer extends ResidentBuffer {
  readonly kind = "gpu" as const;
  #resource: unknown;

  constructor(layout: BufferLayout, resource: unknown, byteLength = layout.byteLength) {
    if (resource === null || resource === undefined) throw new TypeError("GpuResidentBuffer requires an opaque GPU resource");
    super(layout, byteLength);
    this.#resource = resource;
  }

  get resource(): unknown {
    return this.#resource;
  }

  rebindResource(resource: unknown): number {
    if (resource === null || resource === undefined) throw new TypeError("GpuResidentBuffer requires an opaque GPU resource");
    this.#resource = resource;
    return this.markStorageRebound();
  }
}

export type ExecutionRegionLifetime = "single-use" | "persistent" | "frame-persistent";

export type ExecutionEntrypoint<Context, Result> = (
  context: Context,
  region: ExecutionRegion<Context, Result, unknown>,
) => Result | PromiseLike<Result>;

export interface ExecutionRegionOptions<Context = unknown, Result = unknown, Metadata = unknown> {
  readonly id: string;
  readonly inputs: readonly ResidentBuffer[];
  readonly outputs: readonly ResidentBuffer[];
  readonly lifetime: ExecutionRegionLifetime;
  readonly noMaterialization: true;
  readonly noReadback: true;
  readonly entrypoints?: Readonly<Record<string, ExecutionEntrypoint<Context, Result>>>;
  readonly metadata?: Metadata;
}

export class ExecutionRegion<Context = unknown, Result = unknown, Metadata = unknown> {
  readonly id: string;
  readonly inputs: readonly ResidentBuffer[];
  readonly outputs: readonly ResidentBuffer[];
  readonly lifetime: ExecutionRegionLifetime;
  readonly noMaterialization = true as const;
  readonly noReadback = true as const;
  readonly entrypoints: Readonly<Record<string, ExecutionEntrypoint<Context, Result>>>;
  readonly metadata: Metadata | undefined;

  constructor(options: ExecutionRegionOptions<Context, Result, Metadata>) {
    if (!options.id.trim()) throw new TypeError("ExecutionRegion requires a non-empty id");
    if (options.inputs.length === 0 || options.outputs.length === 0) {
      throw new TypeError("ExecutionRegion requires resident inputs and outputs");
    }
    if (options.noMaterialization !== true) throw new TypeError("ExecutionRegion cannot materialize objects inside the region");
    if (options.noReadback !== true) throw new TypeError("ExecutionRegion cannot read GPU results back inside the region");
    this.id = options.id;
    this.inputs = Object.freeze([...options.inputs]);
    this.outputs = Object.freeze([...options.outputs]);
    this.lifetime = options.lifetime;
    this.entrypoints = Object.freeze({ ...(options.entrypoints ?? {}) });
    this.metadata = options.metadata;
  }

  get source(): ResidentBuffer {
    return this.inputs[0];
  }

  get sink(): ResidentBuffer {
    return this.outputs[0];
  }

  entrypoint(backend: ExecutionBackend): ExecutionEntrypoint<Context, Result> | undefined {
    return this.entrypoints[backend];
  }

  execute(backend: ExecutionBackend, context: Context): Result | PromiseLike<Result> {
    const entrypoint = this.entrypoint(backend);
    if (!entrypoint) throw new TypeError(`ExecutionRegion ${this.id} has no ${backend} entrypoint`);
    return entrypoint(context, this);
  }
}

export type ExecutionBackend = "packed-js" | "wasm-simd" | "shared-worker-wasm" | "webgpu" | (string & {});

export interface BackendCapabilityOptions {
  readonly backend: ExecutionBackend;
  readonly available: boolean;
  readonly residentKinds: readonly ResidentBufferKind[];
  readonly supportsPersistentMemory: boolean;
  readonly supportsSharedMemory: boolean;
  readonly supportsGpuSink: boolean;
  readonly supportsSimd?: boolean;
  readonly requiresCrossOriginIsolated?: boolean;
  readonly crossOriginIsolated?: boolean;
  readonly sharedMemoryAvailable?: boolean;
  readonly webgpuLimits?: Readonly<Record<string, number>>;
  readonly requiredWebgpuLimits?: Readonly<Record<string, number>>;
  readonly deviceState?: "ready" | "lost" | "unavailable";
  readonly deviceLossReason?: string;
  readonly reason?: string;
}

export class BackendCapability implements BackendCapabilityOptions {
  readonly backend: ExecutionBackend;
  readonly available: boolean;
  readonly residentKinds: readonly ResidentBufferKind[];
  readonly supportsPersistentMemory: boolean;
  readonly supportsSharedMemory: boolean;
  readonly supportsGpuSink: boolean;
  readonly supportsSimd: boolean;
  readonly requiresCrossOriginIsolated: boolean;
  readonly crossOriginIsolated: boolean;
  readonly sharedMemoryAvailable: boolean;
  readonly webgpuLimits: Readonly<Record<string, number>>;
  readonly requiredWebgpuLimits: Readonly<Record<string, number>>;
  readonly deviceState: "ready" | "lost" | "unavailable";
  readonly deviceLossReason: string | undefined;
  readonly reason: string | undefined;

  constructor(options: BackendCapabilityOptions) {
    if (!options.backend) throw new TypeError("BackendCapability requires a backend id");
    this.backend = options.backend;
    this.available = options.available;
    this.residentKinds = Object.freeze([...new Set(options.residentKinds)]);
    this.supportsPersistentMemory = options.supportsPersistentMemory;
    this.supportsSharedMemory = options.supportsSharedMemory;
    this.supportsGpuSink = options.supportsGpuSink;
    this.supportsSimd = options.supportsSimd ?? false;
    this.requiresCrossOriginIsolated = options.requiresCrossOriginIsolated ?? false;
    this.crossOriginIsolated = options.crossOriginIsolated ?? !this.requiresCrossOriginIsolated;
    this.sharedMemoryAvailable = options.sharedMemoryAvailable ?? options.supportsSharedMemory;
    this.webgpuLimits = Object.freeze({ ...(options.webgpuLimits ?? {}) });
    this.requiredWebgpuLimits = Object.freeze({ ...(options.requiredWebgpuLimits ?? {}) });
    this.deviceState = options.deviceState ?? (options.available ? "ready" : "unavailable");
    this.deviceLossReason = options.deviceLossReason;
    this.reason = options.reason;
  }

  rejectionReason(region: ExecutionRegion): string | null {
    if (!this.available) return this.reason ?? "backend-unavailable";
    if (this.deviceState !== "ready") return this.deviceLossReason ?? `device-${this.deviceState}`;
    const residentKinds = [...region.inputs, ...region.outputs].map(buffer => buffer.kind);
    if (residentKinds.some(kind => !this.residentKinds.includes(kind))) return "unsupported-resident-kind";
    if (region.lifetime !== "single-use" && !this.supportsPersistentMemory) return "persistent-memory-unsupported";
    if (residentKinds.includes("shared-wasm")) {
      if (!this.supportsSharedMemory || !this.sharedMemoryAvailable) return "shared-memory-unavailable";
      if (this.requiresCrossOriginIsolated && !this.crossOriginIsolated) return "cross-origin-isolation-required";
    }
    if (region.outputs.some(buffer => buffer.kind === "gpu") && !this.supportsGpuSink) return "gpu-sink-unsupported";
    for (const [limit, required] of Object.entries(this.requiredWebgpuLimits)) {
      if ((this.webgpuLimits[limit] ?? 0) < required) return `webgpu-limit-${limit}`;
    }
    return null;
  }

  supports(region: ExecutionRegion): boolean {
    return this.rejectionReason(region) === null;
  }
}

export interface ExecutionSample {
  readonly backend: ExecutionBackend;
  readonly computeMs: number;
  readonly transferBytes?: number;
  readonly transferMs?: number;
  readonly materializationBytes?: number;
  readonly materializationMs?: number;
  readonly readbackBytes?: number;
  readonly readbackMs?: number;
  readonly synchronizationBytes?: number;
  readonly synchronizationMs?: number;
  readonly totalMs?: number;
}

export interface ExecutionAggregate {
  readonly backend: ExecutionBackend;
  readonly samples: number;
  readonly computeMs: number;
  readonly transferBytes: number;
  readonly transferMs: number;
  readonly materializationBytes: number;
  readonly materializationMs: number;
  readonly readbackBytes: number;
  readonly readbackMs: number;
  readonly synchronizationBytes: number;
  readonly synchronizationMs: number;
  readonly totalMs: number;
}

type MutableAggregate = { -readonly [Key in keyof ExecutionAggregate]: ExecutionAggregate[Key] };

function finiteMetric(value: number | undefined, name: string): number {
  const normalized = value ?? 0;
  if (!Number.isFinite(normalized) || normalized < 0) throw new RangeError(`${name} must be a finite non-negative number`);
  return normalized;
}

export class ExecutionTelemetry {
  readonly baselineBackend = "packed-js" as const;
  #aggregates = new Map<ExecutionBackend, MutableAggregate>();
  #recent = new Map<ExecutionBackend, ExecutionSample[]>();
  readonly recentCapacity = 31;

  record(sample: ExecutionSample): ExecutionAggregate {
    const computeMs = finiteMetric(sample.computeMs, "computeMs");
    const transferBytes = finiteMetric(sample.transferBytes, "transferBytes");
    const transferMs = finiteMetric(sample.transferMs, "transferMs");
    const materializationBytes = finiteMetric(sample.materializationBytes, "materializationBytes");
    const materializationMs = finiteMetric(sample.materializationMs, "materializationMs");
    const readbackBytes = finiteMetric(sample.readbackBytes, "readbackBytes");
    const readbackMs = finiteMetric(sample.readbackMs, "readbackMs");
    const synchronizationBytes = finiteMetric(sample.synchronizationBytes, "synchronizationBytes");
    const synchronizationMs = finiteMetric(sample.synchronizationMs, "synchronizationMs");
    const measuredTotal = computeMs + transferMs + materializationMs + readbackMs + synchronizationMs;
    const totalMs = sample.totalMs === undefined ? measuredTotal : finiteMetric(sample.totalMs, "totalMs");
    if (totalMs + Number.EPSILON < measuredTotal) throw new RangeError("totalMs cannot be smaller than its measured components");
    const aggregate = this.#aggregates.get(sample.backend) ?? {
      backend: sample.backend,
      samples: 0,
      computeMs: 0,
      transferBytes: 0,
      transferMs: 0,
      materializationBytes: 0,
      materializationMs: 0,
      readbackBytes: 0,
      readbackMs: 0,
      synchronizationBytes: 0,
      synchronizationMs: 0,
      totalMs: 0,
    };
    aggregate.samples += 1;
    aggregate.computeMs += computeMs;
    aggregate.transferBytes += transferBytes;
    aggregate.transferMs += transferMs;
    aggregate.materializationBytes += materializationBytes;
    aggregate.materializationMs += materializationMs;
    aggregate.readbackBytes += readbackBytes;
    aggregate.readbackMs += readbackMs;
    aggregate.synchronizationBytes += synchronizationBytes;
    aggregate.synchronizationMs += synchronizationMs;
    aggregate.totalMs += totalMs;
    this.#aggregates.set(sample.backend, aggregate);
    const recent = this.#recent.get(sample.backend) ?? [];
    recent.push(Object.freeze({
      ...sample,
      computeMs,
      transferBytes,
      transferMs,
      materializationBytes,
      materializationMs,
      readbackBytes,
      readbackMs,
      synchronizationBytes,
      synchronizationMs,
      totalMs,
    }));
    if (recent.length > this.recentCapacity) recent.splice(0, recent.length - this.recentCapacity);
    this.#recent.set(sample.backend, recent);
    return this.aggregate(sample.backend) as ExecutionAggregate;
  }

  aggregate(backend: ExecutionBackend): ExecutionAggregate | null {
    const aggregate = this.#aggregates.get(backend);
    if (!aggregate) return null;
    const divisor = aggregate.samples;
    return Object.freeze({
      backend,
      samples: divisor,
      computeMs: aggregate.computeMs / divisor,
      transferBytes: aggregate.transferBytes / divisor,
      transferMs: aggregate.transferMs / divisor,
      materializationBytes: aggregate.materializationBytes / divisor,
      materializationMs: aggregate.materializationMs / divisor,
      readbackBytes: aggregate.readbackBytes / divisor,
      readbackMs: aggregate.readbackMs / divisor,
      synchronizationBytes: aggregate.synchronizationBytes / divisor,
      synchronizationMs: aggregate.synchronizationMs / divisor,
      totalMs: aggregate.totalMs / divisor,
    });
  }

  packedJsBaseline(): ExecutionAggregate | null {
    return this.aggregate(this.baselineBackend);
  }

  /**
   * Median of the most recent measurements. Promotion decisions use this
   * instead of lifetime means so one cold compile/GC pause cannot permanently
   * bias a region and later workload changes can be observed.
   */
  recentAggregate(backend: ExecutionBackend, windowSize = 9): ExecutionAggregate | null {
    const source = this.#recent.get(backend);
    if (!source || source.length === 0) return null;
    const size = Math.max(1, Math.min(source.length, Math.floor(windowSize)));
    const samples = source.slice(-size);
    const median = (key: keyof ExecutionSample): number => {
      const values = samples.map(sample => finiteMetric(sample[key] as number | undefined, String(key))).sort((left, right) => left - right);
      const middle = Math.floor(values.length / 2);
      return values.length % 2 === 0 ? (values[middle - 1]! + values[middle]!) / 2 : values[middle]!;
    };
    return Object.freeze({
      backend,
      samples: samples.length,
      computeMs: median("computeMs"),
      transferBytes: median("transferBytes"),
      transferMs: median("transferMs"),
      materializationBytes: median("materializationBytes"),
      materializationMs: median("materializationMs"),
      readbackBytes: median("readbackBytes"),
      readbackMs: median("readbackMs"),
      synchronizationBytes: median("synchronizationBytes"),
      synchronizationMs: median("synchronizationMs"),
      totalMs: median("totalMs"),
    });
  }

  recentPackedJsBaseline(windowSize = 9): ExecutionAggregate | null {
    return this.recentAggregate(this.baselineBackend, windowSize);
  }

  compareWithPackedJs(backend: ExecutionBackend): Readonly<{ ready: boolean; wins: boolean; ratio: number | null; savedMs: number | null }> {
    const baseline = this.packedJsBaseline();
    const candidate = this.aggregate(backend);
    if (!baseline || !candidate || backend === this.baselineBackend) {
      return Object.freeze({ ready: false, wins: false, ratio: null, savedMs: null });
    }
    const ratio = baseline.totalMs === 0 ? (candidate.totalMs === 0 ? 1 : Number.POSITIVE_INFINITY) : candidate.totalMs / baseline.totalMs;
    return Object.freeze({ ready: true, wins: candidate.totalMs < baseline.totalMs, ratio, savedMs: baseline.totalMs - candidate.totalMs });
  }

  compareRecentWithPackedJs(
    backend: ExecutionBackend,
    windowSize = 9,
  ): Readonly<{ ready: boolean; wins: boolean; ratio: number | null; savedMs: number | null }> {
    const baseline = this.recentPackedJsBaseline(windowSize);
    const candidate = this.recentAggregate(backend, windowSize);
    if (!baseline || !candidate || backend === this.baselineBackend) {
      return Object.freeze({ ready: false, wins: false, ratio: null, savedMs: null });
    }
    const ratio = baseline.totalMs === 0 ? (candidate.totalMs === 0 ? 1 : Number.POSITIVE_INFINITY) : candidate.totalMs / baseline.totalMs;
    return Object.freeze({ ready: true, wins: candidate.totalMs < baseline.totalMs, ratio, savedMs: baseline.totalMs - candidate.totalMs });
  }

  snapshot(): Readonly<Record<string, ExecutionAggregate>> {
    return Object.freeze(Object.fromEntries([...this.#aggregates.keys()].map(backend => [backend, this.aggregate(backend)])) as Record<string, ExecutionAggregate>);
  }
}

export type FrameBudgetLevel = "idle" | "comfortable" | "pressured" | "critical";

export interface FrameBudgetSnapshot {
  readonly budgetMs: number;
  readonly emaMainThreadMs: number;
  readonly peakMainThreadMs: number;
  readonly pressure: number;
  readonly level: FrameBudgetLevel;
  readonly samples: number;
}

export class FrameBudgetSignal {
  readonly budgetMs: number;
  readonly alpha: number;
  #samples = 0;
  #emaMainThreadMs = 0;
  #peakMainThreadMs = 0;
  #listeners = new Set<(snapshot: FrameBudgetSnapshot) => void>();

  constructor(options: Readonly<{ budgetMs?: number; alpha?: number }> = {}) {
    const budgetMs = Number(options.budgetMs ?? 8);
    const alpha = Number(options.alpha ?? 0.12);
    this.budgetMs = Number.isFinite(budgetMs) ? Math.max(0.1, budgetMs) : 8;
    this.alpha = Number.isFinite(alpha) ? Math.min(1, Math.max(0.01, alpha)) : 0.12;
  }

  get pressure(): number {
    return this.#emaMainThreadMs / this.budgetMs;
  }

  get level(): FrameBudgetLevel {
    const pressure = this.pressure;
    return pressure >= 1.15 ? "critical" : pressure >= 0.75 ? "pressured" : pressure >= 0.25 ? "comfortable" : "idle";
  }

  observe(mainThreadMs: number): FrameBudgetSnapshot {
    if (!Number.isFinite(mainThreadMs) || mainThreadMs < 0) return this.snapshot();
    this.#samples += 1;
    if (this.#samples === 1) this.#emaMainThreadMs = mainThreadMs;
    else this.#emaMainThreadMs += (mainThreadMs - this.#emaMainThreadMs) * this.alpha;
    this.#peakMainThreadMs = Math.max(this.#peakMainThreadMs * 0.995, mainThreadMs);
    const snapshot = this.snapshot();
    for (const listener of this.#listeners) listener(snapshot);
    return snapshot;
  }

  snapshot(): FrameBudgetSnapshot {
    return Object.freeze({
      budgetMs: this.budgetMs,
      emaMainThreadMs: this.#emaMainThreadMs,
      peakMainThreadMs: this.#peakMainThreadMs,
      pressure: this.pressure,
      level: this.level,
      samples: this.#samples,
    });
  }

  subscribe(listener: (snapshot: FrameBudgetSnapshot) => void, options: Readonly<{ emitCurrent?: boolean }> = {}): () => void {
    this.#listeners.add(listener);
    if (options.emitCurrent) listener(this.snapshot());
    return () => this.#listeners.delete(listener);
  }
}

export class FrameBudgetGovernor extends FrameBudgetSignal {}

export class SerializedExecutionQueue {
  #tail: Promise<void> = Promise.resolve();
  #pending = 0;
  #closed = false;

  get pending(): number {
    return this.#pending;
  }

  get closed(): boolean {
    return this.#closed;
  }

  enqueue<Result>(task: () => Result | PromiseLike<Result>): Promise<Result> {
    if (this.#closed) return Promise.reject(new Error("SerializedExecutionQueue is closed"));
    this.#pending += 1;
    const result = this.#tail.then(task);
    this.#tail = result.then(
      () => { this.#pending -= 1; },
      () => { this.#pending -= 1; },
    );
    return result;
  }

  async idle(): Promise<void> {
    await this.#tail;
  }

  close(): void {
    this.#closed = true;
  }
}
