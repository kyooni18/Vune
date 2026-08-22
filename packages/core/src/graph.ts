import {
  closureForKind,
  closureKindOf,
  closureVariantsOf,
  markMuseClosure,
  type MuseClosureKind,
} from "./closures.js"

export const museView = Symbol.for("muse.view")
export const museInitializers = Symbol.for("muse.initializers")
export const museNamedArguments = Symbol.for("muse.named.arguments")
const museViewNodeFactory = Symbol.for("muse.view.node.factory")

export type ViewGraphLeaf = string | number | bigint | boolean | null | undefined | object
export type ViewGraphChild = ViewGraphLeaf | ViewNode
export type ViewGraphValue = ViewGraphChild | readonly ViewGraphValue[]
export type ViewValue = ViewGraphValue
export type Length = number | string
export type ClassValue = string | false | null | undefined | readonly ClassValue[]

export interface GeometryFrame {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

export interface EdgeInsets {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

export interface GeometryProxy {
  readonly frame: GeometryFrame
  readonly size: Readonly<Pick<GeometryFrame, "width" | "height">>
  readonly safeAreaInsets: EdgeInsets
}

export const zeroGeometry: GeometryProxy = Object.freeze({
  frame: Object.freeze({ x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 }),
  size: Object.freeze({ width: 0, height: 0 }),
  safeAreaInsets: Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 }),
})

