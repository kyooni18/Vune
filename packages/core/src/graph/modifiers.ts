import type { Animation } from "../animation.js"
import type { FrameOptions } from "../layout.js"
import type { Transition } from "../transition.js"
import type { VuneStyleProperties } from "../html.js"
import { arrayCheck, snapshotArrayValues } from "./arrays.js"
import type { ClassValue, Length, ModifiableViewNode, Modifiers, OffsetValue, ScaleEffectValue, ViewModifierNode, ViewNode } from "./types.js"

const decoratedNodes = new WeakMap<object, ModifiableViewNode>()

function snapshotStyleRecord(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value
  const array = arrayCheck(value)
  if (array === true) return value
  if (array === undefined) return Object.freeze({})
  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return Object.freeze({})
    const clone = Object.create(prototype) as Record<PropertyKey, unknown>
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") continue
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !("value" in descriptor)) continue
      const item = descriptor.value
      if (item !== undefined && typeof item !== "string" && (typeof item !== "number" || !Number.isFinite(item))) continue
      Object.defineProperty(clone, key, descriptor)
    }
    return Object.freeze(clone)
  } catch {
    return Object.freeze({})
  }
}

export function snapshotRecord(value: unknown, snapshotStyle = false): unknown {
  if (typeof value !== "object" || value === null) return value
  const array = arrayCheck(value)
  if (array === true) return value
  if (array === undefined) return Object.freeze({})
  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return value
    const clone = Object.create(prototype) as Record<PropertyKey, unknown>
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !("value" in descriptor)) continue
      const normalized = snapshotStyle && key === "style"
        ? { ...descriptor, value: snapshotStyleRecord(descriptor.value) }
        : descriptor
      Object.defineProperty(clone, key, normalized)
    }
    return Object.freeze(clone)
  } catch {
    return Object.freeze({})
  }
}

function snapshotClassValue(value: unknown, seen = new Set<unknown[]>()): unknown {
  const array = arrayCheck(value)
  if (array === undefined) return false
  if (!array) return value
  const values = value as unknown[]
  if (seen.has(values)) return false
  seen.add(values)
  try {
    const length = Object.getOwnPropertyDescriptor(values, "length")
    if (!length || !("value" in length) || !Number.isSafeInteger(length.value) || length.value < 0) return false
    const snapshot: unknown[] = []
    for (let index = 0; index < length.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(values, String(index))
      if (descriptor && "value" in descriptor) snapshot.push(snapshotClassValue(descriptor.value, seen))
    }
    return Object.freeze(snapshot)
  } catch {
    return false
  } finally {
    seen.delete(values)
  }
}

function maskShapeDescriptor(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const node = value as { kind?: string; content?: unknown; props?: Record<string, unknown> }
  const shape = node.kind === "modified" ? node.content : node
  if (!shape || typeof shape !== "object") return undefined
  const shapeNode = shape as { kind?: string; props?: Record<string, unknown> }
  if (shapeNode.kind !== "element") return undefined
  const name = shapeNode.props?.["data-vune"]
  if (typeof name !== "string") return undefined
  const radius = name === "Circle" ? 50
    : name === "Capsule" ? 50
      : name === "RoundedRectangle"
        ? (() => {
            const value = shapeNode.props?.style && typeof shapeNode.props.style === "object" ? (shapeNode.props.style as Record<string, unknown>).borderRadius : undefined
            const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : 8
            return Number.isFinite(parsed) ? Math.max(0, Math.min(50, parsed)) : 8
          })()
        : undefined
  if (radius === undefined && name !== "Rectangle") return undefined
  const shapeMarkup = name === "Circle"
    ? `<circle cx="50" cy="50" r="50" fill="white"/>`
    : `<rect x="0" y="0" width="100" height="100" rx="${radius ?? 0}" fill="white"/>`
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${shapeMarkup}</svg>`)}")`
}

function maskStyle(value: unknown): Record<string, string> {
  const source = typeof value === "string" ? value : maskShapeDescriptor(value)
  return source ? { mask: source, WebkitMask: source } : {}
}

function snapshotModifierArgument(name: string, value: unknown): unknown {
  if (name === "style") return snapshotStyleRecord(value)
  if (name === "frame") return snapshotRecord(value)
  if (name === "className") return snapshotClassValue(value)
  if (name === "withProps") return snapshotRecord(value, true)
  return value
}

