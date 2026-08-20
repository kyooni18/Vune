import {
  Fragment,
  createElement,
  useRef,
  type ComponentType,
  type ReactNode,
} from 'react'
import { layoutChild } from './layout.js'
import { useReactiveValue } from './state.js'

export type ViewContent = ReactNode | (() => ReactNode)

export interface ViewDefinition<S extends Record<string, unknown>> {
  state: () => S
  body: (state: S) => ReactNode
}

function isViewDefinition(value: unknown): value is ViewDefinition<Record<string, unknown>> {
  return typeof value === 'object'
    && value !== null
    && 'state' in value
    && 'body' in value
    && typeof (value as any).state === 'function'
    && typeof (value as any).body === 'function'
}

export function view(content: ViewContent): ComponentType
export function view<S extends Record<string, unknown>>(definition: ViewDefinition<S>): ComponentType
export function view(input: ViewContent | ViewDefinition<Record<string, unknown>>): ComponentType {
  const definition = isViewDefinition(input) ? input : null

  function VuneView() {
    const instanceState = useRef<Record<string, unknown> | null>(null)
    if (definition && instanceState.current === null) instanceState.current = definition.state()

    const node = useReactiveValue(() => {
      if (definition) return definition.body(instanceState.current ?? {})
      return typeof input === 'function' ? (input as () => ReactNode)() : input
    })

    return createElement(Fragment, null, layoutChild(node))
  }

  VuneView.displayName = 'VuneView'
  return VuneView
}
