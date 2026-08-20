import { isValidElement, useSyncExternalStore } from 'react'
import type { StateRef, Value } from './types.js'

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
const owners = new WeakMap<object, ReactiveOwner>()
const proxyRaws = new WeakMap<object, object>()
let activeCollector: ((state: StateRef<unknown>) => void) | null = null

export function isStateRef(value: unknown): value is StateRef<unknown> {
  return typeof value === 'object' && value !== null && records.has(value as object)
}

function isReactiveContainer(value: unknown): value is object {
  if (typeof value !== 'object' || value === null) return false
  if (records.has(value)) return false
  if (isValidElement(value) || Object.isFrozen(value)) return false
  if (Array.isArray(value)) return true
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function notify(record: StateRecord<unknown>): void {
  record.version += 1
  for (const listener of [...record.listeners]) listener()
}

function notifyOwner(owner: ReactiveOwner): void {
  const affected = [...owner.records]
  for (const record of affected) notify(record)
  for (const record of affected) {
    if (record.listeners.size > 0) reconcileRecordOwners(record)
  }
}

function attachRecord(owner: ReactiveOwner, record: StateRecord<unknown>): void {
  if (owner.records.has(record)) return
  owner.records.add(record)
  record.owners.add(owner)
}

function detachRecord(record: StateRecord<unknown>): void {
  for (const owner of record.owners) owner.records.delete(record)
  record.owners.clear()
}

function unwrapStateValue<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value
  return (proxyRaws.get(value as object) ?? value) as T
}

function ownerFor(raw: object): ReactiveOwner {
  const existing = owners.get(raw)
  if (existing) return existing

  const owner = {} as ReactiveOwner
  owner.raw = raw
  owner.records = new Set()
  owner.proxies = new WeakMap()
  owners.set(raw, owner)
  return owner
}

function wrapStateValue<T>(value: T, record: StateRecord<unknown>): T {
  const unwrapped = unwrapStateValue(value)
  if (!isReactiveContainer(unwrapped)) return unwrapped

  const owner = ownerFor(unwrapped)
  const existing = owner.proxies.get(record)
  if (existing) return existing as T

  const proxy = new Proxy(unwrapped, {
    get(target, property, receiver) {
      return wrapStateValue(Reflect.get(target, property, receiver), record)
    },
    set(target, property, next) {
      const previous = Reflect.get(target, property, target)
      const rawNext = unwrapStateValue(next)
      const changed = !Object.is(unwrapStateValue(previous), rawNext)
      const updated = Reflect.set(target, property, rawNext, target)
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
  proxyRaws.set(proxy, unwrapped)
  return proxy as T
}

function reconcileRecordOwners(record: StateRecord<unknown>): void {
  detachRecord(record)

  const visited = new Set<object>()
  const visit = (value: unknown): void => {
    const raw = unwrapStateValue(value)
    if (!isReactiveContainer(raw) || visited.has(raw)) return
    visited.add(raw)

    const owner = ownerFor(raw)
    attachRecord(owner, record)

    for (const property of Reflect.ownKeys(raw)) {
      const descriptor = Object.getOwnPropertyDescriptor(raw, property)
      if (!descriptor || !('value' in descriptor)) continue
      visit(descriptor.value)
    }
  }

  visit(record.current)
}

export function State<T>(initial: T): StateRef<T> {
  const state = {} as StateRef<T>
  const record: StateRecord<T> = {
    current: initial,
    listeners: new Set(),
    version: 0,
    owners: new Set(),
  }
  record.current = wrapStateValue(initial, record as StateRecord<unknown>)
  records.set(state as object, record)

  Object.defineProperty(state, 'value', {
    enumerable: true,
    configurable: false,
    get() {
      activeCollector?.(state as StateRef<unknown>)
      return record.current
    },
    set(next: T) {
      detachRecord(record as StateRecord<unknown>)
      const wrapped = wrapStateValue(next, record as StateRecord<unknown>)
      if (Object.is(record.current, wrapped)) {
        if (record.listeners.size > 0) reconcileRecordOwners(record as StateRecord<unknown>)
        return
      }
      record.current = wrapped
      if (record.listeners.size > 0) reconcileRecordOwners(record as StateRecord<unknown>)
      notify(record as StateRecord<unknown>)
    },
  })

  return state
}

export function subscribeState(state: StateRef<unknown>, listener: Listener): () => void {
  const record = records.get(state as object)
  if (!record) return () => undefined
  record.listeners.add(listener)
  reconcileRecordOwners(record)
  let active = true
  return () => {
    if (!active) return
    active = false
    record.listeners.delete(listener)
    if (record.listeners.size === 0) detachRecord(record)
  }
}

export function collectStateReads<T>(
  compute: () => T,
  collector: (state: StateRef<unknown>) => void,
): T {
  const previous = activeCollector
  activeCollector = collector
  try {
    return compute()
  } finally {
    activeCollector = previous
  }
}

function dependencyVersion(dependencies: ReadonlySet<StateRef<unknown>>): number {
  let version = 0
  for (const state of dependencies) {
    version += records.get(state as object)?.version ?? 0
  }
  return version
}

export function useReactiveValue<T>(compute: () => T): T {
  const dependencies = new Set<StateRef<unknown>>()
  const value = collectStateReads(compute, state => dependencies.add(state))

  useSyncExternalStore(
    listener => {
      const unsubscribers = [...dependencies].map(state => subscribeState(state, listener))
      return () => {
        for (const unsubscribe of unsubscribers) unsubscribe()
      }
    },
    () => dependencyVersion(dependencies),
    () => dependencyVersion(dependencies),
  )

  return value
}

export function resolveValue<T>(value: Value<T>): T {
  if (typeof value === 'function') return (value as () => T)()
  if (isStateRef(value)) return value.value as T
  return value as T
}

/**
 * With the Muse Vite macro, Action(expression) is rewritten to a lazy callback.
 * Action(() => expression) also works without the macro.
 */
export function Action<T>(expression: T | (() => T)): () => T {
  if (typeof expression === 'function') return expression as () => T
  return () => expression
}
