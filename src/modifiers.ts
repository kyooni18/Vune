import { cloneVNode, type CSSProperties, type Ref, type VNode, type VNodeRef } from 'vue'
import type {
  Alignment,
  Axis,
  BorderOptions,
  ClassValue,
  FrameOptions,
  Length,
  ModelOptions,
  Modifiers,
  StyledVNode,
} from './types.js'

const proxyCache = new WeakMap<object, StyledVNode>()
const styledProxySet = new WeakSet<object>()

function cssLength(value: Length): string {
  return typeof value === 'number' ? `${value}px` : value
}

function resolvedStyle(vnode: VNode): CSSProperties {
  const source = vnode.props?.style
  if (!source) return {}
  if (!Array.isArray(source)) return typeof source === 'object' ? source as CSSProperties : {}
  return Object.assign({}, ...source.map(item => {
    if (Array.isArray(item)) return Object.assign({}, ...item)
    return typeof item === 'object' && item !== null ? item : {}
  }))
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

function semanticAlignmentStyle(vnode: VNode, alignment: Alignment): CSSProperties {
  const current = resolvedStyle(vnode)
  const { horizontal, vertical } = alignmentParts(alignment)
  const horizontalFlex = horizontal === 'leading'
    ? 'flex-start'
    : horizontal === 'trailing'
      ? 'flex-end'
      : 'center'
  const verticalFlex = vertical === 'top'
    ? 'flex-start'
    : vertical === 'bottom'
      ? 'flex-end'
      : 'center'

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

  return {
    display: 'flex',
    justifyContent: horizontalFlex,
    alignItems: verticalFlex,
  }
}

function edgeStyle(prefix: 'padding' | 'margin', axis: Axis, value: Length): CSSProperties {
  const length = cssLength(value)
  const style: CSSProperties = {}
  const writable = style as Record<string, string | number | undefined>

  if (axis === 'all') {
    writable[prefix] = length
    return style
  }

  const edges = axis === 'horizontal'
    ? ['Left', 'Right']
    : axis === 'vertical'
      ? ['Top', 'Bottom']
      : [axis[0].toUpperCase() + axis.slice(1)]

  for (const edge of edges) writable[`${prefix}${edge}`] = length
  return style
}

function patch(vnode: VNode, extraProps: Record<string, unknown>, mergeRef = false): StyledVNode {
  return styled(cloneVNode(vnode, extraProps, mergeRef))
}

function patchStyle(vnode: VNode, style: CSSProperties): StyledVNode {
  return patch(vnode, { style })
}

function eventPropName(event: string): string {
  if (event.startsWith('on') && event.length > 2) return event
  if (!event) throw new Error('Event name cannot be empty')
  return `on${event[0].toUpperCase()}${event.slice(1)}`
}

function applyModel<T>(vnode: VNode, value: Ref<T>, options: ModelOptions<T> = {}): StyledVNode {
  const name = options.name ?? 'modelValue'
  const event = `onUpdate:${name}`
  const exposed = options.transformIn ? options.transformIn(value.value) : value.value

  return patch(vnode, {
    [name]: exposed,
    [event]: (next: unknown) => {
      value.value = options.transformOut
        ? options.transformOut(next)
        : next as T
    },
  })
}

const modifiers: Modifiers = {
  padding(this: VNode, axisOrValue: Axis | Length, maybeValue?: Length) {
    if (maybeValue === undefined) {
      return patchStyle(this, { padding: cssLength(axisOrValue as Length) })
    }
    return patchStyle(this, edgeStyle('padding', axisOrValue as Axis, maybeValue))
  },

  margin(this: VNode, axisOrValue: Axis | Length, maybeValue?: Length) {
    if (maybeValue === undefined) {
      return patchStyle(this, { margin: cssLength(axisOrValue as Length) })
    }
    return patchStyle(this, edgeStyle('margin', axisOrValue as Axis, maybeValue))
  },

  gap(this: VNode, value: Length) {
    return patchStyle(this, { gap: cssLength(value) })
  },

  width(this: VNode, value: Length) {
    return patchStyle(this, { width: cssLength(value) })
  },

  height(this: VNode, value: Length) {
    return patchStyle(this, { height: cssLength(value) })
  },

  minWidth(this: VNode, value: Length) {
    return patchStyle(this, { minWidth: cssLength(value) })
  },

  maxWidth(this: VNode, value: Length) {
    return patchStyle(this, { maxWidth: cssLength(value) })
  },

  minHeight(this: VNode, value: Length) {
    return patchStyle(this, { minHeight: cssLength(value) })
  },

  maxHeight(this: VNode, value: Length) {
    return patchStyle(this, { maxHeight: cssLength(value) })
  },

  frame(this: VNode, options: FrameOptions) {
    const style: CSSProperties = {}
    if (options.width !== undefined) style.width = cssLength(options.width)
    if (options.height !== undefined) style.height = cssLength(options.height)
    if (options.minWidth !== undefined) style.minWidth = cssLength(options.minWidth)
    if (options.maxWidth === 'infinity') {
      style.width = '100%'
      style.maxWidth = '100%'
    } else if (options.maxWidth !== undefined) {
      style.maxWidth = cssLength(options.maxWidth)
    }
    if (options.minHeight !== undefined) style.minHeight = cssLength(options.minHeight)
    if (options.maxHeight === 'infinity') {
      style.height = '100%'
      style.maxHeight = '100%'
    } else if (options.maxHeight !== undefined) {
      style.maxHeight = cssLength(options.maxHeight)
    }
    if (options.alignment !== undefined) {
      Object.assign(style, semanticAlignmentStyle(this, options.alignment))
    }
    return patchStyle(this, style)
  },

  background(this: VNode, value: NonNullable<CSSProperties['background']>) {
    return patchStyle(this, { background: value })
  },

  foreground(this: VNode, value: NonNullable<CSSProperties['color']>) {
    return patchStyle(this, { color: value })
  },

  opacity(this: VNode, value: number) {
    return patchStyle(this, { opacity: value })
  },

  radius(this: VNode, value: Length) {
    return patchStyle(this, { borderRadius: cssLength(value) })
  },

  border(this: VNode, options: BorderOptions = {}) {
    return patchStyle(this, {
      borderWidth: cssLength(options.width ?? 1),
      borderColor: options.color ?? 'currentColor',
      borderStyle: options.style ?? 'solid',
    })
  },

  shadow(this: VNode, value: NonNullable<CSSProperties['boxShadow']>) {
    return patchStyle(this, { boxShadow: value })
  },

  fontSize(this: VNode, value: Length) {
    return patchStyle(this, { fontSize: cssLength(value) })
  },

  fontWeight(this: VNode, value: NonNullable<CSSProperties['fontWeight']>) {
    return patchStyle(this, { fontWeight: value })
  },

  fontFamily(this: VNode, value: NonNullable<CSSProperties['fontFamily']>) {
    return patchStyle(this, { fontFamily: value })
  },

  lineHeight(this: VNode, value: NonNullable<CSSProperties['lineHeight']>) {
    return patchStyle(this, { lineHeight: value })
  },

  textAlign(this: VNode, value: NonNullable<CSSProperties['textAlign']>) {
    return patchStyle(this, { textAlign: value })
  },

  bold(this: VNode) {
    return patchStyle(this, { fontWeight: 600 })
  },

  grow(this: VNode, value = 1) {
    return patchStyle(this, { flexGrow: value })
  },

  shrink(this: VNode, value = 1) {
    return patchStyle(this, { flexShrink: value })
  },

  flex(this: VNode, value: NonNullable<CSSProperties['flex']>) {
    return patchStyle(this, { flex: value })
  },

  wrap(this: VNode, value: NonNullable<CSSProperties['flexWrap']> = 'wrap') {
    return patchStyle(this, { flexWrap: value })
  },

  order(this: VNode, value: number) {
    return patchStyle(this, { order: value })
  },

  align(this: VNode, value: NonNullable<CSSProperties['alignItems']>) {
    return patchStyle(this, { alignItems: value })
  },

  justify(this: VNode, value: NonNullable<CSSProperties['justifyContent']>) {
    return patchStyle(this, { justifyContent: value })
  },

  alignment(this: VNode, value: Alignment) {
    return patchStyle(this, semanticAlignmentStyle(this, value))
  },

  position(this: VNode, value: NonNullable<CSSProperties['position']>) {
    return patchStyle(this, { position: value })
  },

  overflow(this: VNode, value: NonNullable<CSSProperties['overflow']>) {
    return patchStyle(this, { overflow: value })
  },

  cursor(this: VNode, value: NonNullable<CSSProperties['cursor']>) {
    return patchStyle(this, { cursor: value })
  },

  zIndex(this: VNode, value: NonNullable<CSSProperties['zIndex']>) {
    return patchStyle(this, { zIndex: value })
  },

  transform(this: VNode, value: NonNullable<CSSProperties['transform']>) {
    return patchStyle(this, { transform: value })
  },

  cssTransition(this: VNode, value: NonNullable<CSSProperties['transition']>) {
    return patchStyle(this, { transition: value })
  },

  id(this: VNode, value: string) {
    return patch(this, { id: value })
  },

  role(this: VNode, value: string) {
    return patch(this, { role: value })
  },

  disabled(this: VNode, value = true) {
    return patch(this, { disabled: value })
  },

  keyed(this: VNode, value: PropertyKey) {
    return patch(this, { key: value })
  },

  templateRef(this: VNode, value: VNodeRef, merge = false) {
    return patch(this, { ref: value }, merge)
  },

  model<T>(this: VNode, value: Ref<T>, nameOrOptions?: string | ModelOptions<T>) {
    const options = typeof nameOrOptions === 'string'
      ? { name: nameOrOptions }
      : nameOrOptions
    return applyModel(this, value, options)
  },

  className(this: VNode, value: ClassValue) {
    return patch(this, { class: value })
  },

  style(this: VNode, value: CSSProperties) {
    return patchStyle(this, value)
  },

  withProps(this: VNode, value: Record<string, unknown>) {
    return patch(this, value)
  },

  attr(this: VNode, name: string, value: unknown) {
    return patch(this, { [name]: value })
  },

  on(this: VNode, event: string, handler: (...args: any[]) => unknown) {
    return patch(this, { [eventPropName(event)]: handler })
  },

  onClick(this: VNode, handler: (event: MouseEvent) => unknown) {
    return patch(this, { onClick: handler })
  },

  onDblClick(this: VNode, handler: (event: MouseEvent) => unknown) {
    return patch(this, { onDblclick: handler })
  },

  onInput(this: VNode, handler: (event: InputEvent) => unknown) {
    return patch(this, { onInput: handler })
  },

  onChange(this: VNode, handler: (event: Event) => unknown) {
    return patch(this, { onChange: handler })
  },

  onKeyDown(this: VNode, handler: (event: KeyboardEvent) => unknown) {
    return patch(this, { onKeydown: handler })
  },

  onKeyUp(this: VNode, handler: (event: KeyboardEvent) => unknown) {
    return patch(this, { onKeyup: handler })
  },

  onFocus(this: VNode, handler: (event: FocusEvent) => unknown) {
    return patch(this, { onFocus: handler })
  },

  onBlur(this: VNode, handler: (event: FocusEvent) => unknown) {
    return patch(this, { onBlur: handler })
  },

  onSubmit(this: VNode, handler: (event: SubmitEvent) => unknown) {
    return patch(this, { onSubmit: handler })
  },

  onPointerDown(this: VNode, handler: (event: PointerEvent) => unknown) {
    return patch(this, { onPointerdown: handler })
  },

  onPointerMove(this: VNode, handler: (event: PointerEvent) => unknown) {
    return patch(this, { onPointermove: handler })
  },

  onPointerUp(this: VNode, handler: (event: PointerEvent) => unknown) {
    return patch(this, { onPointerup: handler })
  },

  onMouseEnter(this: VNode, handler: (event: MouseEvent) => unknown) {
    return patch(this, { onMouseenter: handler })
  },

  onMouseLeave(this: VNode, handler: (event: MouseEvent) => unknown) {
    return patch(this, { onMouseleave: handler })
  },
}

const modifierNames = new Set(Reflect.ownKeys(modifiers))

export function styled(vnode: VNode): StyledVNode {
  if (styledProxySet.has(vnode as object)) return vnode as StyledVNode

  const cached = proxyCache.get(vnode as object)
  if (cached) return cached

  const proxy = new Proxy(vnode as StyledVNode, {
    get(target, property, receiver) {
      if (modifierNames.has(property)) {
        const modifier = Reflect.get(modifiers, property) as (...args: any[]) => StyledVNode
        return (...args: any[]) => modifier.apply(target, args)
      }
      return Reflect.get(target, property, receiver)
    },
    set(target, property, value, receiver) {
      return Reflect.set(target, property, value, receiver)
    },
  })

  proxyCache.set(vnode as object, proxy)
  styledProxySet.add(proxy as object)
  return proxy
}
