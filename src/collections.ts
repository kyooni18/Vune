import {
  Fragment,
  h,
  isVNode,
  type CSSProperties,
  type VNode,
  type VNodeChild,
} from 'vue'
import { Grid, HStack, Text, VStack } from './elements.js'
import { layoutChild, layoutChildren } from './layout.js'
import { styled } from './modifiers.js'
import type {
  GridOptions,
  HStackOptions,
  Length,
  StyledVNode,
  VStackOptions,
} from './types.js'

function flatten(children: VNodeChild[]): VNodeChild[] {
  const result: VNodeChild[] = []
  for (const child of children) {
    if (Array.isArray(child)) result.push(...flatten(child as VNodeChild[]))
    else result.push(child)
  }
  return result
}

function isOptions(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && !isVNode(value)
}

function cssLength(value: Length): string {
  return typeof value === 'number' ? `${value}px` : value
}

export interface ListOptions {
  spacing?: Length
  inset?: Length
  separators?: boolean
}

export function List(...children: VNodeChild[]): StyledVNode
export function List(options: ListOptions, ...children: VNodeChild[]): StyledVNode
export function List(...args: any[]): StyledVNode {
  const options: ListOptions = isOptions(args[0]) ? args[0] as ListOptions : {}
  const children = isOptions(args[0]) ? args.slice(1) : args
  const rows = flatten(children).map((child, index) =>
    h(
      'div',
      {
        role: 'listitem',
        key: isVNode(child) ? child.key ?? index : index,
        style: {
          minWidth: 0,
          ...(options.inset === undefined ? {} : { padding: cssLength(options.inset) }),
          ...(options.separators === false || index === 0
            ? {}
            : { borderTop: '1px solid rgba(127, 127, 127, 0.22)' }),
        },
      },
      layoutChild(child),
    ),
  )

  return styled(
    h(
      'div',
      {
        role: 'list',
        style: {
          display: 'flex',
          flexDirection: 'column',
          ...(options.spacing === undefined ? {} : { gap: cssLength(options.spacing) }),
        },
      },
      rows,
    ),
  )
}

export interface SectionOptions {
  header?: VNodeChild | string
  footer?: VNodeChild | string
  spacing?: Length
}

function sectionPart(value: VNodeChild | string | undefined, role: 'heading' | 'note'): VNodeChild | null {
  if (value === undefined) return null
  const child = typeof value === 'string' ? Text(value) : value
  return h('div', { role }, child)
}

export function Section(...children: VNodeChild[]): StyledVNode
export function Section(title: string, ...children: VNodeChild[]): StyledVNode
export function Section(options: SectionOptions, ...children: VNodeChild[]): StyledVNode
export function Section(...args: any[]): StyledVNode {
  let options: SectionOptions = {}
  let children: VNodeChild[] = args

  if (typeof args[0] === 'string') {
    options = { header: args[0] }
    children = args.slice(1)
  } else if (isOptions(args[0])) {
    options = args[0] as SectionOptions
    children = args.slice(1)
  }

  return styled(
    h(
      'section',
      { style: { display: 'flex', flexDirection: 'column', gap: cssLength(options.spacing ?? 8) } },
      [
        sectionPart(options.header, 'heading'),
        h('div', { role: 'group' }, layoutChildren(flatten(children))),
        sectionPart(options.footer, 'note'),
      ].filter(Boolean),
    ),
  )
}

export interface LazyOptions {
  estimatedItemSize?: Length
}

export type LazyVStackOptions = VStackOptions & LazyOptions
export type LazyHStackOptions = HStackOptions & LazyOptions
export type LazyGridOptions = GridOptions & LazyOptions

function lazyStyle(estimatedItemSize: Length = 44): CSSProperties {
  return {
    contentVisibility: 'auto',
    containIntrinsicSize: `auto ${cssLength(estimatedItemSize)}`,
  } as CSSProperties
}

function lazyChild(child: VNodeChild, estimatedItemSize?: Length): VNodeChild {
  if (!isVNode(child) || child.type === Fragment) return child
  return styled(child as VNode).style(lazyStyle(estimatedItemSize))
}

export function LazyVStack(...children: VNodeChild[]): StyledVNode
export function LazyVStack(options: LazyVStackOptions, ...children: VNodeChild[]): StyledVNode
export function LazyVStack(...args: any[]): StyledVNode {
  const options: LazyVStackOptions = isOptions(args[0]) ? args[0] as LazyVStackOptions : {}
  const children = isOptions(args[0]) ? args.slice(1) : args
  const { estimatedItemSize, ...stackOptions } = options
  return VStack(
    stackOptions,
    ...flatten(children).map(child => lazyChild(child, estimatedItemSize)),
  )
}

export function LazyHStack(...children: VNodeChild[]): StyledVNode
export function LazyHStack(options: LazyHStackOptions, ...children: VNodeChild[]): StyledVNode
export function LazyHStack(...args: any[]): StyledVNode {
  const options: LazyHStackOptions = isOptions(args[0]) ? args[0] as LazyHStackOptions : {}
  const children = isOptions(args[0]) ? args.slice(1) : args
  const { estimatedItemSize, ...stackOptions } = options
  return HStack(
    stackOptions,
    ...flatten(children).map(child => lazyChild(child, estimatedItemSize)),
  )
}

export function LazyGrid(
  columnsOrOptions: number | string | LazyGridOptions = 1,
  ...children: VNodeChild[]
): StyledVNode {
  const options: LazyGridOptions = typeof columnsOrOptions === 'object'
    ? columnsOrOptions
    : { columns: columnsOrOptions }
  const { estimatedItemSize, ...gridOptions } = options
  return Grid(
    gridOptions,
    ...flatten(children).map(child => lazyChild(child, estimatedItemSize)),
  )
}
