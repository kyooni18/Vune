import { actionClosure } from "./closures.js"
import { currentTransaction, snapshotTransaction, Transaction } from "./animation.js"
import { isViewNode } from "./graph/nodes.js"

declare const stateBrand: unique symbol
declare const bindingBrand: unique symbol

export interface StateRef<T> {
  value: T
  readonly [stateBrand]: true
}

export interface BindingRef<T> {
  value: T
  readonly [bindingBrand]: true
}
export type Value<T> = T | StateRef<T> | BindingRef<T> | (() => T)

export interface StateMutation {
  readonly kind: "replace" | "set" | "delete" | "define" | "array" | "invalidate"
  /** Raw reactive object that received the mutation, when one exists. */
  readonly target?: object
  readonly property?: PropertyKey
  readonly method?: string
  readonly previous?: unknown
  readonly value?: unknown
  readonly arguments?: readonly unknown[]
}

export interface StateMutationBatch {
  /** State version after this logical notification. */
  readonly version: number
  /** Mutations coalesced by the current State batch. */
  readonly mutations: readonly StateMutation[]
}

export type StateListener = (transaction: Transaction, batch: StateMutationBatch) => void
type Listener = StateListener

type OwnershipChange = "none" | "add" | "reconcile"

interface StateRecord<T> {
  current: T
  listeners: Set<Listener>
  version: number
  owners: Set<ReactiveOwner>
  rootArrayRefs?: Map<object, number>
  transaction: Transaction
  batchDepth: number
  pendingNotification: boolean
  pendingReconcile: boolean
  pendingMutations: StateMutation[]
  observedMutationClock: number
}

interface ReactiveOwner {
  raw: object
  records: Set<StateRecord<unknown>>
  proxies: WeakMap<StateRecord<unknown>, object>
}

const records = new WeakMap<object, StateRecord<any>>()
const bindings = new WeakSet<object>()
const owners = new WeakMap<object, ReactiveOwner>()
const proxyRaws = new WeakMap<object, object>()
const arrayMutators = new Map<PropertyKey, Function>([
  ["copyWithin", Array.prototype.copyWithin],
  ["fill", Array.prototype.fill],
  ["pop", Array.prototype.pop],
  ["push", Array.prototype.push],
  ["reverse", Array.prototype.reverse],
  ["shift", Array.prototype.shift],
  ["sort", Array.prototype.sort],
  ["splice", Array.prototype.splice],
  ["unshift", Array.prototype.unshift],
])
let activeCollector: ((state: StateRef<unknown>) => void) | null = null
// Nested mutations can happen while a renderer is between getSnapshot() and
// subscribe(). Owners are intentionally detached while a State has no live
// listeners, so retain a cheap global clock to conservatively detect that
// race without keeping every object graph strongly indexed at all times.
let reactiveMutationClock = 0

export function isStateRef(value: unknown): value is StateRef<unknown> {
  return typeof value === "object" && value !== null && records.has(value as object)
}

export function isBinding(value: unknown): value is BindingRef<unknown> {
  return typeof value === "object" && value !== null && bindings.has(value as object)
}

