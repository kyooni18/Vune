import {
  Fragment,
  h,
  isVNode,
  mergeProps,
  toValue,
  type ButtonHTMLAttributes,
  type Component as VueComponent,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type Ref,
  type TextareaHTMLAttributes,
  type VNode,
  type VNodeChild,
  type VNodeProps,
  type VNodeRef,
} from 'vue'
import {
  isComponentVNode,
  layoutChild,
  layoutChildren,
  layoutPropsOf,
} from './layout.js'
import { styled } from './modifiers.js'
import type {
  ComponentProps,
  ComponentSlots,
  GridOptions,
  HStackOptions,
  Length,
  ScrollAxis,
  NativeProps,
  VStackOptions,
  ZStackOptions,
  StyledVNode,
  Value,
} from './types.js'

function flatten(children: VNodeChild[]): VNodeChild[] {
  const result: VNodeChild[] = []

  function append(child: VNodeChild): void {
    if (Array.isArray(child)) {
      for (const nested of child) append(nested as VNodeChild)
      return
    }
    result.push(child)
  }

  for (const child of children) append(child)
  return result
}

function isStackOptions(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && !isVNode(value)
}

function horizontalAlignment(value: 'leading' | 'center' | 'trailing'): 'flex-start' | 'center' | 'flex-end' {
  return value === 'leading' ? 'flex-start' : value === 'trailing' ? 'flex-end' : 'center'
}

function verticalAlignment(value: 'top' | 'center' | 'bottom'): 'flex-start' | 'center' | 'flex-end' {
  return value === 'top' ? 'flex-start' : value === 'bottom' ? 'flex-end' : 'center'
}

function stackAlignment(value: ZStackOptions['alignment']): {
  justifyItems: 'start' | 'center' | 'end'
  alignItems: 'start' | 'center' | 'end'
} {
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
  return { justifyItems: horizontal, alignItems: vertical }
}

function cssTrack(value: number | string): string {
  return typeof value === 'number'
    ? `repeat(${value}, minmax(0, 1fr))`
    : value
}

export function Element(
  tag: string,
  props: NativeProps | null = null,
  ...children: VNodeChild[]
): StyledVNode {
  return styled(h(tag, props, flatten(children)))
}

export function Component<C extends VueComponent>(
  component: C,
  props: ComponentProps<C> | null = null,
  slots?: ComponentSlots<C>,
): StyledVNode {
  return styled(h(component as any, props as any, slots as any))
}

export const ComponentNode = Component

export function Slots<S extends Record<string, ((...args: any[]) => VNodeChild) | undefined>>(
  slots: S,
): S {
  return slots
}

export function Raw(vnode: VNode): StyledVNode {
  return styled(vnode)
}

export function Key(key: PropertyKey, child: VNode): StyledVNode {
  return styled(child).keyed(key)
}

export function TemplateRef(reference: VNodeRef, child: VNode, merge = false): StyledVNode {
  return styled(child).templateRef(reference, merge)
}

export function Group(...children: VNodeChild[]): VNode {
  return h(Fragment, null, flatten(children))
}

export function Box(...children: VNodeChild[]): StyledVNode {
  return styled(h('div', null, layoutChildren(flatten(children))))
}

export function ScrollView(
  child: VNodeChild,
  axis: ScrollAxis = 'vertical',
): StyledVNode {
  const overflowX = axis === 'horizontal' || axis === 'both' ? 'auto' : 'hidden'
  const overflowY = axis === 'vertical' || axis === 'both' ? 'auto' : 'hidden'

  return styled(
    h('div', { style: { overflowX, overflowY } }, layoutChild(child)),
  )
}

export function Rectangle(): StyledVNode {
  return Box()
}

export function RoundedRectangle(radius: Length = 8): StyledVNode {
  return Box().radius(radius)
}

export function Circle(): StyledVNode {
  return Box().radius('50%')
}

export function Capsule(): StyledVNode {
  return Box().radius('9999px')
}

export function VStack(...children: VNodeChild[]): StyledVNode
export function VStack(options: VStackOptions, ...children: VNodeChild[]): StyledVNode
export function VStack(...args: any[]): StyledVNode {
  const options: VStackOptions = isStackOptions(args[0]) ? args[0] as VStackOptions : {}
  const children = isStackOptions(args[0]) ? args.slice(1) : args

  return styled(
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          ...(options.alignment === undefined ? {} : { alignItems: horizontalAlignment(options.alignment) }),
          ...(options.spacing === undefined ? {} : { gap: typeof options.spacing === 'number' ? `${options.spacing}px` : options.spacing }),
        },
      },
      layoutChildren(flatten(children)),
    ),
  )
}

