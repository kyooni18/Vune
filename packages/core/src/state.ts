import { actionClosure } from "./closures.js"
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
type Listener = () => void

interface StateRecord<T> {
  current: T
  listeners: Set<Listener>
  version: number
  owners: Set<ReactiveOwner>
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
let activeCollector: ((state: StateRef<unknown>) => void) | null = null

export function isStateRef(value: unknown): value is StateRef<unknown> {
  return typeof value === "object" && value !== null && records.has(value as object)
}

export function isBinding(value: unknown): value is BindingRef<unknown> {
  return typeof value === "object" && value !== null && bindings.has(value as object)
}

function reactiveContainer(value: unknown): value is object {
  if (typeof value !== "object" || value === null || records.has(value) || isViewNode(value) || Object.isFrozen(value)) return false
  if (Array.isArray(value)) return true
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
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

function notify(record: StateRecord<unknown>): void {
  record.version += 1
  for (const listener of [...record.listeners]) listener()
}

function notifyOwner(owner: ReactiveOwner): void {
  const affected = [...owner.records]
  for (const record of affected) notify(record)
  for (const record of affected) {
    if (record.listeners.size > 0) reconcile(record as StateRecord<unknown>)
  }
}

function attach(record: StateRecord<unknown>, owner: ReactiveOwner): void {
  if (owner.records.has(record)) return
  owner.records.add(record)
  record.owners.add(owner)
}

function detach(record: StateRecord<unknown>): void {
  for (const owner of record.owners) owner.records.delete(record)
  record.owners.clear()
}

function wrap<T>(value: T, record: StateRecord<unknown>): T {
  const raw = unwrap(value)
  if (!reactiveContainer(raw)) return raw
  const owner = ownerFor(raw)
  const existing = owner.proxies.get(record)
  if (existing) return existing as T
  const proxy = new Proxy(raw, {
    get(target, property, receiver) { return wrap(Reflect.get(target, property, receiver), record) },
    set(target, property, next) {
      const previous = Reflect.get(target, property, target)
      const changed = !Object.is(unwrap(previous), unwrap(next))
      const updated = Reflect.set(target, property, unwrap(next), target)
      if (updated && changed) notifyOwner(owner)
      return updated
    },
    deleteProperty(target, property) {
      const existed = Reflect.has(target, property)
      const deleted = Reflect.deleteProperty(target, property)
      if (deleted && existed) notifyOwner(owner)
      return deleted
    },
  })
  owner.proxies.set(record, proxy)
  proxyRaws.set(proxy, raw)
  return proxy as T
}

function reconcile(record: StateRecord<unknown>): void {
  detach(record)
  const visited = new Set<object>()
  const visit = (value: unknown): void => {
    const raw = unwrap(value)
    if (!reactiveContainer(raw) || visited.has(raw)) return
    visited.add(raw)
    attach(record, ownerFor(raw))
    for (const property of Reflect.ownKeys(raw)) {
      const descriptor = Object.getOwnPropertyDescriptor(raw, property)
      if (descriptor && "value" in descriptor) visit(descriptor.value)
    }
  }
  visit(record.current)
}

export function State<T>(initial: T): StateRef<T> {
  const state = {} as StateRef<T>
  const record: StateRecord<T> = { current: initial, listeners: new Set(), version: 0, owners: new Set() }
  record.current = wrap(initial, record)
  records.set(state as object, record)
  Object.defineProperty(state, "value", {
    enumerable: true,
    get() { activeCollector?.(state as StateRef<unknown>); return record.current },
    set(next: T) {
      detach(record as StateRecord<unknown>)
      const wrapped = wrap(next, record as StateRecord<unknown>)
      if (Object.is(record.current, wrapped)) { if (record.listeners.size) reconcile(record as StateRecord<unknown>); return }
      record.current = wrapped
      if (record.listeners.size) reconcile(record as StateRecord<unknown>)
      notify(record as StateRecord<unknown>)
    },
  })
  return state
}

export function subscribeState(state: StateRef<unknown>, listener: Listener): () => void {
  const record = records.get(state as object)
  if (!record) return () => undefined
  record.listeners.add(listener)
  reconcile(record)
  let active = true
  return () => { if (!active) return; active = false; record.listeners.delete(listener); if (!record.listeners.size) detach(record) }
}

export function collectStateReads<T>(compute: () => T, collector: (state: StateRef<unknown>) => void): T {
  const previous = activeCollector
  activeCollector = collector
  try { return compute() } finally { activeCollector = previous }
}

export function stateVersion(state: StateRef<unknown>): number {
  return records.get(state as object)?.version ?? 0
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
