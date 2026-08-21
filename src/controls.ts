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
import { isBinding, isStateRef, resolveValue } from './state.js'
import { defineBuiltinView, initializer, initializerKinds } from './view-system.js'
import { materializeViewNode } from './runtime/renderer.js'
import { viewElement, type ViewNode } from './runtime/view-graph.js'
import type { Length, StateRef, StyledElement, Value } from './types.js'

export type ImageFit = 'contain' | 'cover' | 'fill' | 'none' | 'scale-down'

export type ImageOptions = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  fit?: ImageFit
}

interface BuiltinArgs { args: readonly unknown[] }

const builtinArgs = (args: readonly unknown[]): Record<string, unknown> => ({ args: [...args] })

function buildImage(args: readonly unknown[]): ViewNode {
  const source = args[0] as Value<string>
  const options = (args[1] ?? {}) as ImageOptions
  const { fit, style, ...props } = options
  return viewElement('img', {
    ...props,
    src: String(resolveValue(source)),
    style: {
      ...style,
      ...(fit === undefined ? {} : { objectFit: fit }),
    },
  })
}

export const Image = defineBuiltinView<BuiltinArgs>('Image', [
  initializer('Image(source, options?)', args => optionalObject(args, 1), builtinArgs, [initializerKinds.value(true, 'source'), initializerKinds.value(false, 'options')]),
], ({ args }) => buildImage(args)) as unknown as {
  (source: Value<string>, options?: ImageOptions): StyledElement
}

function content(value: ReactNode | Value<string | number>): ReactNode {
  if (isValidElement(value) || Array.isArray(value)) return value as ReactNode
  if (isStateRef(value) || isBinding(value) || typeof value === 'function') {
    return String(resolveValue(value as Value<string | number>))
  }
  return value as ReactNode
}

export interface LabelOptions { spacing?: Length }

function buildLabel(args: readonly unknown[]): ReactNode {
  const title = args[0] as ReactNode | Value<string | number>
  const icon = args[1] as ReactNode
  const options = (args[2] ?? {}) as LabelOptions
  return HStack({ spacing: options.spacing ?? 6 }, icon, content(title))
}

export const Label = defineBuiltinView<BuiltinArgs>('Label', [
  initializer('Label(title, icon, options?)', args => optionalObject(args, 2), builtinArgs, [initializerKinds.value(true, 'title'), initializerKinds.value(true, 'icon'), initializerKinds.value(false, 'options')]),
], ({ args }) => buildLabel(args)) as unknown as {
  (title: ReactNode | Value<string | number>, icon: ReactNode, options?: LabelOptions): StyledElement
}

export type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>

function buildLink(args: readonly unknown[]): ViewNode {
  const label = args[0] as ReactNode | Value<string | number>
  const href = args[1] as Value<string>
  const props = (args[2] ?? {}) as LinkProps
  return viewElement('a', { ...props, href: String(resolveValue(href)) }, [content(label)])
}

export const Link = defineBuiltinView<BuiltinArgs>('Link', [
  initializer('Link(label, href, props?)', args => optionalObject(args, 2), builtinArgs, [initializerKinds.value(true, 'label'), initializerKinds.value(true, 'href'), initializerKinds.value(false, 'props')]),
], ({ args }) => buildLink(args)) as unknown as {
  (label: ReactNode | Value<string | number>, href: Value<string>, props?: LinkProps): StyledElement
}

export type ProgressViewOptions = ProgressHTMLAttributes<HTMLProgressElement> & {
  label?: ReactNode | Value<string | number>
}

function buildProgressView(args: readonly unknown[]): ReactNode {
  const value = args[0] as Value<number> | null | undefined
  const options = (args[1] ?? {}) as ProgressViewOptions
  const { max = 1, label, ...props } = options
  const progress = materializeViewNode(viewElement('progress', {
    ...props,
    max,
    ...(value == null ? {} : { value: Number(resolveValue(value)) }),
  }))
  if (label === undefined) return progress
  return VStack({ alignment: 'leading', spacing: 6 }, content(label), progress)
}

