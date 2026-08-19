import {
  h,
  KeepAlive as VueKeepAlive,
  Suspense as VueSuspense,
  Teleport as VueTeleport,
  Transition as VueTransition,
  TransitionGroup as VueTransitionGroup,
  type KeepAliveProps,
  type SuspenseProps,
  type TeleportProps,
  type TransitionGroupProps,
  type TransitionProps,
  type VNodeChild,
} from 'vue'
import { styled } from './modifiers.js'
import type { StyledVNode } from './types.js'

export function Transition(
  child: VNodeChild,
  props: TransitionProps = {},
): StyledVNode {
  return styled(h(VueTransition, props, { default: () => child }))
}

export function TransitionGroup(
  children: VNodeChild[],
  props: TransitionGroupProps = {},
): StyledVNode {
  return styled(h(VueTransitionGroup, props, { default: () => children }))
}

export function Teleport(
  to: TeleportProps['to'],
  ...children: VNodeChild[]
): StyledVNode {
  return styled(h(VueTeleport, { to }, children))
}

export function Suspense(
  content: VNodeChild,
  fallback: VNodeChild,
  props: SuspenseProps = {},
): StyledVNode {
  return styled(
    h(VueSuspense, props, {
      default: () => content,
      fallback: () => fallback,
    }),
  )
}

export function KeepAlive(
  child: VNodeChild,
  props: KeepAliveProps = {},
): StyledVNode {
  return styled(h(VueKeepAlive, props, { default: () => child }))
}
