import type { ReactElement, ReactNode } from 'react'

export type ViewGraphChild = ReactNode | ViewNode

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

export interface ModifiedViewNode {
  readonly kind: 'modified'
  readonly content: ViewNode
  readonly name: string
  readonly arguments: readonly unknown[]
}

export type ViewNode = ElementViewNode | FragmentViewNode | ModifiedViewNode

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

export function isViewNode(value: unknown): value is ViewNode {
  return typeof value === 'object'
    && value !== null
    && ((value as ViewNode).kind === 'element'
      || (value as ViewNode).kind === 'fragment'
      || (value as ViewNode).kind === 'modified')
}

export function markViewNode(element: ReactElement, node: ViewNode): ReactElement {
  nodes.set(element as object, node)
  return element
}

export function viewNodeOf(value: ReactElement): ViewNode | undefined {
  return nodes.get(value as object)
}

export function inheritViewNode(source: ReactElement, target: ReactElement): void {
  const node = viewNodeOf(source)
  if (node) nodes.set(target as object, node)
}

export function markModifiedViewNode(
  source: ReactElement,
  target: ReactElement,
  name: string,
  args: readonly unknown[],
): void {
  const content = viewNodeOf(source)
  if (!content) return
  nodes.set(target as object, Object.freeze({
    kind: 'modified' as const,
    content,
    name,
    arguments: [...args],
  }))
}