function ownDataValue(value: unknown, key: PropertyKey): unknown {
  if (typeof value !== "object" || value === null) return undefined
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && "value" in descriptor ? descriptor.value : undefined
  } catch {
    return undefined
  }
}

function snapshotModifierNode(value: unknown): ViewModifierNode | undefined {
  const name = ownDataValue(value, "name")
  const arguments_ = ownDataValue(value, "arguments")
  if (typeof name !== "string" || arrayCheck(arguments_) !== true) return undefined
  const props = ownDataValue(value, "props")
  const normalizedArguments = Object.freeze(snapshotArrayValues(arguments_ as readonly unknown[]).map(item => snapshotModifierArgument(name, item)))
  const mask = name === "mask" ? maskStyle(normalizedArguments[0]) : {}
  const normalizedProps = props === undefined ? undefined : props === null ? null : snapshotRecord(props, true) as object
  return Object.freeze({
    name,
    arguments: normalizedArguments,
    ...(Object.keys(mask).length > 0 ? { props: Object.freeze({ style: Object.freeze(mask) }) } : normalizedProps === undefined ? {} : { props: normalizedProps }),
  })
}

function applyModifier(content: ViewNode, name: string, arguments_: readonly unknown[]): ModifiableViewNode {
  return modifiedContent(content, { name, arguments: arguments_ })
}

const modifierPrototype = Object.freeze(Object.assign(Object.create(Object.prototype), {
  padding(this: ViewNode, value: Length = 0) { return applyModifier(this, "padding", [value]) },
  margin(this: ViewNode, value: Length = 0) { return applyModifier(this, "margin", [value]) },
  gap(this: ViewNode, value: Length) { return applyModifier(this, "gap", [value]) },
  frame(this: ViewNode, options: FrameOptions) { return applyModifier(this, "frame", [options]) },
  font(this: ViewNode, value: string) { return applyModifier(this, "font", [value]) },
  fontSize(this: ViewNode, value: Length) { return applyModifier(this, "fontSize", [value]) },
  bold(this: ViewNode, isActive = true) { return applyModifier(this, "bold", [isActive]) },
  foreground(this: ViewNode, value: string) { return applyModifier(this, "foreground", [value]) },
  foregroundStyle(this: ViewNode, value: string) { return applyModifier(this, "foregroundStyle", [value]) },
  background(this: ViewNode, value: string, alignment = "center") { return applyModifier(this, "background", [value, alignment]) },
  opacity(this: ViewNode, value: number) { return applyModifier(this, "opacity", [value]) },
  scaleEffect(this: ViewNode, value: ScaleEffectValue, anchor = "center") { return applyModifier(this, "scaleEffect", [value, anchor]) },
  rotationEffect(this: ViewNode, value: number, anchor = "center") { return applyModifier(this, "rotationEffect", [value, anchor]) },
  offset(this: ViewNode, valueOrX: OffsetValue | number, y?: number) {
    return applyModifier(this, "offset", typeof valueOrX === "number" ? [valueOrX, y ?? 0] : [valueOrX])
  },
  mask(this: ViewNode, value: ViewNode | string) { return applyModifier(this, "mask", [value]) },
  animation(this: ViewNode, animation?: Animation | null, value?: unknown) {
    if (arguments.length === 0) return applyModifier(this, "animation", [])
    if (arguments.length === 1) return applyModifier(this, "animation", [animation ?? null])
    return applyModifier(this, "animation", [animation ?? null, value])
  },
  transition(this: ViewNode, transition: Transition) { return applyModifier(this, "transition", [transition]) },
  style(this: ViewNode, value: VuneStyleProperties) { return applyModifier(this, "style", [value]) },
  className(this: ViewNode, value: ClassValue) { return applyModifier(this, "className", [value]) },
  withProps(this: ViewNode, value: Record<string, unknown>) { return applyModifier(this, "withProps", [value]) },
  keyed(this: ViewNode, value: string | number) { return applyModifier(this, "keyed", [value]) },
  elementRef(this: ViewNode, value: unknown) { return applyModifier(this, "elementRef", [value]) },
  continuousCorners(this: ViewNode, smoothing = 0.6) { return applyModifier(this, "continuousCorners", [smoothing]) },
}) as Modifiers)

