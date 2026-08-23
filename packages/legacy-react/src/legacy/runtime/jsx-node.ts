import type { ReactElement } from 'react'

export const vuneNode = Symbol.for('vune.node')

export interface VuneNodeMetadata {
  modifiers: unknown[]
  layout?: unknown
}

const metadata = new WeakMap<object, VuneNodeMetadata>()

export function markVuneNode(element: ReactElement, data: VuneNodeMetadata): ReactElement {
  metadata.set(element, data)
  return element
}

export function getVuneNodeMetadata(element: ReactElement): VuneNodeMetadata | undefined {
  return metadata.get(element)
}
