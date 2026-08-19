import {
  Fragment,
  createElement,
  isValidElement,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react'
import type { ClassValue } from './types.js'

export interface ComponentLayoutProps {
  className?: ClassValue
  style?: CSSProperties
}

export const vuneIntrinsic = Symbol.for('vune.intrinsic')

const componentLayoutProps = new WeakMap<object, ComponentLayoutProps>()
const proxyTargets = new WeakMap<object, ReactElement>()

function identity(element: ReactElement): ReactElement {
  return proxyTargets.get(element as object) ?? element
}

export function registerStyledProxy(proxy: object, target: ReactElement): void {
  proxyTargets.set(proxy, target)
}

export function markIntrinsic<T extends Function>(component: T): T {
  Object.defineProperty(component, vuneIntrinsic, { value: true })
  return component
}

export function isComponentElement(element: ReactElement): boolean {
  const type = element.type as any
  if (typeof type === 'string' || type === Fragment) return false
  if (type?.[vuneIntrinsic] === true) return false
  return true
}

export function layoutPropsOf(element: ReactElement): ComponentLayoutProps | undefined {
  return componentLayoutProps.get(identity(element) as object)
}

export function copyLayoutProps(source: ReactElement, target: ReactElement): void {
  const props = layoutPropsOf(source)
  if (!props) return
  componentLayoutProps.set(target as object, {
    ...props,
    ...(props.style ? { style: { ...props.style } } : {}),
  })
}

export function setLayoutStyle(element: ReactElement, style: CSSProperties): void {
  const target = identity(element)
  const current = componentLayoutProps.get(target as object)
  componentLayoutProps.set(target as object, {
    ...current,
    style: { ...(current?.style ?? {}), ...style },
  })
}

export function setLayoutClass(element: ReactElement, className: ClassValue): void {
  const target = identity(element)
  const current = componentLayoutProps.get(target as object)
  componentLayoutProps.set(target as object, { ...current, className })
}

function classNameOf(value: ClassValue): string | undefined {
  if (Array.isArray(value)) return value.filter(Boolean).join(' ')
  return value as string | undefined
}

export function layoutChild(child: ReactNode): ReactNode {
  if (!isValidElement(child) || !isComponentElement(child)) return child
  const layout = layoutPropsOf(child)
  return createElement(
    'div',
    {
      key: child.key ?? undefined,
      'data-vune-layout-host': '',
      className: classNameOf(layout?.className),
      style: {
        minWidth: 0,
        minHeight: 0,
        ...(layout?.style ?? {}),
      },
    },
    child,
  )
}

export function layoutChildren(children: ReactNode[]): ReactNode[] {
  return children.map(layoutChild)
}
