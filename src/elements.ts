import {
  Fragment,
  createElement,
  isValidElement,
  type ButtonHTMLAttributes,
  type ElementType,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
} from 'react'
import { flattenTransparentFragments, isComponentElement, layoutChild, layoutChildren, layoutPropsOf } from './layout.js'
import { finalize } from './modifiers.js'
import { collectChildren, type MuseBuilder } from './builder.js'
import { resolveValue } from './state.js'
import type {
  ComponentProps,
  GridOptions,
  HStackOptions,
  Length,
  NativeProps,
  ScrollAxis,
  StyledElement,
  Value,
  VStackOptions,
  ZStackOptions,
} from './types.js'

function flatten(children: ReactNode[]): ReactNode[] {
  const result: ReactNode[] = []
  for (const child of children) {
    if (Array.isArray(child)) result.push(...flatten(child))
    else result.push(child)
  }
  return result
}

function isOptions(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !isValidElement(value)
}

function cssLength(value: Length): string {
  return typeof value === 'number' ? `${value}px` : value
}

function horizontalAlignment(value: 'leading' | 'center' | 'trailing'): 'flex-start' | 'center' | 'flex-end' {
  return value === 'leading' ? 'flex-start' : value === 'trailing' ? 'flex-end' : 'center'
}

function verticalAlignment(value: 'top' | 'center' | 'bottom'): 'flex-start' | 'center' | 'flex-end' {
  return value === 'top' ? 'flex-start' : value === 'bottom' ? 'flex-end' : 'center'
}

function stackAlignment(value: ZStackOptions['alignment']) {
  const horizontal = value?.includes('Leading') || value === 'leading'
    ? 'start'
    : value?.includes('Trailing') || value === 'trailing'
      ? 'end'
      : 'center'
  const vertical = value?.startsWith('top') || value === 'top'
    ? 'start'
    : value?.startsWith('bottom') || value === 'bottom'
      ? 'end'
      : 'center'
  return { justifyItems: horizontal, alignItems: vertical } as const
}

function cssTrack(value: number | string): string {
  return typeof value === 'number' ? `repeat(${value}, minmax(0, 1fr))` : value
}

export function Element(tag: string, props: NativeProps | null = null, ...children: ReactNode[]): StyledElement {
  return finalize(createElement(tag, props as any, ...flatten(children)))
}

type RequiredPropKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? never : K
}[keyof T]

type ComponentArguments<C extends ElementType> = [RequiredPropKeys<ComponentProps<C>>] extends [never]
  ? [props?: ComponentProps<C> | null, ...children: ReactNode[]]
  : [props: ComponentProps<C>, ...children: ReactNode[]]

export function Component<C extends ElementType>(component: C, ...args: ComponentArguments<C>): StyledElement
export function Component(component: ElementType, ...args: Array<unknown>): StyledElement {
  const [props, ...children] = args
  return finalize(createElement(component as any, props as any, ...children as ReactNode[]))
}

export function Raw(element: ReactElement): StyledElement { return finalize(element) }
export function Key(key: string | number, child: ReactElement): StyledElement { return finalize(child).keyed(key) }
export function ElementRef(reference: Ref<unknown>, child: ReactElement): StyledElement { return finalize(child).elementRef(reference) }
export function Group(builder: MuseBuilder): ReactElement
export function Group(...children: ReactNode[]): ReactElement
export function Group(...children: Array<ReactNode | MuseBuilder>): ReactElement {
  return finalize(createElement(Fragment, null, ...flatten(collectChildren(children))))
}
export function Box(...children: ReactNode[]): StyledElement {
  return finalize(createElement('div', { style: { outline: 'none' } }, ...layoutChildren(flatten(children))))
}

export function ScrollView(child: ReactNode, axis: ScrollAxis = 'vertical'): StyledElement {
  const overflowX = axis === 'horizontal' || axis === 'both' ? 'auto' : 'hidden'
  const overflowY = axis === 'vertical' || axis === 'both' ? 'auto' : 'hidden'
  return finalize(createElement('div', { style: { outline: 'none', overflowX, overflowY } }, layoutChild(child)))
}

export function Rectangle(): StyledElement { return Box() }
export function RoundedRectangle(radius: Length = 8): StyledElement { return Box().radius(radius) }
export function Circle(): StyledElement { return Box().radius('50%') }
export function Capsule(): StyledElement { return Box().radius('9999px') }

export function VStack(builder: MuseBuilder): StyledElement
export function VStack(...children: ReactNode[]): StyledElement
export function VStack(options: VStackOptions, ...children: ReactNode[]): StyledElement
export function VStack(options: VStackOptions, builder: MuseBuilder): StyledElement
export function VStack(...args: any[]): StyledElement {
  const options: VStackOptions = isOptions(args[0]) ? args[0] as VStackOptions : {}
  const children = isOptions(args[0]) ? collectChildren(args.slice(1)) : collectChildren(args)
  return finalize(createElement('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      boxSizing: 'border-box',
      outline: 'none',
      ...(options.alignment === undefined ? {} : { alignItems: horizontalAlignment(options.alignment) }),
      ...(options.spacing === undefined ? {} : { gap: cssLength(options.spacing) }),
    },
  }, ...layoutChildren(flatten(children))))
}

export function HStack(builder: MuseBuilder): StyledElement
export function HStack(...children: ReactNode[]): StyledElement
export function HStack(options: HStackOptions, ...children: ReactNode[]): StyledElement
export function HStack(options: HStackOptions, builder: MuseBuilder): StyledElement
export function HStack(...args: any[]): StyledElement {
  const options: HStackOptions = isOptions(args[0]) ? args[0] as HStackOptions : {}
  const children = isOptions(args[0]) ? collectChildren(args.slice(1)) : collectChildren(args)
  return finalize(createElement('div', {
    style: {
      display: 'flex',
      flexDirection: 'row',
      width: '100%',
      boxSizing: 'border-box',
      outline: 'none',
      alignItems: verticalAlignment(options.alignment ?? 'center'),
      ...(options.spacing === undefined ? {} : { gap: cssLength(options.spacing) }),
    },
  }, ...layoutChildren(flatten(children))))
}

