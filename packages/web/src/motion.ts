import {
  animate,
  compileMotionPlan as compileEngineMotionPlan,
  createInterpolator,
  curves,
  motionValue,
  smooth,
  spring,
  timing,
  type AnimationControls,
  type InterpolatorOptions,
  type MotionExecutionPlan,
  type MotionSpec,
  type MotionValue,
} from "o0o0o"
import type { Animation } from "@vune-ui/core"

export type StyleValue = unknown

export interface DomStyleMotionChange {
  readonly property: string
  readonly from: StyleValue
  readonly to: StyleValue
  readonly animation: Animation
}

export interface DomLayoutBox {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

type MotionRoute =
  | { readonly kind: "scalar"; readonly unit: string; readonly value: number }
  | { readonly kind: "interpolated"; readonly options: InterpolatorOptions }

interface CompiledMotionPlan {
  /** Public/raw spec retained for compatibility and diagnostics. */
  readonly spec: MotionSpec
  /** Fully compiled o0o0o route: spring coefficients/easing LUT are ready. */
  readonly executionPlan: MotionExecutionPlan
  readonly delayMs: number
  /** Number of forward passes. Infinity means repeat forever. */
  readonly repeatCount: number
  readonly autoreverses: boolean
}

interface MotionChannel {
  readonly route: "scalar" | "interpolated"
  currentStyleValue(): string
  isActive(): boolean
  retarget(to: StyleValue, plan: CompiledMotionPlan): boolean
  dispose(): void
}

const compiledMotionPlans = new WeakMap<Animation, CompiledMotionPlan>()
const compiledDescriptorPlans = new Map<string, CompiledMotionPlan>()
const maximumCompiledDescriptorPlans = 128
const activeChannels = new WeakMap<Element, Map<string, MotionChannel>>()
const pendingStyleWrites = new Map<Element, Map<string, string>>()
let styleWriteScheduled = false

function queueStyleWrite(element: Element, property: string, value: string): void {
  let writes = pendingStyleWrites.get(element)
  if (!writes) {
    writes = new Map()
    pendingStyleWrites.set(element, writes)
  }
  writes.set(property, value)
  if (styleWriteScheduled) return
  styleWriteScheduled = true
  queueMicrotask(() => {
    styleWriteScheduled = false
    const batch = [...pendingStyleWrites]
    pendingStyleWrites.clear()
    for (const [target, properties] of batch) {
      const style = (target as Element & { style?: CSSStyleDeclaration }).style
      if (!style) continue
      for (const [name, next] of properties) style.setProperty(name, next)
    }
  })
}

function removePendingStyleWrite(element: Element, property?: string): void {
  const writes = pendingStyleWrites.get(element)
  if (!writes) return
  if (property === undefined) {
    pendingStyleWrites.delete(element)
    return
  }
  writes.delete(property)
  if (writes.size === 0) pendingStyleWrites.delete(element)
}

function channelsFor(element: Element): Map<string, MotionChannel> {
  let channels = activeChannels.get(element)
  if (!channels) {
    channels = new Map()
    activeChannels.set(element, channels)
  }
  return channels
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

function compileMotionPlan(animation: Animation): CompiledMotionPlan {
  const cached = compiledMotionPlans.get(animation)
  if (cached) return cached
  const descriptor = animation.descriptor
  const speed = Number.isFinite(descriptor.speed) && descriptor.speed > 0 ? descriptor.speed : 1
  const duration = Number.isFinite(descriptor.duration) ? Math.max(0, descriptor.duration) / speed : 0.35
  const response = Math.max(0.001, (descriptor.response ?? descriptor.duration) / speed)
  const dampingRatio = descriptor.dampingFraction ?? 0.825
  const blendDuration = Math.max(0, Number.isFinite(descriptor.blendDuration) ? descriptor.blendDuration ?? 0 : 0) / speed
  const delayMs = Math.max(0, Number.isFinite(descriptor.delay) ? descriptor.delay : 0) * 1000 / speed
  const repeatCount = descriptor.repeatCount === Number.POSITIVE_INFINITY
    ? Number.POSITIVE_INFINITY
    : Math.max(1, Math.floor(Number.isFinite(descriptor.repeatCount) ? descriptor.repeatCount! : 1))
  const autoreverses = descriptor.autoreverses ?? true
  // Compiler-hoisted Animation values hit the WeakMap above. This bounded
  // structural cache covers dynamic code that recreates an equivalent immutable
  // descriptor, so easing LUT/spring coefficient compilation is still paid once.
  const descriptorKey = [
    descriptor.kind, duration, response, dampingRatio, blendDuration, delayMs,
    repeatCount, autoreverses ? 1 : 0,
  ].join("|")
  const shared = compiledDescriptorPlans.get(descriptorKey)
  if (shared) {
    compiledDescriptorPlans.delete(descriptorKey)
    compiledDescriptorPlans.set(descriptorKey, shared)
    compiledMotionPlans.set(animation, shared)
    return shared
  }

  const spec = descriptor.kind === "spring"
    ? spring({ response, dampingRatio, blendDuration })
    : (() => {
        const base = curveFor(descriptor.kind)
        return base.kind === "timing" ? timing({ duration, curve: base.curve }) : base
      })()
  const plan: CompiledMotionPlan = Object.freeze({
    spec,
    executionPlan: compileEngineMotionPlan(spec),
    delayMs,
    repeatCount,
    autoreverses,
  })
  compiledMotionPlans.set(animation, plan)
  compiledDescriptorPlans.set(descriptorKey, plan)
  while (compiledDescriptorPlans.size > maximumCompiledDescriptorPlans) {
    const oldest = compiledDescriptorPlans.keys().next().value as string | undefined
    if (oldest === undefined) break
    compiledDescriptorPlans.delete(oldest)
  }
  return plan
}

/** Convert and memoize Vune's SwiftUI-shaped value into an o0o0o execution spec. */
export function motionSpecForAnimation(animation: Animation): MotionSpec {
  return compileMotionPlan(animation).spec
}

function isColorProperty(property: string): boolean {
  return property === "color" || property === "background" || property === "background-color" || property === "border-color" || property.endsWith("-color")
}

function parseScalar(value: StyleValue): { readonly value: number; readonly unit: string } | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? { value, unit: "" } : undefined
  if (typeof value !== "string") return undefined
  const match = value.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))(.*)$/)
  if (!match) return undefined
  const scalar = Number(match[1])
  return Number.isFinite(scalar) ? { value: scalar, unit: match[2] } : undefined
}

