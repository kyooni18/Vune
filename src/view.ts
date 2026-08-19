import { defineComponent, type Component, type VNodeChild } from 'vue'

export type ViewBody = () => VNodeChild

export interface StatelessViewDefinition {
  name?: string
  body: ViewBody
}

export interface ViewDefinition<State> {
  name?: string
  state: () => State
  body: (state: State) => VNodeChild
}

/**
 * Defines a Vue component without requiring callers to write defineComponent(),
 * setup(), or a render function. State is created once per component instance;
 * body is evaluated by Vue on each reactive render.
 */
export function View(body: ViewBody): Component
export function View(definition: StatelessViewDefinition): Component
export function View<State>(definition: ViewDefinition<State>): Component
export function View<State>(
  definitionOrBody: ViewBody | StatelessViewDefinition | ViewDefinition<State>,
): Component {
  const definition: StatelessViewDefinition | ViewDefinition<State> =
    typeof definitionOrBody === 'function'
      ? { body: definitionOrBody }
      : definitionOrBody

  return defineComponent({
    name: definition.name,
    setup() {
      if ('state' in definition) {
        const state = definition.state()
        return () => definition.body(state)
      }

      return () => definition.body()
    },
  })
}
