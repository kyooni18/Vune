import { Fragment, cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { isViewNode, markViewNode, viewGraphChild, type ViewGraphValue, type ViewHostNode, type ViewModifierNode, type ViewNode } from './view-graph.js'
import { zeroGeometry } from '@vune-ui/core'

export type RendererChild<Output> = Output | readonly RendererChild<Output>[]

/**
 * The only React-specific part of the View graph. View construction and
 * initializer selection can stay renderer-agnostic; this adapter materializes
 * the graph for React today and leaves another renderer possible later.
 */
export interface VuneRenderer<Output = ReactNode> {
  element(type: unknown, props?: object | null, ...children: RendererChild<Output>[]): Output
  fragment(children: readonly RendererChild<Output>[]): Output
  /** Materialize a renderer-neutral leaf such as text, null, or a number. */
  value?(value: unknown): Output
  /** Optional host hook for user-defined View nodes. */
  view?(node: ViewHostNode): Output
  /** Optional hook for renderers that apply graph modifiers during materialization. */
  modifier?(content: RendererChild<Output>, modifier: ViewModifierNode): RendererChild<Output>
  render(value: ViewGraphValue): RendererChild<Output>
}

/** Traverse a renderer-neutral View graph with the supplied materializer. */
export function renderViewNode<Output>(
  value: ViewGraphValue,
  renderer: VuneRenderer<Output>,
): RendererChild<Output> {
  if (Array.isArray(value)) {
    return value.map(child => renderViewNode(child as ViewGraphValue, renderer)) as unknown as RendererChild<Output>
  }
  if (!isViewNode(value)) return renderer.value?.(value) ?? value as RendererChild<Output>
  if (value.kind === 'view') {
    if (renderer.view) return renderer.view(value)
    const rendered = value.render(value.props)
    const graphValue = Array.isArray(rendered)
      ? rendered.map(child => viewGraphChild(child as ReactNode | ViewNode)) as unknown as ViewGraphValue
      : viewGraphChild(rendered as ReactNode | ViewNode)
    return renderViewNode(graphValue, renderer)
  }
  if (value.kind === 'modified') {
    let content = renderViewNode(value.content, renderer)
    for (const modifier of value.modifiers) content = renderer.modifier?.(content, modifier) ?? content
    return content
  }
  if (value.kind === 'fragment') {
    return renderer.fragment(value.children.map(child => renderViewNode(child, renderer)))
  }
  if (value.kind === 'geometry') {
    return renderViewNode(value.content(zeroGeometry), renderer)
  }
  if (value.kind === 'lazy') {
    return renderer.element(
      'div',
      value.props,
      ...value.children.map(child => renderViewNode(child, renderer)),
    )
  }
  return renderer.element(
    value.type,
    value.props,
    ...value.children.map(child => renderViewNode(child, renderer)),
  )
}

export const reactRenderer: VuneRenderer<ReactNode> = {
  element(type, props, ...children) {
    return createElement(type as any, props as any, ...children)
  },
  fragment(children) {
    return createElement(Fragment, null, ...children)
  },
  value(value) {
    return value as ReactNode
  },
  view(node) {
    return createElement(node.host as any, node.props as any)
  },
  modifier(content, modifier) {
    return modifier.props && isValidElement(content)
      ? cloneElement(content, modifier.props as any)
      : content
  },
  render(value) {
    return renderViewNode(value, reactRenderer)
  },
}

export function materializeViewNode(node: ViewNode): ReactElement {
  return markViewNode(reactRenderer.render(node) as ReactElement, node) as ReactElement
}