export function HStack(...children: VNodeChild[]): StyledVNode
export function HStack(options: HStackOptions, ...children: VNodeChild[]): StyledVNode
export function HStack(...args: any[]): StyledVNode {
  const options: HStackOptions = isStackOptions(args[0]) ? args[0] as HStackOptions : {}
  const children = isStackOptions(args[0]) ? args.slice(1) : args

  return styled(
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'row',
          alignItems: verticalAlignment(options.alignment ?? 'center'),
          ...(options.spacing === undefined ? {} : { gap: typeof options.spacing === 'number' ? `${options.spacing}px` : options.spacing }),
        },
      },
      layoutChildren(flatten(children)),
    ),
  )
}

export function ZStack(...children: VNodeChild[]): StyledVNode
export function ZStack(options: ZStackOptions, ...children: VNodeChild[]): StyledVNode
export function ZStack(...args: any[]): StyledVNode {
  const options: ZStackOptions = isStackOptions(args[0]) ? args[0] as ZStackOptions : {}
  const children = isStackOptions(args[0]) ? args.slice(1) : args
  const layers = flatten(children).map((child) => {
    const component = isVNode(child) && isComponentVNode(child)
    const layout = component ? layoutPropsOf(child as VNode) : undefined
    return h(
      'div',
      {
        key: isVNode(child) ? child.key : undefined,
        ...(component ? { 'data-vune-layout-host': '' } : {}),
        ...(layout?.class === undefined ? {} : { class: layout.class }),
        style: {
          gridArea: '1 / 1',
          ...(component ? { minWidth: 0, minHeight: 0, ...(layout?.style ?? {}) } : {}),
        },
      },
      child,
    )
  })

  return styled(
    h(
      'div',
      { style: { display: 'grid', ...(options.alignment === undefined ? {} : stackAlignment(options.alignment)) } },
      layers,
    ),
  )
}

export function Grid(
  columnsOrOptions: number | string | GridOptions = 1,
  ...children: VNodeChild[]
): StyledVNode {
  const options: GridOptions = typeof columnsOrOptions === 'object'
    ? columnsOrOptions
    : { columns: columnsOrOptions }

  return styled(
    h(
      'div',
      {
        style: {
          display: 'grid',
          gridTemplateColumns: cssTrack(options.columns ?? 1),
          ...(options.rows === undefined ? {} : { gridTemplateRows: cssTrack(options.rows) }),
          ...(options.autoFlow === undefined ? {} : { gridAutoFlow: options.autoFlow }),
        },
      },
      layoutChildren(flatten(children)),
    ),
  )
}

export type TextProps = HTMLAttributes & VNodeProps

export function Text(
  value: Value<string | number>,
  props: TextProps | null = null,
): StyledVNode {
  return styled(h('span', props, String(toValue(value))))
}

export type ButtonProps = ButtonHTMLAttributes & VNodeProps

export function Button(
  label: Value<string | number>,
  action: (event: MouseEvent) => unknown,
  props: ButtonProps | null = null,
): StyledVNode {
  return styled(h('button', mergeProps(props ?? {}, { type: 'button', onClick: action }), String(toValue(label))))
}

export type TextFieldOptions = InputHTMLAttributes & VNodeProps

export function TextField(
  value: Ref<string>,
  options: TextFieldOptions = {},
): StyledVNode {
  function update(event: Event) {
    const target = event.target as HTMLInputElement | null
    if (target) value.value = target.value
  }

  return styled(h('input', mergeProps({ onInput: update }, options, { value: value.value })))
}

export type TextAreaOptions = TextareaHTMLAttributes & VNodeProps

export function TextArea(
  value: Ref<string>,
  options: TextAreaOptions = {},
): StyledVNode {
  function update(event: Event) {
    const target = event.target as HTMLTextAreaElement | null
    if (target) value.value = target.value
  }

  return styled(h('textarea', mergeProps({ onInput: update }, options, { value: value.value })))
}

export type ToggleProps = InputHTMLAttributes & VNodeProps

export function Toggle(
  value: Ref<boolean>,
  props: ToggleProps | null = null,
): StyledVNode {
  function update(event: Event) {
    const target = event.target as HTMLInputElement | null
    if (target) value.value = target.checked
  }

  return styled(
    h('input', mergeProps({ onChange: update }, props ?? {}, { type: 'checkbox', checked: value.value })),
  )
}

export function Spacer(minLength?: Length): StyledVNode {
  return styled(
    h('div', {
      'aria-hidden': 'true',
      style: {
        flexGrow: 1,
        flexBasis: minLength === undefined ? '0px' : typeof minLength === 'number' ? `${minLength}px` : minLength,
      },
    }),
  )
}

export function Divider(): StyledVNode {
  return styled(h('hr'))
}
