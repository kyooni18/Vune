export type PackedFieldType = "f32" | "f64" | "i32" | "u32" | "u8"

export interface PackedField {
  readonly name: string
  readonly type: PackedFieldType
}

export interface PackedLayout {
  readonly fields: readonly PackedField[]
  readonly length: number
}

export type PackedBuffer = Float32Array | Float64Array | Int32Array | Uint32Array | Uint8Array

export interface PackedStorage {
  readonly layout: PackedLayout
  readonly buffers: readonly PackedBuffer[]
  version: number
}

/** A half-open row range dirtied by one logical PackedState version. */
export interface PackedDirtyRange {
  readonly start: number
  readonly end: number
  /** Absent when every column in the range may have changed. */
  readonly fields?: readonly string[]
  readonly version: number
}

export type PackedStateChangeKind =
  | "mutation"
  | "invalidate"
  | "resize"
  | "reserve"
  | "external"
  | "batch"
  | "snapshot"

export interface PackedStateChange {
  readonly kind: PackedStateChangeKind
  readonly previousVersion: number
  readonly version: number
  readonly previousLength: number
  readonly length: number
  readonly previousCapacity: number
  readonly capacity: number
  /** True when consumers must reacquire layout or TypedArray views. */
  readonly storageChanged: boolean
  readonly dirtyRanges: readonly PackedDirtyRange[]
}

export interface PackedStateOptions {
  /** Preallocate rows without changing the initial logical length. */
  readonly capacity?: number
  readonly version?: number
}

export interface PackedMutationRange {
  readonly start: number
  readonly end: number
  /** Restrict invalidation to these columns; absent means all columns. */
  readonly fields?: readonly string[]
}

export interface PackedMutationView {
  readonly length: number
  readonly buffers: readonly PackedBuffer[]
  column(name: string): PackedBuffer
}

export type PackedStateListener = (state: PackedState, change: PackedStateChange) => void

export interface PackedStateSubscriptionOptions {
  readonly emitCurrent?: boolean
}

type PackedRangeInput = PackedMutationRange | readonly PackedMutationRange[]

export type ResidentInputResidency = "objects" | "packed" | "gpu"
export type ResidentOutputResidency = "objects" | "packed" | "gpu"
export type ResidentLifetime = "single-use" | "persistent" | "frame-persistent"

export type KernelUnaryOperator = "+" | "-" | "!" | "~"
export type KernelBinaryOperator =
  | "+" | "-" | "*" | "/" | "%" | "**"
  | "<" | "<=" | ">" | ">=" | "==" | "!=" | "===" | "!=="
  | "&" | "|" | "^" | "<<" | ">>" | ">>>"
  | "&&" | "||" | "??"

export type KernelExpression =
  | { readonly op: "const"; readonly value: number | boolean }
  | { readonly op: "load"; readonly path: readonly (string | number)[] }
  | { readonly op: "index" }
  | { readonly op: "capture"; readonly name: string }
  | { readonly op: "unary"; readonly operator: KernelUnaryOperator; readonly value: KernelExpression }
  | { readonly op: "binary"; readonly operator: KernelBinaryOperator; readonly left: KernelExpression; readonly right: KernelExpression }
  | { readonly op: "select"; readonly condition: KernelExpression; readonly whenTrue: KernelExpression; readonly whenFalse: KernelExpression }

export interface KernelMapOutput {
  readonly name: string
  readonly value: KernelExpression
}

export interface KernelMapIR {
  readonly kind: "map"
  readonly itemName: string
  readonly indexName?: string
  readonly preserveInput: boolean
  readonly outputs: readonly KernelMapOutput[]
  readonly captures: readonly string[]
  readonly requiresTypeProof: true
}

export interface KernelScalarIR {
  readonly kind: "scalar"
  readonly itemName: string
  readonly indexName?: string
  readonly value: KernelExpression
  readonly captures: readonly string[]
  readonly requiresTypeProof: true
}

export type KernelIR = KernelMapIR | KernelScalarIR

export interface ResidentPackedSource {
  readonly kind: "packed"
  readonly layout: PackedLayout
}

export interface ResidentPackedSink {
  readonly kind: "packed"
  readonly layout: PackedLayout
}

export interface ResidentRegionIR {
  readonly version: 1
  readonly id: string
  readonly source: ResidentPackedSource
  readonly kernels: readonly KernelIR[]
  readonly sink: ResidentPackedSink
  /** Discharges KernelIR.requiresTypeProof for the packed numeric layout. */
  readonly typeProof: "numeric-packed"
  readonly lifetime: ResidentLifetime
  readonly inputResidency: ResidentInputResidency
  readonly outputResidency: ResidentOutputResidency
  readonly estimatedOpsPerItem: number
  readonly estimatedTransferBytes: number
}

export interface ResidentExecutionInputs {
  readonly captures?: Readonly<Record<string, number | boolean>>
  readonly ranges?: readonly PackedMutationRange[]
}

interface MutableRange {
  start: number
  end: number
}

interface MutableDirtyRange extends MutableRange {
  fields?: string[]
  version: number
}