export const ProgressView = defineBuiltinView<BuiltinArgs>('ProgressView', [
  initializer('ProgressView(value?, options?)', args => args.length <= 2 && (args.length < 2 || args[1] === undefined || typeof args[1] === 'object'), builtinArgs, [initializerKinds.value(false, 'value'), initializerKinds.value(false, 'options')]),
], ({ args }) => buildProgressView(args)) as unknown as {
  (value?: Value<number> | null, options?: ProgressViewOptions): StyledElement
}

export interface PickerOption<T extends string | number> {
  label: string
  value: T
  disabled?: boolean
}

export type PickerProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'defaultValue'>

function buildPicker(args: readonly unknown[]): ViewNode {
  const selection = args[0] as StateRef<string | number>
  const options = args[1] as readonly PickerOption<string | number>[]
  const props = (args[2] ?? {}) as PickerProps
  const { onChange, ...rest } = props
  return viewElement('select', {
      ...rest,
      value: String(selection.value),
      onChange(event: ChangeEvent<HTMLSelectElement>) {
        const selected = options.find(option => String(option.value) === event.currentTarget.value)
        if (selected) selection.value = selected.value
        onChange?.(event)
      },
  }, options.map(option => createElement(
    'option',
    { key: String(option.value), value: String(option.value), disabled: option.disabled },
    option.label,
  )))
}

export const Picker = defineBuiltinView<BuiltinArgs>('Picker', [
  initializer('Picker(selection, options, props?)', args => optionalObject(args, 2), builtinArgs, [initializerKinds.value(true, 'selection'), initializerKinds.value(true, 'options'), initializerKinds.value(false, 'props')]),
], ({ args }) => buildPicker(args)) as unknown as {
  <T extends string | number>(selection: StateRef<T>, options: readonly PickerOption<T>[], props?: PickerProps): StyledElement
}

export type SliderOptions = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue'> & {
  min?: number
  max?: number
  step?: number
}

function buildSlider(args: readonly unknown[]): ViewNode {
  const value = args[0] as StateRef<number>
  const options = (args[1] ?? {}) as SliderOptions
  const { min = 0, max = 1, step = 0.01, onChange, ...props } = options
  return viewElement('input', {
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
  })
}

export const Slider = defineBuiltinView<BuiltinArgs>('Slider', [
  initializer('Slider(value, options?)', args => optionalObject(args, 1), builtinArgs, [initializerKinds.value(true, 'value'), initializerKinds.value(false, 'options')]),
], ({ args }) => buildSlider(args)) as unknown as {
  (value: StateRef<number>, options?: SliderOptions): StyledElement
}

export interface StepperOptions {
  min?: number
  max?: number
  step?: number
  label?: Value<string | number>
  spacing?: Length
}

function buildStepper(args: readonly unknown[]): ReactNode {
  const value = args[0] as StateRef<number>
  const options = (args[1] ?? {}) as StepperOptions
  const { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY, step = 1 } = options
  const label = options.label === undefined ? Text(() => value.value) : Text(options.label)
  return HStack(
    { spacing: options.spacing ?? 8 },
    Button('−', () => { value.value = Math.max(min, value.value - step) }),
    label,
    Button('+', () => { value.value = Math.min(max, value.value + step) }),
  )
}

export const Stepper = defineBuiltinView<BuiltinArgs>('Stepper', [
  initializer('Stepper(value, options?)', args => optionalObject(args, 1), builtinArgs, [initializerKinds.value(true, 'value'), initializerKinds.value(false, 'options')]),
], ({ args }) => buildStepper(args)) as unknown as {
  (value: StateRef<number>, options?: StepperOptions): StyledElement
}

const optionalObject = (args: readonly unknown[], required: number) => args.length === required
  || (args.length === required + 1 && typeof args[required] === 'object' && args[required] !== null)
