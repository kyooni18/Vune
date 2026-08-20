import {
  createContext,
  createElement,
  isValidElement,
  useContext,
  type AnchorHTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { layoutChild, layoutChildren } from './layout.js'
import { styled } from './modifiers.js'
import { isStateRef, resolveValue } from './state.js'
import type { StateRef, StyledElement, Value } from './types.js'

export interface RouterLike {
  push(destination: unknown): unknown
  back?(): unknown
}

const NavigationContext = createContext<RouterLike | null>(null)

function flatten(children: ReactNode[]): ReactNode[] {
  const result: ReactNode[] = []
  for (const child of children) {
    if (Array.isArray(child)) result.push(...flatten(child))
    else result.push(child)
  }
  return result
}

function content(value: ReactNode | Value<string | number>): ReactNode {
  if (isValidElement(value) || Array.isArray(value)) return value as ReactNode
  if (isStateRef(value) || typeof value === 'function') {
    return String(resolveValue(value as Value<string | number>))
  }
  return value as ReactNode
}

interface NavigationLinkHostProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  destination: unknown
}

function NavigationLinkHost({ destination, children, onClick, ...props }: NavigationLinkHostProps) {
  const router = useContext(NavigationContext)
  return createElement('a', {
    ...props,
    href: props.href ?? (typeof destination === 'string' ? destination : undefined),
    onClick(event: ReactMouseEvent<HTMLAnchorElement>) {
      onClick?.(event)
      if (event.defaultPrevented) return
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      if (props.target === '_blank' || !router) return
      event.preventDefault()
      router.push(destination)
    },
    style: {
      color: 'inherit',
      textDecoration: 'inherit',
      display: 'block',
      width: '100%',
      height: '100%',
      ...props.style,
    },
  }, children)
}

export function NavigationStack(router: RouterLike, ...children: ReactNode[]): StyledElement {
  return styled(createElement(
    'div',
    { 'data-vune-navigation-stack': '' },
    createElement(
      NavigationContext.Provider,
      { value: router },
      ...layoutChildren(flatten(children)),
    ),
  ))
}

export type NavigationLinkProps = Omit<NavigationLinkHostProps, 'destination' | 'children'>

export function NavigationLink(
  destination: unknown,
  label: ReactNode | Value<string | number>,
  props: NavigationLinkProps = {},
): StyledElement {
  return styled(createElement(NavigationLinkHost, { ...props, destination }, content(label)))
}

export interface SheetOptions {
  target?: string
  dismissOnBackdrop?: boolean
  ariaLabel?: string
  placement?: 'bottom' | 'center'
}

export function Sheet(
  isPresented: StateRef<boolean>,
  sheetContent: ReactNode,
  options: SheetOptions = {},
): ReactNode {
  if (!isPresented.value || typeof document === 'undefined') return null
  const target = options.target ? document.querySelector(options.target) : document.body
  if (!target) return null

  const panelRadius = options.placement === 'center' ? '16px' : '16px 16px 0 0'
  const backdrop = createElement('div', {
    'data-vune-sheet-backdrop': '',
    role: 'presentation',
    onClick(event: ReactMouseEvent<HTMLDivElement>) {
      if (options.dismissOnBackdrop === false) return
      if (event.target === event.currentTarget) isPresented.value = false
    },
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 1000,
      display: 'grid',
      ...(options.placement === 'center' ? { placeItems: 'center' } : { alignItems: 'end' }),
      background: 'rgba(0, 0, 0, 0.32)',
    },
  }, createElement('div', {
    'data-vune-sheet': '',
    role: 'dialog',
    'aria-modal': true,
    'aria-label': options.ariaLabel,
    style: {
      minWidth: 0,
      maxHeight: '90vh',
      overflow: 'auto',
      background: 'Canvas',
      color: 'CanvasText',
      borderRadius: panelRadius,
    },
  }, layoutChild(sheetContent)))

  return createPortal(backdrop, target)
}

export interface AlertAction {
  label: string
  action?: () => unknown
  role?: 'default' | 'cancel' | 'destructive'
}

export interface AlertOptions {
  title: string
  message?: string
  actions?: readonly AlertAction[]
  target?: string
}

export function Alert(isPresented: StateRef<boolean>, options: AlertOptions): ReactNode {
  const actions = options.actions?.length ? options.actions : [{ label: 'OK', role: 'cancel' as const }]
  const dialog = createElement('div', {
    role: 'alertdialog',
    'aria-modal': true,
    'aria-label': options.title,
    style: {
      width: 'min(420px, calc(100vw - 32px))',
      padding: '20px',
      background: 'Canvas',
      color: 'CanvasText',
      borderRadius: '14px',
      boxShadow: '0 16px 50px rgba(0,0,0,0.28)',
    },
  },
  createElement('strong', null, options.title),
  options.message === undefined ? null : createElement('p', null, options.message),
  createElement('div', {
    style: { display: 'flex', justifyContent: 'flex-end', gap: '8px' },
  }, ...actions.map(action => createElement('button', {
    key: action.label,
    type: 'button',
    'data-role': action.role ?? 'default',
    onClick() {
      action.action?.()
      isPresented.value = false
    },
  }, action.label))))

  return Sheet(isPresented, dialog, {
    target: options.target,
    dismissOnBackdrop: false,
    ariaLabel: options.title,
    placement: 'center',
  })
}

export function Menu(
  label: ReactNode | Value<string | number>,
  ...items: ReactNode[]
): StyledElement {
  return styled(createElement('details', { 'data-vune-menu': '' },
    createElement('summary', { style: { cursor: 'pointer' } }, content(label)),
    createElement('div', {
      role: 'menu',
      style: { display: 'flex', flexDirection: 'column', minWidth: 'max-content' },
    }, ...layoutChildren(flatten(items))),
  ))
}
