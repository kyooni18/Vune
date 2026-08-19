import type {
  CSSProperties,
  Component as VueComponent,
  FunctionalComponent,
  MaybeRefOrGetter,
  Ref,
  VNode,
  VNodeChild,
  VNodeProps,
  VNodeRef,
} from 'vue'

export type Value<T> = MaybeRefOrGetter<T>
export type Length = number | string
export type ScrollAxis = 'vertical' | 'horizontal' | 'both'
export type HorizontalAlignment = 'leading' | 'center' | 'trailing'
export type VerticalAlignment = 'top' | 'center' | 'bottom'
export type Alignment =
  | 'center'
  | 'leading'
  | 'trailing'
  | 'top'
  | 'bottom'
  | 'topLeading'
  | 'topTrailing'
  | 'bottomLeading'
  | 'bottomTrailing'
export type Axis =
  | 'all'
  | 'horizontal'
  | 'vertical'
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'

export type ClassValue =
  | string
  | string[]
  | Record<string, boolean | undefined | null>

export type UIChild = VNodeChild
export type NativeProps = Record<string, unknown> & VNodeProps
export type AnyComponent = VueComponent

/**
 * Best-effort extraction of the public props accepted by a Vue component.
 * SFCs and defineComponent() values expose these through their public instance.
 */
export type ComponentProps<C> =
  C extends abstract new (...args: any[]) => { $props: infer P }
    ? P
    : C extends FunctionalComponent<infer P>
      ? P & VNodeProps
      : NativeProps

type InstanceSlots<C> =
  C extends abstract new (...args: any[]) => { $slots: infer S }
    ? S
    : never

export type SlotRenderer = (...args: any[]) => UIChild
export type SlotMap = Record<string, SlotRenderer | undefined>

type NormalizeSlots<S> = {
  [K in keyof S]?: NonNullable<S[K]> extends (...args: infer A) => any
    ? (...args: A) => UIChild
    : never
}

/**
 * Preserves typed slots when a component exposes them through $slots.
 */
export type ComponentSlots<C> = [InstanceSlots<C>] extends [never]
  ? SlotMap
  : NormalizeSlots<InstanceSlots<C>>

export interface FrameOptions {
  width?: Length
  height?: Length
  minWidth?: Length
  maxWidth?: Length | 'infinity'
  minHeight?: Length
  maxHeight?: Length | 'infinity'
  alignment?: Alignment
}

export interface VStackOptions {
  alignment?: HorizontalAlignment
  spacing?: Length
}

export interface HStackOptions {
  alignment?: VerticalAlignment
  spacing?: Length
}

export interface ZStackOptions {
  alignment?: Alignment
}

export interface BorderOptions {
  width?: Length
  color?: string
  style?: CSSProperties['borderStyle']
}

export interface GridOptions {
  columns?: number | string
  rows?: number | string
  autoFlow?: CSSProperties['gridAutoFlow']
}

export interface ModelOptions<T> {
  name?: string
  transformIn?: (value: T) => unknown
  transformOut?: (value: unknown) => T
}

export type EventHandler<E extends Event> = (event: E) => unknown

export interface Modifiers {
  padding(value: Length): StyledVNode
  padding(axis: Axis, value: Length): StyledVNode
  margin(value: Length): StyledVNode
  margin(axis: Axis, value: Length): StyledVNode
  gap(value: Length): StyledVNode

  width(value: Length): StyledVNode
  height(value: Length): StyledVNode
  minWidth(value: Length): StyledVNode
  maxWidth(value: Length): StyledVNode
  minHeight(value: Length): StyledVNode
  maxHeight(value: Length): StyledVNode
  frame(options: FrameOptions): StyledVNode

  background(value: NonNullable<CSSProperties['background']>): StyledVNode
  foreground(value: NonNullable<CSSProperties['color']>): StyledVNode
  opacity(value: number): StyledVNode
  radius(value: Length): StyledVNode
  border(options?: BorderOptions): StyledVNode
  shadow(value: NonNullable<CSSProperties['boxShadow']>): StyledVNode

  fontSize(value: Length): StyledVNode
  fontWeight(value: NonNullable<CSSProperties['fontWeight']>): StyledVNode
  fontFamily(value: NonNullable<CSSProperties['fontFamily']>): StyledVNode
  lineHeight(value: NonNullable<CSSProperties['lineHeight']>): StyledVNode
  textAlign(value: NonNullable<CSSProperties['textAlign']>): StyledVNode
  bold(): StyledVNode

  grow(value?: number): StyledVNode
  shrink(value?: number): StyledVNode
  flex(value: NonNullable<CSSProperties['flex']>): StyledVNode
  wrap(value?: NonNullable<CSSProperties['flexWrap']>): StyledVNode
  order(value: number): StyledVNode
  align(value: NonNullable<CSSProperties['alignItems']>): StyledVNode
  justify(value: NonNullable<CSSProperties['justifyContent']>): StyledVNode
  alignment(value: Alignment): StyledVNode

  position(value: NonNullable<CSSProperties['position']>): StyledVNode
  overflow(value: NonNullable<CSSProperties['overflow']>): StyledVNode
  cursor(value: NonNullable<CSSProperties['cursor']>): StyledVNode
  zIndex(value: NonNullable<CSSProperties['zIndex']>): StyledVNode
  transform(value: NonNullable<CSSProperties['transform']>): StyledVNode
  cssTransition(value: NonNullable<CSSProperties['transition']>): StyledVNode

  id(value: string): StyledVNode
  role(value: string): StyledVNode
  disabled(value?: boolean): StyledVNode
  keyed(value: PropertyKey): StyledVNode
  templateRef(value: VNodeRef, merge?: boolean): StyledVNode
  model<T>(value: Ref<T>, name?: string): StyledVNode
  model<T>(value: Ref<T>, options?: ModelOptions<T>): StyledVNode

  className(value: ClassValue): StyledVNode
  style(value: CSSProperties): StyledVNode
  withProps(value: Record<string, unknown>): StyledVNode
  attr(name: string, value: unknown): StyledVNode

  on(event: string, handler: (...args: any[]) => unknown): StyledVNode
  onClick(handler: EventHandler<MouseEvent>): StyledVNode
  onDblClick(handler: EventHandler<MouseEvent>): StyledVNode
  onInput(handler: EventHandler<InputEvent>): StyledVNode
  onChange(handler: EventHandler<Event>): StyledVNode
  onKeyDown(handler: EventHandler<KeyboardEvent>): StyledVNode
  onKeyUp(handler: EventHandler<KeyboardEvent>): StyledVNode
  onFocus(handler: EventHandler<FocusEvent>): StyledVNode
  onBlur(handler: EventHandler<FocusEvent>): StyledVNode
  onSubmit(handler: EventHandler<SubmitEvent>): StyledVNode
  onPointerDown(handler: EventHandler<PointerEvent>): StyledVNode
  onPointerMove(handler: EventHandler<PointerEvent>): StyledVNode
  onPointerUp(handler: EventHandler<PointerEvent>): StyledVNode
  onMouseEnter(handler: EventHandler<MouseEvent>): StyledVNode
  onMouseLeave(handler: EventHandler<MouseEvent>): StyledVNode
}

export type StyledVNode = VNode & Modifiers
export type ElementType = string | VueComponent
