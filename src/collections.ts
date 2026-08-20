import {
  Fragment,
  createElement,
  isValidElement,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { Grid, HStack, Text, VStack } from './elements.js'
import { collectChildren, type RuiBuilder } from './builder.js'
import { layoutChild, layoutChildren } from './layout.js'
import { finalize, styled } from './modifiers.js'
import type {
  GridOptions,
  HStackOptions,
  Length,
  StyledElement,
  VStackOptions,
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

export interface ListOptions {
  spacing?: Length
  inset?: Length
  separators?: boolean
}

export function List(...children: ReactNode[]): StyledElement
export function List(options: ListOptions, ...children: ReactNode[]): StyledElement
export function List(...args: any[]): StyledElement {
  const options: ListOptions = isOptions(args[0]) ? args[0] as ListOptions : {}
  const children = isOptions(args[0]) ? args.slice(1) : args
  const flat = flatten(children)
  const rows = flat.map((child, index) => createElement(
    'div',
    {
      role: 'listitem',
      key: isValidElement(child) ? child.key ?? index : index,
      style: {
        minWidth: 0,
        ...(options.inset === undefined ? {} : { padding: cssLength(options.inset) }),
        ...(options.separators === false || index === 0
          ? {}
          : { borderTop: '1px solid rgba(127, 127, 127, 0.22)' }),
      },
    },
    layoutChild(child),
  ))

  return finalize(createElement('div', {
    role: 'list',
    style: {
      display: 'flex',
      flexDirection: 'column',
      ...(options.spacing === undefined ? {} : { gap: cssLength(options.spacing) }),
    },
  }, ...rows))
}

export interface SectionOptions {
  header?: ReactNode | string
  footer?: ReactNode | string
  spacing?: Length
}

function sectionPart(value: ReactNode | string | undefined, role: 'heading' | 'note'): ReactNode {
  if (value === undefined) return null
  const child = typeof value === 'string' ? Text(value) : value
  return createElement('div', { role }, layoutChild(child))
}

export function Section(...children: ReactNode[]): StyledElement
export function Section(title: string, ...children: ReactNode[]): StyledElement
export function Section(options: SectionOptions, ...children: ReactNode[]): StyledElement
export function Section(...args: any[]): StyledElement {
  let options: SectionOptions = {}
  let children: ReactNode[] = args

  if (typeof args[0] === 'string') {
    options = { header: args[0] }
    children = args.slice(1)
  } else if (isOptions(args[0])) {
    options = args[0] as SectionOptions
    children = args.slice(1)
  }

  return finalize(createElement(
    'section',
    { style: { display: 'flex', flexDirection: 'column', gap: cssLength(options.spacing ?? 8) } },
    sectionPart(options.header, 'heading'),
    createElement('div', { role: 'group' }, ...layoutChildren(flatten(children))),
    sectionPart(options.footer, 'note'),
  ))
}

export interface LazyOptions { estimatedItemSize?: Length }
export type LazyVStackOptions = VStackOptions & LazyOptions
export type LazyHStackOptions = HStackOptions & LazyOptions
export type LazyGridOptions = GridOptions & LazyOptions

function lazyStyle(estimatedItemSize: Length = 44): CSSProperties {
  return {
    contentVisibility: 'auto',
    containIntrinsicSize: `auto ${cssLength(estimatedItemSize)}`,
  }
}

function lazyChild(child: ReactNode, estimatedItemSize?: Length): ReactNode {
  if (!isValidElement(child) || child.type === Fragment) return child
  return styled(child).style(lazyStyle(estimatedItemSize))
}

export function LazyVStack(...children: ReactNode[]): StyledElement
export function LazyVStack(options: LazyVStackOptions, ...children: ReactNode[]): StyledElement
export function LazyVStack(builder: RuiBuilder): StyledElement
export function LazyVStack(options: LazyVStackOptions, builder: RuiBuilder): StyledElement
export function LazyVStack(...args: any[]): StyledElement {
  const options: LazyVStackOptions = isOptions(args[0]) ? args[0] as LazyVStackOptions : {}
  const children = isOptions(args[0]) ? collectChildren(args.slice(1)) : collectChildren(args)
  const { estimatedItemSize, ...stackOptions } = options
  return VStack(stackOptions, ...flatten(children).map(child => lazyChild(child, estimatedItemSize)))
}

export function LazyHStack(...children: ReactNode[]): StyledElement
export function LazyHStack(options: LazyHStackOptions, ...children: ReactNode[]): StyledElement
export function LazyHStack(builder: RuiBuilder): StyledElement
export function LazyHStack(options: LazyHStackOptions, builder: RuiBuilder): StyledElement
export function LazyHStack(...args: any[]): StyledElement {
  const options: LazyHStackOptions = isOptions(args[0]) ? args[0] as LazyHStackOptions : {}
  const children = isOptions(args[0]) ? collectChildren(args.slice(1)) : collectChildren(args)
  const { estimatedItemSize, ...stackOptions } = options
  return HStack(stackOptions, ...flatten(children).map(child => lazyChild(child, estimatedItemSize)))
}

export function LazyGrid(builder: RuiBuilder): StyledElement
export function LazyGrid(columnsOrOptions: number | string | LazyGridOptions, builder: RuiBuilder): StyledElement
export function LazyGrid(
  columnsOrOptions: number | string | LazyGridOptions | (() => ReactNode | ReactNode[]) = 1,
  ...children: Array<ReactNode | RuiBuilder>
): StyledElement {
  const builder = typeof columnsOrOptions === 'function'
  const options: LazyGridOptions = builder ? {} : typeof columnsOrOptions === 'object'
    ? columnsOrOptions
    : { columns: columnsOrOptions }
  const { estimatedItemSize, ...gridOptions } = options
  const resolvedChildren = builder ? collectChildren([columnsOrOptions]) : collectChildren(children)
  return Grid(gridOptions, ...flatten(resolvedChildren).map(child => lazyChild(child, estimatedItemSize)))
}
