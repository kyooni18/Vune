import type { EdgeInsets, GeometryProxy } from "./types.js"

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
  return Object.freeze({
    top: number(values.top),
    right: number(values.right),
    bottom: number(values.bottom),
    left: number(values.left),
  })
}

export function classNameOf(value: unknown): string {
  if (Array.isArray(value)) return value.map(classNameOf).filter(Boolean).join(" ")
  return typeof value === "string" ? value : ""
}
