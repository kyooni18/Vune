import {
  cloneElement,
  type CSSProperties,
  type ReactElement,
} from 'react'
import {
  copyLayoutProps,
  classNameOf,
  isComponentElement,
  layoutPropsOf,
  registerStyledProxy,
  setLayoutClass,
  setLayoutStyle,
} from './layout.js'
import type {
  Alignment,
  Axis,
  BorderOptions,
  ClassValue,
  FrameOptions,
  Length,
  Modifiers,
  StyleValue,
  StyledElement,
} from './types.js'

const proxyCache = new WeakMap<object, StyledElement>()
const proxyTargets = new WeakMap<object, ReactElement>()

function raw(element: ReactElement): ReactElement {
  return proxyTargets.get(element as object) ?? element
}

function cssLength(value: Length): string {
  return typeof value === 'number' ? `${value}px` : value
}

function currentStyle(element: ReactElement): StyleValue {
  if (isComponentElement(element)) return layoutPropsOf(element)?.style ?? {}
  const value = (raw(element).props as any)?.style
  return value && typeof value === 'object' ? value as StyleValue : {}
}

function patch(element: ReactElement, extraProps: Record<string, unknown>): StyledElement {
  const target = raw(element)
  const clone = cloneElement(target, extraProps as any)
  copyLayoutProps(element, clone)
  return styled(clone)
}

function patchStyle(element: ReactElement, style: StyleValue): StyledElement {
  if (isComponentElement(element)) {
    const clone = cloneElement(raw(element))
    copyLayoutProps(element, clone)
    setLayoutStyle(clone, style)
    return styled(clone)
  }
  return patch(element, { style: { ...currentStyle(element), ...style } })
}

function alignmentParts(alignment: Alignment): {
  horizontal: 'leading' | 'center' | 'trailing'
  vertical: 'top' | 'center' | 'bottom'
} {
  switch (alignment) {
    case 'leading': return { horizontal: 'leading', vertical: 'center' }
    case 'trailing': return { horizontal: 'trailing', vertical: 'center' }
    case 'top': return { horizontal: 'center', vertical: 'top' }
    case 'bottom': return { horizontal: 'center', vertical: 'bottom' }
    case 'topLeading': return { horizontal: 'leading', vertical: 'top' }
    case 'topTrailing': return { horizontal: 'trailing', vertical: 'top' }
    case 'bottomLeading': return { horizontal: 'leading', vertical: 'bottom' }
    case 'bottomTrailing': return { horizontal: 'trailing', vertical: 'bottom' }
    default: return { horizontal: 'center', vertical: 'center' }
  }
}

function semanticAlignmentStyle(element: ReactElement, alignment: Alignment): CSSProperties {
  const current = currentStyle(element)
  const { horizontal, vertical } = alignmentParts(alignment)
  const horizontalFlex = horizontal === 'leading' ? 'flex-start' : horizontal === 'trailing' ? 'flex-end' : 'center'
  const verticalFlex = vertical === 'top' ? 'flex-start' : vertical === 'bottom' ? 'flex-end' : 'center'

  if (current.display === 'grid') {
    return {
      justifyItems: horizontal === 'leading' ? 'start' : horizontal === 'trailing' ? 'end' : 'center',
      alignItems: vertical === 'top' ? 'start' : vertical === 'bottom' ? 'end' : 'center',
    }
  }
  if (current.display === 'flex') {
    const column = String(current.flexDirection ?? 'row').startsWith('column')
    return column
      ? { alignItems: horizontalFlex, justifyContent: verticalFlex }
      : { justifyContent: horizontalFlex, alignItems: verticalFlex }
  }
  return { display: 'flex', justifyContent: horizontalFlex, alignItems: verticalFlex }
}

function edgeStyle(prefix: 'padding' | 'margin', axis: Axis, value: Length): CSSProperties {
  const length = cssLength(value)
  if (axis === 'all') return { [prefix]: length } as CSSProperties
  if (axis === 'horizontal') return { [`${prefix}Left`]: length, [`${prefix}Right`]: length } as CSSProperties
  if (axis === 'vertical') return { [`${prefix}Top`]: length, [`${prefix}Bottom`]: length } as CSSProperties
  const edge = axis[0].toUpperCase() + axis.slice(1)
  return { [`${prefix}${edge}`]: length } as CSSProperties
}

