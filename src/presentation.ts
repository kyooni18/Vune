import {
  Comment, Fragment, Teleport, defineComponent, h, inject, mergeProps, provide, toValue,
  type InjectionKey, type Ref, type VNode, type VNodeChild,
} from 'vue'
import { layoutChild, layoutChildren } from './layout.js'
import { styled } from './modifiers.js'
import type { NativeProps, StyledVNode, Value } from './types.js'

type MergeableProps = Record<string, any>

export interface RouterLike { push(destination: unknown): unknown; back?(): unknown }
const navigationKey: InjectionKey<RouterLike> = Symbol('vune-navigation')
const NavigationProvider = defineComponent({
  name: 'VuneNavigationProvider', props: { router: { required: true } },
  setup(props, { slots }) { provide(navigationKey, props.router as RouterLike); return () => h(Fragment, null, slots.default?.()) },
})
const NavigationLinkHost = defineComponent({
  name: 'VuneNavigationLink', inheritAttrs: false, props: { destination: { required: true } },
  setup(props, { attrs, slots }) {
    const router = inject(navigationKey, null)
    function navigate(event: MouseEvent) {
      if (event.defaultPrevented) return
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      if (attrs.target === '_blank' || !router) return
      event.preventDefault(); router.push(props.destination)
    }
    return () => h('a', mergeProps(attrs, { href: typeof props.destination === 'string' ? props.destination : undefined, onClick: navigate, style: { color: 'inherit', textDecoration: 'inherit', display: 'block', width: '100%', height: '100%' } }), slots.default?.())
  },
})
function flatten(children: VNodeChild[]): VNodeChild[] { const result: VNodeChild[] = []; for (const child of children) { if (Array.isArray(child)) result.push(...flatten(child as VNodeChild[])); else result.push(child) }; return result }
function content(value: VNodeChild | Value<string | number>): VNodeChild {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object' && '__v_isVNode' in value) return value as VNode
  return String(toValue(value as Value<string | number>))
}
export function NavigationStack(router: RouterLike, ...children: VNodeChild[]): StyledVNode { return styled(h('div', { 'data-vune-navigation-stack': '' }, [h(NavigationProvider, { router }, { default: () => layoutChildren(flatten(children)) })])) }
export function NavigationLink(destination: unknown, label: VNodeChild | Value<string | number>, props: NativeProps = {}): StyledVNode { return styled(h(NavigationLinkHost, { ...(props as MergeableProps), destination }, { default: () => content(label) })) }

export interface SheetOptions { target?: string; dismissOnBackdrop?: boolean; ariaLabel?: string; placement?: 'bottom' | 'center' }
export function Sheet(isPresented: Ref<boolean>, content: VNodeChild, options: SheetOptions = {}): VNode {
  if (!isPresented.value) return h(Comment, null, 'vune-sheet')
  function dismiss(event: MouseEvent) { if (options.dismissOnBackdrop === false) return; if (event.target === event.currentTarget) isPresented.value = false }
  return h(Teleport, { to: options.target ?? 'body' }, h('div', { 'data-vune-sheet-backdrop': '', role: 'presentation', onClick: dismiss, style: { position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', ...(options.placement === 'center' ? { placeItems: 'center' } : { alignItems: 'end' }), background: 'rgba(0, 0, 0, 0.32)' } }, [h('div', { 'data-vune-sheet': '', role: 'dialog', 'aria-modal': 'true', 'aria-label': options.ariaLabel, style: { minWidth: 0, maxHeight: '90vh', overflow: 'auto', background: 'Canvas', color: 'CanvasText', borderRadius: '16px 16px 0 0' } }, [layoutChild(content)])]))
}
export interface AlertAction { label: string; action?: () => unknown; role?: 'default' | 'cancel' | 'destructive' }
export interface AlertOptions { title: string; message?: string; actions?: readonly AlertAction[]; target?: string }
export function Alert(isPresented: Ref<boolean>, options: AlertOptions): VNode {
  const actions = options.actions?.length ? options.actions : [{ label: 'OK', role: 'cancel' as const }]
  const dialog = h('div', { role: 'alertdialog', 'aria-modal': 'true', 'aria-label': options.title, style: { width: 'min(420px, calc(100vw - 32px))', padding: '20px', background: 'Canvas', color: 'CanvasText', borderRadius: '14px', boxShadow: '0 16px 50px rgba(0,0,0,0.28)' } }, [h('strong', null, options.title), options.message === undefined ? null : h('p', null, options.message), h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px' } }, actions.map(action => h('button', { type: 'button', 'data-role': action.role ?? 'default', onClick: () => { action.action?.(); isPresented.value = false } }, action.label)))])
  return Sheet(isPresented, dialog, { target: options.target, dismissOnBackdrop: false, ariaLabel: options.title, placement: 'center' })
}
export function Menu(label: VNodeChild | Value<string | number>, ...items: VNodeChild[]): StyledVNode { return styled(h('details', { 'data-vune-menu': '' }, [h('summary', { style: { cursor: 'pointer' } }, [content(label)]), h('div', { role: 'menu', style: { display: 'flex', flexDirection: 'column', minWidth: 'max-content' } }, layoutChildren(flatten(items)))])) }
