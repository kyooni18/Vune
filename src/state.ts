import { useSyncExternalStore } from 'react'
import type { StateRef, Value } from './types.js'

type Listener = () => void

interface StateRecord<T> {
  current: T
  listeners: Set<Listener>
  version: number
}

const records = new WeakMap<object, StateRecord<any>>()
let activeCollector: ((state: StateRef<unknown>) => void) | null = null

export function isStateRef(value: unknown): value is StateRef<unknown> {
  return typeof value === 'object' && value !== null && records.has(value as object)
}

export function State<T>(initial: T): StateRef<T> {
  const state = {} as StateRef<T>
  const record: StateRecord<T> = {
    current: initial,
    listeners: new Set(),
    version: 0,
  }
  records.set(state as object, record)

  Object.defineProperty(state, 'value', {
    enumerable: true,
    configurable: false,
    get() {
      activeCollector?.(state as StateRef<unknown>)
      return record.current
    },
    set(next: T) {
      if (Object.is(record.current, next)) return
      record.current = next
      record.version += 1
      for (const listener of [...record.listeners]) listener()
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
 * With the Vune Vite macro, Action(expression) is rewritten to a lazy callback.
 * Action(() => expression) also works without the macro.
 */
export function Action<T>(expression: T | (() => T)): () => T {
  if (typeof expression === 'function') return expression as () => T
  return () => expression
}
