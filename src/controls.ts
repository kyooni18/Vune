import {
  h,
  isRef,
  isVNode,
  mergeProps,
  toValue,
  type Ref,
  type VNodeChild,
} from 'vue'
import { HStack, Text, VStack, Button } from './elements.js'
import { styled } from './modifiers.js'
import type { Length, NativeProps, StyledVNode, Value } from './types.js'

type MergeableProps = Record<string, any>

export type ImageFit = 'contain' | 'cover' | 'fill' | 'none' | 'scale-down'

export type ImageOptions = NativeProps & {
  alt?: string
  fit?: ImageFit
  loading?: 'eager' | 'lazy'
}

export function Image(source: Value<string>, options: ImageOptions = {}): StyledVNode {
  const { fit, ...props } = options
  return styled(h('img', mergeProps(props as MergeableProps, {
    src: String(toValue(source)),
    ...(fit === undefined ? {} : { style: { objectFit: fit } }),
  })))
}

function content(value: VNodeChild | Value<string | number>): VNodeChild {
  if (isVNode(value) || Array.isArray(value)) return value as VNodeChild
  if (isRef(value)) return String(value.value)
  return String(toValue(value as Value<string | number>))
}

export interface LabelOptions { spacing?: Length }

export function Label(title: VNodeChild | Value<string | number>, icon: VNodeChild, options: LabelOptions = {}): StyledVNode {
  return HStack({ spacing: options.spacing ?? 6 }, icon, content(title))
}

export function Link(label: VNodeChild | Value<string | number>, href: Value<string>, props: NativeProps = {}): StyledVNode {
  return styled(h('a', mergeProps(props as MergeableProps, { href: String(toValue(href)) }), [content(label)]))
}

export type ProgressViewOptions = NativeProps & { max?: number; label?: VNodeChild | Value<string | number> }

export function ProgressView(value?: Value<number> | null, options: ProgressViewOptions = {}): StyledVNode {
  const { max = 1, label, ...props } = options
  const progress = styled(h('progress', mergeProps(props as MergeableProps, {
    max,
    ...(value == null ? {} : { value: Number(toValue(value)) }),
  })))
  if (label === undefined) return progress
  return VStack({ alignment: 'leading', spacing: 6 }, content(label), progress)
}

export interface PickerOption<T extends string | number> { label: string; value: T; disabled?: boolean }
export type PickerProps = NativeProps

export function Picker<T extends string | number>(selection: Ref<T>, options: readonly PickerOption<T>[], props: PickerProps = {}): StyledVNode {
  function update(event: Event) {
    const target = event.target as HTMLSelectElement | null
    if (!target) return
    const selected = options.find(option => String(option.value) === target.value)
    if (selected) selection.value = selected.value
  }
  return styled(h('select', mergeProps({ onChange: update }, props as MergeableProps, { value: String(selection.value) }), options.map(option =>
    h('option', { value: String(option.value), disabled: option.disabled }, option.label),
  )))
}

export type SliderOptions = NativeProps & { min?: number; max?: number; step?: number }

export function Slider(value: Ref<number>, options: SliderOptions = {}): StyledVNode {
  const { min = 0, max = 1, step = 0.01, ...props } = options
  function update(event: Event) {
    const target = event.target as HTMLInputElement | null
    if (target) value.value = Number(target.value)
  }
  return styled(h('input', mergeProps({ onInput: update }, props as MergeableProps, { type: 'range', min, max, step, value: value.value })))
}

export interface StepperOptions { min?: number; max?: number; step?: number; label?: Value<string | number>; spacing?: Length }

export function Stepper(value: Ref<number>, options: StepperOptions = {}): StyledVNode {
  const { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY, step = 1 } = options
  function decrement() { value.value = Math.max(min, value.value - step) }
  function increment() { value.value = Math.min(max, value.value + step) }
  const label = options.label === undefined ? Text(() => value.value) : Text(options.label)
  return HStack({ spacing: options.spacing ?? 8 }, Button('−', decrement), label, Button('+', increment))
}
