import type { EdgeInsets, GeometryProxy } from "./types.js"
import { arrayCheck } from "./arrays.js"

export const zeroGeometry: GeometryProxy = Object.freeze({
  frame: Object.freeze({ x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 }),
  size: Object.freeze({ width: 0, height: 0 }),
  safeAreaInsets: Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 }),
})

/** Normalize renderer-provided CSS safe-area values without introducing DOM dependencies. */
export function edgeInsetsFromCss(values: Partial<Record<keyof EdgeInsets, unknown>>): EdgeInsets {
  const number = (value: unknown): number => {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0
    if (typeof value !== "string") return 0
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  const own = (key: keyof EdgeInsets): unknown => {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(values, key)
      return descriptor && "value" in descriptor ? descriptor.value : undefined
    } catch {
      return undefined
    }
  }
  return Object.freeze({
    top: number(own("top")),
    right: number(own("right")),
    bottom: number(own("bottom")),
    left: number(own("left")),
  })
}

export function classNameOf(value: unknown): string {
  return classNamePart(value, new Set())
}

function classNamePart(value: unknown, seen: Set<unknown[]>): string {
  const array = arrayCheck(value)
  if (array === undefined) return ""
  if (array) {
    const values = value as unknown[]
    if (seen.has(values)) return ""
    seen.add(values)
    try {
      const length = Object.getOwnPropertyDescriptor(values, "length")
      if (!length || !("value" in length) || !Number.isSafeInteger(length.value) || length.value < 0) return ""
      const parts: string[] = []
      for (let index = 0; index < length.value; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(values, String(index))
        if (!descriptor || !("value" in descriptor)) continue
        const part = classNamePart(descriptor.value, seen)
        if (part) parts.push(part)
      }
      return parts.join(" ")
    } catch {
      return ""
    } finally {
      seen.delete(values)
    }
  }
  return typeof value === "string" ? value : ""
}
