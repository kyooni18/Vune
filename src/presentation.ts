import {
  cloneElement,
  createContext,
  createElement,
  isValidElement,
  useEffect,
  useContext,
  useRef,
  type AnchorHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { layoutChild, layoutChildren, markIntrinsic } from './layout.js'
import { finalize } from './modifiers.js'
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
  return finalize(createElement(
    'div',
    { 'data-rui-navigation-stack': '' },
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
  return finalize(createElement(NavigationLinkHost, { ...props, destination }, content(label)))
}

export interface SheetOptions {
  target?: string
  dismissOnBackdrop?: boolean
  ariaLabel?: string
  ariaLabelledBy?: string
  ariaDescribedBy?: string
  role?: 'dialog' | 'alertdialog'
  placement?: 'bottom' | 'center'
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(
    'a[href], area[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter(element => element.getAttribute('aria-hidden') !== 'true')
}

interface SheetHostProps {
  isPresented: StateRef<boolean>
  sheetContent: ReactNode
  options: SheetOptions
}

function SheetHost({ isPresented, sheetContent, options }: SheetHostProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const panel = panelRef.current
    if (!panel || !isPresented.value) return undefined
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusables = focusableElements(panel)
    ;(focusables[0] ?? panel).focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        isPresented.value = false
        return
      }
      if (event.key !== 'Tab') return
      const current = focusableElements(panel)
      if (current.length === 0) {
        event.preventDefault()
        panel.focus()
        return
      }
      const first = current[0]
      const last = current[current.length - 1]
      if (!panel.contains(document.activeElement)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    panel.addEventListener('keydown', onKeyDown)
    return () => {
      panel.removeEventListener('keydown', onKeyDown)
      if (previous?.isConnected) previous.focus()
    }
  }, [isPresented])

  if (!isPresented.value) return null
  const target = options.target ? document.querySelector(options.target) : document.body
  if (!target) return null

  const panelRadius = options.placement === 'center' ? '16px' : '16px 16px 0 0'
  const backdrop = createElement('div', {
    'data-rui-sheet-backdrop': '',
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
    ref: panelRef,
    'data-rui-sheet': '',
    role: options.role ?? 'dialog',
    'aria-modal': true,
    'aria-label': options.ariaLabel,
    'aria-labelledby': options.ariaLabelledBy,
    'aria-describedby': options.ariaDescribedBy,
    tabIndex: -1,
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

markIntrinsic(SheetHost)

export function Sheet(
  isPresented: StateRef<boolean>,
  sheetContent: ReactNode,
  options: SheetOptions = {},
): ReactNode {
  if (!isPresented.value || typeof document === 'undefined') return null
  return createElement(SheetHost, { isPresented, sheetContent, options })
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
  const titleId = 'rui-alert-title'
  const messageId = 'rui-alert-message'
  const dialog = createElement('div', {
    style: {
      width: 'min(420px, calc(100vw - 32px))',
      padding: '20px',
      background: 'Canvas',
      color: 'CanvasText',
      borderRadius: '14px',
      boxShadow: '0 16px 50px rgba(0,0,0,0.28)',
    },
  },
  createElement('strong', { id: titleId }, options.title),
  options.message === undefined ? null : createElement('p', { id: messageId }, options.message),
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
    ariaLabelledBy: titleId,
    ...(options.message === undefined ? {} : { ariaDescribedBy: messageId }),
    role: 'alertdialog',
    placement: 'center',
  })
}

interface MenuHostProps {
  label: ReactNode | Value<string | number>
  items: ReactNode[]
}

function MenuHost({ label, items }: MenuHostProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const menuItems = layoutChildren(items).map((item, index) => {
    if (!isValidElement(item)) return item
    const originalOnClick = (item.props as { onClick?: (event: unknown) => unknown }).onClick
    return cloneElement(item, {
      role: 'menuitem',
      tabIndex: -1,
      key: item.key ?? index,
      onClick(event: unknown) {
        originalOnClick?.(event)
        detailsRef.current?.removeAttribute('open')
      },
    } as any)
  })

  const focusItem = (index: number) => {
    const itemsInMenu = [...(detailsRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    itemsInMenu[Math.max(0, Math.min(index, itemsInMenu.length - 1))]?.focus()
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDetailsElement>) => {
    const details = detailsRef.current
    if (!details) return
    const itemsInMenu = [...details.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    const currentIndex = itemsInMenu.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape' && details.open) {
      event.preventDefault()
      details.removeAttribute('open')
      details.querySelector('summary')?.focus()
    } else if (event.key === 'ArrowDown' && details.open) {
      event.preventDefault()
      focusItem(currentIndex < 0 ? 0 : currentIndex + 1)
    } else if (event.key === 'ArrowUp' && details.open) {
      event.preventDefault()
      focusItem(currentIndex < 0 ? itemsInMenu.length - 1 : currentIndex - 1)
    } else if (event.key === 'Home' && details.open) {
      event.preventDefault()
      focusItem(0)
    } else if (event.key === 'End' && details.open) {
      event.preventDefault()
      focusItem(itemsInMenu.length - 1)
    }
  }

  return createElement('details', { ref: detailsRef, 'data-rui-menu': '', onKeyDown },
    createElement('summary', { 'aria-haspopup': 'menu', style: { cursor: 'pointer' } }, content(label)),
    createElement('div', {
      role: 'menu',
      style: { display: 'flex', flexDirection: 'column', minWidth: 'max-content' },
    }, ...menuItems),
  )
}

export function Menu(
  label: ReactNode | Value<string | number>,
  ...items: ReactNode[]
): StyledElement {
  return finalize(createElement(MenuHost, { label, items: flatten(items) }))
}
