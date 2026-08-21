import { Fragment, createElement, type ReactElement, type ReactNode } from 'react'
import { isViewNode, markViewNode, type ViewNode } from './view-graph.js'

/**
 * The only React-specific part of the View graph. View construction and
 * initializer selection can stay renderer-agnostic; this adapter materializes
 * the graph for React today and leaves another renderer possible later.
 */
export interface MuseRenderer {
  element(type: unknown, props?: object | null, ...children: ReactNode[]): ReactElement
  fragment(children: ReactNode): ReactElement
  render(value: ReactNode | ViewNode): ReactNode
}

export const reactRenderer: MuseRenderer = {
  element(type, props, ...children) {
    return createElement(type as any, props as any, ...children)
  },
  fragment(children) {
    return Array.isArray(children)
      ? createElement(Fragment, null, ...children)
      : createElement(Fragment, null, children)
  },
  render(value) {
    if (!isViewNode(value)) return value
    if (value.kind === 'modified') return reactRenderer.render(value.content)
    if (value.kind === 'fragment') return reactRenderer.fragment(value.children.map(child => reactRenderer.render(child)))
    return reactRenderer.element(value.type, value.props, ...value.children.map(child => reactRenderer.render(child)))
  },
}

export function materializeViewNode(node: ViewNode): ReactElement {
  return markViewNode(reactRenderer.render(node) as ReactElement, node)
}
