import { useEffect, useReducer, useRef } from 'react'
import type { StateRef, Value } from './types.js'

type Listener = () => void
interface StateRecord<T> {
  current: T
  listeners: Set<Listener>
}

const records = new WeakMap<object, StateRecord<any>>()
let activeCollector: ((state: StateRef<unknown>) => void) | null = null

export function isStateRef(value: unknown): value is StateRef<unknown> {
  return typeof value === 'object' && value !== null && records.has(value as object)
}

export function State<T>(initial: T): StateRef<T> {
  const state = {} as StateRef<T>
  const record: StateRecord<T> = { current: initial, listeners: new Set() }
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

export function useReactiveValue<T>(compute: () => T): T {
  const [, rerender] = useReducer((version: number) => version + 1, 0)
  const subscriptions = useRef(new Map<StateRef<unknown>, () => void>())
  const dependencies = new Set<StateRef<unknown>>()
  const value = collectStateReads(compute, state => dependencies.add(state))

  useEffect(() => {
    for (const [state, unsubscribe] of subscriptions.current) {
      if (!dependencies.has(state)) {
        unsubscribe()
        subscriptions.current.delete(state)
      }
    }
    for (const state of dependencies) {
      if (!subscriptions.current.has(state)) {
        subscriptions.current.set(state, subscribeState(state, () => rerender()))
      }
    }
  })

  useEffect(() => () => {
    for (const unsubscribe of subscriptions.current.values()) unsubscribe()
    subscriptions.current.clear()
  }, [])

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
