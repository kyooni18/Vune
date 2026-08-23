import { createElement, type ComponentProps, type ComponentType, type ReactNode } from "react"
import { ForeignComponent, viewElement, type ModifiableViewNode, type ViewValue } from "@vune-ui/core"

/**
 * Embed a React component in the renderer-independent Vune graph while
 * preserving the component's own prop type at the authoring boundary.
 */
export function Component<C extends ComponentType<any>>(
  type: C,
  props: ComponentProps<C>,
  ...children: ViewValue[]
): ModifiableViewNode
export function Component(
  type: string,
  props?: Record<string, unknown> | null,
  ...children: ViewValue[]
): ModifiableViewNode
export function Component(
  type: ComponentType<any> | string,
  props: Record<string, unknown> | null = null,
  ...children: ViewValue[]
): ModifiableViewNode {
  return viewElement(type, props, children)
}

export function Raw(value: ReactNode): ViewValue {
  const RawReactValue = () => value
  return ForeignComponent(RawReactValue, { name: "React.Raw", adapter: "react" })
}

export function reactElement(type: ComponentType<any> | string, props?: Record<string, unknown> | null, ...children: ReactNode[]): ReactNode {
  return createElement(type as any, props, ...children)
}