function reactiveContainer(value: unknown): value is object {
  if (typeof value !== "object" || value === null || records.has(value) || isViewNode(value)) return false
  try {
    if (Object.isFrozen(value)) return false
    if (owners.has(value)) return true
    if (Array.isArray(value)) return true
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}

function unwrap<T>(value: T): T {
  return typeof value === "object" && value !== null ? (proxyRaws.get(value as object) ?? value) as T : value
}

/** Stable raw identity used by fine-grained render executors and diagnostics. */
export function reactiveIdentity<T>(value: T): T {
  return unwrap(value)
}

function ownerFor(raw: object): ReactiveOwner {
  const existing = owners.get(raw)
  if (existing) return existing
  const owner = { raw, records: new Set<StateRecord<unknown>>(), proxies: new WeakMap<StateRecord<unknown>, object>() }
  owners.set(raw, owner)
  return owner
}

function snapshotMutation(mutation: StateMutation): StateMutation {
  const arguments_ = mutation.arguments
    ? Object.freeze(mutation.arguments.map(argument => unwrap(argument)))
    : undefined
  return Object.freeze({
    ...mutation,
    ...(mutation.previous === undefined ? {} : { previous: unwrap(mutation.previous) }),
    ...(mutation.value === undefined ? {} : { value: unwrap(mutation.value) }),
    ...(arguments_ ? { arguments: arguments_ } : {}),
  })
}

function dispatchNotification(record: StateRecord<unknown>): void {
  record.version += 1
  const mutations = Object.freeze(record.pendingMutations.splice(0))
  const batch: StateMutationBatch = Object.freeze({
    version: record.version,
    mutations: mutations.length > 0 ? mutations : Object.freeze([snapshotMutation({ kind: "invalidate" })]),
  })
  let failed = false
  let failure: unknown
  for (const listener of [...record.listeners]) {
    try { listener(record.transaction, batch) } catch (error) {
      if (!failed) { failed = true; failure = error }
    }
  }
  // A broken subscriber must not prevent sibling renderers from observing the
  // mutation. Preserve the caller-visible error after all listeners caught up.
  if (failed) throw failure
}

function notify(record: StateRecord<unknown>, mutation: StateMutation = { kind: "invalidate" }): void {
  record.transaction = snapshotTransaction(currentTransaction())
  record.pendingMutations.push(snapshotMutation(mutation))
  if (record.batchDepth > 0) {
    record.pendingNotification = true
    return
  }
  dispatchNotification(record)
}

function beginBatch(record: StateRecord<unknown>): void {
  record.batchDepth += 1
}

function endBatch(record: StateRecord<unknown>): void {
  if (record.batchDepth === 0) return
  record.batchDepth -= 1
  if (record.batchDepth > 0) return
  if (record.pendingReconcile) {
    record.pendingReconcile = false
    if (record.listeners.size > 0) reconcile(record)
  }
  if (record.pendingNotification) {
    record.pendingNotification = false
    dispatchNotification(record)
  }
}

function attach(record: StateRecord<unknown>, owner: ReactiveOwner): void {
  if (owner.records.has(record)) return
  owner.records.add(record)
  record.owners.add(owner)
}

function attachGraph(record: StateRecord<unknown>, value: unknown): void {
  // State values can be produced from deeply nested JSON or document trees.
  // Walking ownership recursively makes subscription depth depend on the JS
  // call-stack limit (only a few thousand nodes in Node/browser engines). Keep
  // the same descriptor-only, cycle-safe traversal on an explicit stack.
  const visited = new Set<object>()
  const pending: unknown[] = [value]
  while (pending.length > 0) {
    const raw = unwrap(pending.pop())
    if (!reactiveContainer(raw) || visited.has(raw)) continue
    visited.add(raw)
    attach(record, ownerFor(raw))
    let properties: readonly PropertyKey[]
    try {
      properties = Reflect.ownKeys(raw)
    } catch {
      // Proxies are allowed as State values. If they intentionally block
      // reflection, keep the reachable container itself reactive instead of
      // making subscription fail merely because its children are opaque.
      continue
    }
    for (const property of properties) {
      let descriptor: PropertyDescriptor | undefined
      try { descriptor = Object.getOwnPropertyDescriptor(raw, property) } catch { continue }
      if (descriptor && "value" in descriptor) pending.push(descriptor.value)
    }
  }
}

function detach(record: StateRecord<unknown>): void {
  for (const owner of record.owners) owner.records.delete(record)
  record.owners.clear()
  record.rootArrayRefs = undefined
}

function buildRootArrayRefs(record: StateRecord<unknown>): void {
  const raw = unwrap(record.current)
  if (!Array.isArray(raw)) {
    record.rootArrayRefs = undefined
    return
  }
  const refs = new Map<object, number>()
  let length = 0
  try { length = raw.length } catch { record.rootArrayRefs = undefined; return }
  for (let index = 0; index < length; index += 1) {
    let descriptor: PropertyDescriptor | undefined
    try { descriptor = Object.getOwnPropertyDescriptor(raw, String(index)) } catch { continue }
    if (!descriptor || !("value" in descriptor)) continue
    const value = unwrap(descriptor.value)
    if (!reactiveContainer(value)) continue
    refs.set(value, (refs.get(value) ?? 0) + 1)
  }
  record.rootArrayRefs = refs
}

function reconcile(record: StateRecord<unknown>): void {
  detach(record)
  attachGraph(record, record.current)
  buildRootArrayRefs(record)
}

function shallowReactiveLeaf(value: unknown): value is object {
  const raw = unwrap(value)
  if (!reactiveContainer(raw)) return false
  let properties: readonly PropertyKey[]
  try { properties = Reflect.ownKeys(raw) } catch { return false }
  for (const property of properties) {
    let descriptor: PropertyDescriptor | undefined
    try { descriptor = Object.getOwnPropertyDescriptor(raw, property) } catch { return false }
    if (!descriptor) continue
    if (!("value" in descriptor)) return false
    if (reactiveContainer(unwrap(descriptor.value))) return false
  }
  return true
}

function detachReactiveLeaf(record: StateRecord<unknown>, value: unknown): void {
  const raw = unwrap(value)
  if (!reactiveContainer(raw)) return
  const owner = owners.get(raw)
  if (!owner) return
  owner.records.delete(record)
  record.owners.delete(owner)
}

function updateRootArrayReference(
  record: StateRecord<unknown>,
  arrayOwner: ReactiveOwner,
  previous: unknown,
  next: unknown,
): boolean {
  if (!record.rootArrayRefs || unwrap(record.current) !== arrayOwner.raw) return false
  const previousRaw = unwrap(previous)
  const nextRaw = unwrap(next)
  const previousReactive = reactiveContainer(previousRaw)
  const nextReactive = reactiveContainer(nextRaw)

  if (previousReactive && !Object.is(previousRaw, nextRaw)) {
    const count = record.rootArrayRefs.get(previousRaw as object) ?? 0
    if (count <= 1) {
      record.rootArrayRefs.delete(previousRaw as object)
      if (shallowReactiveLeaf(previousRaw)) detachReactiveLeaf(record, previousRaw)
      else return false
    } else {
      record.rootArrayRefs.set(previousRaw as object, count - 1)
    }
  }

  if (nextReactive && !Object.is(previousRaw, nextRaw)) {
    const count = record.rootArrayRefs.get(nextRaw as object) ?? 0
    record.rootArrayRefs.set(nextRaw as object, count + 1)
    if (count === 0) attachGraph(record, nextRaw)
  }
  return true
}

function notifyRootArraySlot(
  owner: ReactiveOwner,
  previous: unknown,
  next: unknown,
  mutation: StateMutation,
): void {
  reactiveMutationClock += 1
  const affected = [...owner.records]
  for (const record of affected) {
    if (!updateRootArrayReference(record, owner, previous, next)) {
      const change = ownershipChange(previous, next)
      updateOwnership(record, change, change === "add" ? next : undefined)
    }
  }
  let failed = false
  let failure: unknown
  for (const record of affected) {
    try { notify(record, mutation) } catch (error) {
      if (!failed) { failed = true; failure = error }
    }
  }
  if (failed) throw failure
}

function notifyRootArrayRemoval(owner: ReactiveOwner, removed: unknown, mutation: StateMutation): void {
  reactiveMutationClock += 1
  const affected = [...owner.records]
  for (const record of affected) {
    if (!record.rootArrayRefs || unwrap(record.current) !== owner.raw || !reactiveContainer(unwrap(removed))) {
      updateOwnership(record, reactiveContainer(unwrap(removed)) ? "reconcile" : "none")
      continue
    }
    const raw = unwrap(removed)
    const count = record.rootArrayRefs.get(raw as object) ?? 0
    if (count <= 1) {
      record.rootArrayRefs.delete(raw as object)
      if (shallowReactiveLeaf(raw)) detachReactiveLeaf(record, raw)
      else requestReconcile(record)
    } else {
      record.rootArrayRefs.set(raw as object, count - 1)
    }
  }
  let failed = false
  let failure: unknown
  for (const record of affected) {
    try { notify(record, mutation) } catch (error) {
      if (!failed) { failed = true; failure = error }
    }
  }
  if (failed) throw failure
}

function requestReconcile(record: StateRecord<unknown>): void {
  if (record.listeners.size === 0) return
  if (record.batchDepth > 0) {
    record.pendingReconcile = true
    return
  }
  reconcile(record)
}

function ownershipChange(previous: unknown, next: unknown, previousExists = true): OwnershipChange {
  const left = unwrap(previous)
  const right = unwrap(next)
  if (previousExists && Object.is(left, right)) return "none"
  const previousReactive = previousExists && reactiveContainer(left)
  const nextReactive = reactiveContainer(right)
  if (!previousReactive && nextReactive) return "add"
  if (previousReactive) return "reconcile"
  return "none"
}

function updateOwnership(record: StateRecord<unknown>, change: OwnershipChange, addedValue?: unknown): void {
  if (record.listeners.size === 0 || change === "none") return
  if (change === "add") {
    attachGraph(record, addedValue)
    return
  }
  requestReconcile(record)
}

function notifyOwner(
  owner: ReactiveOwner,
  change: OwnershipChange = "reconcile",
  addedValue?: unknown,
  mutation: StateMutation = { kind: "invalidate", target: owner.raw },
): void {
  reactiveMutationClock += 1
  const affected = [...owner.records]
  for (const record of affected) updateOwnership(record, change, addedValue)
  let failed = false
  let failure: unknown
  for (const record of affected) {
    try { notify(record, mutation) } catch (error) {
      if (!failed) { failed = true; failure = error }
    }
  }
  // Shared raw objects may feed multiple State records. Keep every record's
  // version/listeners coherent even when one subscriber fails, then preserve
  // the first error for normal error-boundary/reporting behavior.
  if (failed) throw failure
}

function notifyOwnerAdditions(
  owner: ReactiveOwner,
  additions: readonly unknown[],
  mutation: StateMutation = { kind: "invalidate", target: owner.raw },
): void {
  reactiveMutationClock += 1
  const affected = [...owner.records]
  for (const record of affected) {
    if (record.listeners.size === 0) continue
    for (const addition of additions) {
      const raw = unwrap(addition)
      if (!reactiveContainer(raw)) continue
      if (record.rootArrayRefs && unwrap(record.current) === owner.raw) {
        const count = record.rootArrayRefs.get(raw as object) ?? 0
        record.rootArrayRefs.set(raw as object, count + 1)
        if (count === 0) attachGraph(record, raw)
      } else {
        attachGraph(record, raw)
      }
    }
  }
  let failed = false
  let failure: unknown
  for (const record of affected) {
    try { notify(record, mutation) } catch (error) {
      if (!failed) { failed = true; failure = error }
    }
  }
  if (failed) throw failure
}

function sameArraySnapshot(previous: readonly unknown[], current: readonly unknown[]): boolean {
  if (previous.length !== current.length) return false
  for (let index = 0; index < previous.length; index += 1) {
    if (!Object.is(unwrap(previous[index]), unwrap(current[index]))) return false
  }
  return true
}

function samePropertyDescriptor(left: PropertyDescriptor | undefined, right: PropertyDescriptor | undefined): boolean {
  if (!left || !right) return left === right
  if (left.configurable !== right.configurable || left.enumerable !== right.enumerable) return false
  const leftData = "value" in left || "writable" in left
  const rightData = "value" in right || "writable" in right
  if (leftData !== rightData) return false
  return leftData
    ? left.writable === right.writable && Object.is(unwrap(left.value), unwrap(right.value))
    : left.get === right.get && left.set === right.set
}

function wrap<T>(value: T, record: StateRecord<unknown>): T {
  const raw = unwrap(value)
  if (!reactiveContainer(raw)) return raw
  const owner = ownerFor(raw)
  const existing = owner.proxies.get(record)
  if (existing) return existing as T
  const mutatorCache = new Map<PropertyKey, Function>()
  const proxy = new Proxy(raw, {
    get(target, property, receiver) {
      const result = Reflect.get(target, property, receiver)
      const nativeMutator = Array.isArray(target) ? arrayMutators.get(property) : undefined
      if (nativeMutator && result === nativeMutator) {
        const cached = mutatorCache.get(property)
        if (cached) return cached
        const wrapper = function(this: unknown, ...arguments_: unknown[]) {
          const actual = unwrap(this)
          const actualOwner = typeof actual === "object" && actual !== null ? owners.get(actual as object) : undefined

          // The overwhelmingly common path is invoking the mutator on the
          // State proxy it came from. Execute the native operation against the
          // raw array so thousands of index writes do not each bounce through
          // Proxy set/delete traps. We still preserve one logical State
          // notification and the ownership semantics of the operation.
          if (actual === raw && actualOwner === owner && Array.isArray(actual)) {
            const mutatorArguments = [...arguments_]
            if (property === "push" || property === "unshift") {
              for (let index = 0; index < mutatorArguments.length; index += 1) mutatorArguments[index] = unwrap(mutatorArguments[index])
            } else if (property === "splice") {
              for (let index = 2; index < mutatorArguments.length; index += 1) mutatorArguments[index] = unwrap(mutatorArguments[index])
            } else if (property === "fill" && mutatorArguments.length > 0) {
              mutatorArguments[0] = unwrap(mutatorArguments[0])
            } else if (property === "sort" && typeof mutatorArguments[0] === "function") {
              const compare = mutatorArguments[0] as (left: unknown, right: unknown) => number
              mutatorArguments[0] = (left: unknown, right: unknown) => compare(wrap(left, record), wrap(right, record))
            }

            const previous = property === "push" || property === "unshift" || property === "pop" || property === "shift"
              ? undefined
              : Array.prototype.slice.call(actual) as unknown[]
            const previousLength = actual.length
            const result = Reflect.apply(nativeMutator, actual, mutatorArguments)
            const changed = property === "push" || property === "unshift"
              ? mutatorArguments.length > 0
              : property === "pop" || property === "shift"
                ? previousLength > 0
                : !sameArraySnapshot(previous ?? [], actual)

            if (changed) {
              const mutation: StateMutation = {
                kind: "array",
                target: actual,
                method: String(property),
                arguments: mutatorArguments,
              }
              if (property === "reverse" || property === "sort") {
                notifyOwner(owner, "none", undefined, mutation)
              } else if (property === "push" || property === "unshift") {
                const additions = mutatorArguments.filter(value => reactiveContainer(unwrap(value)))
                if (additions.length > 0) notifyOwnerAdditions(owner, additions, mutation)
                else notifyOwner(owner, "none", undefined, mutation)
              } else if (property === "pop" && reactiveContainer(unwrap(result))) {
                notifyRootArrayRemoval(owner, result, mutation)
              } else if ((property === "pop" || property === "shift") && !reactiveContainer(unwrap(result))) {
                notifyOwner(owner, "none", undefined, mutation)
              } else {
                notifyOwner(owner, "reconcile", undefined, mutation)
              }
            }

            if (property === "reverse" || property === "sort" || property === "copyWithin" || property === "fill") return this
            if (property === "pop" || property === "shift") return wrap(result, record)
            if (property === "splice" && Array.isArray(result)) return result.map(item => wrap(item, record))
            return result
          }

          // Borrowed methods (`const push = first.value.push; push.call(second,
          // ...)`) keep the fully generic Proxy path. This preserves JS method
          // borrowing semantics without complicating the hot path above.
          const batched = actualOwner ? [...actualOwner.records] : []
          for (const affected of batched) beginBatch(affected)
          let failed = false
          let failure: unknown
          let result: unknown
          try {
            result = Reflect.apply(nativeMutator, this, arguments_)
          } catch (error) {
            failed = true
            failure = error
          }
          for (let index = batched.length - 1; index >= 0; index -= 1) {
            try { endBatch(batched[index]) } catch (error) {
              if (!failed) { failed = true; failure = error }
            }
          }
          if (failed) throw failure
          return result
        }
        mutatorCache.set(property, wrapper)
        return wrapper
      }
      return wrap(result, record)
    },
    set(target, property, next) {
      const normalized = unwrap(next)
      const descriptor = Reflect.getOwnPropertyDescriptor(target, property)
      const changed = !descriptor || !("value" in descriptor) || !Object.is(unwrap(descriptor.value), normalized)
      const change = descriptor && "value" in descriptor
        ? ownershipChange(descriptor.value, normalized)
        : ownershipChange(undefined, normalized, false)
      const previous = descriptor && "value" in descriptor ? unwrap(descriptor.value) : undefined
      const updated = Reflect.set(target, property, normalized, target)
      if (updated && changed) {
        const mutation: StateMutation = { kind: "set", target, property, previous, value: normalized }
        const index = Array.isArray(target) && typeof property !== "symbol" ? Number(property) : Number.NaN
        if (Array.isArray(target) && Number.isSafeInteger(index) && index >= 0 && String(index) === String(property)) {
          notifyRootArraySlot(owner, previous, normalized, mutation)
        } else {
          notifyOwner(owner, change, change === "add" ? normalized : undefined, mutation)
        }
      }
      return updated
    },
    deleteProperty(target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, property)
      const existed = descriptor !== undefined
      const deleted = Reflect.deleteProperty(target, property)
      if (deleted && existed) {
        const change = descriptor && "value" in descriptor && reactiveContainer(unwrap(descriptor.value)) ? "reconcile" : "none"
        notifyOwner(owner, change, undefined, {
          kind: "delete",
          target,
          property,
          previous: descriptor && "value" in descriptor ? descriptor.value : undefined,
        })
      }
      return deleted
    },
    defineProperty(target, property, descriptor) {
      const previous = Reflect.getOwnPropertyDescriptor(target, property)
      const normalized = "value" in descriptor ? { ...descriptor, value: unwrap(descriptor.value) } : descriptor
      const defined = Reflect.defineProperty(target, property, normalized)
      const current = Reflect.getOwnPropertyDescriptor(target, property)
      if (defined && !samePropertyDescriptor(previous, current)) {
        const previousValue = previous && "value" in previous ? previous.value : undefined
        const currentValue = current && "value" in current ? current.value : undefined
        const change = ownershipChange(previousValue, currentValue, Boolean(previous && "value" in previous))
        notifyOwner(owner, change, change === "add" ? currentValue : undefined, {
          kind: "define",
          target,
          property,
          previous: previousValue,
          value: currentValue,
        })
      }
      return defined
    },
    setPrototypeOf(target, prototype) {
      const previous = Reflect.getPrototypeOf(target)
      const updated = Reflect.setPrototypeOf(target, prototype)
      if (updated && previous !== prototype) notifyOwner(owner, "reconcile", undefined, {
        kind: "invalidate",
        target,
      })
      return updated
    },
    preventExtensions(target) {
      const wasExtensible = Reflect.isExtensible(target)
      const updated = Reflect.preventExtensions(target)
      if (updated && wasExtensible) notifyOwner(owner, "reconcile", undefined, {
        kind: "invalidate",
        target,
      })
      return updated
    },
  })
  owner.proxies.set(record, proxy)
  proxyRaws.set(proxy, raw)
  return proxy as T
}