/** Normalize renderer-provided CSS safe-area values without introducing DOM dependencies. */
export function edgeInsetsFromCss(values: Partial<Record<keyof EdgeInsets, unknown>>): EdgeInsets {
  const number = (value: unknown): number => {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0
    if (typeof value !== "string") return 0
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return Object.freeze({
    top: number(values.top),
    right: number(values.right),
    bottom: number(values.bottom),
    left: number(values.left),
  })
}

export function classNameOf(value: unknown): string {
  if (Array.isArray(value)) return value.map(classNameOf).filter(Boolean).join(" ")
  return typeof value === "string" ? value : ""
}

export interface ViewModifierNode {
  readonly name: string
  readonly arguments: readonly unknown[]
  /** Optional renderer-facing props supplied by a compatibility adapter. */
  readonly props?: object | null
}

export interface ElementViewNode {
  readonly kind: "element"
  readonly type: unknown
  readonly props: Record<string, unknown> | null
  readonly children: readonly ViewGraphChild[]
}

export interface FragmentViewNode {
  readonly kind: "fragment"
  readonly children: readonly ViewGraphChild[]
}

export interface ViewHostNode {
  readonly kind: "view"
  readonly name: string
  readonly host: unknown
  readonly props: Record<string, unknown>
  readonly state?: (props: Record<string, unknown>) => Record<string, unknown>
  readonly render: (props: Record<string, unknown>) => ViewGraphValue
}

export interface GeometryViewNode {
  readonly kind: "geometry"
  readonly content: (geometry: GeometryProxy) => ViewGraphValue
}

export interface ModifiedContent {
  readonly kind: "modified"
  readonly content: ViewNode
  readonly modifier: ViewModifierNode
  readonly name: string
  readonly arguments: readonly unknown[]
}

export type ViewNode = ElementViewNode | FragmentViewNode | ViewHostNode | GeometryViewNode | ModifiedContent
/** Public View value: an immutable graph node with value-semantic modifiers. */
export type View = ViewNode & Modifiers
export type ViewModifier = ViewModifierNode

export interface Modifiers {
  padding(value?: Length): ModifiableViewNode
  margin(value?: Length): ModifiableViewNode
  gap(value: Length): ModifiableViewNode
  frame(options: Record<string, unknown>): ModifiableViewNode
  font(value: string): ModifiableViewNode
  fontSize(value: Length): ModifiableViewNode
  bold(): ModifiableViewNode
  foreground(value: unknown): ModifiableViewNode
  background(value: unknown): ModifiableViewNode
  style(value: Record<string, unknown>): ModifiableViewNode
  className(value: ClassValue): ModifiableViewNode
  withProps(value: Record<string, unknown>): ModifiableViewNode
  keyed(value: string | number): ModifiableViewNode
  elementRef(value: unknown): ModifiableViewNode
}

export type ModifiableViewNode = ViewNode & Modifiers

const decoratedNodes = new WeakMap<object, ModifiableViewNode>()

function decorate(node: ViewNode): ModifiableViewNode {
  const existing = decoratedNodes.get(node)
  if (existing) return existing
  const result = { ...node } as ModifiableViewNode
  const modifier = (name: string, args: readonly unknown[]) => modifiedContent(result, { name, arguments: [...args] })
  Object.defineProperties(result, {
    padding: { value: (value: Length = 0) => modifier("padding", [value]) },
    margin: { value: (value: Length = 0) => modifier("margin", [value]) },
    gap: { value: (value: Length) => modifier("gap", [value]) },
    frame: { value: (options: Record<string, unknown>) => modifier("frame", [options]) },
    font: { value: (value: string) => modifier("font", [value]) },
    fontSize: { value: (value: Length) => modifier("fontSize", [value]) },
    bold: { value: () => modifier("bold", []) },
    foreground: { value: (value: unknown) => modifier("foreground", [value]) },
    background: { value: (value: unknown) => modifier("background", [value]) },
    style: { value: (value: Record<string, unknown>) => modifier("style", [value]) },
    className: { value: (value: ClassValue) => modifier("className", [value]) },
    withProps: { value: (value: Record<string, unknown>) => modifier("withProps", [value]) },
    keyed: { value: (value: string | number) => modifier("keyed", [value]) },
    elementRef: { value: (value: unknown) => modifier("elementRef", [value]) },
  })
  const frozen = Object.freeze(result)
  decoratedNodes.set(node, frozen)
  decoratedNodes.set(frozen, frozen)
  return frozen
}

export function viewElement(type: unknown, props: Record<string, unknown> | null = null, children: readonly ViewGraphChild[] = []): ModifiableViewNode {
  return decorate(Object.freeze({ kind: "element" as const, type, props, children: [...children] }))
}

export function viewFragment(children: readonly ViewGraphChild[] = []): ModifiableViewNode {
  return decorate(Object.freeze({ kind: "fragment" as const, children: [...children] }))
}

export function viewHost(
  name: string,
  host: unknown,
  props: Record<string, unknown>,
  render: (props: Record<string, unknown>) => ViewGraphValue,
  state?: (props: Record<string, unknown>) => Record<string, unknown>,
): ModifiableViewNode {
  return decorate(Object.freeze({ kind: "view" as const, name, host, props, render, state }))
}

export function modifiedContent(content: ViewNode, modifier: ViewModifierNode): ModifiableViewNode {
  return decorate(Object.freeze({
    kind: "modified" as const,
    content,
    modifier: Object.freeze({ name: modifier.name, arguments: [...modifier.arguments], props: modifier.props }),
    name: modifier.name,
    arguments: [...modifier.arguments],
  }))
}

/** Apply a named modifier without coupling the graph to a renderer. */
export function modifier(content: ViewNode, name: string, ...arguments_: readonly unknown[]): ModifiableViewNode {
  return modifiedContent(content, { name, arguments: arguments_ })
}

/** Create a renderer-neutral geometry observation boundary. */
export function geometryView(content: (geometry: GeometryProxy) => ViewGraphValue): ModifiableViewNode {
  return decorate(Object.freeze({ kind: "geometry" as const, content }))
}

export function isViewNode(value: unknown): value is ViewNode {
  if (typeof value !== "object" || value === null) return false
  const kind = (value as { kind?: unknown }).kind
  return kind === "element" || kind === "fragment" || kind === "view" || kind === "geometry" || kind === "modified"
}

export function modifierGraphOf(value: ViewNode): readonly ViewModifierNode[] {
  const modifiers: ViewModifierNode[] = []
  let current: ViewNode = value
  while (current.kind === "modified") {
    modifiers.unshift(current.modifier)
    current = current.content
  }
  return modifiers
}

export interface MuseRenderer<Output = unknown> {
  element(type: unknown, props: Record<string, unknown> | null, ...children: Output[]): Output
  fragment(children: Output[]): Output
  value?(value: unknown): Output
  modifier(content: Output, modifier: ViewModifierNode): Output
  /** Render a View host with an optional renderer-owned resolved prop set. */
  view?(node: ViewHostNode, render: (props?: Record<string, unknown>) => Output): Output
  /** Materialize a geometry boundary and feed its measured proxy to the body. */
  geometry?(node: GeometryViewNode, render: (geometry: GeometryProxy) => Output): Output
}

export function renderViewNode<Output>(value: ViewGraphValue, renderer: MuseRenderer<Output>): Output {
  if (Array.isArray(value)) return renderer.fragment(value.map(item => renderViewNode(item, renderer)))
  if (!isViewNode(value)) return renderer.value ? renderer.value(value) : value as Output
  switch (value.kind) {
    case "element":
      return renderer.element(value.type, value.props, ...value.children.map(child => renderViewNode(child, renderer)))
    case "fragment":
      return renderer.fragment(value.children.map(child => renderViewNode(child, renderer)))
    case "modified":
      return renderer.modifier(renderViewNode(value.content, renderer), value.modifier)
    case "view":
      {
        const renderWithProps = (props: Record<string, unknown> = value.props): Output => renderViewNode(value.render(props), renderer)
        if (renderer.view) return renderer.view(value, renderWithProps)
        const state = value.state?.(value.props) ?? {}
        return renderWithProps({ ...value.props, ...state })
      }
    case "geometry":
      return renderer.geometry
        ? renderer.geometry(value, geometry => renderViewNode(value.content(geometry), renderer))
        : renderViewNode(value.content(zeroGeometry), renderer)
  }
}

export type InitializerParameterKind = "value" | "binding" | "viewBuilder" | "action"

export interface InitializerParameter {
  /** Source field/property populated by a declared initializer, when known. */
  readonly name?: string
  readonly label?: string
  readonly kind: InitializerParameterKind
  readonly required?: boolean
  readonly type?: string
  readonly properties?: readonly string[]
}

export interface InitializerMatch {
  readonly signature: string
  readonly parameters?: readonly InitializerParameter[]
  readonly accepts: (args: readonly unknown[]) => boolean
  readonly build?: (args: readonly unknown[]) => Record<string, unknown>
}

export interface InitializerResolution {
  readonly initializer: InitializerMatch
  readonly args: readonly unknown[]
}

export interface ViewFieldDefinition {
  readonly name: string
  readonly kind: "stored" | "state" | "binding"
  readonly type?: string
  readonly defaultValue?: string
}

export interface ViewDefinition<Props extends object = Record<string, unknown>> {
  readonly name?: string
  readonly genericParameters?: string
  readonly fields?: readonly ViewFieldDefinition[]
  readonly initializers: readonly InitializerMatch[]
  readonly state?: (props: Props) => Partial<Props>
  readonly intrinsic?: boolean
  readonly body: (props: Props) => ViewValue
}

export type ViewConstructor<Props extends object = Record<string, unknown>> = ((...args: unknown[]) => ModifiableViewNode) & {
  readonly [museView]: true
  readonly [museInitializers]: readonly InitializerMatch[]
  readonly viewType: ViewType<Props>
  readonly displayName?: string
}

export class MuseInitializerError extends TypeError {
  readonly typeName: string
  readonly arguments: readonly unknown[]
  readonly candidates: readonly string[]

  constructor(typeName: string, args: readonly unknown[], candidates: readonly string[]) {
    const rendered = args.map(value => typeof value === "function" ? "closure" : typeof value).join(", ")
    super(`No matching initializer for ${typeName}(${rendered}).${candidates.length ? ` Available initializers: ${candidates.join("; ")}.` : ""}`)
    this.name = "MuseInitializerError"
    this.typeName = typeName
    this.arguments = args
    this.candidates = candidates
  }
}

function displayNameOf(target: unknown): string {
  return typeof target === "function" && ((target as { displayName?: string }).displayName || target.name)
    || "View"
}

function metadataOf(target: unknown): readonly InitializerMatch[] {
  return typeof target === "function" ? ((target as Partial<ViewConstructor>)[museInitializers] ?? []) : []
}

export function registerInitializers<T extends Function>(target: T, initializers: readonly InitializerMatch[]): T {
  if (!(target as { [museView]?: true })[museView]) {
    Object.defineProperty(target, museView, { configurable: true, enumerable: false, value: true })
  }
  Object.defineProperty(target, museInitializers, { configurable: true, enumerable: false, value: Object.freeze([...initializers]) })
  return target
}

export function initializersOf(target: unknown): readonly InitializerMatch[] {
  return metadataOf(target)
}

export function namedArguments<T extends Record<string, unknown>>(value: T): T {
  Object.defineProperty(value, museNamedArguments, { configurable: false, enumerable: false, value: true })
  return value
}

function isNamedObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || isViewNode(value)) return false
  // StateRef and BindingRef deliberately expose an accessor named `value`.
  // They are value arguments, not labeled-argument carriers.
  const valueDescriptor = Object.getOwnPropertyDescriptor(value, "value")
  return !(valueDescriptor && (valueDescriptor.get || valueDescriptor.set))
}

