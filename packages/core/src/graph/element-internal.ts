import { decorate, snapshotRecord } from "./modifiers.js"
import type { ModifiableViewNode, ViewGraphChild } from "./types.js"

export function snapshotElementProps(type: unknown, props: Record<string, unknown>): Record<string, unknown> {
  const snapshot = snapshotRecord(props, true) as Record<string, unknown>
  if (typeof type !== "string" || type.includes("-")) return snapshot
  try {
    const normalized: Record<string, unknown> = {}
    for (const key of Reflect.ownKeys(snapshot)) {
      if (typeof key !== "string") continue
      const descriptor = Object.getOwnPropertyDescriptor(snapshot, key)
      if (!descriptor || !("value" in descriptor)) continue
      const value = descriptor.value
      const primitive = value === undefined || value === null || typeof value === "string" || typeof value === "boolean"
        || (typeof value === "number" && Number.isFinite(value))
      const supported = primitive
        || (key === "style" && typeof value === "object" && value !== null)
        || (key === "ref" && (typeof value === "object" || typeof value === "function"))
        || (/^on[A-Za-z]/.test(key) && typeof value === "function")
      if (supported) Object.defineProperty(normalized, key, { ...descriptor, configurable: true })
    }
    return Object.freeze(normalized)
  } catch {
    return Object.freeze({})
  }
}

/** Internal constructor for call sites that own the newly-created children array. */
export function viewElementOwned(type: unknown, props: Record<string, unknown> | null, children: ViewGraphChild[]): ModifiableViewNode {
  const normalizedProps = props === null ? null : snapshotElementProps(type, props)
  return decorate({ kind: "element" as const, type, props: normalizedProps, children: Object.freeze(children) }, true)
}
