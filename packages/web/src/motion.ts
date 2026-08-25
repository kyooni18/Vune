import {
  animateInterpolated,
  curves,
  smooth,
  spring,
  timing,
  type AnimationControls,
  type MotionSpec,
} from "o0o0o"
import type { Animation } from "@vune-ui/core"

type StyleValue = unknown

const activeAnimations = new WeakMap<Element, Map<string, AnimationControls>>()

function controlsFor(element: Element): Map<string, AnimationControls> {
  let controls = activeAnimations.get(element)
  if (!controls) {
    controls = new Map()
    activeAnimations.set(element, controls)
  }
  return controls
}

function curveFor(kind: Animation["descriptor"]["kind"]): MotionSpec {
  switch (kind) {
    case "linear": return timing({ duration: 0.35, curve: curves.linear })
    case "easeIn": return timing({ duration: 0.35, curve: curves.easeIn })
    case "easeOut": return timing({ duration: 0.35, curve: curves.easeOut })
    case "easeInOut": return timing({ duration: 0.35, curve: curves.easeInOut })
    default: return smooth()
  }
}

/** Convert Vune's SwiftUI-shaped value into an o0o0o execution spec. */
export function motionSpecForAnimation(animation: Animation): MotionSpec {
  const descriptor = animation.descriptor
  const duration = Number.isFinite(descriptor.duration) ? descriptor.duration / Math.max(descriptor.speed, 0.0001) : 0.35
  if (descriptor.kind === "spring") {
    return spring({
      response: Math.max(0.001, (descriptor.response ?? descriptor.duration) / Math.max(descriptor.speed, 0.0001)),
      dampingRatio: descriptor.dampingFraction ?? 0.825,
    })
  }
  const spec = curveFor(descriptor.kind)
  return spec.kind === "timing" ? timing({ duration, curve: spec.curve }) : spec
}

function isColorProperty(property: string): boolean {
  return property === "color" || property === "background" || property === "background-color" || property === "border-color" || property.endsWith("-color")
}

function cssNumberInterpolator(from: StyleValue, to: StyleValue): ((from: unknown, to: unknown, progress: number) => string) | undefined {
  const left = String(from).trim().match(/^(-?(?:\d+\.?\d*|\.\d+))(.*)$/)
  const right = String(to).trim().match(/^(-?(?:\d+\.?\d*|\.\d+))(.*)$/)
  if (!left || !right || left[2] !== right[2]) return undefined
  const start = Number(left[1])
  const end = Number(right[1])
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined
  return (_from, _to, progress) => `${start + (end - start) * progress}${left[2]}`
}

function interpolationOptions(property: string, from: StyleValue, to: StyleValue): Record<string, unknown> | undefined {
  if (property === "transform" && typeof from === "string" && typeof to === "string") return { type: "transform" }
  if (isColorProperty(property) && typeof from === "string" && typeof to === "string") return { type: "color", color: { space: "oklab" } }
  if (typeof from === "number" && typeof to === "number") return {}
  const interpolate = cssNumberInterpolator(from, to)
  return interpolate ? { interpolate } : undefined
}

/**
 * Animate one DOM style value with o0o0o. Returns false when the value is not
 * safely interpolable, allowing the normal DOM patcher to apply it directly.
 */
export function animateDomStyle(
  element: Element,
  property: string,
  from: StyleValue,
  to: StyleValue,
  animation: Animation,
): boolean {
  const options = interpolationOptions(property, from, to)
  if (!options) return false
  const controls = controlsFor(element)
  controls.get(property)?.cancel()
  const spec = motionSpecForAnimation(animation)
  const control = animateInterpolated(from, to, spec, value => {
    const style = (element as Element & { style?: CSSStyleDeclaration }).style
    style?.setProperty(property, String(value))
  }, options)
  controls.set(property, control)
  void control.finished.finally(() => {
    if (controls.get(property) === control) controls.delete(property)
  })
  return true
}

export function cancelDomAnimations(element: Element): void {
  const controls = activeAnimations.get(element)
  if (!controls) return
  controls.forEach(control => control.cancel())
  controls.clear()
}