export function ZStack(builder: MuseBuilder): StyledElement
export function ZStack(...children: ReactNode[]): StyledElement
export function ZStack(options: ZStackOptions, ...children: ReactNode[]): StyledElement
export function ZStack(options: ZStackOptions, builder: MuseBuilder): StyledElement
export function ZStack(...args: any[]): StyledElement {
  const options: ZStackOptions = isOptions(args[0]) ? args[0] as ZStackOptions : {}
  const children = isOptions(args[0]) ? collectChildren(args.slice(1)) : collectChildren(args)
  const layers = flattenTransparentFragments(children).map((child, index) => {
    const component = isValidElement(child) && isComponentElement(child)
    const layout = component ? layoutPropsOf(child) : undefined
    return createElement('div', {
      key: isValidElement(child) ? child.key ?? index : index,
      ...(component ? { 'data-muse-layout-host': '' } : {}),
      className: Array.isArray(layout?.className) ? layout.className.join(' ') : layout?.className,
      style: { gridArea: '1 / 1', minWidth: 0, minHeight: 0, ...(component ? layout?.style ?? {} : {}) },
    }, child)
  })
  return finalize(createElement('div', {
    style: { display: 'grid', boxSizing: 'border-box', outline: 'none', ...(options.alignment === undefined ? {} : stackAlignment(options.alignment)) },
  }, ...layers))
}

export function Grid(...children: ReactNode[]): StyledElement
export function Grid(columnsOrOptions: number | string | GridOptions, ...children: ReactNode[]): StyledElement
export function Grid(builder: () => ReactNode | ReactNode[]): StyledElement
export function Grid(columnsOrOptions: number | string | GridOptions, builder: MuseBuilder): StyledElement
export function Grid(columnsOrOptions: ReactNode | GridOptions | MuseBuilder = 1, ...children: Array<ReactNode | MuseBuilder>): StyledElement {
  const builder = typeof columnsOrOptions === 'function'
  const hasOptions = !builder && (typeof columnsOrOptions === 'number'
    || typeof columnsOrOptions === 'string'
    || isOptions(columnsOrOptions))
  const options: GridOptions = hasOptions
    ? typeof columnsOrOptions === 'object' ? columnsOrOptions as GridOptions : { columns: columnsOrOptions as number | string }
    : {}
  const childArgs = builder ? [columnsOrOptions] : hasOptions ? children : [columnsOrOptions, ...children]
  const resolvedChildren = collectChildren(childArgs)
  return finalize(createElement('div', {
    style: {
      display: 'grid',
      boxSizing: 'border-box',
      outline: 'none',
      gridTemplateColumns: cssTrack(options.columns ?? 1),
      ...(options.rows === undefined ? {} : { gridTemplateRows: cssTrack(options.rows) }),
      ...(options.autoFlow === undefined ? {} : { gridAutoFlow: options.autoFlow }),
    },
  }, ...layoutChildren(flatten(resolvedChildren))))
}

export type TextProps = HTMLAttributes<HTMLSpanElement>
export function Text(value: Value<string | number>, props: TextProps | null = null): StyledElement {
  return finalize(createElement('span', props, String(resolveValue(value))))
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>
export function Button(label: Value<string | number>, action: (event: any) => unknown, props: ButtonProps | null = null): StyledElement {
  const { onClick, ...rest } = props ?? {}
  return finalize(createElement('button', {
    ...rest,
    type: rest.type ?? 'button',
    onClick(event: any) {
      onClick?.(event)
      if (!event.defaultPrevented) action(event)
    },
  }, String(resolveValue(label))))
}

export type TextFieldOptions = InputHTMLAttributes<HTMLInputElement>
export function TextField(value: import('./types.js').StateRef<string>, options: TextFieldOptions = {}): StyledElement {
  const { onChange, ...rest } = options
  return finalize(createElement('input', {
    ...rest,
    value: value.value,
    onChange(event: any) {
      value.value = event.currentTarget.value
      onChange?.(event)
    },
  }))
}

export type TextAreaOptions = TextareaHTMLAttributes<HTMLTextAreaElement>
export function TextArea(value: import('./types.js').StateRef<string>, options: TextAreaOptions = {}): StyledElement {
  const { onChange, ...rest } = options
  return finalize(createElement('textarea', {
    ...rest,
    value: value.value,
    onChange(event: any) {
      value.value = event.currentTarget.value
      onChange?.(event)
    },
  }))
}

export type ToggleProps = InputHTMLAttributes<HTMLInputElement>
export function Toggle(value: import('./types.js').StateRef<boolean>, props: ToggleProps | null = null): StyledElement {
  const { onChange, ...rest } = props ?? {}
  return finalize(createElement('input', {
    ...rest,
    type: 'checkbox',
    checked: value.value,
    onChange(event: any) {
      value.value = event.currentTarget.checked
      onChange?.(event)
    },
  }))
}

export function Spacer(minLength?: Length): StyledElement {
  return finalize(createElement('div', {
    'aria-hidden': true,
    style: {
      flexGrow: 1,
      flexShrink: minLength === undefined ? 1 : 0,
      flexBasis: minLength === undefined ? '0px' : cssLength(minLength),
      minWidth: 0,
      minHeight: 0,
    },
  }))
}

export function Divider(): StyledElement { return finalize(createElement('hr')) }
