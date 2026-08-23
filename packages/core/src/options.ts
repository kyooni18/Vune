import { arrayCheck } from "./graph/arrays.js"

export function snapshotOptionRecord(
  value: unknown,
  keys: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== "object" || value === null || arrayCheck(value) !== false) return undefined
  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return undefined
    const snapshot: Record<string, unknown> = {}
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor) continue
      if (!("value" in descriptor)) return undefined
      snapshot[key] = descriptor.value
    }
    return Object.freeze(snapshot)
  } catch {
    return undefined
  }
}

export function requireOptionRecord(
  value: unknown,
  keys: readonly string[],
  name: string,
): Readonly<Record<string, unknown>> {
  const snapshot = snapshotOptionRecord(value, keys)
  if (snapshot === undefined) throw new TypeError(`${name} options must be a data-only record`)
  return snapshot
}
