import type { Animation } from "../animation.js"
import type { FrameOptions } from "../layout.js"
import type { VuneStyleProperties } from "../html.js"
import type { ViewIdentity, ViewIdentitySegment } from "../identity.js"
import type { StateRef } from "../state.js"
import type { ViewType } from "./initializers.js"
import type { vuneForeignComponent, vuneInitializers, vuneView } from "./symbols.js"
import type { Transition } from "../transition.js"

export type ViewGraphLeaf = string | number | bigint | boolean | null | undefined
export type ViewGraphValue = ViewGraphLeaf | ViewNode | readonly ViewGraphValue[]
export type ViewGraphChild = ViewGraphValue
export type ViewValue = ViewGraphValue
export type Length = number | string
export type ClassValue = string | false | null | undefined | readonly ClassValue[]

export interface Point { readonly x: number; readonly y: number }
export interface Size { readonly width: number; readonly height: number }
export type ScaleEffectValue = number | Point | Size
export type OffsetValue = Point | Size

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
  readonly [vuneForeignComponent]: true
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

/** A dynamic child position inside a compiler-generated immutable template. */
export interface CompiledTemplateSlot {
  readonly kind: "slot"
  readonly index: number
  /** Original graph-identity path from the template root to this dynamic slot. */
  readonly identity: readonly ViewIdentitySegment[]
}

/** Static host element emitted by the compiler after evaluating intrinsic View semantics. */
export interface CompiledTemplateElement {
  readonly kind: "element"
  readonly type: string
  readonly props: Record<string, unknown> | null
  readonly children: readonly CompiledTemplateValue[]
}

export interface CompiledTemplateFragment {
  readonly kind: "fragment"
  readonly children: readonly CompiledTemplateValue[]
}

export type CompiledTemplateValue = ViewGraphLeaf | CompiledTemplateSlot | CompiledTemplateElement | CompiledTemplateFragment

export type CompiledTemplateSlotKind = "view" | "text"

/** Immutable static tree plus the number of runtime graph/value slots it consumes. */
export interface CompiledTemplateDescriptor {
  readonly root: CompiledTemplateValue
  readonly slotCount: number
  /** Prevalidated original graph-identity path for each runtime slot. */
  readonly slotIdentities: readonly (readonly ViewIdentitySegment[])[]
  /** Compiler-proven slot shape. Older/manual templates default to generic view slots. */
  readonly slotKinds: readonly CompiledTemplateSlotKind[]
}

/** Runtime instance of a compiler template. Only its slot array changes between evaluations. */
export interface CompiledTemplateViewNode {
  readonly kind: "template"
  readonly template: CompiledTemplateDescriptor
  readonly slots: readonly ViewGraphValue[]
}

/**
 * Compiler-proven View body fast path. The template is immutable and the
 * evaluator computes only its dynamic slots from the already-resolved View
 * props, allowing renderers to bypass the generic body/reconciliation path.
 */
export type CompiledViewModifierSpec = readonly [name: string, arguments: readonly unknown[]]

export interface CompiledViewBodyEvaluation {
  readonly slots: readonly ViewGraphValue[]
  /** Optional non-structural modifier graph proven safe for direct renderer patching. */
  readonly modifiers?: readonly CompiledViewModifierSpec[]
}

export interface CompiledViewBodyPlan<Props extends object = Record<string, unknown>> {
  readonly template: CompiledTemplateDescriptor
  /** Lets renderers reject modifier patching before evaluating a plan when the surrounding graph makes it unsafe. */
  readonly patchesModifiers?: boolean
  /** Re-evaluate only dynamic slots/modifier arguments, never the immutable View body graph. */
  readonly evaluate: (props: Props) => CompiledViewBodyEvaluation
}

export interface ViewHostNode {
  readonly kind: "view"
  readonly name: string
  readonly host: unknown
  readonly props: Record<string, unknown>
  readonly state?: (props: Record<string, unknown>) => Record<string, unknown>
  /** Compiler-proven State dependencies. Omitted when runtime discovery is required. */
  readonly dependencies?: (props: Record<string, unknown>) => readonly StateRef<unknown>[]
  /** Whether dependencies is a compiler-proven exhaustive set. */
  readonly dependenciesComplete?: boolean
  /** Optional compiler-proven body plan used by renderer-specific direct patch paths. */
  readonly compiledBody?: CompiledViewBodyPlan<Record<string, unknown>>
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

export type ViewNode = ElementViewNode | FragmentViewNode | CompiledTemplateViewNode | ViewHostNode | GeometryViewNode | LazyViewNode | ModifiedContent
/** Public View value: an immutable graph node with value-semantic modifiers. */
export type View = ViewNode & Modifiers
export type ViewModifier = ViewModifierNode
type MaskValue = ViewNode | string

export interface Modifiers {
  padding(value?: Length): ModifiableViewNode
  margin(value?: Length): ModifiableViewNode
  gap(value: Length): ModifiableViewNode
  frame(options: FrameOptions): ModifiableViewNode
  font(value: string): ModifiableViewNode
  fontSize(value: Length): ModifiableViewNode
  bold(isActive?: boolean): ModifiableViewNode
  foreground(value: string): ModifiableViewNode
  foregroundStyle(value: string): ModifiableViewNode
  background(value: string, alignment?: string): ModifiableViewNode
  opacity(value: number): ModifiableViewNode
  scaleEffect(value: ScaleEffectValue, anchor?: string): ModifiableViewNode
  rotationEffect(value: number, anchor?: string): ModifiableViewNode
  offset(value: OffsetValue): ModifiableViewNode
  offset(x: number, y: number): ModifiableViewNode
  mask(value: MaskValue): ModifiableViewNode
  animation(animation: Animation | null, value: unknown): ModifiableViewNode
  transition(transition: Transition): ModifiableViewNode
  style(value: VuneStyleProperties): ModifiableViewNode
  className(value: ClassValue): ModifiableViewNode
  withProps(value: Record<string, unknown>): ModifiableViewNode
  keyed(value: string | number): ModifiableViewNode
  elementRef(value: unknown): ModifiableViewNode
  continuousCorners(smoothing?: number): ModifiableViewNode
}

export type ModifiableViewNode = ViewNode & Modifiers

export interface VuneRenderer<Output = unknown> {
  element(type: unknown, props: Record<string, unknown> | null, ...children: Output[]): Output
  fragment(children: Output[]): Output
  value?(value: unknown): Output
  modifier(content: Output, modifier: ViewModifierNode): Output
  /** Materialize a compiler-generated static template without generic graph traversal. */
  template?(node: CompiledTemplateViewNode, renderSlot: (index: number) => Output, identity: ViewIdentity): Output
  /** Render a View host with an optional renderer-owned resolved prop set. */
  view?(node: ViewHostNode, render: (props?: Record<string, unknown>) => Output, identity: ViewIdentity): Output
  /** Materialize a geometry boundary and feed its measured proxy to the body. */
  geometry?(node: GeometryViewNode, render: (geometry: GeometryProxy) => Output): Output
  /** Materialize a lazy container; `render` may request a visible child range. */
  lazy?(node: LazyViewNode, render: (range?: LazyViewRange) => Output, identity: ViewIdentity, renderItem?: (index: number) => Output): Output
}
