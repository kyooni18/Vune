/**
 * Renderer-independent identity storage for a mounted Muse View instance.
 * Muse traversal decides identity; renderers only bind storage and native
 * reconciliation to this renderer-independent contract.
 */
export class ViewIdentityStore {
  private values = new WeakMap<object, unknown>()

  getOrCreate<T>(identity: object, create: () => T): T {
    if (this.values.has(identity)) return this.values.get(identity) as T
    const value = create()
    this.values.set(identity, value)
    return value
  }

  delete(identity: object): void {
    this.values.delete(identity)
  }

  clear(): void {
    this.values = new WeakMap<object, unknown>()
  }
}

export type ViewIdentitySegment = string | number
export type ViewIdentity = readonly ViewIdentitySegment[]

export function viewIdentityKey(identity: ViewIdentity): string {
  return identity.map(segment => `${typeof segment === "number" ? "n" : "s"}:${String(segment).length}:${String(segment)}`).join("|")
}

export function keyedViewIdentity(identity: ViewIdentity, key: string | number): ViewIdentity {
  const tail = identity.at(-2)
  const parent = tail === "array" || tail === "element" || tail === "fragment" ? identity.slice(0, -2) : identity
  return [...parent, "key", key]
}

export function createViewIdentityStore(): ViewIdentityStore {
  return new ViewIdentityStore()
}
