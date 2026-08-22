import type { FrameOptions } from "../layout.js"
import type { MuseStyleProperties } from "../html.js"
import type { ClassValue, Length, ModifiableViewNode, Modifiers, ViewModifierNode, ViewNode } from "./types.js"

const decoratedNodes = new WeakMap<object, ModifiableViewNode>()

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
  bold(this: ViewNode) { return applyModifier(this, "bold", []) },
  foreground(this: ViewNode, value: string) { return applyModifier(this, "foreground", [value]) },
  background(this: ViewNode, value: string) { return applyModifier(this, "background", [value]) },
  style(this: ViewNode, value: MuseStyleProperties) { return applyModifier(this, "style", [value]) },
  className(this: ViewNode, value: ClassValue) { return applyModifier(this, "className", [value]) },
  withProps(this: ViewNode, value: Record<string, unknown>) { return applyModifier(this, "withProps", [value]) },
  keyed(this: ViewNode, value: string | number) { return applyModifier(this, "keyed", [value]) },
  elementRef(this: ViewNode, value: unknown) { return applyModifier(this, "elementRef", [value]) },
}) as Modifiers)

/** Add the shared immutable modifier surface to a graph node. */
export function decorate(node: ViewNode, owned = false): ModifiableViewNode {
  const existing = decoratedNodes.get(node)
  if (existing) return existing
  let result: ModifiableViewNode
  if (owned && Object.isExtensible(node)) {
    Object.setPrototypeOf(node, modifierPrototype)
    result = node as ModifiableViewNode
  } else {
    result = Object.assign(Object.create(modifierPrototype), node) as ModifiableViewNode
  }
  const frozen = Object.freeze(result)
  decoratedNodes.set(node, frozen)
  decoratedNodes.set(frozen, frozen)
  return frozen
}

export function modifiedContent(content: ViewNode, modifier: ViewModifierNode | readonly ViewModifierNode[]): ModifiableViewNode {
  const incoming = Array.isArray(modifier) ? modifier : [modifier]
  if (incoming.length === 0) return decorate(content)
  const normalizedIncoming = incoming.map(item => Object.freeze({
    name: item.name,
    arguments: Object.freeze([...item.arguments]),
    props: item.props,
  }))
  const normalizedModifiers = Object.freeze(content.kind === "modified"
    ? [...content.modifiers, ...normalizedIncoming]
    : normalizedIncoming)
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

/** Apply a named modifier without coupling the graph to a renderer. */
export function modifier(content: ViewNode, name: string, ...arguments_: readonly unknown[]): ModifiableViewNode {
  return modifiedContent(content, { name, arguments: arguments_ })
}

export function modifierGraphOf(value: ViewNode): readonly ViewModifierNode[] {
  return value.kind === "modified" ? value.modifiers : []
}
