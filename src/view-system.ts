import { cloneElement, isValidElement, useRef, type ReactElement, type ReactNode } from 'react'
import { useReactiveValue } from './state.js'
import { finalize } from './modifiers.js'
import { reactRenderer } from './runtime/renderer.js'
import { isViewNode, markViewNode, viewElement, type ViewNode } from './runtime/view-graph.js'
import { markIntrinsic } from './layout.js'
import type { Modifiers } from './types.js'

/** The marker used by values produced by Muse's struct/View model. */
export const museView = Symbol.for('muse.view')
export const museInitializers = Symbol.for('muse.initializers')

export interface ViewObject {
  readonly [museView]: true
  readonly body: ReactNode | (() => ReactNode)
}

export type View = ReactNode | ViewObject | ViewNode
export type ViewBuilderResult = View | readonly ViewBuilderResult[] | null | undefined | false
export type ViewBuilder = (...values: unknown[]) => ViewBuilderResult
export type ViewBuilderClosure = () => ViewBuilderResult

export type InitializerParameterKind = 'value' | 'viewBuilder' | 'action'

export interface InitializerParameter {
  label?: string
  kind: InitializerParameterKind
  required?: boolean
}

export interface InitializerMatch {
  /** A human-readable signature used in diagnostics and editor tooling. */
  signature: string
  parameters?: readonly InitializerParameter[]
  /** Whether this initializer accepts the supplied JavaScript arguments. */
  accepts(args: readonly unknown[]): boolean
  /** Builds the props stored by a struct View. */
  build?(args: readonly unknown[]): Record<string, unknown>
}

export interface InitializerResolution {
  initializer: InitializerMatch
  args: readonly unknown[]
}

export interface ViewDefinition<Props extends object = Record<string, unknown>> {
  name?: string
  initializers: readonly InitializerMatch[]
  state?(props: Props): Partial<Props>
  /** Built-ins apply modifiers to their rendered root instead of a host slot. */
  intrinsic?: boolean
  body(props: Props): View
}

export type ViewConstructor<Props extends object = Record<string, unknown>> = {
  (...args: unknown[]): ReactElement & Modifiers
  readonly [museView]: true
  readonly [museInitializers]: readonly InitializerMatch[]
  readonly displayName?: string
}

export class MuseInitializerError extends TypeError {
  readonly typeName: string
  readonly arguments: readonly unknown[]
  readonly candidates: readonly string[]

  constructor(typeName: string, args: readonly unknown[], candidates: readonly string[]) {
    const rendered = args.map(value => typeof value === 'function' ? 'closure' : typeof value).join(', ')
    const available = candidates.length > 0 ? ` Available initializers: ${candidates.join('; ')}.` : ''
    super(`No matching initializer for ${typeName}(${rendered}).${available}`)
    this.name = 'MuseInitializerError'
    this.typeName = typeName
    this.arguments = args
    this.candidates = candidates
  }
}

function typeName(target: unknown): string {
  if (typeof target === 'function' && (target as any).displayName) return (target as any).displayName
  if (typeof target === 'function' && target.name) return target.name
  return 'View'
}

function metadataOf(target: unknown): readonly InitializerMatch[] {
  if (typeof target !== 'function') return []
  return ((target as any)[museInitializers] as readonly InitializerMatch[] | undefined) ?? []
}

/** Register overload metadata on a callable View without changing its identity. */
export function registerInitializers<T extends Function>(
  target: T,
  initializers: readonly InitializerMatch[],
): T {
  if (!(target as any)[museView]) {
    Object.defineProperty(target, museView, { configurable: true, enumerable: false, value: true })
  }
  Object.defineProperty(target, museInitializers, {
    configurable: true,
    enumerable: false,
    value: Object.freeze([...initializers]),
  })
  return target
}

export function initializersOf(target: unknown): readonly InitializerMatch[] {
  return metadataOf(target)
}