const modifiers: Modifiers = {
  padding(this: ReactElement, axisOrValue: Axis | Length, maybeValue?: Length) {
    return maybeValue === undefined
      ? patchStyle(this, { padding: cssLength(axisOrValue as Length) })
      : patchStyle(this, edgeStyle('padding', axisOrValue as Axis, maybeValue))
  },
  margin(this: ReactElement, axisOrValue: Axis | Length, maybeValue?: Length) {
    return maybeValue === undefined
      ? patchStyle(this, { margin: cssLength(axisOrValue as Length) })
      : patchStyle(this, edgeStyle('margin', axisOrValue as Axis, maybeValue))
  },
  gap(this: ReactElement, value: Length) { return patchStyle(this, { gap: cssLength(value) }) },
  width(this: ReactElement, value: Length) { return patchStyle(this, { width: cssLength(value) }) },
  height(this: ReactElement, value: Length) { return patchStyle(this, { height: cssLength(value) }) },
  minWidth(this: ReactElement, value: Length) { return patchStyle(this, { minWidth: cssLength(value) }) },
  maxWidth(this: ReactElement, value: Length) { return patchStyle(this, { maxWidth: cssLength(value) }) },
  minHeight(this: ReactElement, value: Length) { return patchStyle(this, { minHeight: cssLength(value) }) },
  maxHeight(this: ReactElement, value: Length) { return patchStyle(this, { maxHeight: cssLength(value) }) },
  frame(this: ReactElement, options: FrameOptions) {
    const style: CSSProperties = { boxSizing: 'border-box' }
    if (options.width !== undefined) style.width = cssLength(options.width)
    if (options.height !== undefined) style.height = cssLength(options.height)
    if (options.minWidth !== undefined) style.minWidth = cssLength(options.minWidth)
    if (options.maxWidth === 'infinity') Object.assign(style, { width: '100%', maxWidth: '100%', alignSelf: 'stretch' })
    else if (options.maxWidth !== undefined) style.maxWidth = cssLength(options.maxWidth)
    if (options.minHeight !== undefined) style.minHeight = cssLength(options.minHeight)
    if (options.maxHeight === 'infinity') Object.assign(style, { height: '100%', maxHeight: '100%', alignSelf: 'stretch' })
    else if (options.maxHeight !== undefined) style.maxHeight = cssLength(options.maxHeight)
    if (options.alignment !== undefined) Object.assign(style, semanticAlignmentStyle(this, options.alignment))
    return patchStyle(this, style)
  },
  background(this: ReactElement, value: any) { return patchStyle(this, { background: value }) },
  foreground(this: ReactElement, value: any) { return patchStyle(this, { color: value }) },
  opacity(this: ReactElement, value: number) { return patchStyle(this, { opacity: value }) },
  radius(this: ReactElement, value: Length) { return patchStyle(this, { borderRadius: cssLength(value) }) },
  border(this: ReactElement, options: BorderOptions = {}) {
    return patchStyle(this, {
      borderWidth: cssLength(options.width ?? 1),
      borderColor: options.color ?? 'currentColor',
      borderStyle: options.style ?? 'solid',
    })
  },
  shadow(this: ReactElement, value: any) { return patchStyle(this, { boxShadow: value }) },
  fontSize(this: ReactElement, value: Length) { return patchStyle(this, { fontSize: cssLength(value) }) },
  fontWeight(this: ReactElement, value: any) { return patchStyle(this, { fontWeight: value }) },
  fontFamily(this: ReactElement, value: any) { return patchStyle(this, { fontFamily: value }) },
  lineHeight(this: ReactElement, value: any) { return patchStyle(this, { lineHeight: value }) },
  textAlign(this: ReactElement, value: any) { return patchStyle(this, { textAlign: value }) },
  bold(this: ReactElement) { return patchStyle(this, { fontWeight: 600 }) },
  grow(this: ReactElement, value = 1) { return patchStyle(this, { flexGrow: value }) },
  shrink(this: ReactElement, value = 1) { return patchStyle(this, { flexShrink: value }) },
  flex(this: ReactElement, value: any) { return patchStyle(this, { flex: value }) },
  wrap(this: ReactElement, value: any = 'wrap') { return patchStyle(this, { flexWrap: value }) },
  order(this: ReactElement, value: number) { return patchStyle(this, { order: value }) },
  align(this: ReactElement, value: any) { return patchStyle(this, { alignItems: value }) },
  justify(this: ReactElement, value: any) { return patchStyle(this, { justifyContent: value }) },
  alignment(this: ReactElement, value: Alignment) { return patchStyle(this, semanticAlignmentStyle(this, value)) },
  position(this: ReactElement, value: any) { return patchStyle(this, { position: value }) },
  overflow(this: ReactElement, value: any) { return patchStyle(this, { overflow: value }) },
  cursor(this: ReactElement, value: any) { return patchStyle(this, { cursor: value }) },
  zIndex(this: ReactElement, value: any) { return patchStyle(this, { zIndex: value }) },
  transform(this: ReactElement, value: any) { return patchStyle(this, { transform: value }) },
  cssTransition(this: ReactElement, value: any) { return patchStyle(this, { transition: value }) },
  id(this: ReactElement, value: string) { return patch(this, { id: value }) },
  role(this: ReactElement, value: string) { return patch(this, { role: value }) },
  disabled(this: ReactElement, value = true) { return patch(this, { disabled: value }) },
  keyed(this: ReactElement, value: any) { return patch(this, { key: value }) },
  elementRef(this: ReactElement, value: any) { return patch(this, { ref: value }) },
  className(this: ReactElement, value: ClassValue) {
    if (isComponentElement(this)) {
      const clone = cloneElement(raw(this))
      copyLayoutProps(this, clone)
      setLayoutClass(clone, classNameOf(layoutPropsOf(this)?.className, value))
      return styled(clone)
    }
    const className = classNameOf((raw(this).props as any)?.className, value)
    return patch(this, { className })
  },
  style(this: ReactElement, value: StyleValue) { return patchStyle(this, value) },
  withProps(this: ReactElement, value: Record<string, unknown>) { return patch(this, value) },
  attr(this: ReactElement, name: string, value: unknown) { return patch(this, { [name]: value }) },
  on(this: ReactElement, event: string, handler: (...args: any[]) => unknown) { return patch(this, { [event]: handler }) },
  onClick(this: ReactElement, handler: any) { return patch(this, { onClick: handler }) },
  onInput(this: ReactElement, handler: any) { return patch(this, { onInput: handler }) },
  onChange(this: ReactElement, handler: any) { return patch(this, { onChange: handler }) },
  onKeyDown(this: ReactElement, handler: any) { return patch(this, { onKeyDown: handler }) },
  onKeyUp(this: ReactElement, handler: any) { return patch(this, { onKeyUp: handler }) },
  onFocus(this: ReactElement, handler: any) { return patch(this, { onFocus: handler }) },
  onBlur(this: ReactElement, handler: any) { return patch(this, { onBlur: handler }) },
  onSubmit(this: ReactElement, handler: any) { return patch(this, { onSubmit: handler }) },
}

export function styled(element: ReactElement): StyledElement {
  const target = raw(element)
  const cached = proxyCache.get(target as object)
  if (cached) return cached

  let proxy: StyledElement
  proxy = new Proxy(target as StyledElement, {
    get(current, property, receiver) {
      if (typeof property === 'string' && property in modifiers) {
        const modifier = (modifiers as any)[property]
        return (...args: any[]) => modifier.apply(proxy, args)
      }
      return Reflect.get(current as object, property, receiver)
    },
  })

  proxyCache.set(target as object, proxy)
  proxyTargets.set(proxy as object, target)
  registerStyledProxy(proxy as object, target)
  return proxy
}
