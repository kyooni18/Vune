import { ref, type Component, type Ref, type VNodeChild } from 'vue'
import {
  View,
  type StatelessViewDefinition,
  type ViewBody,
  type ViewDefinition,
} from './view.js'

/**
 * Declares component-local reactive state for the Vune macro transform.
 * vuneMacro() relocates top-level State() declarations into the view's
 * per-instance state factory before the module executes.
 */
export function State<T>(initial: T): Ref<T> {
  return ref(initial) as Ref<T>
}

/**
 * Compile-time event wrapper. vuneMacro() rewrites Action(expression) into
 * a callback so the expression runs only when the event fires.
 */
export function Action<T>(_expression: T): (...args: any[]) => unknown {
  throw new Error(
    'Action() requires the Vune Vite macro. Add vuneMacro() before vue() in vite.config.',
  )
}

/**
 * Macro-first view entry point. After transformation this delegates to View().
 * The VNode overload keeps macro-authored source valid TypeScript for editors.
 */
export function view(body: VNodeChild): Component
export function view(body: ViewBody): Component
export function view(definition: StatelessViewDefinition): Component
export function view<S>(definition: ViewDefinition<S>): Component
export function view<S>(
  input: VNodeChild | ViewBody | StatelessViewDefinition | ViewDefinition<S>,
): Component {
  if (typeof input === 'function') return View(input as ViewBody)

  if (input && typeof input === 'object' && 'body' in input) {
    if ('state' in input) return View(input as ViewDefinition<S>)
    return View(input as StatelessViewDefinition)
  }

  throw new Error(
    'view() expression syntax requires the Vune Vite macro. Add vuneMacro() before vue() in vite.config.',
  )
}