function numericCssTemplate(value: string): { readonly parts: readonly string[]; readonly values: readonly number[] } | undefined {
  const pattern = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi
  const parts: string[] = []
  const values: number[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(value))) {
    parts.push(value.slice(cursor, match.index))
    const number = Number(match[0])
    if (!Number.isFinite(number)) return undefined
    values.push(number)
    cursor = match.index + match[0].length
  }
  if (values.length === 0) return undefined
  parts.push(value.slice(cursor))
  return { parts, values }
}

function numericCssInterpolatorOptions(from: string, to: string): InterpolatorOptions | undefined {
  const left = numericCssTemplate(from)
  const right = numericCssTemplate(to)
  if (!left || !right || left.values.length !== right.values.length || left.parts.length !== right.parts.length) return undefined
  for (let index = 0; index < left.parts.length; index += 1) {
    if (left.parts[index] !== right.parts[index]) return undefined
  }
  return {
    interpolate(_from, _to, progress) {
      let output = left.parts[0]
      for (let index = 0; index < left.values.length; index += 1) {
        const value = left.values[index] + (right.values[index] - left.values[index]) * progress
        const normalized = Math.abs(value) < 1e-10 ? 0 : Math.round(value * 100000) / 100000
        output += `${normalized}${left.parts[index + 1]}`
      }
      return output
    },
  }
}

function interpolatorOptions(property: string, from: StyleValue, to: StyleValue): InterpolatorOptions | undefined {
  if (property === "transform" && typeof from === "string" && typeof to === "string") return { type: "transform" }
  if (isColorProperty(property) && typeof from === "string" && typeof to === "string") return { type: "color", color: { space: "oklab" } }
  // CSS has many numerically-interpolable compound values (translate/scale,
  // border radii, filters, shadows without color changes, background position,
  // etc.). If the token skeleton is stable, interpolate every numeric token in
  // one channel rather than falling back to a discrete jump.
  if (typeof from === "string" && typeof to === "string") return numericCssInterpolatorOptions(from, to)
  return undefined
}

