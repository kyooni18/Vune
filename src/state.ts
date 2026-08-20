import { isValidElement, useSyncExternalStore } from 'react'
import type { StateRef, Value } from './types.js'

type Listener = () => void

interface StateRecord<T> {
  current: T
  listeners: Set<Listener>
  version: number
  proxies: WeakMap<object, object>
  raws: WeakMap<object, object>
}

const records = new WeakMap<object, StateRecord<any>>()
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

function unwrapStateValue<T>(value: T, record: StateRecord<unknown>): T {
  if (typeof value !== 'object' || value === null) return value
  return (record.raws.get(value as object) ?? value) as T
}

function wrapStateValue<T>(value: T, record: StateRecord<unknown>): T {
  const unwrapped = unwrapStateValue(value, record)
  if (!isReactiveContainer(unwrapped)) return unwrapped

  const existing = record.proxies.get(unwrapped)
  if (existing) return existing as T

  const proxy = new Proxy(unwrapped, {
    get(target, property, receiver) {
      return wrapStateValue(Reflect.get(target, property, receiver), record)
    },
    set(target, property, next) {
      const previous = Reflect.get(target, property, target)
      const rawNext = unwrapStateValue(next, record)
      const changed = !Object.is(unwrapStateValue(previous, record), rawNext)
      const updated = Reflect.set(target, property, rawNext, target)
      if (updated && changed) notify(record)
      return updated
    },
    deleteProperty(target, property) {
      const existed = Reflect.has(target, property)
      const deleted = Reflect.deleteProperty(target, property)
      if (deleted && existed) notify(record)
      return deleted
    },
  })

  record.proxies.set(unwrapped, proxy)
  record.raws.set(proxy, unwrapped)
  return proxy as T
}

export function State<T>(initial: T): StateRef<T> {
  const state = {} as StateRef<T>
  const record: StateRecord<T> = {
    current: initial,
    listeners: new Set(),
    version: 0,
    proxies: new WeakMap(),
    raws: new WeakMap(),
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
      const wrapped = wrapStateValue(next, record as StateRecord<unknown>)
      if (Object.is(record.current, wrapped)) return
      record.current = wrapped
      notify(record as StateRecord<unknown>)
    },
  })

  return state
}

export function subscribeState(state: StateRef<unknown>, listener: Listener): () => void {
  const record = records.get(state as object)
  if (!record) return () => undefined
  record.listeners.add(listener)
  return () => record.listeners.delete(listener)
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
 * With the Rui Vite macro, Action(expression) is rewritten to a lazy callback.
 * Action(() => expression) also works without the macro.
 */
export function Action<T>(expression: T | (() => T)): () => T {
  if (typeof expression === 'function') return expression as () => T
  return () => expression
}
