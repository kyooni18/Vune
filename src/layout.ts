import { h, isVNode, type CSSProperties, type VNode, type VNodeChild } from 'vue'
import type { ClassValue } from './types.js'

export interface ComponentLayoutProps {
  class?: ClassValue
  style?: CSSProperties
}

const componentLayoutProps = new WeakMap<object, ComponentLayoutProps>()

/**
 * True for ordinary Vue component VNodes. Native elements, Fragments, text,
 * comments and Teleports are not treated as opaque component layout items.
 */
export function isComponentVNode(vnode: VNode): boolean {
  const type = vnode.type as any
  if (typeof type === 'function') return true
  if (typeof type !== 'object' || type === null) return false
  if (type.__isTeleport === true) return false
  return true
}

export function layoutPropsOf(vnode: VNode): ComponentLayoutProps | undefined {
  return componentLayoutProps.get(vnode as object)
}

export function layoutStyleOf(vnode: VNode): CSSProperties | undefined {
  return layoutPropsOf(vnode)?.style
}

export function copyLayoutProps(source: VNode, target: VNode): void {
  const props = layoutPropsOf(source)
  if (!props) return
  componentLayoutProps.set(target as object, {
    ...props,
    ...(props.style ? { style: { ...props.style } } : {}),
  })
}

export function setLayoutStyle(vnode: VNode, style: CSSProperties): void {
  const current = layoutPropsOf(vnode)
  componentLayoutProps.set(vnode as object, {
    ...current,
    style: {
      ...(current?.style ?? {}),
      ...style,
    },
  })
}

export function setLayoutClass(vnode: VNode, value: ClassValue): void {
  const current = layoutPropsOf(vnode)
  componentLayoutProps.set(vnode as object, {
    ...current,
    class: value,
  })
}

/**
 * Wraps an opaque Vue component in one neutral layout box. The original
 * component VNode stays intact inside the box, so refs, props, slots, emits,
 * state and lifecycle remain owned by Vue while Vune owns only its outer slot.
 */
export function layoutChild(child: VNodeChild): VNodeChild {
  if (!isVNode(child) || !isComponentVNode(child)) return child

  const layout = layoutPropsOf(child)
  return h(
    'div',
    {
      key: child.key,
      'data-vune-layout-host': '',
      ...(layout?.class === undefined ? {} : { class: layout.class }),
      style: {
        minWidth: 0,
        minHeight: 0,
        ...(layout?.style ?? {}),
      },
    },
    child,
  )
}

export function layoutChildren(children: VNodeChild[]): VNodeChild[] {
  return children.map(layoutChild)
}
