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
type Listener = (transaction: Transaction) => void

type OwnershipChange = "none" | "add" | "reconcile"

interface StateRecord<T> {
  current: T
  listeners: Set<Listener>
  version: number
  owners: Set<ReactiveOwner>
  transaction: Transaction
  batchDepth: number
  pendingNotification: boolean
  pendingReconcile: boolean
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

function ownerFor(raw: object): ReactiveOwner {
  const existing = owners.get(raw)
  if (existing) return existing
  const owner = { raw, records: new Set<StateRecord<unknown>>(), proxies: new WeakMap<StateRecord<unknown>, object>() }
  owners.set(raw, owner)
  return owner
}

function dispatchNotification(record: StateRecord<unknown>): void {
  record.version += 1
  let failed = false
  let failure: unknown
  for (const listener of [...record.listeners]) {
    try { listener(record.transaction) } catch (error) {
      if (!failed) { failed = true; failure = error }
    }
  }
  // A broken subscriber must not prevent sibling renderers from observing the
  // mutation. Preserve the caller-visible error after all listeners caught up.
  if (failed) throw failure
}

function notify(record: StateRecord<unknown>): void {
  record.transaction = snapshotTransaction(currentTransaction())
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
}

function reconcile(record: StateRecord<unknown>): void {
  detach(record)
  attachGraph(record, record.current)
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

function notifyOwner(owner: ReactiveOwner, change: OwnershipChange = "reconcile", addedValue?: unknown): void {
  reactiveMutationClock += 1
  const affected = [...owner.records]
  for (const record of affected) updateOwnership(record, change, addedValue)
  let failed = false
  let failure: unknown
  for (const record of affected) {
    try { notify(record) } catch (error) {
      if (!failed) { failed = true; failure = error }
    }
  }
  // Shared raw objects may feed multiple State records. Keep every record's
  // version/listeners coherent even when one subscriber fails, then preserve
  // the first error for normal error-boundary/reporting behavior.
  if (failed) throw failure
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
      const updated = Reflect.set(target, property, normalized, target)
      if (updated && changed) notifyOwner(owner, change, change === "add" ? normalized : undefined)
      return updated
    },
    deleteProperty(target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, property)
      const existed = descriptor !== undefined
      const deleted = Reflect.deleteProperty(target, property)
      if (deleted && existed) {
        const change = descriptor && "value" in descriptor && reactiveContainer(unwrap(descriptor.value)) ? "reconcile" : "none"
        notifyOwner(owner, change)
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
        notifyOwner(owner, change, change === "add" ? currentValue : undefined)
      }
      return defined
    },
    setPrototypeOf(target, prototype) {
      const previous = Reflect.getPrototypeOf(target)
      const updated = Reflect.setPrototypeOf(target, prototype)
      if (updated && previous !== prototype) notifyOwner(owner, "reconcile")
      return updated
    },
    preventExtensions(target) {
      const wasExtensible = Reflect.isExtensible(target)
      const updated = Reflect.preventExtensions(target)
      if (updated && wasExtensible) notifyOwner(owner, "reconcile")
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
    observedMutationClock: reactiveMutationClock,
  }
  record.current = wrap(initial, record as StateRecord<unknown>)
  records.set(state as object, record)
  Object.defineProperty(state, "value", {
    enumerable: true,
    get() { activeCollector?.(state as StateRef<unknown>); return record.current },
    set(next: T) {
      const rawNext = unwrap(next)
      if (Object.is(unwrap(record.current), rawNext)) return
      detach(record as StateRecord<unknown>)
      record.current = wrap(rawNext, record as StateRecord<unknown>) as T
      if (record.listeners.size) reconcile(record as StateRecord<unknown>)
      notify(record as StateRecord<unknown>)
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
