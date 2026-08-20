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

export interface ViewDefinition<State extends Record<string, unknown>> {
  state: () => State
  body: (state: State) => ReactNode
}

function isViewDefinition<State extends Record<string, unknown>>(
  value: ViewContent | ViewDefinition<State>,
): value is ViewDefinition<State> {
  return typeof value === 'object'
    && value !== null
    && 'state' in value
    && typeof (value as ViewDefinition<State>).state === 'function'
    && 'body' in value
    && typeof (value as ViewDefinition<State>).body === 'function'
}

export function view<State extends Record<string, unknown>>(definition: ViewDefinition<State>): ComponentType
export function view(content: ViewContent): ComponentType
export function view<State extends Record<string, unknown>>(
  input: ViewContent | ViewDefinition<State>,
): ComponentType {
  function VuneView() {
    const instance = useRef<{ initialized: boolean; state: State | null }>({
      initialized: false,
      state: null,
    })

    const definition = isViewDefinition(input) ? input : null
    if (definition && !instance.current.initialized) {
      instance.current.state = definition.state()
      instance.current.initialized = true
    }

    const node = useReactiveValue(() => {
      if (definition) return definition.body(instance.current.state as State)
      return typeof input === 'function'
        ? (input as () => ReactNode)()
        : input
    })

    return createElement(Fragment, null, layoutChild(node))
  }

  VuneView.displayName = 'VuneView'
  return VuneView
}