function routeFor(property: string, from: StyleValue, to: StyleValue): MotionRoute | undefined {
  const left = parseScalar(from)
  const right = parseScalar(to)
  if (left && right && left.unit === right.unit) return { kind: "scalar", value: right.value, unit: right.unit }
  const options = interpolatorOptions(property, from, to)
  return options ? { kind: "interpolated", options } : undefined
}

function startAfterDelay(delayMs: number, start: () => void): ReturnType<typeof setTimeout> | undefined {
  if (!(delayMs > 0)) {
    start()
    return undefined
  }
  return setTimeout(start, delayMs)
}

class ScalarMotionChannel implements MotionChannel {
  readonly route = "scalar" as const
  readonly #value: MotionValue
  readonly #unsubscribe: () => void
  #control: AnimationControls | undefined
  #timer: ReturnType<typeof setTimeout> | undefined
  #generation = 0
  #active = false
  #unit: string
  #currentStyle: string

  constructor(
    private readonly element: Element,
    private readonly property: string,
    start: number,
    unit: string,
  ) {
    this.#unit = unit
    this.#currentStyle = `${start}${unit}`
    this.#value = motionValue(start)
    this.#unsubscribe = this.#value.subscribeValue(value => {
      this.#currentStyle = `${value}${this.#unit}`
      queueStyleWrite(this.element, this.property, this.#currentStyle)
    }, { emitCurrent: false })
  }

  currentStyleValue(): string { return this.#currentStyle }
  isActive(): boolean { return this.#active }

  retarget(to: StyleValue, plan: CompiledMotionPlan): boolean {
    const target = parseScalar(to)
    if (!target || target.unit !== this.#unit) return false
    const generation = ++this.#generation
    this.#active = true
    if (this.#timer !== undefined) clearTimeout(this.#timer)
    this.#timer = undefined

    const run = async () => {
      if (generation !== this.#generation) return
      const origin = this.#value.get()
      let forwardPass = 0
      try {
        while (generation === this.#generation && (plan.repeatCount === Number.POSITIVE_INFINITY || forwardPass < plan.repeatCount)) {
          // Calling animate() on the same MotionValue deliberately avoids a
          // pre-cancel here: o0o0o retargets a live spring in-place and carries
          // its velocity into the new target.
          this.#control = animate(this.#value, target.value, plan.executionPlan)
          const forward = await this.#control.finished
          if (generation !== this.#generation || forward.status !== "finished") return
          forwardPass += 1
          if (plan.repeatCount !== Number.POSITIVE_INFINITY && forwardPass >= plan.repeatCount) return
          if (plan.autoreverses) {
            this.#control = animate(this.#value, origin, plan.executionPlan)
            const reverse = await this.#control.finished
            if (generation !== this.#generation || reverse.status !== "finished") return
          } else {
            this.#value.set(origin, 0)
          }
        }
      } finally {
        if (generation === this.#generation && plan.repeatCount !== Number.POSITIVE_INFINITY) this.#active = false
      }
    }

    // A delayed retarget intentionally leaves the current engine animation
    // running. When the timer fires animate() retargets the same MotionValue
    // from its then-current presentation value/velocity instead of freezing it
    // at request time and later reviving stale velocity.
    this.#timer = startAfterDelay(plan.delayMs, () => {
      this.#timer = undefined
      void run()
    })
    return true
  }

  dispose(): void {
    this.#generation += 1
    this.#active = false
    if (this.#timer !== undefined) clearTimeout(this.#timer)
    this.#timer = undefined
    this.#control?.cancel()
    this.#control = undefined
    this.#unsubscribe()
    removePendingStyleWrite(this.element, this.property)
  }
}

class InterpolatedMotionChannel implements MotionChannel {
  readonly route = "interpolated" as const
  readonly #progress = motionValue(0)
  readonly #unsubscribe: () => void
  #control: AnimationControls | undefined
  #timer: ReturnType<typeof setTimeout> | undefined
  #generation = 0
  #active = false
  #interpolate: (progress: number) => unknown
  #currentStyle: string
  #origin: StyleValue
  #target: StyleValue
  #options: InterpolatorOptions

  constructor(
    private readonly element: Element,
    private readonly property: string,
    from: StyleValue,
    to: StyleValue,
    options: InterpolatorOptions,
  ) {
    this.#origin = from
    this.#target = to
    this.#options = options
    this.#interpolate = createInterpolator(from, to, options)
    this.#currentStyle = String(from)
    this.#unsubscribe = this.#progress.subscribeValue(progress => {
      const value = this.#interpolate(progress)
      this.#currentStyle = String(value)
      queueStyleWrite(this.element, this.property, this.#currentStyle)
    }, { emitCurrent: false })
  }

  currentStyleValue(): string { return this.#currentStyle }
  isActive(): boolean { return this.#active }

  retarget(to: StyleValue, plan: CompiledMotionPlan): boolean {
    const options = interpolatorOptions(this.property, this.#currentStyle, to)
    if (!options) return false
    const generation = ++this.#generation
    this.#active = true
    if (this.#timer !== undefined) clearTimeout(this.#timer)
    this.#timer = undefined

    const run = async () => {
      if (generation !== this.#generation) return
      this.#control?.cancel()
      this.#origin = this.#currentStyle
      this.#target = to
      this.#options = options
      try {
        this.#interpolate = createInterpolator(this.#origin, this.#target, this.#options)
      } catch {
        if (generation === this.#generation) this.#active = false
        return
      }
      this.#progress.set(0, 0)
      let forwardPass = 0
      try {
        while (generation === this.#generation && (plan.repeatCount === Number.POSITIVE_INFINITY || forwardPass < plan.repeatCount)) {
          this.#progress.set(0, 0)
          this.#control = animate(this.#progress, 1, plan.executionPlan)
          const forward = await this.#control.finished
          if (generation !== this.#generation || forward.status !== "finished") return
          forwardPass += 1
          if (plan.repeatCount !== Number.POSITIVE_INFINITY && forwardPass >= plan.repeatCount) return
          if (plan.autoreverses) {
            this.#control = animate(this.#progress, 0, plan.executionPlan)
            const reverse = await this.#control.finished
            if (generation !== this.#generation || reverse.status !== "finished") return
          }
        }
      } finally {
        if (generation === this.#generation && plan.repeatCount !== Number.POSITIVE_INFINITY) this.#active = false
      }
    }

    this.#timer = startAfterDelay(plan.delayMs, () => {
      this.#timer = undefined
      void run()
    })
    return true
  }

  dispose(): void {
    this.#generation += 1
    this.#active = false
    if (this.#timer !== undefined) clearTimeout(this.#timer)
    this.#timer = undefined
    this.#control?.cancel()
    this.#control = undefined
    this.#unsubscribe()
    removePendingStyleWrite(this.element, this.property)
  }
}

function dropChannel(element: Element, property: string): void {
  const channels = activeChannels.get(element)
  const channel = channels?.get(property)
  channel?.dispose()
  channels?.delete(property)
  if (channels?.size === 0) activeChannels.delete(element)
}

/** Stop one property channel before a direct/remove style patch. */
export function cancelDomStyleAnimation(element: Element, property: string): void {
  dropChannel(element, property)
}

/**
 * Animate one DOM style value with a precompiled motion plan and a persistent
 * per-property channel. Returns false when the value cannot be interpolated
 * safely, allowing the normal DOM patcher to apply it directly.
 */
function animateDomStyleWithPlan(
  element: Element,
  property: string,
  from: StyleValue,
  to: StyleValue,
  plan: CompiledMotionPlan,
): boolean {
  const channels = channelsFor(element)
  let existing = channels.get(property)
  // While a channel is running, its presentation value is the authoritative
  // starting point for retargeting. Once it settles, the renderer-provided
  // `from` value wins again so external/direct style patches can resynchronize
  // the persistent channel without an artificial jump.
  if (existing && !existing.isActive() && String(from) !== existing.currentStyleValue()) {
    existing.dispose()
    channels.delete(property)
    existing = undefined
  }
  const effectiveFrom = existing?.isActive() ? existing.currentStyleValue() : from
  const route = routeFor(property, effectiveFrom, to)
  if (!route) {
    dropChannel(element, property)
    return false
  }

  if (route.kind === "scalar") {
    if (existing?.route === "scalar" && existing.retarget(to, plan)) return true
    existing?.dispose()
    const start = parseScalar(effectiveFrom)
    if (!start || start.unit !== route.unit) {
      channels.delete(property)
      return false
    }
    const channel = new ScalarMotionChannel(element, property, start.value, start.unit)
    channels.set(property, channel)
    return channel.retarget(to, plan)
  }

  if (existing?.route === "interpolated" && existing.retarget(to, plan)) return true
  existing?.dispose()
  try {
    const channel = new InterpolatedMotionChannel(element, property, effectiveFrom, to, route.options)
    channels.set(property, channel)
    return channel.retarget(to, plan)
  } catch {
    channels.delete(property)
    return false
  }
}

/** Animate one style property. Kept as the small compatibility surface. */
export function animateDomStyle(
  element: Element,
  property: string,
  from: StyleValue,
  to: StyleValue,
  animation: Animation,
): boolean {
  return animateDomStyleWithPlan(element, property, from, to, compileMotionPlan(animation))
}

/**
 * Launch a whole style diff as one motion batch. Every property keeps its own
 * persistent channel and execution plan, while o0o0o shares the frame loop and
 * Vune coalesces the resulting DOM writes into one commit batch.
 */
export function animateDomStyles(element: Element, changes: readonly DomStyleMotionChange[]): ReadonlySet<string> {
  const animated = new Set<string>()
  if (changes.length === 0) return animated
  const plans = new Map<Animation, CompiledMotionPlan>()
  for (const change of changes) {
    let plan = plans.get(change.animation)
    if (!plan) {
      plan = compileMotionPlan(change.animation)
      plans.set(change.animation, plan)
    }
    if (animateDomStyleWithPlan(element, change.property, change.from, change.to, plan)) animated.add(change.property)
  }
  return animated
}

/**
 * FLIP-style geometry animation for intrinsic layout changes. Built-in offset,
 * rotation and scale use the independent CSS translate/rotate/scale channels,
 * leaving `transform` available as an internal layout channel. If user code is
 * already occupying transform, the conservative choice is to skip FLIP rather
 * than interfere with it.
 */
export function animateDomLayout(
  element: Element,
  before: DomLayoutBox,
  after: DomLayoutBox,
  animation: Animation,
): boolean {
  if (![before.left, before.top, before.width, before.height, after.left, after.top, after.width, after.height].every(Number.isFinite)) return false
  if (!(after.width > 0) || !(after.height > 0) || !(before.width > 0) || !(before.height > 0)) return false
  const dx = before.left + before.width / 2 - (after.left + after.width / 2)
  const dy = before.top + before.height / 2 - (after.top + after.height / 2)
  const sx = before.width / after.width
  const sy = before.height / after.height
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01 && Math.abs(sx - 1) < 0.0001 && Math.abs(sy - 1) < 0.0001) return false

  const style = (element as Element & { style?: CSSStyleDeclaration }).style
  if (!style) return false
  const transformChannel = activeChannels.get(element)?.get("transform")
  const current = style.getPropertyValue("transform").trim()
  if (current && current !== "none" && !transformChannel) return false

  // The target layout is already committed. Invert it back onto the previous
  // visual box synchronously, then let the regular transform channel converge
  // to identity. Center-origin math means we do not need to mutate
  // transform-origin and therefore cannot leak layout-animation state.
  dropChannel(element, "transform")
  const inverse = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`
  style.setProperty("transform", inverse)
  return animateDomStyleWithPlan(element, "transform", inverse, "none", compileMotionPlan(animation))
}

export function cancelDomAnimations(element: Element): void {
  const channels = activeChannels.get(element)
  if (channels) {
    channels.forEach(channel => channel.dispose())
    channels.clear()
    activeChannels.delete(element)
  }
  removePendingStyleWrite(element)
}
