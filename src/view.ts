import {
  Fragment,
  createElement,
  type ComponentType,
  type ReactNode,
} from 'react'
import { layoutChild } from './layout.js'
import { useReactiveValue } from './state.js'

export type ViewContent = ReactNode | (() => ReactNode)

export function view(content: ViewContent): ComponentType {
  function VuneView() {
    const node = typeof content === 'function'
      ? useReactiveValue(content as () => ReactNode)
      : content
    return createElement(Fragment, null, layoutChild(node))
  }

  VuneView.displayName = 'VuneView'
  return VuneView
}
