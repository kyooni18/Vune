import {
  Fragment,
  createElement,
  useRef,
  type ComponentType,
  type ReactNode,
} from 'react'
import { layoutChild } from './layout.js'
import { useReactiveValue } from './state.js'

export type ViewContent<Props extends object = {}> = ReactNode | ((props: Props) => ReactNode)

export interface ViewDefinition<
  State extends Record<string, unknown>,
  Props extends object = {},
> {
  state: (props: Props) => State
  body: (state: State, props: Props) => ReactNode
}

function isViewDefinition<
  State extends Record<string, unknown>,
  Props extends object,
>(
  value: ViewContent<Props> | ViewDefinition<State, Props>,
): value is ViewDefinition<State, Props> {
  return typeof value === 'object'
    && value !== null
    && 'state' in value
    && typeof (value as ViewDefinition<State, Props>).state === 'function'
    && 'body' in value
    && typeof (value as ViewDefinition<State, Props>).body === 'function'
}

export function view<
  State extends Record<string, unknown>,
  Props extends object = {},
>(definition: ViewDefinition<State, Props>): ComponentType<Props>
export function view<Props extends object = {}>(content: ViewContent<Props>): ComponentType<Props>
export function view<
  State extends Record<string, unknown>,
  Props extends object = {},
>(
  input: ViewContent<Props> | ViewDefinition<State, Props>,
): ComponentType<Props> {
  function VuneView(props: Props) {
    const instance = useRef<{ initialized: boolean; state: State | null }>({
      initialized: false,
      state: null,
    })

    const definition = isViewDefinition(input) ? input : null
    if (definition && !instance.current.initialized) {
      instance.current.state = definition.state(props)
      instance.current.initialized = true
    }

    const node = useReactiveValue<ReactNode>(() => {
      if (definition) return definition.body(instance.current.state as State, props)
      const content = input as ViewContent<Props>
      return typeof content === 'function'
        ? (content as (props: Props) => ReactNode)(props)
        : content
    })

    return createElement(Fragment, null, layoutChild(node))
  }

  VuneView.displayName = 'VuneView'
  return VuneView
}