function normalizeNamedArguments(candidate: InitializerMatch, args: readonly unknown[]): readonly unknown[] {
  const parameters = candidate.parameters
  const first = args[0]
  if (!parameters || !isNamedObject(first)) return args
  const labels = new Set(parameters.flatMap(parameter => parameter.label ? [parameter.label] : []))
  const properties = new Set(parameters.flatMap(parameter => parameter.properties ?? []))
  const keys = Object.keys(first)
  if (properties.size > 0 && keys.length > 0 && keys.every(key => properties.has(key))) return args
  if (!keys.some(key => labels.has(key)) || keys.some(key => !labels.has(key))) return args
  let trailing = 1
  const normalized = parameters.map(parameter => {
    if (parameter.label && Object.prototype.hasOwnProperty.call(first, parameter.label)) return first[parameter.label]
    if ((parameter.kind === "viewBuilder" || parameter.kind === "action") && typeof args[trailing] === "function") return args[trailing++]
    return undefined
  })
  return trailing === args.length ? normalized : args
}

function genericConstraint(genericParameters: string | undefined, type: string): string | undefined {
  if (!genericParameters || !/^[$A-Za-z_][A-Za-z0-9_]*$/.test(type.trim())) return undefined
  const match = new RegExp(`(?:^|,)\\s*${type.trim()}\\s*(?:=[^:,>]+)?\\s*(?::\\s*([^,>]+))?`).exec(genericParameters)
  return match?.[1]?.trim() ?? (match ? "unknown" : undefined)
}

