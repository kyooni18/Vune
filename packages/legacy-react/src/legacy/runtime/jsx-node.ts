import type { ReactElement } from 'react'

export const museNode = Symbol.for('muse.node')

export interface MuseNodeMetadata {
  modifiers: unknown[]
  layout?: unknown
}

const metadata = new WeakMap<object, MuseNodeMetadata>()

export function markMuseNode(element: ReactElement, data: MuseNodeMetadata): ReactElement {
  metadata.set(element, data)
  return element
}

export function getMuseNodeMetadata(element: ReactElement): MuseNodeMetadata | undefined {
  return metadata.get(element)
}
