import type { Component as VueComponent, Ref } from 'vue'
import { Component } from './elements.js'
import type { ComponentProps, ComponentSlots, ModelOptions, StyledVNode } from './types.js'

export function Model<C extends VueComponent, T>(
  component: C,
  value: Ref<T>,
  props: ComponentProps<C> | null = null,
  options: ModelOptions<T> = {},
  slots?: ComponentSlots<C>,
): StyledVNode {
  return Component(component, props, slots).model(value, options)
}