function typeMatches(parameter: InitializerParameter, value: unknown, genericParameters?: string): boolean | undefined {
  if (value === undefined || value === null) return undefined
  if (parameter.kind === "binding") {
    const descriptor = typeof value === "object" ? Object.getOwnPropertyDescriptor(value, "value") : undefined
    return !!descriptor?.get || !!descriptor?.set
  }
  if (!parameter.type || parameter.kind !== "value") return undefined
  const generic = genericConstraint(genericParameters, parameter.type)
  if (generic) {
    if (/\bView\b/.test(generic)) return isViewNode(value) || (typeof value === "function" && !!(value as { [museView]?: true })[museView])
    return undefined
  }
  const alternatives = parameter.type.split("|").map(item => item.trim().toLowerCase()).filter(Boolean)
  let recognized = false
  for (const type of alternatives) {
    if (type.includes("binding")) {
      recognized = true
      const descriptor = typeof value === "object" ? Object.getOwnPropertyDescriptor(value, "value") : undefined
      if (descriptor?.get || descriptor?.set) return true
      continue
    }
    if (type === "string") { recognized = true; if (typeof value === "string") return true; continue }
    if (type === "number") { recognized = true; if (typeof value === "number") return true; continue }
    if (type === "boolean") { recognized = true; if (typeof value === "boolean") return true; continue }
    if (type === "function" || type.includes("=>")) { recognized = true; if (typeof value === "function") return true; continue }
    if (type === "object") { recognized = true; if (typeof value === "object" && value !== null) return true; continue }
    if (type === "array" || type.endsWith("[]")) { recognized = true; if (Array.isArray(value)) return true; continue }
    if (type === "unknown" || type === "any") continue
  }
  return recognized ? false : undefined
}