function namedArgumentsFor(
  candidate: InitializerMatch,
  args: readonly unknown[],
): readonly unknown[] {
  const parameters = candidate.parameters
  const first = args[0]
  if (!parameters || !isNamedArguments(first)) return args

  const labels = new Set(parameters.flatMap(parameter => parameter.label ? [parameter.label] : []))
  const keys = Object.keys(first)
  if (!keys.some(label => labels.has(label)) || keys.some(label => !labels.has(label))) return args

  let trailingClosures = args.slice(1).filter(value => typeof value === 'function').length
  for (const parameter of parameters) {
    if (parameter.required === false || (parameter.label && Object.prototype.hasOwnProperty.call(first, parameter.label))) continue
    if ((parameter.kind === 'viewBuilder' || parameter.kind === 'action') && trailingClosures > 0) {
      trailingClosures -= 1
      continue
    }
    if (parameter.required) return args
  }

  let trailing = 1
  const normalized = parameters.map(parameter => {
    if (parameter.label && Object.prototype.hasOwnProperty.call(first, parameter.label)) {
      return first[parameter.label]
    }
    if ((parameter.kind === 'viewBuilder' || parameter.kind === 'action') && typeof args[trailing] === 'function') {
      return args[trailing++]
    }
    return undefined
  })
  while (normalized.length > 0
    && normalized[normalized.length - 1] === undefined
    && parameters[normalized.length - 1]?.required === false) {
    normalized.pop()
  }
  return trailing === args.length ? normalized : args
}

function isNamedArguments(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && !isValidElement(value)
}

/** Resolve overloads exactly once at the View boundary. */
export function resolveInitializer(target: unknown, args: readonly unknown[]): InitializerResolution {
  const candidates = metadataOf(target)
  const match = candidates
    .map(candidate => ({ candidate, args: namedArgumentsFor(candidate, args) }))
    .find(({ candidate, args: candidateArgs }) => candidate.accepts(candidateArgs))
  const initializer = match?.candidate
  if (!initializer) throw new MuseInitializerError(typeName(target), args, candidates.map(candidate => candidate.signature))
  return { initializer, args: match?.args ?? args }
}

/** Validate a legacy function DSL call against its declared initializer metadata. */
export function assertInitializerCall(target: unknown, args: readonly unknown[]): void {
  if (metadataOf(target).length > 0) resolveInitializer(target, args)
}

export function flattenViewBuilder(value: ViewBuilderResult): View[] {
  if (value === null || value === undefined || value === false) return []
  if (Array.isArray(value)) return value.flatMap(item => flattenViewBuilder(item as ViewBuilderResult))
  return [value as View]
}

export const ViewBuilder = Object.freeze({
  buildBlock(...values: ViewBuilderResult[]): View[] {
    return values.flatMap(flattenViewBuilder)
  },
  buildOptional(value: ViewBuilderResult | null | undefined): View[] {
    return flattenViewBuilder(value)
  },
  buildEither(first: ViewBuilderResult, second?: ViewBuilderResult): View[] {
    return flattenViewBuilder(second === undefined ? first : second)
  },
  buildArray(values: readonly ViewBuilderResult[]): View[] {
    return values.flatMap(flattenViewBuilder)
  },
})

export function resolveBuilderClosure(closure: ViewBuilderClosure): View[] {
  return flattenViewBuilder(closure())
}

function renderView(value: View): ReactNode {
  if (isViewNode(value)) return reactRenderer.render(value)
  if (value && typeof value === 'object' && museView in (value as object)) {
    const body = (value as any).body
    return typeof body === 'function' ? body() : body
  }
  return value as ReactNode
}

/** Render a View value at the React ownership boundary. */
export function renderViewTree(value: ViewBuilderResult): ReactNode {
  if (Array.isArray(value)) return value.map(item => renderViewTree(item as ViewBuilderResult))
  if (value === null || value === undefined || value === false) return value as any
  return renderView(value as View)
}