export function State<T>(initial: T): StateRef<T> {
  const state = {} as StateRef<T>
  const record: StateRecord<T> = {
    current: initial,
    listeners: new Set(),
    version: 0,
    owners: new Set(),
    transaction: new Transaction(),
    batchDepth: 0,
    pendingNotification: false,
    pendingReconcile: false,
    pendingMutations: [],
    observedMutationClock: reactiveMutationClock,
  }
  record.current = wrap(initial, record as StateRecord<unknown>)
  records.set(state as object, record)
  Object.defineProperty(state, "value", {
    enumerable: true,
    get() { activeCollector?.(state as StateRef<unknown>); return record.current },
    set(next: T) {
      const previous = unwrap(record.current)
      const rawNext = unwrap(next)
      if (Object.is(previous, rawNext)) return
      detach(record as StateRecord<unknown>)
      record.current = wrap(rawNext, record as StateRecord<unknown>) as T
      if (record.listeners.size) reconcile(record as StateRecord<unknown>)
      notify(record as StateRecord<unknown>, { kind: "replace", previous, value: rawNext })
    },
  })
  return state
}

export function subscribeState(state: StateRef<unknown>, listener: Listener): () => void {
  const record = records.get(state as object)
  if (!record) return () => undefined
  const first = record.listeners.size === 0
  if (first && record.observedMutationClock !== reactiveMutationClock) {
    // useSyncExternalStore reads its snapshot before subscribing. If any
    // reactive object changed in that gap, advance this State's snapshot
    // conservatively so the renderer performs its mandatory post-subscribe
    // recheck instead of potentially committing stale nested data.
    record.version += 1
    record.observedMutationClock = reactiveMutationClock
  }
  record.listeners.add(listener)
  if (first) reconcile(record)
  let active = true
  return () => {
    if (!active) return
    active = false
    record.listeners.delete(listener)
    if (!record.listeners.size) {
      record.pendingNotification = false
      record.pendingReconcile = false
      record.pendingMutations.length = 0
      detach(record)
      record.observedMutationClock = reactiveMutationClock
    }
  }
}

