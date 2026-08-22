/**
 * Renderer-independent identity storage for a mounted Muse View instance.
 * Renderers decide what constitutes an identity; the core only owns the
 * lifetime-safe object-keyed storage contract.
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

export function createViewIdentityStore(): ViewIdentityStore {
  return new ViewIdentityStore()
}