interface ViewHostProps<Props extends object> {
  definition: ViewDefinition<Props>
  props: Props
}

function renderDefinition<Props extends object>(
  definition: ViewDefinition<Props>,
  props: Props,
  forwarded: Record<string, unknown>,
): ReactNode {
  const state = useRef<Partial<Props> | null>(null)
  if (state.current === null) state.current = definition.state?.(props) ?? null
  const resolvedProps = state.current === null ? props : { ...props, ...state.current }
  const node = useReactiveValue(() => definition.body(resolvedProps))
  const rendered = renderViewTree(node)
  if (definition.intrinsic && isValidElement(rendered)) {
    const renderedProps = rendered.props as Record<string, unknown>
    const merged = { ...forwarded }
    if (forwarded.style !== undefined || renderedProps.style !== undefined) {
      merged.style = { ...(renderedProps.style as object ?? {}), ...(forwarded.style as object ?? {}) }
    }
    if (forwarded.className !== undefined && renderedProps.className !== undefined) {
      merged.className = `${String(renderedProps.className)} ${String(forwarded.className)}`
    }
    return cloneElement(rendered, merged as any)
  }
  return reactRenderer.fragment(rendered)
}

function ViewHost<Props extends object>({ definition, props }: ViewHostProps<Props>) {
  return renderDefinition(definition, props, {})
}

interface BuiltinViewHostProps<Props extends object> extends ViewHostProps<Props> {
  [key: string]: unknown
}

function BuiltinViewHost<Props extends object>({ definition, props, ...forwarded }: BuiltinViewHostProps<Props>) {
  return renderDefinition(definition, props, forwarded)
}

markIntrinsic(BuiltinViewHost)

/**
 * Define a user View with the same initializer/body split as a built-in View.
 * The returned callable is intentionally React-compatible, so it can be used
 * inside the existing renderer while the View graph stays declarative.
 */
export function defineView<Props extends object = Record<string, unknown>>(
  name: string,
  definition: ViewDefinition<Props>,
): ViewConstructor<Props> {
  const Type = ((...args: unknown[]) => {
    const resolution = resolveInitializer(Type, args)
    const props = (resolution.initializer.build?.(resolution.args) ?? {}) as Props
    const host = definition.intrinsic ? BuiltinViewHost : ViewHost
    const node = viewElement(host, { definition, props })
    const element = finalize(reactRenderer.render(node) as ReactElement)
    markViewNode(element, node)
    return element
  }) as ViewConstructor<Props>

  Object.defineProperty(Type, museView, { configurable: false, value: true })
  Object.defineProperty(Type, 'displayName', { configurable: true, value: name })
  registerInitializers(Type, definition.initializers)
  return Type
}

export function defineBuiltinView<Props extends object = Record<string, unknown>>(
  name: string,
  initializers: readonly InitializerMatch[],
  body: (props: Props) => View,
): ViewConstructor<Props> {
  return defineView(name, { name, initializers, intrinsic: true, body })
}

/** A concise alias for code that wants to describe a SwiftUI-like struct. */
export const structView = defineView

export function initializer(
  signature: string,
  accepts: (args: readonly unknown[]) => boolean,
  build?: (args: readonly unknown[]) => Record<string, unknown>,
  parameters?: readonly InitializerParameter[],
): InitializerMatch {
  return { signature, accepts, build, parameters }
}

/** Helpers shared by built-in initializer declarations. */
export const initializerKinds = Object.freeze({
  value: (required = true, label?: string): InitializerParameter => ({ kind: 'value', required, label }),
  viewBuilder: (required = true, label?: string): InitializerParameter => ({ kind: 'viewBuilder', required, label }),
  action: (required = true, label?: string): InitializerParameter => ({ kind: 'action', required, label }),
})

export function acceptsTrailingBuilder(args: readonly unknown[], requiredArguments = 0): boolean {
  return args.length === requiredArguments + 1 && typeof args[args.length - 1] === 'function'
}
