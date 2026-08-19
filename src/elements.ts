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
import { styled } from './modifiers.js'
import type {
  ComponentProps,
  ComponentSlots,
  GridOptions,
  Length,
  ScrollAxis,
  NativeProps,
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

/**
 * Creates an ordinary Vue component VNode while preserving public prop and slot types.
 */
export function Component<C extends VueComponent>(
  component: C,
  props: ComponentProps<C> | null = null,
  slots?: ComponentSlots<C>,
): StyledVNode {
  return styled(h(component as any, props as any, slots as any))
}

/** @deprecated Use Component() instead. */
export const ComponentNode = Component

/** Identity helper useful when extracting a slots object into a local variable. */
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

/**
 * Groups children without creating a DOM element. Because a Fragment has no CSS box,
 * Group intentionally does not expose modifier chaining. Use Box() when a real
 * styling boundary is required.
 */
export function Group(...children: VNodeChild[]): VNode {
  return h(Fragment, null, flatten(children))
}

/** Creates a neutral div that can be used as an explicit styling boundary. */
export function Box(...children: VNodeChild[]): StyledVNode {
  return styled(h('div', null, flatten(children)))
}

/**
 * Creates a native overflow container without introducing a custom scrolling system.
 * Compose multiple children with a stack or Group before passing them in.
 */
export function ScrollView(
  child: VNodeChild,
  axis: ScrollAxis = 'vertical',
): StyledVNode {
  const overflowX = axis === 'horizontal' || axis === 'both' ? 'auto' : 'hidden'
  const overflowY = axis === 'vertical' || axis === 'both' ? 'auto' : 'hidden'

  return styled(
    h(
      'div',
      {
        style: {
          overflowX,
          overflowY,
        },
      },
      child,
    ),
  )
}

/** A neutral rectangular CSS box. */
export function Rectangle(): StyledVNode {
  return Box()
}

/** A rectangular CSS box with a configurable corner radius. */
export function RoundedRectangle(radius: Length = 8): StyledVNode {
  return Box().radius(radius)
}

/** A CSS box with a 50% border radius. Use equal width and height for a circle. */
export function Circle(): StyledVNode {
  return Box().radius('50%')
}

/** A pill-shaped CSS box using an effectively unbounded corner radius. */
export function Capsule(): StyledVNode {
  return Box().radius('9999px')
}

export function VStack(...children: VNodeChild[]): StyledVNode {
  return styled(
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
        },
      },
      flatten(children),
    ),
  )
}

export function HStack(...children: VNodeChild[]): StyledVNode {
  return styled(
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
        },
      },
      flatten(children),
    ),
  )
}

/**
 * Overlays children in the same CSS grid cell. Each child gets one lightweight layer wrapper.
 */
export function ZStack(...children: VNodeChild[]): StyledVNode {
  const layers = flatten(children).map((child) =>
    h(
      'div',
      {
        key: isVNode(child) ? child.key : undefined,
        style: { gridArea: '1 / 1' },
      },
      child,
    ),
  )

  return styled(
    h(
      'div',
      {
        style: {
          display: 'grid',
        },
      },
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
          ...(options.rows === undefined
            ? {}
            : { gridTemplateRows: cssTrack(options.rows) }),
          ...(options.autoFlow === undefined
            ? {}
            : { gridAutoFlow: options.autoFlow }),
        },
      },
      flatten(children),
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
  return styled(
    h(
      'button',
      mergeProps(props ?? {}, { type: 'button', onClick: action }),
      String(toValue(label)),
    ),
  )
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

  return styled(
    h(
      'input',
      mergeProps(
        { onInput: update },
        options,
        { value: value.value },
      ),
    ),
  )
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

  return styled(
    h(
      'textarea',
      mergeProps(
        { onInput: update },
        options,
        { value: value.value },
      ),
    ),
  )
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
    h(
      'input',
      mergeProps(
        { onChange: update },
        props ?? {},
        {
          type: 'checkbox',
          checked: value.value,
        },
      ),
    ),
  )
}

export function Spacer(minLength?: Length): StyledVNode {
  return styled(
    h('div', {
      'aria-hidden': 'true',
      style: {
        flexGrow: 1,
        flexBasis: minLength === undefined
          ? '0px'
          : typeof minLength === 'number'
            ? `${minLength}px`
            : minLength,
      },
    }),
  )
}

export function Divider(): StyledVNode {
  return styled(h('hr'))
}
