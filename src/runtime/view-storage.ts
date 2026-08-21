import { useRef } from 'react'

/**
 * Per-mounted-View storage. The storage is owned by Muse's View runtime; the
 * React hook is only the host-specific lifetime primitive used underneath.
 */
export interface ViewIdentityStorage<T> {
  initialized: boolean
  value: T | undefined
}

/** Renderer-independent lifetime store keyed by a mounted View identity. */
export interface ViewIdentityStore<T> {
  getOrCreate(identity: object, factory: () => T): T
  delete(identity: object): void
}

export function createViewIdentityStore<T>(): ViewIdentityStore<T> {
  const values = new WeakMap<object, T>()
  return {
    getOrCreate(identity, factory) {
      if (values.has(identity)) return values.get(identity) as T
      const created = factory()
      values.set(identity, created)
      return created
    },
    delete(identity) {
      values.delete(identity)
    },
  }
}

export function useViewIdentityStorage<T>(factory: () => T): T {
  const identity = useRef<object | null>(null)
  if (identity.current === null) identity.current = {}
  const store = useRef<ViewIdentityStore<T> | null>(null)
  if (store.current === null) store.current = createViewIdentityStore<T>()
  return store.current.getOrCreate(identity.current, factory)
}
