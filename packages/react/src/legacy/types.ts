import type {
  CSSProperties,
  ComponentPropsWithoutRef,
  ElementType,
  Key,
  ReactElement,
  ReactNode,
  Ref,
} from 'react'

export type Length = number | string
export type Axis = 'all' | 'horizontal' | 'vertical' | 'top' | 'right' | 'bottom' | 'left'
export type ScrollAxis = 'vertical' | 'horizontal' | 'both'
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

export interface StateRef<T> {
  value: T
}

/** A writable lens used by controls without exposing the owning State. */
export interface BindingRef<T> {
  value: T
}

export type Value<T> = T | StateRef<T> | BindingRef<T> | (() => T)
export type NativeProps = Record<string, unknown>
export type ComponentProps<C extends ElementType> = ComponentPropsWithoutRef<C>
export type ClassValue = string | false | null | readonly (string | false | null | undefined)[] | undefined
export type StyleValue = CSSProperties | (CSSProperties & {
  [property: `--${string}`]: string | number | undefined
})

export interface VStackOptions {
  alignment?: 'leading' | 'center' | 'trailing'
  spacing?: Length
}

export interface HStackOptions {
  alignment?: 'top' | 'center' | 'bottom'
  spacing?: Length
}

export interface ZStackOptions {
  alignment?: Alignment
}

export interface GridOptions {
  columns?: number | string
  rows?: number | string
  autoFlow?: CSSProperties['gridAutoFlow']
}

export interface FrameOptions {
  width?: Length
  height?: Length
  minWidth?: Length
  maxWidth?: Length | 'infinity'
  minHeight?: Length
  maxHeight?: Length | 'infinity'
  alignment?: Alignment
}

export interface BorderOptions {
  width?: Length
  color?: CSSProperties['borderColor']
  style?: CSSProperties['borderStyle']
}

export interface Modifiers {
  padding(value: Length): StyledElement
  padding(axis: Axis, value: Length): StyledElement
  margin(value: Length): StyledElement
  margin(axis: Axis, value: Length): StyledElement
  gap(value: Length): StyledElement
  width(value: Length): StyledElement
  height(value: Length): StyledElement
  minWidth(value: Length): StyledElement
  maxWidth(value: Length): StyledElement
  minHeight(value: Length): StyledElement
  maxHeight(value: Length): StyledElement
  frame(options: FrameOptions): StyledElement
  background(value: NonNullable<CSSProperties['background']>): StyledElement
  foreground(value: NonNullable<CSSProperties['color']>): StyledElement
  opacity(value: number): StyledElement
  radius(value: Length): StyledElement
  border(options?: BorderOptions): StyledElement
  shadow(value: NonNullable<CSSProperties['boxShadow']>): StyledElement
  fontSize(value: Length): StyledElement
  font(value: string): StyledElement
  fontWeight(value: NonNullable<CSSProperties['fontWeight']>): StyledElement
  fontFamily(value: NonNullable<CSSProperties['fontFamily']>): StyledElement
  lineHeight(value: NonNullable<CSSProperties['lineHeight']>): StyledElement
  textAlign(value: NonNullable<CSSProperties['textAlign']>): StyledElement
  bold(): StyledElement
  grow(value?: number): StyledElement
  shrink(value?: number): StyledElement
  flex(value: NonNullable<CSSProperties['flex']>): StyledElement
  wrap(value?: NonNullable<CSSProperties['flexWrap']>): StyledElement
  order(value: number): StyledElement
  align(value: NonNullable<CSSProperties['alignItems']>): StyledElement
  justify(value: NonNullable<CSSProperties['justifyContent']>): StyledElement
  alignment(value: Alignment): StyledElement
  position(value: NonNullable<CSSProperties['position']>): StyledElement
  overflow(value: NonNullable<CSSProperties['overflow']>): StyledElement
  cursor(value: NonNullable<CSSProperties['cursor']>): StyledElement
  zIndex(value: NonNullable<CSSProperties['zIndex']>): StyledElement
  transform(value: NonNullable<CSSProperties['transform']>): StyledElement
  cssTransition(value: NonNullable<CSSProperties['transition']>): StyledElement
  id(value: string): StyledElement
  role(value: string): StyledElement
  disabled(value?: boolean): StyledElement
  keyed(value: Key): StyledElement
  elementRef(value: Ref<unknown>): StyledElement
  className(value: ClassValue): StyledElement
  style(value: StyleValue): StyledElement
  withProps(value: Record<string, unknown>): StyledElement
  attr(name: string, value: unknown): StyledElement
  on(event: string, handler: (...args: any[]) => unknown): StyledElement
  onClick(handler: (event: any) => unknown): StyledElement
  onInput(handler: (event: any) => unknown): StyledElement
  onChange(handler: (event: any) => unknown): StyledElement
  onKeyDown(handler: (event: any) => unknown): StyledElement
  onKeyUp(handler: (event: any) => unknown): StyledElement
  onFocus(handler: (event: any) => unknown): StyledElement
  onBlur(handler: (event: any) => unknown): StyledElement
  onSubmit(handler: (event: any) => unknown): StyledElement
}

export type StyledElement = ReactElement & Modifiers
export type UIChild = ReactNode