function genericViewType(type: string | undefined, genericParameters: string | undefined): boolean {
  if (!type || !genericParameters) return false
  return genericParameters.split(",").some(declaration => {
    const name = /^\s*[$A-Za-z_][A-Za-z0-9_]*/.exec(declaration)?.[0]
    return !!name && new RegExp(`\\b${name}\\b`).test(type) && /\bView\b/.test(genericConstraint(genericParameters, name) ?? "")
  })
}

function isViewBuilderValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(isViewBuilderValue)
  return isViewNode(value)
}

function validateGenericViewBuilders(
  target: unknown,
  resolution: InitializerResolution,
  props: Record<string, unknown>,
): void {
  const genericParameters = typeof target === "function" ? (target as Partial<ViewConstructor>).viewType?.genericParameters : undefined
  if (!genericParameters || !resolution.initializer.parameters) return
  for (const parameter of resolution.initializer.parameters) {
    if (parameter.kind !== "viewBuilder" || !genericViewType(parameter.type, genericParameters)) continue
    const field = parameter.name ?? parameter.label
    if (!field || isViewBuilderValue(props[field])) continue
    throw new MuseInitializerError(displayNameOf(target), resolution.args, [resolution.initializer.signature])
  }
}

function score(candidate: InitializerMatch, original: readonly unknown[], args: readonly unknown[], genericParameters?: string): number {
  if (!candidate.parameters) return 1
  let result = 40 + (original === args ? 0 : 80) + (candidate.parameters.length === args.length ? 20 : 0)
  for (let index = 0; index < candidate.parameters.length; index += 1) {
    const parameter = candidate.parameters[index]
    const value = args[index]
    if (value === undefined) {
      if (parameter.required === false) result += 2
      continue
    }
    const variants = closureVariantsOf(value)
    if (variants && (parameter.kind === "viewBuilder" || parameter.kind === "action") && !variants[parameter.kind]) return Number.NEGATIVE_INFINITY
    const kind = closureKindOf(value)
    if (kind !== undefined && kind !== parameter.kind) return Number.NEGATIVE_INFINITY
    if (typeMatches(parameter, value, genericParameters) === false) return Number.NEGATIVE_INFINITY
    result += parameter.kind === "value" ? 8 : 12
  }
  return result
}

export function resolveInitializer(target: unknown, args: readonly unknown[]): InitializerResolution {
  const supplied = args.length === 2 && args[1] === undefined && (args[0] === null || typeof args[0] === "object") ? args.slice(0, -1) : args
  const candidates = metadataOf(target)
  const genericParameters = typeof target === "function" ? (target as Partial<ViewConstructor>).viewType?.genericParameters : undefined
  const match = candidates.map(candidate => {
    const normalized = normalizeNamedArguments(candidate, supplied)
    if (!candidate.accepts(normalized)) return null
    const value = score(candidate, supplied, normalized, genericParameters)
    if (!Number.isFinite(value)) return null
    const typed = candidate.parameters
      ? normalized.map((item, index) => {
        const parameter = candidate.parameters?.[index]
        return typeof item === "function" && parameter && parameter.kind !== "binding"
          ? markMuseClosure(closureForKind(item as (...args: any[]) => any, parameter.kind as MuseClosureKind), parameter.kind)
          : item
      })
      : normalized
    return { candidate, args: typed, score: value }
  }).filter((item): item is { candidate: InitializerMatch; args: readonly unknown[]; score: number } => item !== null)
    .sort((left, right) => right.score - left.score)[0]
  if (!match) throw new MuseInitializerError(displayNameOf(target), supplied, candidates.map(candidate => candidate.signature))
  return { initializer: match.candidate, args: match.args }
}

export function assertInitializerCall(target: unknown, args: readonly unknown[]): void {
  if (metadataOf(target).length > 0) resolveInitializer(target, args)
}

export type ViewBuilderResult = ViewValue | readonly ViewBuilderResult[] | false
export type ViewBuilderClosure = () => ViewBuilderResult

export function flattenViewBuilder(value: ViewBuilderResult): ViewValue[] {
  if (value === null || value === undefined || value === false) return []
  if (Array.isArray(value)) return value.flatMap(item => flattenViewBuilder(item))
  return [value]
}

