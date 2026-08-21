import { isValidElement } from 'react'

/** Opaque leaves are intentionally renderer-neutral; React is one consumer. */
export type ViewGraphLeaf = string | number | bigint | boolean | null | undefined | object
export type ViewGraphChild = ViewGraphLeaf | ViewNode
export type ViewGraphValue = ViewGraphChild | readonly ViewGraphValue[]

export interface ElementViewNode {
  readonly kind: 'element'
  readonly type: unknown
  readonly props: object | null
  readonly children: readonly ViewGraphChild[]
}

export interface FragmentViewNode {
  readonly kind: 'fragment'
  readonly children: readonly ViewGraphChild[]
}

export interface ViewHostNode {
  readonly kind: 'view'
  readonly name: string
  readonly host: unknown
  readonly props: object
  readonly render: (props: object) => ViewGraphValue
}

export interface ViewModifierNode {
  readonly name: string
  readonly arguments: readonly unknown[]
  /** Effective host props retained for React materialization compatibility. */
  readonly props?: object | null
}

/** Renderer-neutral equivalent of SwiftUI's ModifiedContent<Base, Modifier>. */
export interface ModifiedContent<Base extends ViewNode = ViewNode, Modifier extends ViewModifierNode = ViewModifierNode> {
  readonly kind: 'modified'
  readonly content: Base
  readonly modifier: Modifier
  readonly name: Modifier['name']
  readonly arguments: Modifier['arguments']
}

export type ModifiedViewNode = ModifiedContent
export type ViewNode = ElementViewNode | FragmentViewNode | ViewHostNode | ModifiedViewNode

const nodes = new WeakMap<object, ViewNode>()

export function viewElement(
  type: unknown,
  props: object | null,
  children: readonly ViewGraphChild[] = [],
): ElementViewNode {
  return Object.freeze({
    kind: 'element' as const,
    type,
    props,
    children: [...children],
  })
}

export function viewFragment(children: readonly ViewGraphChild[] = []): FragmentViewNode {
  return Object.freeze({ kind: 'fragment' as const, children: [...children] })
}

export function viewHost(
  name: string,
  host: unknown,
  props: object,
  render: (props: object) => ViewGraphValue,
): ViewHostNode {
  return Object.freeze({ kind: 'view' as const, name, host, props, render })
}

/** Replace already-materialized Muse elements with their graph identity. */
export function viewGraphChild(value: unknown): ViewGraphChild {
  if (isViewNode(value)) return value
  if (isValidElement(value)) {
    const node = viewNodeOf(value)
    // Modified elements also carry layout metadata and refs in React's
    // compatibility layer. Keep that materialized value as a child; the
    // immutable ModifiedContent graph remains available at the View boundary.
    return node?.kind === 'modified' ? value : node ?? value
  }
  return value as ViewGraphChild
}

export function viewGraphChildren(values: readonly unknown[]): ViewGraphChild[] {
  return values.map(value => viewGraphChild(value))
}

export function isViewNode(value: unknown): value is ViewNode {
  return typeof value === 'object'
    && value !== null
    && ((value as ViewNode).kind === 'element'
      || (value as ViewNode).kind === 'fragment'
      || (value as ViewNode).kind === 'view'
      || (value as ViewNode).kind === 'modified')
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
  if (node.kind === 'element') {
    nodes.set(target, Object.freeze({ ...node, props: isValidElement(target) ? target.props as object | null : null }))
    return
  }
  nodes.set(target, node)
}

export function markModifiedViewNode(
  source: object,
  target: object,
  name: string,
  args: readonly unknown[],
): void {
  const content = viewNodeOf(source)
  if (!content) return
  const modifier = Object.freeze({ name, arguments: [...args], props: isValidElement(target) ? target.props as object | null : null })
  nodes.set(target, Object.freeze({
    kind: 'modified' as const,
    content,
    modifier,
    name,
    arguments: modifier.arguments,
  }))
}