interface ExecutionColumns {
  readonly fields: ReadonlyMap<string, number>
  readonly buffers: readonly PackedBuffer[]
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer`)
}

const packedFieldTypes: ReadonlySet<string> = new Set<PackedFieldType>(["f32", "f64", "i32", "u32", "u8"])

function assertPackedFieldType(type: unknown, label: string): asserts type is PackedFieldType {
  if (typeof type !== "string" || !packedFieldTypes.has(type)) {
    throw new TypeError(`${label} has an unsupported packed field type: ${String(type)}`)
  }
}

function assertFieldName(name: string): void {
  if (typeof name !== "string" || name.length === 0 || name === "__proto__" || name === "prototype" || name === "constructor") {
    throw new TypeError(`invalid packed field name: ${JSON.stringify(name)}`)
  }
}

function assertPackedLayout(layout: PackedLayout): void {
  if (typeof layout !== "object" || layout === null || !Array.isArray(layout.fields)) {
    throw new TypeError("packed layout must contain a fields array")
  }
  assertNonNegativeInteger(layout.length, "packed layout length")
  if (layout.fields.length === 0) throw new TypeError("packed layout requires at least one field")
  const names = new Set<string>()
  for (const field of layout.fields) {
    if (typeof field !== "object" || field === null) throw new TypeError("packed layout field must be an object")
    assertFieldName(field.name)
    assertPackedFieldType(field.type, `packed field ${field.name}`)
    if (names.has(field.name)) throw new TypeError(`duplicate packed field: ${field.name}`)
    names.add(field.name)
  }
}

function assertRangeBounds(start: number, end: number, length: number, label: string): void {
  assertNonNegativeInteger(start, `${label} start`)
  assertNonNegativeInteger(end, `${label} end`)
  if (end < start) throw new RangeError(`${label} end must be greater than or equal to the start`)
  if (end > length) throw new RangeError(`${label} exceeds the logical extent`)
}

function throwCollectedErrors(errors: readonly unknown[], message: string): void {
  if (errors.length === 0) return
  if (errors.length === 1) throw errors[0]
  throw new AggregateError(errors, message)
}

function bufferFor(type: PackedFieldType, length: number): PackedBuffer {
  if (type === "f32") return new Float32Array(length)
  if (type === "f64") return new Float64Array(length)
  if (type === "i32") return new Int32Array(length)
  if (type === "u32") return new Uint32Array(length)
  if (type === "u8") return new Uint8Array(length)
  throw new TypeError(`unsupported packed field type: ${String(type)}`)
}

function bufferMatches(type: PackedFieldType, buffer: PackedBuffer): boolean {
  if (type === "f32") return buffer instanceof Float32Array
  if (type === "f64") return buffer instanceof Float64Array
  if (type === "i32") return buffer instanceof Int32Array
  if (type === "u32") return buffer instanceof Uint32Array
  return buffer instanceof Uint8Array
}

function sameLayout(left: PackedLayout, right: PackedLayout): boolean {
  return left.length === right.length
    && left.fields.length === right.fields.length
    && left.fields.every((field, index) => {
      const other = right.fields[index]
      return other?.name === field.name && other.type === field.type
    })
}

function freezeFields(fields: readonly string[] | undefined): readonly string[] | undefined {
  return fields ? Object.freeze([...fields]) : undefined
}

function mergeFieldNames(left: readonly string[] | undefined, right: readonly string[] | undefined): readonly string[] | undefined {
  if (!left || !right) return undefined
  return Object.freeze([...new Set([...left, ...right])].sort())
}

function normalizeDirtyFields(fields: readonly string[] | undefined, layout: PackedLayout): readonly string[] | undefined {
  if (fields === undefined) return undefined
  if (!Array.isArray(fields) || fields.length === 0) throw new TypeError("packed dirty fields must be a non-empty array")
  const known = new Set(layout.fields.map(field => field.name))
  const names = new Set<string>()
  for (const field of fields) {
    assertFieldName(field)
    if (!known.has(field)) throw new TypeError(`unknown packed field in dirty range: ${field}`)
    if (names.has(field)) throw new TypeError(`duplicate packed field in dirty range: ${field}`)
    names.add(field)
  }
  return Object.freeze([...names].sort())
}

function normalizePackedRanges(
  ranges: readonly PackedMutationRange[],
  layout: PackedLayout,
): readonly PackedMutationRange[] {
  const normalized = ranges
    .map((range): PackedMutationRange | undefined => {
      assertRangeBounds(range.start, range.end, layout.length, "packed mutation range")
      if (range.end === range.start) return undefined
      return {
        start: range.start,
        end: range.end,
        fields: normalizeDirtyFields(range.fields, layout),
      }
    })
    .filter((range): range is NonNullable<typeof range> => range !== undefined)
    .sort((left, right) => left.start - right.start || left.end - right.end)
  if (normalized.length === 0) return Object.freeze([])
  const merged: MutableDirtyRange[] = []
  for (const range of normalized) {
    const previous = merged.at(-1)
    if (!previous || previous.end <= range.start) {
      merged.push({ start: range.start, end: range.end, fields: range.fields ? [...range.fields] : undefined, version: 0 })
      continue
    }
    previous.end = Math.max(previous.end, range.end)
    const mergedFields = mergeFieldNames(previous.fields, range.fields)
    previous.fields = mergedFields ? [...mergedFields] : undefined
  }
  return Object.freeze(merged.map(range => Object.freeze({
    start: range.start,
    end: range.end,
    ...(range.fields ? { fields: Object.freeze([...range.fields]) } : {}),
  })))
}

function normalizePackedDirtyRanges(
  ranges: readonly PackedDirtyRange[],
  layout: PackedLayout,
): readonly PackedDirtyRange[] {
  const normalized = ranges
    .map((range): MutableDirtyRange | undefined => {
      assertRangeBounds(range.start, range.end, layout.length, "packed dirty range")
      if (range.end === range.start) return undefined
      assertNonNegativeInteger(range.version, "packed dirty range version")
      return {
        start: range.start,
        end: range.end,
        fields: normalizeDirtyFields(range.fields, layout)?.slice(),
        version: range.version,
      }
    })
    .filter((range): range is NonNullable<typeof range> => range !== undefined)
    .sort((left, right) => left.start - right.start || left.end - right.end)
  if (normalized.length === 0) return Object.freeze([])
  const merged: MutableDirtyRange[] = []
  for (const range of normalized) {
    const previous = merged.at(-1)
    if (!previous || previous.end <= range.start) {
      merged.push({ start: range.start, end: range.end, fields: range.fields ? [...range.fields] : undefined, version: range.version })
      continue
    }
    previous.end = Math.max(previous.end, range.end)
    const mergedFields = mergeFieldNames(previous.fields, range.fields)
    previous.fields = mergedFields ? [...mergedFields] : undefined
    previous.version = Math.max(previous.version, range.version)
  }
  return Object.freeze(merged.map(range => Object.freeze({
    start: range.start,
    end: range.end,
    ...(range.fields ? { fields: Object.freeze([...range.fields]) } : {}),
    version: range.version,
  })))
}

function subtractPackedDirtyRanges(
  current: readonly PackedDirtyRange[],
  ranges: readonly PackedMutationRange[],
  layout: PackedLayout,
): readonly PackedDirtyRange[] {
  const clearRanges = normalizePackedRanges(ranges, layout)
  if (clearRanges.length === 0 || current.length === 0) return current
  let next: MutableDirtyRange[] = current.map(range => ({
    start: range.start,
    end: range.end,
    fields: range.fields ? [...range.fields] : undefined,
    version: range.version,
  }))
  for (const clear of clearRanges) {
    const split: MutableDirtyRange[] = []
    for (const dirty of next) {
      const overlapStart = Math.max(dirty.start, clear.start)
      const overlapEnd = Math.min(dirty.end, clear.end)
      if (overlapStart >= overlapEnd) {
        split.push(dirty)
        continue
      }
      if (dirty.start < overlapStart) {
        split.push({ ...dirty, end: overlapStart, fields: dirty.fields ? [...dirty.fields] : undefined })
      }
      const dirtyFields = dirty.fields ?? layout.fields.map(field => field.name)
      const clearFields = clear.fields ?? layout.fields.map(field => field.name)
      const cleared = new Set(clearFields)
      const remainingFields = dirtyFields.filter(field => !cleared.has(field))
      if (remainingFields.length > 0) {
        split.push({
          start: overlapStart,
          end: overlapEnd,
          fields: remainingFields.length === layout.fields.length ? undefined : remainingFields,
          version: dirty.version,
        })
      }
      if (overlapEnd < dirty.end) {
        split.push({ ...dirty, start: overlapEnd, fields: dirty.fields ? [...dirty.fields] : undefined })
      }
    }
    next = split
  }
  return normalizePackedDirtyRanges(next, layout)
}

function copyBufferView(buffer: PackedBuffer, length: number): PackedBuffer {
  return buffer.length === length ? buffer : buffer.subarray(0, length) as PackedBuffer
}

function storageFromBacking(
  fields: readonly PackedField[],
  length: number,
  buffers: readonly PackedBuffer[],
  version: number,
): PackedStorage {
  const layout = definePackedLayout(fields, length)
  return definePackedStorage(layout, buffers.map(buffer => copyBufferView(buffer, length)), version)
}

function changedOutputFields(region: ResidentRegionIR): readonly string[] | undefined {
  const names = new Set<string>()
  for (const kernel of region.kernels) {
    if (kernel.kind !== "map") continue
    for (const output of kernel.outputs) names.add(output.name)
  }
  return names.size > 0 ? Object.freeze([...names].sort()) : undefined
}

export class PackedState {
  readonly #fields: readonly PackedField[]
  readonly #fieldIndexes: ReadonlyMap<string, number>
  #buffers: readonly PackedBuffer[]
  #storage: PackedStorage
  #length: number
  #capacity: number
  #dirtyRanges: readonly PackedDirtyRange[]
  readonly #listeners = new Set<PackedStateListener>()
  #lastChange: PackedStateChange | null
  #batchDepth: number
  #batchedDirtyRanges: PackedMutationRange[]

  constructor(layout: PackedLayout, options: PackedStateOptions = {}) {
    assertPackedLayout(layout)
    const capacity = options.capacity ?? layout.length
    assertNonNegativeInteger(capacity, "packed state capacity")
    if (capacity < layout.length) throw new RangeError("packed state capacity cannot be smaller than its logical length")
    const version = options.version ?? 0
    assertNonNegativeInteger(version, "packed state version")
    this.#fields = Object.freeze(layout.fields.map(field => Object.freeze({ name: field.name, type: field.type })))
    this.#fieldIndexes = new Map(this.#fields.map((field, index) => [field.name, index]))
    this.#length = layout.length
    this.#capacity = capacity
    this.#buffers = Object.freeze(this.#fields.map(field => bufferFor(field.type, capacity)))
    this.#storage = storageFromBacking(this.#fields, this.#length, this.#buffers, version)
    this.#dirtyRanges = Object.freeze([])
    this.#lastChange = null
    this.#batchDepth = 0
    this.#batchedDirtyRanges = []
  }

  static fromStorage(
    storage: PackedStorage,
    options: PackedStateOptions = {},
  ): PackedState {
    const state = new PackedState(storage.layout, {
      capacity: Math.max(options.capacity ?? storage.layout.length, storage.layout.length),
      version: options.version ?? storage.version,
    })
    const nextBuffers = state.#buffers.slice()
    for (let index = 0; index < storage.buffers.length; index += 1) nextBuffers[index]!.set(storage.buffers[index]!)
    state.#buffers = Object.freeze(nextBuffers)
    state.#storage = storageFromBacking(state.#fields, state.#length, state.#buffers, state.version)
    return state
  }

  get buffers(): readonly PackedBuffer[] {
    return this.#storage.buffers
  }

  get capacity(): number {
    return this.#capacity
  }

  get dirtyRanges(): readonly PackedDirtyRange[] {
    return this.#dirtyRanges
  }

  get lastChange(): PackedStateChange | null {
    return this.#lastChange
  }

  get layout(): PackedLayout {
    return this.#storage.layout
  }

  get length(): number {
    return this.#length
  }

  get storage(): PackedStorage {
    return this.#storage
  }

  get version(): number {
    return this.#storage.version
  }

  set version(_value: number) {
    throw new TypeError("packed state version is runtime-owned and must advance exactly once through a state operation")
  }

  column(name: string): PackedBuffer {
    const index = this.#fieldIndexes.get(name)
    if (index === undefined) throw new TypeError(`unknown packed field: ${name}`)
    return this.#storage.buffers[index]!
  }

  subscribe(listener: PackedStateListener, options: PackedStateSubscriptionOptions = {}): () => void {
    if (typeof listener !== "function") throw new TypeError("packed state listener must be a function")
    this.#listeners.add(listener)
    if (options.emitCurrent === true) listener(this, this.#snapshotChange())
    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      this.#listeners.delete(listener)
    }
  }

  clearDirtyRanges(ranges?: readonly PackedMutationRange[]): readonly PackedDirtyRange[] {
    if (!ranges || ranges.length === 0) {
      this.#dirtyRanges = Object.freeze([])
      return this.#dirtyRanges
    }
    this.#dirtyRanges = subtractPackedDirtyRanges(this.#dirtyRanges, ranges, this.layout)
    return this.#dirtyRanges
  }

  consumeDirtyRanges(): readonly PackedDirtyRange[] {
    const current = this.#dirtyRanges
    this.#dirtyRanges = Object.freeze([])
    return current
  }

  invalidate(
    ranges: PackedRangeInput,
    kind: PackedStateChangeKind = "invalidate",
  ): boolean {
    const normalized = this.#normalizeRangeInput(ranges)
    if (normalized.length === 0) return false
    if (this.#batchDepth > 0) {
      this.#batchedDirtyRanges.push(...normalized)
      return true
    }
    this.#commitRanges(normalized, kind, this.length, this.capacity, false)
    return true
  }

  mutate(
    ranges: PackedRangeInput,
    mutate: (view: PackedMutationView) => void,
    kind: PackedStateChangeKind = "mutation",
  ): boolean {
    if (typeof mutate !== "function") throw new TypeError("packed state mutator must be a function")
    const normalized = this.#normalizeRangeInput(ranges)
    if (normalized.length === 0) throw new RangeError("packed mutation requires a non-empty dirty range")
    const view: PackedMutationView = {
      length: this.length,
      buffers: this.storage.buffers,
      column: name => this.column(name),
    }
    let mutationError: unknown
    try {
      mutate(view)
    } catch (error) {
      mutationError = error
    }
    if (this.#batchDepth > 0) {
      this.#batchedDirtyRanges.push(...normalized)
      if (mutationError !== undefined) throw mutationError
      return true
    }
    this.#commitRanges(normalized, kind, this.length, this.capacity, false, mutationError)
    return true
  }

  set(name: string, index: number, value: number): boolean {
    assertNonNegativeInteger(index, "packed state index")
    if (index >= this.length) throw new RangeError("packed state index is outside the logical length")
    const fieldIndex = this.#fieldIndexes.get(name)
    if (fieldIndex === undefined) throw new TypeError(`unknown packed field: ${name}`)
    const normalized = this.#coerceFieldValue(this.#fields[fieldIndex]!, value)
    const column = this.#storage.buffers[fieldIndex]!
    if (column[index] === normalized) return false
    column[index] = normalized
    return this.invalidate({ start: index, end: index + 1, fields: [name] }, "mutation")
  }

  fill(name: string, value: number, start = 0, end = this.length): boolean {
    const fieldIndex = this.#fieldIndexes.get(name)
    if (fieldIndex === undefined) throw new TypeError(`unknown packed field: ${name}`)
    const normalizedRanges = this.#normalizeRangeInput({ start, end, fields: [name] })
    if (normalizedRanges.length === 0) return false
    const normalized = this.#coerceFieldValue(this.#fields[fieldIndex]!, value)
    const column = this.#storage.buffers[fieldIndex]!
    let changed = false
    for (const range of normalizedRanges) {
      for (let row = range.start; row < range.end; row += 1) {
        if (column[row] === normalized) continue
        column[row] = normalized
        changed = true
      }
    }
    if (!changed) return false
    return this.invalidate(normalizedRanges, "mutation")
  }

  batch<T>(mutate: (packed: PackedState) => T): T {
    if (typeof mutate !== "function") throw new TypeError("packed state batch callback must be a function")
    this.#batchDepth += 1
    try {
      const value = mutate(this)
      if (this.#batchDepth === 1 && this.#batchedDirtyRanges.length > 0) {
        const batched = this.#batchedDirtyRanges
        this.#batchedDirtyRanges = []
        this.#commitRanges(batched, "batch", this.length, this.capacity, false)
      }
      return value
    } catch (error) {
      if (this.#batchDepth === 1 && this.#batchedDirtyRanges.length > 0) {
        const batched = this.#batchedDirtyRanges
        this.#batchedDirtyRanges = []
        this.#commitRanges(batched, "batch", this.length, this.capacity, false, error)
      }
      this.#batchedDirtyRanges = []
      throw error
    } finally {
      this.#batchDepth -= 1
      if (this.#batchDepth === 0 && this.#batchedDirtyRanges.length > 0) this.#batchedDirtyRanges = []
    }
  }

  reserve(capacity: number): boolean {
    assertNonNegativeInteger(capacity, "packed state capacity")
    if (capacity <= this.capacity) return false
    const previousLength = this.length
    const previousCapacity = this.capacity
    this.#reallocate(capacity)
    if (this.length === 0) this.#commitStorageChange("reserve", previousLength, previousCapacity)
    else this.#commitRanges([{ start: 0, end: this.length }], "reserve", previousLength, previousCapacity, true)
    return true
  }

  resize(length: number): boolean {
    assertNonNegativeInteger(length, "packed state length")
    if (length === this.length) return false
    const previousLength = this.length
    const previousCapacity = this.capacity
    if (length > this.capacity) this.#reallocate(Math.max(length, Math.max(1, this.capacity * 2)))
    if (length < previousLength) {
      for (const buffer of this.#buffers) buffer.fill(0, length, previousLength)
    }
    if (length > previousLength) {
      for (const buffer of this.#buffers) buffer.fill(0, previousLength, length)
    }
    this.#length = length
    this.#storage = storageFromBacking(this.#fields, this.#length, this.#buffers, this.version)
    this.#dirtyRanges = normalizePackedDirtyRanges(this.#dirtyRanges.flatMap(range => {
      const end = Math.min(range.end, this.#length)
      if (range.start >= end) return []
      return [{
        start: range.start,
        end,
        ...(range.fields ? { fields: range.fields } : {}),
        version: range.version,
      }]
    }), this.layout)
    const dirtyRanges = length > previousLength
      ? [{ start: previousLength, end: length }]
      : this.#length === 0
        ? []
        : [{ start: 0, end: this.#length }]
    if (dirtyRanges.length === 0) this.#commitStorageChange("resize", previousLength, previousCapacity)
    else this.#commitRanges(dirtyRanges, "resize", previousLength, previousCapacity, true)
    return true
  }

  snapshot(): PackedStorage {
    return definePackedStorage(this.layout, this.storage.buffers.map((buffer, index) => {
      const copy = bufferFor(this.layout.fields[index]!.type, buffer.length)
      copy.set(buffer)
      return copy
    }), this.version)
  }

  #normalizeRangeInput(ranges: PackedRangeInput): readonly PackedMutationRange[] {
    const input = Array.isArray(ranges) ? ranges : [ranges]
    return normalizePackedRanges(input, this.layout)
  }

  #coerceFieldValue(field: PackedField, value: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError(`packed field ${field.name} value must be a finite number`)
    }
    if (field.type === "f32" || field.type === "f64") return value
    if (!Number.isSafeInteger(value)) throw new TypeError(`packed field ${field.name} value must be an integer`)
    if (field.type === "u8" && (value < 0 || value > 0xff)) throw new RangeError(`packed field ${field.name} value is outside u8 range`)
    if (field.type === "u32" && (value < 0 || value > 0xffffffff)) throw new RangeError(`packed field ${field.name} value is outside u32 range`)
    if (field.type === "i32" && (value < -0x80000000 || value > 0x7fffffff)) throw new RangeError(`packed field ${field.name} value is outside i32 range`)
    return value
  }

  #snapshotChange(): PackedStateChange {
    const dirtyRanges = this.length === 0
      ? Object.freeze([])
      : Object.freeze([Object.freeze({ start: 0, end: this.length, version: this.version })])
    return Object.freeze({
      kind: "snapshot",
      previousVersion: this.version,
      version: this.version,
      previousLength: this.length,
      length: this.length,
      previousCapacity: this.capacity,
      capacity: this.capacity,
      storageChanged: false,
      dirtyRanges,
    })
  }

  #reallocate(capacity: number): void {
    const nextBuffers = this.#fields.map((field, index) => {
      const next = bufferFor(field.type, capacity)
      next.set(this.#buffers[index]!.subarray(0, this.length))
      return next
    })
    this.#capacity = capacity
    this.#buffers = Object.freeze(nextBuffers)
    this.#storage = storageFromBacking(this.#fields, this.length, this.#buffers, this.version)
  }

  #commitRanges(
    ranges: readonly PackedMutationRange[],
    kind: PackedStateChangeKind,
    previousLength: number,
    previousCapacity: number,
    storageChanged: boolean,
    upstreamError?: unknown,
  ): PackedStateChange {
    const normalized = normalizePackedRanges(ranges, this.layout)
    if (normalized.length === 0) {
      if (upstreamError !== undefined) throw upstreamError
      return this.#lastChange ?? this.#snapshotChange()
    }
    const previousVersion = this.version
    if (previousVersion >= Number.MAX_SAFE_INTEGER) throw new RangeError("packed state version exhausted the safe integer range")
    this.#storage.version += 1
    this.#dirtyRanges = normalizePackedDirtyRanges([
      ...this.#dirtyRanges,
      ...normalized.map(range => ({
        start: range.start,
        end: range.end,
        ...(range.fields ? { fields: range.fields } : {}),
        version: this.version,
      })),
    ], this.layout)
    return this.#emitChange(kind, previousVersion, previousLength, previousCapacity, storageChanged, upstreamError)
  }

  #commitStorageChange(
    kind: "reserve" | "resize",
    previousLength: number,
    previousCapacity: number,
    upstreamError?: unknown,
  ): PackedStateChange {
    const previousVersion = this.version
    if (previousVersion >= Number.MAX_SAFE_INTEGER) throw new RangeError("packed state version exhausted the safe integer range")
    this.#storage.version += 1
    this.#dirtyRanges = Object.freeze([])
    return this.#emitChange(kind, previousVersion, previousLength, previousCapacity, true, upstreamError)
  }

  #emitChange(
    kind: PackedStateChangeKind,
    previousVersion: number,
    previousLength: number,
    previousCapacity: number,
    storageChanged: boolean,
    upstreamError?: unknown,
  ): PackedStateChange {
    const change = Object.freeze({
      kind,
      previousVersion,
      version: this.version,
      previousLength,
      length: this.length,
      previousCapacity,
      capacity: this.capacity,
      storageChanged,
      dirtyRanges: this.#dirtyRanges,
    })
    this.#lastChange = change
    const errors: unknown[] = []
    if (upstreamError !== undefined) errors.push(upstreamError)
    for (const listener of [...this.#listeners]) {
      if (!this.#listeners.has(listener)) continue
      try {
        listener(this, change)
      } catch (error) {
        errors.push(error)
      }
    }
    throwCollectedErrors(errors, `packed state ${kind} failed`)
    return change
  }
}

export function definePackedLayout(fields: readonly PackedField[], length: number): PackedLayout {
  assertNonNegativeInteger(length, "packed layout length")
  const names = new Set<string>()
  const frozenFields = fields.map(field => {
    if (typeof field !== "object" || field === null) throw new TypeError("packed layout field must be an object")
    assertFieldName(field.name)
    assertPackedFieldType(field.type, `packed field ${field.name}`)
    if (names.has(field.name)) throw new TypeError(`duplicate packed field: ${field.name}`)
    names.add(field.name)
    return Object.freeze({ name: field.name, type: field.type })
  })
  if (frozenFields.length === 0) throw new TypeError("packed layout requires at least one field")
  return Object.freeze({ fields: Object.freeze(frozenFields), length })
}

export function allocatePackedStorage(layout: PackedLayout, version = 0): PackedStorage {
  assertPackedLayout(layout)
  assertNonNegativeInteger(version, "packed storage version")
  return {
    layout,
    buffers: Object.freeze(layout.fields.map(field => bufferFor(field.type, layout.length))),
    version,
  }
}

export function definePackedStorage(
  layout: PackedLayout,
  buffers: readonly PackedBuffer[],
  version = 0,
): PackedStorage {
  assertPackedLayout(layout)
  assertNonNegativeInteger(version, "packed storage version")
  if (buffers.length !== layout.fields.length) throw new TypeError("packed storage buffer count does not match its layout")
  const frozenBuffers = buffers.map((buffer, index) => {
    const field = layout.fields[index]
    if (!field || !bufferMatches(field.type, buffer)) {
      throw new TypeError(`packed buffer ${index} does not match field ${field?.name ?? "<missing>"}`)
    }
    if (buffer.length !== layout.length) throw new RangeError(`packed buffer ${field.name} has the wrong length`)
    return buffer
  })
  return { layout, buffers: Object.freeze(frozenBuffers), version }
}

export function allocatePackedState(layout: PackedLayout, options: PackedStateOptions = {}): PackedState {
  return new PackedState(layout, options)
}

export function definePackedState(storage: PackedStorage, options: PackedStateOptions = {}): PackedState {
  return PackedState.fromStorage(storage, options)
}

function expressionOps(expression: KernelExpression): number {
  if (expression.op === "unary") return 1 + expressionOps(expression.value)
  if (expression.op === "binary") return 1 + expressionOps(expression.left) + expressionOps(expression.right)
  if (expression.op === "select") {
    return 1 + expressionOps(expression.condition) + expressionOps(expression.whenTrue) + expressionOps(expression.whenFalse)
  }
  return 1
}

export function estimateKernelOps(kernels: readonly KernelIR[]): number {
  return kernels.reduce((total, kernel) => total + (kernel.kind === "map"
    ? kernel.outputs.reduce((outputTotal, output) => outputTotal + expressionOps(output.value), 0)
    : expressionOps(kernel.value)), 0)
}

export function defineResidentRegion(region: Omit<ResidentRegionIR, "version" | "estimatedOpsPerItem"> & {
  readonly estimatedOpsPerItem?: number
}): ResidentRegionIR {
  if (region.inputResidency !== "packed" || region.outputResidency !== "packed") {
    throw new TypeError("a Resident Compute region must remain packed from source through sink")
  }
  if (!sameLayout(region.source.layout, region.sink.layout)) {
    throw new TypeError("the initial JS packed executor requires matching source and sink layouts")
  }
  if (region.kernels.length === 0) throw new TypeError("resident region requires at least one kernel")
  if (region.kernels.some(kernel => kernel.kind !== "map")) {
    throw new TypeError("the initial packed executor only supports map kernels with packed outputs")
  }
  const sinkFields = new Set(region.sink.layout.fields.map(field => field.name))
  for (const kernel of region.kernels) {
    if (kernel.kind !== "map") continue
    const outputFields = new Set(kernel.outputs.map(output => output.name))
    if (outputFields.size !== kernel.outputs.length) throw new TypeError("resident map kernel writes a field more than once")
    for (const output of kernel.outputs) {
      if (!sinkFields.has(output.name)) throw new TypeError(`resident kernel writes unknown packed field: ${output.name}`)
    }
    if (!kernel.preserveInput && sinkFields.size !== outputFields.size) {
      throw new TypeError("a non-preserving resident map kernel must write every packed field")
    }
  }
  assertNonNegativeInteger(region.estimatedTransferBytes, "estimated transfer bytes")
  const estimatedOpsPerItem = region.estimatedOpsPerItem ?? estimateKernelOps(region.kernels)
  assertNonNegativeInteger(estimatedOpsPerItem, "estimated operations per item")
  return Object.freeze({
    version: 1,
    ...region,
    kernels: Object.freeze([...region.kernels]),
    estimatedOpsPerItem,
  })
}

function columns(storage: PackedStorage): ExecutionColumns {
  return {
    fields: new Map(storage.layout.fields.map((field, index) => [field.name, index])),
    buffers: storage.buffers,
  }
}

function readField(expression: Extract<KernelExpression, { readonly op: "load" }>, row: number, source: ExecutionColumns): number {
  if (expression.path.length !== 1 || typeof expression.path[0] !== "string") {
    throw new TypeError("packed JS execution requires a single statically proven column load")
  }
  const fieldIndex = source.fields.get(expression.path[0])
  if (fieldIndex === undefined) throw new TypeError(`resident kernel reads unknown packed field: ${expression.path[0]}`)
  return source.buffers[fieldIndex]![row]!
}

function evaluate(
  expression: KernelExpression,
  row: number,
  source: ExecutionColumns,
  captures: Readonly<Record<string, number | boolean>>,
): number | boolean {
  if (expression.op === "const") return expression.value
  if (expression.op === "load") return readField(expression, row, source)
  if (expression.op === "index") return row
  if (expression.op === "capture") {
    const value = captures[expression.name]
    if (value === undefined) throw new TypeError(`resident kernel capture is missing: ${expression.name}`)
    return value
  }
  if (expression.op === "unary") {
    const value = evaluate(expression.value, row, source, captures)
    if (expression.operator === "+") return +value
    if (expression.operator === "-") return -value
    if (expression.operator === "!") return !value
    return ~Number(value)
  }
  if (expression.op === "select") {
    return evaluate(expression.condition, row, source, captures)
      ? evaluate(expression.whenTrue, row, source, captures)
      : evaluate(expression.whenFalse, row, source, captures)
  }
  const left = evaluate(expression.left, row, source, captures)
  if (expression.operator === "&&") return left && evaluate(expression.right, row, source, captures)
  if (expression.operator === "||") return left || evaluate(expression.right, row, source, captures)
  if (expression.operator === "??") return left ?? evaluate(expression.right, row, source, captures)
  const right = evaluate(expression.right, row, source, captures)
  if (expression.operator === "+") return Number(left) + Number(right)
  if (expression.operator === "-") return Number(left) - Number(right)
  if (expression.operator === "*") return Number(left) * Number(right)
  if (expression.operator === "/") return Number(left) / Number(right)
  if (expression.operator === "%") return Number(left) % Number(right)
  if (expression.operator === "**") return Number(left) ** Number(right)
  if (expression.operator === "<") return left < right
  if (expression.operator === "<=") return left <= right
  if (expression.operator === ">") return left > right
  if (expression.operator === ">=") return left >= right
  if (expression.operator === "==") return left == right
  if (expression.operator === "!=") return left != right
  if (expression.operator === "===") return left === right
  if (expression.operator === "!==") return left !== right
  if (expression.operator === "&") return Number(left) & Number(right)
  if (expression.operator === "|") return Number(left) | Number(right)
  if (expression.operator === "^") return Number(left) ^ Number(right)
  if (expression.operator === "<<") return Number(left) << Number(right)
  if (expression.operator === ">>") return Number(left) >> Number(right)
  return Number(left) >>> Number(right)
}

function copyPackedColumns(source: PackedStorage, sink: PackedStorage, ranges: readonly PackedMutationRange[]): void {
  for (let index = 0; index < source.buffers.length; index += 1) {
    const input = source.buffers[index]!
    const output = sink.buffers[index]!
    if (input === output) continue
    for (const range of ranges) output.set(input.subarray(range.start, range.end), range.start)
  }
}

function executionRanges(storage: PackedStorage, ranges: readonly PackedMutationRange[] | undefined): readonly PackedMutationRange[] {
  if (!ranges || ranges.length === 0) {
    return storage.layout.length === 0
      ? Object.freeze([])
      : Object.freeze([Object.freeze({ start: 0, end: storage.layout.length })])
  }
  return normalizePackedRanges(ranges, storage.layout)
}

/**
 * Execute a fused packed region without materializing row objects. Both
 * storages are caller-owned so persistent regions can reuse their allocations.
 */
export function executeResidentRegionJS(
  region: ResidentRegionIR,
  sourceStorage: PackedStorage | PackedState,
  sinkStorage: PackedStorage | PackedState = sourceStorage,
  inputs: ResidentExecutionInputs = {},
): PackedStorage | PackedState {
  const sourceState = sourceStorage instanceof PackedState ? sourceStorage : null
  const sinkState = sinkStorage instanceof PackedState ? sinkStorage : null
  const source = sourceState?.storage ?? sourceStorage
  const sink = sinkState?.storage ?? sinkStorage
  if (!sameLayout(region.source.layout, source.layout)) throw new TypeError("resident source storage does not match region layout")
  if (!sameLayout(region.sink.layout, sink.layout)) throw new TypeError("resident sink storage does not match region layout")
  if (source.layout.length !== sink.layout.length) throw new RangeError("resident source and sink lengths differ")
  const ranges = inputs.ranges
    ? executionRanges(source, inputs.ranges)
    : sourceState
      ? sourceState.dirtyRanges
      : executionRanges(source, undefined)
  if (ranges.length === 0) return sinkState ?? sink
  copyPackedColumns(source, sink, ranges)
  const executionColumns = columns(sink)
  const captures = inputs.captures ?? Object.freeze({})
  const kernelValues = region.kernels.map(kernel => new Array<number | boolean>(kernel.kind === "map" ? kernel.outputs.length : 0))
  for (const range of ranges) {
    for (let row = range.start; row < range.end; row += 1) {
      for (let kernelIndex = 0; kernelIndex < region.kernels.length; kernelIndex += 1) {
        const kernel = region.kernels[kernelIndex]!
        if (kernel.kind !== "map") throw new TypeError("packed JS execution encountered a non-map kernel")
        const values = kernelValues[kernelIndex]!
        for (let outputIndex = 0; outputIndex < kernel.outputs.length; outputIndex += 1) {
          values[outputIndex] = evaluate(kernel.outputs[outputIndex]!.value, row, executionColumns, captures)
        }
        for (let outputIndex = 0; outputIndex < kernel.outputs.length; outputIndex += 1) {
          const output = kernel.outputs[outputIndex]!
          const fieldIndex = executionColumns.fields.get(output.name)
          if (fieldIndex === undefined) throw new TypeError(`resident kernel writes unknown packed field: ${output.name}`)
          executionColumns.buffers[fieldIndex]![row] = Number(values[outputIndex])
        }
      }
    }
  }
  if (sinkState) {
    const outputFields = changedOutputFields(region)
    sinkState.invalidate(ranges.map(range => Object.freeze({
      start: range.start,
      end: range.end,
      ...(outputFields ? { fields: outputFields } : {}),
    })), "external")
    return sinkState
  }
  sink.version += 1
  return sink
}

export function executeResidentRegionPackedState(
  region: ResidentRegionIR,
  sourceState: PackedState,
  sinkState: PackedState = sourceState,
  inputs: ResidentExecutionInputs = {},
): PackedStateChange | null {
  const ranges = inputs.ranges ? executionRanges(sourceState.storage, inputs.ranges) : sourceState.dirtyRanges
  if (ranges.length === 0) return null
  const result = executeResidentRegionJS(region, sourceState, sinkState, {
    ...inputs,
    ranges,
  })
  return result instanceof PackedState ? result.lastChange : null
}
