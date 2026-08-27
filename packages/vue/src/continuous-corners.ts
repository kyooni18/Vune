import { continuousCornerPath } from "@vune-ui/core/corners"

const observers = new WeakMap<Element, ResizeObserver>()

function radius(value: string, size: number): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? (value.trim().endsWith("%") ? parsed * size / 100 : parsed) : 0
}

function update(element: Element): void {
  if (typeof HTMLElement === "undefined" || !(element instanceof HTMLElement)) return
  const width = element.offsetWidth
  const height = element.offsetHeight
  if (width <= 0 || height <= 0) return
  const size = Math.min(width, height)
  const css = getComputedStyle(element)
  const smoothing = Number.parseFloat(css.getPropertyValue("--vune-corner-smoothing"))
  const path = continuousCornerPath(width, height, {
    topLeft: radius(css.borderTopLeftRadius, size),
    topRight: radius(css.borderTopRightRadius, size),
    bottomRight: radius(css.borderBottomRightRadius, size),
    bottomLeft: radius(css.borderBottomLeftRadius, size),
  }, Number.isFinite(smoothing) ? smoothing : 0.6)
  const clip = `path('${path}')`
  element.style.clipPath = clip
  ;(element.style as CSSStyleDeclaration & { webkitClipPath?: string }).webkitClipPath = clip
}

export function attachContinuousCornerRef(value: unknown): void {
  if (typeof Element === "undefined" || !(value instanceof Element)) return
  update(value)
  if (typeof ResizeObserver === "undefined") return
  observers.get(value)?.disconnect()
  const observer = new ResizeObserver(() => update(value))
  observer.observe(value)
  observers.set(value, observer)
}
