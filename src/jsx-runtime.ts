import { Fragment, jsx as reactJsx, jsxs as reactJsxs } from 'react/jsx-runtime'
import { jsxDEV as reactJsxDEV } from 'react/jsx-dev-runtime'
import type { JSXElementConstructor, ReactElement } from 'react'
import { styled } from './modifiers.js'
import { applyRuiPlugins } from './runtime/modifier-pipeline.js'
import { markRuiNode } from './runtime/jsx-node.js'

const RUI_PROPS = new Set([
  'padding', 'margin', 'gap', 'width', 'height', 'minWidth', 'maxWidth',
  'minHeight', 'maxHeight', 'frame', 'background', 'foreground', 'opacity',
  'radius', 'border', 'shadow', 'fontSize', 'fontWeight', 'fontFamily',
  'lineHeight', 'textAlign', 'bold', 'grow', 'shrink', 'flex', 'wrap',
  'order', 'align', 'justify', 'alignment', 'position', 'overflow', 'cursor',
  'zIndex', 'transform', 'cssTransition'
])

function splitProps(props: Record<string, unknown> | null | undefined) {
  const native: Record<string, unknown> = {}
  const modifiers: Array<(value: any) => any> = []
  const modifierNames: string[] = []

  for (const [key, value] of Object.entries(props ?? {})) {
    if (RUI_PROPS.has(key)) {
      modifierNames.push(key)
      modifiers.push((element) => {
        const fn = (element as any)[key]
        return typeof fn === 'function' ? fn.call(element, value) : element
      })
    } else {
      native[key] = value
    }
  }

  return { native, modifiers, modifierNames }
}

function applyModifiers(element: ReactElement, modifiers: Array<(value: any) => any>): ReactElement {
  if (modifiers.length === 0) return element
  let result: any = styled(element)
  for (const modifier of modifiers) result = modifier(result)
  return result
}

function wrap(factory: (type: any, props: any, key?: any) => ReactElement, type: any, props: any, key?: any) {
  const { native, modifiers, modifierNames } = splitProps(props)
  const element = factory(type as JSXElementConstructor<any>, native, key)
  const styledElement = applyModifiers(element, modifiers)
  const pluginElement = applyRuiPlugins(styledElement)
  return markRuiNode(pluginElement, { modifiers: modifierNames, layout: native.style })
}

export const jsx = (type: any, props: any, key?: any) => wrap(reactJsx, type, props, key)
export const jsxs = (type: any, props: any, key?: any) => wrap(reactJsxs, type, props, key)
export const jsxDEV = (type: any, props: any, key?: any, isStaticChildren?: boolean, source?: any, self?: any) => {
  const { native, modifiers, modifierNames } = splitProps(props)
  const element = reactJsxDEV(type, native, key, isStaticChildren ?? false, source, self)
  const styledElement = applyModifiers(element, modifiers)
  const pluginElement = applyRuiPlugins(styledElement)
  return markRuiNode(pluginElement, { modifiers: modifierNames, layout: native.style })
}

export { Fragment }
