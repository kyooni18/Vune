import { createElement, type ComponentType, type ReactNode } from "react"
import { viewElement, type ViewValue } from "@muse/core"

export function Component(type: ComponentType<any> | string, props: Record<string, unknown> | null = null, ...children: ViewValue[]): ViewValue {
  return viewElement(type, props, children)
}

export function Raw(value: ReactNode): ViewValue {
  return value as ViewValue
}

export function reactElement(type: ComponentType<any> | string, props?: Record<string, unknown> | null, ...children: ReactNode[]): ReactNode {
  return createElement(type as any, props, ...children)
}
