import type { FrameOptions } from "../layout.js"
import type { MuseStyleProperties } from "../html.js"
import type { ViewIdentity } from "../identity.js"
import type { ViewType } from "./initializers.js"
import type { museForeignComponent, museInitializers, museView } from "./symbols.js"

export type ViewGraphLeaf = string | number | bigint | boolean | null | undefined | object
export type ViewGraphChild = ViewGraphLeaf | ViewNode
export type ViewGraphValue = ViewGraphChild | readonly ViewGraphValue[]
export type ViewValue = ViewGraphValue
export type Length = number | string
export type ClassValue = string | false | null | undefined | readonly ClassValue[]

export interface GeometryFrame {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

export interface EdgeInsets {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

export interface GeometryProxy {
  readonly frame: GeometryFrame
  readonly size: Readonly<Pick<GeometryFrame, "width" | "height">>
  readonly safeAreaInsets: EdgeInsets
}

export interface ViewModifierNode {
  readonly name: string
  readonly arguments: readonly unknown[]
  /** Optional renderer-facing props supplied by a compatibility adapter. */
  readonly props?: object | null
}

export interface ElementViewNode {
  readonly kind: "element"
  readonly type: unknown
  readonly props: Record<string, unknown> | null
  readonly children: readonly ViewGraphChild[]
}

export type ForeignComponentSlot = ViewGraphValue | ((...args: any[]) => ViewGraphValue)

export interface ForeignComponentSchema {
  readonly props?: Record<string, unknown>
  readonly events?: Record<string, unknown>
  readonly slots?: Record<string, unknown>
}

export interface ForeignComponentOptions {
  readonly props?: Record<string, unknown>
  readonly events?: Record<string, unknown>
  readonly slots?: Record<string, ForeignComponentSlot>
  readonly ref?: unknown
  readonly key?: string | number
  /** Renderer-owned adapter metadata; core never invokes it. */
  readonly adapter?: unknown
  readonly schema?: ForeignComponentSchema
  readonly name?: string
}

export interface ForeignComponentDescriptor {
  readonly [museForeignComponent]: true
  readonly component: unknown
  readonly props: Record<string, unknown>
  readonly events: Record<string, unknown>
  readonly slots: Record<string, ForeignComponentSlot>
  readonly ref?: unknown
  readonly key?: string | number
  readonly adapter?: unknown
  readonly schema?: ForeignComponentSchema
  readonly name: string
}

export interface FragmentViewNode {
  readonly kind: "fragment"
  readonly children: readonly ViewGraphChild[]
}

export interface ViewHostNode {
  readonly kind: "view"
  readonly name: string
  readonly host: unknown
  readonly props: Record<string, unknown>
  readonly state?: (props: Record<string, unknown>) => Record<string, unknown>
  readonly render: (props: Record<string, unknown>) => ViewGraphValue
}

export interface GeometryViewNode {
  readonly kind: "geometry"
  readonly content: (geometry: GeometryProxy) => ViewGraphValue
}

export interface LazyViewRange {
  readonly start: number
  readonly end: number
}

export interface LazyViewNode {
  readonly kind: "lazy"
  readonly name: string
  readonly axis: "vertical" | "horizontal" | "grid"
  readonly props: Record<string, unknown>
  readonly children: readonly ViewGraphChild[]
}

export interface ModifiedContent {
  readonly kind: "modified"
  /** The unmodified graph node; modifiers are stored in one flat sequence. */
  readonly content: ViewNode
  readonly modifiers: readonly ViewModifierNode[]
  /** Compatibility view of the final modifier in the flat sequence. */
  readonly modifier: ViewModifierNode
  readonly name: string
  readonly arguments: readonly unknown[]
}

export type ViewNode = ElementViewNode | FragmentViewNode | ViewHostNode | GeometryViewNode | LazyViewNode | ModifiedContent
/** Public View value: an immutable graph node with value-semantic modifiers. */
export type View = ViewNode & Modifiers
export type ViewModifier = ViewModifierNode

export interface Modifiers {
  padding(value?: Length): ModifiableViewNode
  margin(value?: Length): ModifiableViewNode
  gap(value: Length): ModifiableViewNode
  frame(options: FrameOptions): ModifiableViewNode
  font(value: string): ModifiableViewNode
  fontSize(value: Length): ModifiableViewNode
  bold(): ModifiableViewNode
  foreground(value: string): ModifiableViewNode
  background(value: string): ModifiableViewNode
  style(value: MuseStyleProperties): ModifiableViewNode
  className(value: ClassValue): ModifiableViewNode
  withProps(value: Record<string, unknown>): ModifiableViewNode
  keyed(value: string | number): ModifiableViewNode
  elementRef(value: unknown): ModifiableViewNode
}

export type ModifiableViewNode = ViewNode & Modifiers

export interface MuseRenderer<Output = unknown> {
  element(type: unknown, props: Record<string, unknown> | null, ...children: Output[]): Output
  fragment(children: Output[]): Output
  value?(value: unknown): Output
  modifier(content: Output, modifier: ViewModifierNode): Output
  /** Render a View host with an optional renderer-owned resolved prop set. */
  view?(node: ViewHostNode, render: (props?: Record<string, unknown>) => Output, identity: ViewIdentity): Output
  /** Materialize a geometry boundary and feed its measured proxy to the body. */
  geometry?(node: GeometryViewNode, render: (geometry: GeometryProxy) => Output): Output
  /** Materialize a lazy container; `render` may request a visible child range. */
  lazy?(node: LazyViewNode, render: (range?: LazyViewRange) => Output, identity: ViewIdentity): Output
}