/** Add the shared immutable modifier surface to a graph node. */
export function decorate(node: ViewNode, owned = false): ModifiableViewNode {
  // A node constructed by this module already inherits the complete modifier
  // surface. Return it directly instead of copying enumerable properties: a
  // copy would invoke lazy graph getters such as keyed collection children and
  // eagerly materialize every row before a renderer can select a direct path.
  try {
    if (Object.getPrototypeOf(node) === modifierPrototype) return node as ModifiableViewNode
  } catch {
    // Reflection-hostile values continue through the existing guarded path.
  }

  // Internal graph constructors hand us a fresh object that cannot have been
  // decorated before. Mark it in place and return it directly: caching the
  // same frozen object as both key and value only adds two WeakMap writes per
  // transient node (notably every row in a large Element/ForEach tree).
  if (owned && Object.isExtensible(node)) {
    Object.setPrototypeOf(node, modifierPrototype)
    return Object.freeze(node) as ModifiableViewNode
  }
  const existing = decoratedNodes.get(node)
  if (existing) return existing
  const result = Object.assign(Object.create(modifierPrototype), node) as ModifiableViewNode
  const frozen = Object.freeze(result)
  decoratedNodes.set(node, frozen)
  if (frozen !== node) decoratedNodes.set(frozen, frozen)
  return frozen
}

function materializeModifiedContent(content: ViewNode, normalizedIncoming: readonly ViewModifierNode[]): ModifiableViewNode {
  if (normalizedIncoming.length === 0) return decorate(content)
  const normalizedModifiers = Object.freeze(content.kind === "modified"
    ? [...content.modifiers, ...normalizedIncoming]
    : [...normalizedIncoming])
  const finalModifier = normalizedModifiers[normalizedModifiers.length - 1]
  return decorate({
    kind: "modified" as const,
    content: content.kind === "modified" ? content.content : content,
    modifiers: normalizedModifiers,
    modifier: finalModifier,
    name: finalModifier.name,
    arguments: finalModifier.arguments,
  }, true)
}

export function modifiedContent(content: ViewNode, modifier: ViewModifierNode | readonly ViewModifierNode[]): ModifiableViewNode {
  const incoming = arrayCheck(modifier) === true ? snapshotArrayValues(modifier as readonly ViewModifierNode[]) : [modifier]
  const normalizedIncoming = incoming.flatMap(item => {
    const snapshot = snapshotModifierNode(item)
    return snapshot ? [snapshot] : []
  })
  return materializeModifiedContent(content, normalizedIncoming)
}

/**
 * Trusted compiler fast path for a statically-known modifier chain. The input
 * uses compact tuples and skips descriptor discovery/shape validation while
 * retaining argument snapshot semantics for mutable records and style values.
 */
export function modifiedContentCompiled(
  content: ViewNode,
  modifiers: readonly (readonly [name: string, arguments: readonly unknown[]])[],
): ModifiableViewNode {
  const normalizedIncoming = modifiers.map(([name, arguments_]) => {
    const normalizedArguments = Object.freeze(arguments_.map(item => snapshotModifierArgument(name, item)))
    const mask = name === "mask" ? maskStyle(normalizedArguments[0]) : {}
    return Object.freeze({
      name,
      arguments: normalizedArguments,
      ...(Object.keys(mask).length > 0 ? { props: Object.freeze({ style: Object.freeze(mask) }) } : {}),
    }) as ViewModifierNode
  })
  return materializeModifiedContent(content, normalizedIncoming)
}

/** Apply a named modifier without coupling the graph to a renderer. */
export function modifier(content: ViewNode, name: string, ...arguments_: readonly unknown[]): ModifiableViewNode {
  return modifiedContent(content, { name, arguments: arguments_ })
}

export function modifierGraphOf(value: ViewNode): readonly ViewModifierNode[] {
  return value.kind === "modified" ? value.modifiers : []
}

/** Internal keyed wrapper used by collection builders. It preserves the same
 * modifier graph shape without installing the public modifier prototype on
 * every transient row node. */
export function keyedContent(content: ViewNode, key: string | number): ViewNode {
  const keyed = Object.freeze({
    name: "keyed",
    arguments: Object.freeze([key]),
  }) as ViewModifierNode
  const modifiers = Object.freeze(content.kind === "modified"
    ? [...content.modifiers, keyed]
    : [keyed])
  return Object.freeze({
    kind: "modified" as const,
    content: content.kind === "modified" ? content.content : content,
    modifiers,
    modifier: keyed,
    name: keyed.name,
    arguments: keyed.arguments,
  })
}
