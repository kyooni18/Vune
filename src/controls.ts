import {
  createElement,
  isValidElement,
  type AnchorHTMLAttributes,
  type ChangeEvent,
  type ImgHTMLAttributes,
  type InputHTMLAttributes,
  type ProgressHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'
import { Button, HStack, Text, VStack } from './elements.js'
import { styled } from './modifiers.js'
import { isStateRef, resolveValue } from './state.js'
import type { Length, StateRef, StyledElement, Value } from './types.js'

export type ImageFit = 'contain' | 'cover' | 'fill' | 'none' | 'scale-down'

export type ImageOptions = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  fit?: ImageFit
}

export function Image(source: Value<string>, options: ImageOptions = {}): StyledElement {
  const { fit, style, ...props } = options
  return styled(createElement('img', {
    ...props,
    src: String(resolveValue(source)),
    style: {
      ...style,
      ...(fit === undefined ? {} : { objectFit: fit }),
    },
  }))
}

function content(value: ReactNode | Value<string | number>): ReactNode {
  if (isValidElement(value) || Array.isArray(value)) return value as ReactNode
  if (isStateRef(value) || typeof value === 'function') {
    return String(resolveValue(value as Value<string | number>))
  }
  return value as ReactNode
}

export interface LabelOptions { spacing?: Length }

export function Label(
  title: ReactNode | Value<string | number>,
  icon: ReactNode,
  options: LabelOptions = {},
): StyledElement {
  return HStack({ spacing: options.spacing ?? 6 }, icon, content(title))
}

export type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>

export function Link(
  label: ReactNode | Value<string | number>,
  href: Value<string>,
  props: LinkProps = {},
): StyledElement {
  return styled(createElement('a', { ...props, href: String(resolveValue(href)) }, content(label)))
}

export type ProgressViewOptions = ProgressHTMLAttributes<HTMLProgressElement> & {
  label?: ReactNode | Value<string | number>
}

export function ProgressView(
  value?: Value<number> | null,
  options: ProgressViewOptions = {},
): StyledElement {
  const { max = 1, label, ...props } = options
  const progress = styled(createElement('progress', {
    ...props,
    max,
    ...(value == null ? {} : { value: Number(resolveValue(value)) }),
  }))
  if (label === undefined) return progress
  return VStack({ alignment: 'leading', spacing: 6 }, content(label), progress)
}

export interface PickerOption<T extends string | number> {
  label: string
  value: T
  disabled?: boolean
}

export type PickerProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'defaultValue'>

export function Picker<T extends string | number>(
  selection: StateRef<T>,
  options: readonly PickerOption<T>[],
  props: PickerProps = {},
): StyledElement {
  const { onChange, ...rest } = props
  return styled(createElement(
    'select',
    {
      ...rest,
      value: String(selection.value),
      onChange(event: ChangeEvent<HTMLSelectElement>) {
        const selected = options.find(option => String(option.value) === event.currentTarget.value)
        if (selected) selection.value = selected.value
        onChange?.(event)
      },
    },
    ...options.map(option => createElement(
      'option',
      { key: String(option.value), value: String(option.value), disabled: option.disabled },
      option.label,
    )),
  ))
}

export type SliderOptions = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue'> & {
  min?: number
  max?: number
  step?: number
}

export function Slider(value: StateRef<number>, options: SliderOptions = {}): StyledElement {
  const { min = 0, max = 1, step = 0.01, onChange, ...props } = options
  return styled(createElement('input', {
    ...props,
    type: 'range',
    min,
    max,
    step,
    value: value.value,
    onChange(event: ChangeEvent<HTMLInputElement>) {
      value.value = Number(event.currentTarget.value)
      onChange?.(event)
    },
  }))
}

export interface StepperOptions {
  min?: number
  max?: number
  step?: number
  label?: Value<string | number>
  spacing?: Length
}

export function Stepper(value: StateRef<number>, options: StepperOptions = {}): StyledElement {
  const { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY, step = 1 } = options
  const label = options.label === undefined ? Text(() => value.value) : Text(options.label)
  return HStack(
    { spacing: options.spacing ?? 8 },
    Button('−', () => { value.value = Math.max(min, value.value - step) }),
    label,
    Button('+', () => { value.value = Math.min(max, value.value + step) }),
  )
}
