import { createElement, type ComponentType, type ReactNode } from "react"
import { ForeignComponent, viewElement, type ViewValue } from "@vune-ui/core"

export function Component(type: ComponentType<any> | string, props: Record<string, unknown> | null = null, ...children: ViewValue[]): ViewValue {
  return viewElement(type, props, children)
}

export function Raw(value: ReactNode): ViewValue {
  const RawReactValue = () => value
  return ForeignComponent(RawReactValue, { name: "React.Raw", adapter: "react" })
}

export function reactElement(type: ComponentType<any> | string, props?: Record<string, unknown> | null, ...children: ReactNode[]): ReactNode {
  return createElement(type as any, props, ...children)
}
