import type { ReactElement } from 'react'

export const ruiNode = Symbol.for('rui.node')

export interface RuiNodeMetadata {
  modifiers: unknown[]
  layout?: unknown
}

const metadata = new WeakMap<object, RuiNodeMetadata>()

export function markRuiNode(element: ReactElement, data: RuiNodeMetadata): ReactElement {
  metadata.set(element, data)
  return element
}

export function getRuiNodeMetadata(element: ReactElement): RuiNodeMetadata | undefined {
  return metadata.get(element)
}