export function collectStateReads<T>(compute: () => T, collector: (state: StateRef<unknown>) => void): T {
  const previous = activeCollector
  activeCollector = collector
  try { return compute() } finally { activeCollector = previous }
}

export function stateVersion(state: StateRef<unknown>): number {
  const record = records.get(state as object)
  if (!record) return 0
  if (record.listeners.size === 0 && record.observedMutationClock !== reactiveMutationClock) {
    // Detached States cannot cheaply know which shared nested object changed.
    // A conservative bump is preferable to a missed external-store snapshot;
    // once subscribed, owner tracking makes notifications precise again.
    record.version += 1
    record.observedMutationClock = reactiveMutationClock
  }
  return record.version
}

/** Transaction attached to the most recent mutation of this State. */
export function stateTransaction(state: StateRef<unknown>): Transaction {
  return snapshotTransaction(records.get(state as object)?.transaction)
}

export function resolveValue<T>(value: Value<T>): T {
  if (typeof value === "function") return (value as () => T)()
  if (isStateRef(value) || isBinding(value)) return value.value as T
  return value as T
}

export function Binding<T>(source: StateRef<T> | BindingRef<T>): BindingRef<T>
export function Binding<T>(get: () => T, set: (value: T) => void): BindingRef<T>
export function Binding<T>(sourceOrGet: StateRef<T> | BindingRef<T> | (() => T), set?: (value: T) => void): BindingRef<T> {
  const binding = {} as BindingRef<T>
  Object.defineProperty(binding, "value", {
    enumerable: true,
    get: typeof sourceOrGet === "function" ? sourceOrGet : () => sourceOrGet.value,
    set: typeof sourceOrGet === "function" ? (set ?? (() => undefined)) : (value: T) => { sourceOrGet.value = value },
  })
  bindings.add(binding as object)
  return binding
}

export function Action<T>(expression: T | (() => T)): () => T {
  return actionClosure(typeof expression === "function" ? expression as () => T : () => expression)
}
