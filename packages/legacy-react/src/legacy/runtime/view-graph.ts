import { isValidElement } from "react"
import {
  isViewNode as isCoreViewNode,
  viewElement as createCoreElement,
  viewFragment as createCoreFragment,
  viewHost as createCoreHost,
  type ElementViewNode,
  type FragmentViewNode,
  type ModifiedContent,
  type ViewGraphChild,
  type ViewGraphLeaf,
  type ViewGraphValue,
  type ViewHostNode,
  type ViewModifierNode,
  type ViewNode,
} from "@vune-ui/core"

export type {
  ElementViewNode,
  FragmentViewNode,
  ModifiedContent,
  ViewGraphChild,
  ViewGraphLeaf,
  ViewGraphValue,
  ViewHostNode,
  ViewModifierNode,
  ViewNode,
}

/** React-specific metadata remains outside the canonical core graph. */
const nodes = new WeakMap<object, ViewNode>()

export function viewElement(type: unknown, props: object | null = null, children: readonly ViewGraphChild[] = []): ElementViewNode {
  return createCoreElement(type, props as Record<string, unknown> | null, children) as ElementViewNode
}

export function viewFragment(children: readonly ViewGraphChild[] = []): FragmentViewNode {
  return createCoreFragment(children) as FragmentViewNode
}

export function viewHost(
  name: string,
  host: unknown,
  props: object,
  render: (props: object) => ViewGraphValue,
): ViewHostNode {
  return createCoreHost(name, host, props as Record<string, unknown>, value => render(value), undefined) as ViewHostNode
}

export function isViewNode(value: unknown): value is ViewNode {
  return isCoreViewNode(value)
}

export function viewGraphChild(value: unknown): ViewGraphChild {
  if (isViewNode(value)) return value
  if (isValidElement(value)) {
    const node = viewNodeOf(value)
    return node?.kind === "modified" ? value as ViewGraphChild : node ?? value as ViewGraphChild
  }
  return value as ViewGraphChild
}

export function viewGraphChildren(values: readonly unknown[]): ViewGraphChild[] {
  return values.map(value => viewGraphChild(value))
}

export function markViewNode(element: object, node: ViewNode): object {
  nodes.set(element, node)
  return element
}

export function viewNodeOf(value: object): ViewNode | undefined {
  return nodes.get(value)
}

export function inheritViewNode(source: object, target: object): void {
  const node = viewNodeOf(source)
  if (!node) return
  if (node.kind === "element") {
    nodes.set(target, Object.freeze({
      ...node,
      props: isValidElement(target) ? target.props as Record<string, unknown> | null : null,
    }))
    return
  }
  nodes.set(target, node)
}

export function markModifiedViewNode(source: object, target: object, name: string, args: readonly unknown[]): void {
  const content = viewNodeOf(source)
  if (!content) return
  const modifier: ViewModifierNode = Object.freeze({
    name,
    arguments: [...args],
    props: isValidElement(target) ? target.props as object | null : null,
  })
  const modifiers = content.kind === "modified" ? [...content.modifiers, modifier] : [modifier]
  const finalModifier = modifiers[modifiers.length - 1]
  nodes.set(target, Object.freeze({
    kind: "modified" as const,
    content: content.kind === "modified" ? content.content : content,
    modifiers: Object.freeze(modifiers),
    modifier: finalModifier,
    name: finalModifier.name,
    arguments: finalModifier.arguments,
  }) as ModifiedContent)
}