export const ViewBuilder = Object.freeze({
  buildBlock: (...values: ViewBuilderResult[]) => values.flatMap(flattenViewBuilder),
  buildOptional: (value: ViewBuilderResult | null | undefined) => flattenViewBuilder(value as ViewBuilderResult),
  buildEither: (first: ViewBuilderResult, second?: ViewBuilderResult) => flattenViewBuilder(second === undefined ? first : second),
  buildArray: (values: readonly ViewBuilderResult[]) => values.flatMap(flattenViewBuilder),
})

export function resolveBuilderClosure(closure: ViewBuilderClosure): ViewValue[] {
  return ViewBuilder.buildBlock(markMuseClosure(closure, "viewBuilder")())
}

export class ViewType<Props extends object = Record<string, unknown>> {
  readonly name: string
  readonly genericParameters?: string
  readonly fields: readonly ViewFieldDefinition[]
  readonly definition: ViewDefinition<Props>
  readonly initializers: readonly InitializerMatch[]
  private target: unknown

  constructor(name: string, definition: ViewDefinition<Props>) {
    this.name = name
    this.genericParameters = definition.genericParameters
    this.fields = definition.fields ?? []
    this.definition = definition
    this.initializers = definition.initializers
  }

  bind(target: unknown): void { this.target = target }

  createNode(args: readonly unknown[]): ModifiableViewNode {
    if (!this.target) throw new TypeError(`View type ${this.name} is not bound to a constructor`)
    const resolution = resolveInitializer(this.target, args)
    const props = (resolution.initializer.build?.(resolution.args) ?? {}) as Props
    validateGenericViewBuilders(this.target, resolution, props as Record<string, unknown>)
    if (this.definition.intrinsic) {
      const value = this.definition.body(props)
      return isViewNode(value) ? decorate(value) : viewFragment([value as ViewGraphChild])
    }
    return viewHost(this.name, this, props as Record<string, unknown>, next => this.definition.body(next as Props), this.definition.state as ((props: Record<string, unknown>) => Record<string, unknown>) | undefined)
  }
}

export function defineView<Props extends object = Record<string, unknown>>(name: string, definition: ViewDefinition<Props>): ViewConstructor<Props> {
  const viewType = new ViewType(name, definition)
  const Type = ((...args: unknown[]) => viewType.createNode(args)) as ViewConstructor<Props>
  Object.defineProperty(Type, museView, { configurable: false, value: true })
  Object.defineProperty(Type, "displayName", { configurable: true, value: name })
  Object.defineProperty(Type, "viewType", { configurable: false, value: viewType })
  Object.defineProperty(Type, museViewNodeFactory, { configurable: false, value: (...args: unknown[]) => viewType.createNode(args) })
  viewType.bind(Type)
  registerInitializers(Type, definition.initializers)
  return Type
}

export const structView = defineView

export function createViewNode(target: unknown, args: readonly unknown[] = []): ModifiableViewNode {
  const factory = typeof target === "function" ? (target as { [museViewNodeFactory]?: (...args: unknown[]) => ModifiableViewNode })[museViewNodeFactory] : undefined
  if (!factory) throw new TypeError(`Target ${displayNameOf(target)} is not a Muse View constructor`)
  return factory(...args)
}

export function defineBuiltinView<Props extends object = Record<string, unknown>>(
  name: string,
  initializers: readonly InitializerMatch[],
  body: (props: Props) => ViewValue,
  genericParameters?: string,
): ViewConstructor<Props> {
  return defineView(name, { name, initializers, genericParameters, intrinsic: true, body })
}

export function initializer(signature: string, accepts: (args: readonly unknown[]) => boolean, build?: (args: readonly unknown[]) => Record<string, unknown>, parameters?: readonly InitializerParameter[]): InitializerMatch {
  return { signature, accepts, build, parameters }
}

export const initializerKinds = Object.freeze({
  value: (required = true, label?: string, properties?: readonly string[], type?: string): InitializerParameter => ({ kind: "value", required, label, properties, type }),
  binding: (required = true, label?: string, type?: string): InitializerParameter => ({ kind: "binding", required, label, type }),
  viewBuilder: (required = true, label?: string, type?: string): InitializerParameter => ({ kind: "viewBuilder", required, label, type }),
  action: (required = true, label?: string, type?: string): InitializerParameter => ({ kind: "action", required, label, type }),
})
