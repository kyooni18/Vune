import {
  closureForKind,
  closureKindOf,
  closureVariantsOf,
  markMuseClosure,
  type MuseClosureKind,
} from "./closures.js"
import { keyedViewIdentity, type ViewIdentity } from "./identity.js"
import type { FrameOptions } from "./layout.js"
import type { MuseStyleProperties } from "./html.js"
import { isBinding, isStateRef } from "./state.js"
import {
  resolveSemanticInitializer,
  type SemanticArgument,
  type SemanticBuilderTypeSymbol,
  type SemanticInitializerSymbol,
  type SemanticViewTypeSymbol,
} from "./semantic.js"

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

export const museForeignComponent = Symbol.for("muse.foreign.component")

export type ForeignComponentSlot = ViewGraphValue | ((...args: any[]) => ViewGraphValue)

export interface ForeignComponentSchema {
  readonly props?: Record<string, unknown>
  readonly events?: Record<string, unknown>
  readonly slots?: Record<string, unknown>
}

export interface ForeignComponentOptions {
  readonly props?: Record<string, unknown>
  readonly events?: Record<string, unknown>
  readonly slots?: Record<string, ForeignComponentSlot>
  readonly ref?: unknown
  readonly key?: string | number
  /** Renderer-owned adapter metadata; core never invokes it. */
  readonly adapter?: unknown
  readonly schema?: ForeignComponentSchema
  readonly name?: string
}

export interface ForeignComponentDescriptor {
  readonly [museForeignComponent]: true
  readonly component: unknown
  readonly props: Record<string, unknown>
  readonly events: Record<string, unknown>
  readonly slots: Record<string, ForeignComponentSlot>
  readonly ref?: unknown
  readonly key?: string | number
  readonly adapter?: unknown
  readonly schema?: ForeignComponentSchema
  readonly name: string
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

export interface LazyViewRange {
  readonly start: number
  readonly end: number
}

export interface LazyViewNode {
  readonly kind: "lazy"
  readonly name: string
  readonly axis: "vertical" | "horizontal" | "grid"
  readonly props: Record<string, unknown>
  readonly children: readonly ViewGraphChild[]
}

export interface ModifiedContent {
  readonly kind: "modified"
  /** The unmodified graph node; modifiers are stored in one flat sequence. */
  readonly content: ViewNode
  readonly modifiers: readonly ViewModifierNode[]
  /** Compatibility view of the final modifier in the flat sequence. */
  readonly modifier: ViewModifierNode
  readonly name: string
  readonly arguments: readonly unknown[]
}

export type ViewNode = ElementViewNode | FragmentViewNode | ViewHostNode | GeometryViewNode | LazyViewNode | ModifiedContent
/** Public View value: an immutable graph node with value-semantic modifiers. */
export type View = ViewNode & Modifiers
export type ViewModifier = ViewModifierNode

export interface Modifiers {
  padding(value?: Length): ModifiableViewNode
  margin(value?: Length): ModifiableViewNode
  gap(value: Length): ModifiableViewNode
  frame(options: FrameOptions): ModifiableViewNode
  font(value: string): ModifiableViewNode
  fontSize(value: Length): ModifiableViewNode
  bold(): ModifiableViewNode
  foreground(value: string): ModifiableViewNode
  background(value: string): ModifiableViewNode
  style(value: MuseStyleProperties): ModifiableViewNode
  className(value: ClassValue): ModifiableViewNode
  withProps(value: Record<string, unknown>): ModifiableViewNode
  keyed(value: string | number): ModifiableViewNode
  elementRef(value: unknown): ModifiableViewNode
}

export type ModifiableViewNode = ViewNode & Modifiers

const decoratedNodes = new WeakMap<object, ModifiableViewNode>()
const initializerSpecializations = new WeakMap<object, Map<string, InitializerMatch>>()
const initializerSpecializationEligibility = new WeakMap<object, boolean>()

function specializationShape(value: unknown, depth = 0): string | undefined {
  if (depth > 3) return undefined
  if (value === undefined) return "undefined"
  if (value === null) return "null"
  if (isBinding(value)) return `binding:${specializationShape((value as { value: unknown }).value, depth + 1) ?? "unknown"}`
  if (isStateRef(value)) return `state:${specializationShape((value as { value: unknown }).value, depth + 1) ?? "unknown"}`
  if (typeof value === "function") {
    const variants = closureVariantsOf(value)
    const variantNames = variants ? Object.keys(variants).sort().join(",") : ""
    return `function:${closureKindOf(value) ?? "unmarked"}:${variantNames}`
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, 16).map(item => specializationShape(item, depth + 1))
    if (items.some(item => item === undefined)) return undefined
    return `array:${value.length}:${items.join(",")}`
  }
  switch (typeof value) {
    case "string": return value.length <= 128 ? `string:${JSON.stringify(value)}` : undefined
    case "number": return Number.isFinite(value) ? `number:${value}` : `number:${String(value)}`
    case "boolean": return `boolean:${value}`
    case "bigint": return `bigint:${String(value)}`
    case "symbol": return `symbol:${String(value)}`
  }
  if (typeof value !== "object") return typeof value
  if (isViewNode(value)) return `view:${value.kind}`
  const keys = Object.keys(value as Record<string, unknown>).sort()
  const properties = keys.map(key => {
    const item = specializationShape((value as Record<string, unknown>)[key], depth + 1)
    return item === undefined ? undefined : `${key}=${item}`
  })
  if (properties.some(item => item === undefined)) return undefined
  return `object:${properties.join(";")}`
}

function specializationKey(args: readonly unknown[]): string | undefined {
  const shapes = args.map(value => specializationShape(value))
  return shapes.some(shape => shape === undefined) ? undefined : shapes.join("|")
}

function canSpecialize(candidates: readonly InitializerMatch[]): boolean {
  return candidates.length > 0 && candidates.every(candidate => candidate.parameters !== undefined)
}

function applyModifier(content: ViewNode, name: string, arguments_: readonly unknown[]): ModifiableViewNode {
  return modifiedContent(content, { name, arguments: arguments_ })
}

const modifierPrototype = Object.freeze(Object.assign(Object.create(Object.prototype), {
  padding(this: ViewNode, value: Length = 0) { return applyModifier(this, "padding", [value]) },
  margin(this: ViewNode, value: Length = 0) { return applyModifier(this, "margin", [value]) },
  gap(this: ViewNode, value: Length) { return applyModifier(this, "gap", [value]) },
  frame(this: ViewNode, options: FrameOptions) { return applyModifier(this, "frame", [options]) },
  font(this: ViewNode, value: string) { return applyModifier(this, "font", [value]) },
  fontSize(this: ViewNode, value: Length) { return applyModifier(this, "fontSize", [value]) },
  bold(this: ViewNode) { return applyModifier(this, "bold", []) },
  foreground(this: ViewNode, value: string) { return applyModifier(this, "foreground", [value]) },
  background(this: ViewNode, value: string) { return applyModifier(this, "background", [value]) },
  style(this: ViewNode, value: MuseStyleProperties) { return applyModifier(this, "style", [value]) },
  className(this: ViewNode, value: ClassValue) { return applyModifier(this, "className", [value]) },
  withProps(this: ViewNode, value: Record<string, unknown>) { return applyModifier(this, "withProps", [value]) },
  keyed(this: ViewNode, value: string | number) { return applyModifier(this, "keyed", [value]) },
  elementRef(this: ViewNode, value: unknown) { return applyModifier(this, "elementRef", [value]) },
}) as Modifiers)

function decorate(node: ViewNode, owned = false): ModifiableViewNode {
  const existing = decoratedNodes.get(node)
  if (existing) return existing
  let result: ModifiableViewNode
  if (owned && Object.isExtensible(node)) {
    Object.setPrototypeOf(node, modifierPrototype)
    result = node as ModifiableViewNode
  } else {
    result = Object.assign(Object.create(modifierPrototype), node) as ModifiableViewNode
  }
  const frozen = Object.freeze(result)
  decoratedNodes.set(node, frozen)
  decoratedNodes.set(frozen, frozen)
  return frozen
}

export function viewElement(type: unknown, props: Record<string, unknown> | null = null, children: readonly ViewGraphChild[] = []): ModifiableViewNode {
  return decorate({ kind: "element" as const, type, props, children: [...children] }, true)
}

/** Construct a renderer-neutral foreign component boundary. */
export function ForeignComponent(
  component: unknown,
  options: ForeignComponentOptions = {},
  ...children: ViewGraphChild[]
): ModifiableViewNode {
  const descriptor: ForeignComponentDescriptor = Object.freeze({
    [museForeignComponent]: true,
    component,
    props: Object.freeze({ ...(options.props ?? {}) }),
    events: Object.freeze({ ...(options.events ?? {}) }),
    slots: Object.freeze({ ...(options.slots ?? {}) }),
    ...(options.ref === undefined ? {} : { ref: options.ref }),
    ...(options.key === undefined ? {} : { key: options.key }),
    ...(options.adapter === undefined ? {} : { adapter: options.adapter }),
    ...(options.schema === undefined ? {} : { schema: Object.freeze({ ...options.schema }) }),
    name: options.name ?? (typeof component === "function" && component.name ? component.name : "ForeignComponent"),
  })
  return viewElement(descriptor, {
    ...descriptor.props,
    ...descriptor.events,
    ...(descriptor.ref === undefined ? {} : { ref: descriptor.ref }),
  }, children)
}

export function isForeignComponent(value: unknown): value is ForeignComponentDescriptor {
  return typeof value === "object" && value !== null && (value as Partial<ForeignComponentDescriptor>)[museForeignComponent] === true
}

export function viewFragment(children: readonly ViewGraphChild[] = []): ModifiableViewNode {
  return decorate({ kind: "fragment" as const, children: [...children] }, true)
}

export function viewHost(
  name: string,
  host: unknown,
  props: Record<string, unknown>,
  render: (props: Record<string, unknown>) => ViewGraphValue,
  state?: (props: Record<string, unknown>) => Record<string, unknown>,
): ModifiableViewNode {
  return decorate({ kind: "view" as const, name, host, props, render, state }, true)
}

export function modifiedContent(content: ViewNode, modifier: ViewModifierNode | readonly ViewModifierNode[]): ModifiableViewNode {
  const incoming = Array.isArray(modifier) ? modifier : [modifier]
  if (incoming.length === 0) return decorate(content)
  const normalizedIncoming = incoming.map(item => Object.freeze({
    name: item.name,
    arguments: Object.freeze([...item.arguments]),
    props: item.props,
  }))
  const normalizedModifiers = Object.freeze(content.kind === "modified"
    ? [...content.modifiers, ...normalizedIncoming]
    : normalizedIncoming)
  const finalModifier = normalizedModifiers[normalizedModifiers.length - 1]
  return decorate({
    kind: "modified" as const,
    content: content.kind === "modified" ? content.content : content,
    modifiers: normalizedModifiers,
    modifier: finalModifier,
    name: finalModifier.name,
    arguments: finalModifier.arguments,
  }, true)
}

/** Apply a named modifier without coupling the graph to a renderer. */
export function modifier(content: ViewNode, name: string, ...arguments_: readonly unknown[]): ModifiableViewNode {
  return modifiedContent(content, { name, arguments: arguments_ })
}

/** Create a renderer-neutral geometry observation boundary. */
export function geometryView(content: (geometry: GeometryProxy) => ViewGraphValue): ModifiableViewNode {
  return decorate({ kind: "geometry" as const, content }, true)
}

/** Create a lazy graph boundary. Renderers may window its children by range. */
export function lazyView(
  name: string,
  axis: LazyViewNode["axis"],
  props: Record<string, unknown>,
  children: readonly ViewGraphChild[] = [],
): ModifiableViewNode {
  return decorate({ kind: "lazy" as const, name, axis, props, children: [...children] }, true)
}

export function isViewNode(value: unknown): value is ViewNode {
  if (typeof value !== "object" || value === null) return false
  const kind = (value as { kind?: unknown }).kind
  return kind === "element" || kind === "fragment" || kind === "view" || kind === "geometry" || kind === "lazy" || kind === "modified"
}

export function modifierGraphOf(value: ViewNode): readonly ViewModifierNode[] {
  return value.kind === "modified" ? value.modifiers : []
}

export interface MuseRenderer<Output = unknown> {
  element(type: unknown, props: Record<string, unknown> | null, ...children: Output[]): Output
  fragment(children: Output[]): Output
  value?(value: unknown): Output
  modifier(content: Output, modifier: ViewModifierNode): Output
  /** Render a View host with an optional renderer-owned resolved prop set. */
  view?(node: ViewHostNode, render: (props?: Record<string, unknown>) => Output, identity: ViewIdentity): Output
  /** Materialize a geometry boundary and feed its measured proxy to the body. */
  geometry?(node: GeometryViewNode, render: (geometry: GeometryProxy) => Output): Output
  /** Materialize a lazy container; `render` may request a visible child range. */
  lazy?(node: LazyViewNode, render: (range?: LazyViewRange) => Output, identity: ViewIdentity): Output
}

export function renderViewNode<Output>(value: ViewGraphValue, renderer: MuseRenderer<Output>): Output {
  return renderViewNodeAt(value, renderer, ["root"])
}

function renderViewNodeAt<Output>(value: ViewGraphValue, renderer: MuseRenderer<Output>, identity: ViewIdentity): Output {
  if (Array.isArray(value)) return renderer.fragment(value.map((item, index) => renderViewNodeAt(item, renderer, [...identity, "array", index])))
  if (!isViewNode(value)) return renderer.value ? renderer.value(value) : value as Output
  switch (value.kind) {
    case "element":
      {
        const foreign = isForeignComponent(value.type) ? value.type : undefined
        const elementIdentity = foreign && foreign.key !== undefined ? keyedViewIdentity(identity, foreign.key) : identity
        return renderer.element(value.type, value.props, ...value.children.map((child, index) => renderViewNodeAt(child, renderer, [...elementIdentity, "element", index])))
      }
    case "fragment":
      return renderer.fragment(value.children.map((child, index) => renderViewNodeAt(child, renderer, [...identity, "fragment", index])))
    case "modified":
      {
        let contentIdentity = identity
        for (const item of value.modifiers) {
          if (item.name === "keyed") contentIdentity = keyedViewIdentity(contentIdentity, item.arguments[0] as string | number)
        }
        let rendered = renderViewNodeAt(value.content, renderer, contentIdentity)
        for (const item of value.modifiers) rendered = renderer.modifier(rendered, item)
        return rendered
      }
    case "view":
      {
        // A conditional can replace one View type with another at the same
        // structural slot. Include the declared View type in its identity so
        // every renderer observes the same remount boundary.
        // Prefer the declared semantic name when present. It is stable across
        // server/client processes; process-local object IDs would break
        // hydration when construction order differs between the two sides.
        const definitionName = typeof value.host === "object" && value.host !== null
          ? (value.host as { definition?: { name?: unknown } }).definition?.name
          : undefined
        const typeIdentity = typeof definitionName === "string" && definitionName.length > 0 ? definitionName : value.name
        const viewIdentity: ViewIdentity = [...identity, "view", typeIdentity]
        const renderWithProps = (props: Record<string, unknown> = value.props): Output => renderViewNodeAt(value.render(props), renderer, [...viewIdentity, "body"])
        if (renderer.view) return renderer.view(value, renderWithProps, viewIdentity)
        const state = value.state?.(value.props) ?? {}
        return renderWithProps({ ...value.props, ...state })
      }
    case "geometry":
      return renderer.geometry
        ? renderer.geometry(value, geometry => renderViewNodeAt(value.content(geometry), renderer, [...identity, "geometry"]))
        : renderViewNodeAt(value.content(zeroGeometry), renderer, [...identity, "geometry"])
    case "lazy":
      {
        const renderChildren = (range?: LazyViewRange): Output => {
          const start = Math.max(0, range?.start ?? 0)
          const end = Math.min(value.children.length, range?.end ?? value.children.length)
          return renderer.fragment(value.children.slice(start, end).map((child, index) => renderViewNodeAt(child, renderer, [...identity, "lazy", start + index])))
        }
        return renderer.lazy
          ? renderer.lazy(value, renderChildren, identity)
          : renderer.element("div", value.props, ...value.children.map((child, index) => renderViewNodeAt(child, renderer, [...identity, "lazy", index])))
      }
  }
}

export type InitializerParameterKind = "value" | "binding" | "viewBuilder" | "action"

export interface InitializerParameter {
  /** Source field/property populated by a declared initializer, when known. */
  readonly name?: string
  readonly label?: string
  readonly kind: InitializerParameterKind
  readonly required?: boolean
  /** The final parameter accepts additional positional values. */
  readonly variadic?: boolean
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

export interface ViewConstructorMetadata<Props extends object = Record<string, unknown>> {
  readonly [museView]: true
  readonly [museInitializers]: readonly InitializerMatch[]
  readonly viewType: ViewType<Props>
  readonly displayName?: string
}

export type ViewConstructor<
  Props extends object = Record<string, unknown>,
  Args extends readonly unknown[] = readonly unknown[],
> = ((...args: Args) => ModifiableViewNode) & ViewConstructorMetadata<Props>

/** Attach Muse View metadata to an explicit overload surface without adding a catch-all call. */
export type TypedViewConstructor<
  Props extends object,
  Call extends (...args: any[]) => ModifiableViewNode,
> = Call & ViewConstructorMetadata<Props>

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

/** Thrown when declaration-defined initializer resolution has no unique winner. */
export class MuseInitializerAmbiguityError extends MuseInitializerError {
  constructor(typeName: string, args: readonly unknown[], candidates: readonly string[]) {
    const ordered = [...candidates].sort()
    super(typeName, args, ordered)
    this.name = "MuseInitializerAmbiguityError"
    this.message = `Ambiguous initializer for ${typeName}(${args.map(value => typeof value === "function" ? "closure" : typeof value).join(", ")}). Candidates: ${ordered.join("; ")}.`
  }
}

function semanticInitializerSymbol(initializer: InitializerMatch, index: number): SemanticInitializerSymbol | undefined {
  if (!initializer.parameters) return undefined
  return {
    kind: "initializer",
    index,
    signature: initializer.signature,
    parameters: initializer.parameters,
  }
}

function semanticRuntimeArgument(value: unknown): SemanticArgument {
  if (isBinding(value)) return { value, kind: "binding", type: "binding", underlyingType: typeof value.value }
  if (isStateRef(value)) return { value, kind: "value", type: "state", underlyingType: Array.isArray(value.value) ? "array" : typeof value.value }
  const closureKind = closureKindOf(value)
  if (closureKind === "action" || closureKind === "viewBuilder") {
    return { value, kind: closureKind, closureRole: closureKind, type: "function" }
  }
  if (typeof value === "function") return { value, type: "function" }
  if (isViewNode(value)) return { value, type: "View" }
  return { value }
}

function semanticRuntimeArguments(candidate: InitializerMatch, args: readonly unknown[]): readonly SemanticArgument[] {
  void candidate
  return args.flatMap(value => {
    if (!value || typeof value !== "object" || !(value as Record<PropertyKey, unknown>)[museNamedArguments]) return [semanticRuntimeArgument(value)]
    return Object.entries(value as Record<string, unknown>).map(([label, item]) => ({ label, ...semanticRuntimeArgument(item) }))
  })
}

function sharedRuntimeResolution(target: unknown, candidates: readonly InitializerMatch[], args: readonly unknown[]): InitializerResolution | undefined {
  if (candidates.length === 0 || candidates.some(candidate => !candidate.parameters)) return undefined
  const symbols = candidates.map(semanticInitializerSymbol).filter((item): item is SemanticInitializerSymbol => item !== undefined)
  const genericParameters = typeof target === "function" ? (target as Partial<ViewConstructor>).viewType?.genericParameters : undefined
  const supplied = suppliedInitializerArguments(args)
  const runtimeArguments = semanticRuntimeArguments(candidates[0], supplied)
  const result = resolveSemanticInitializer(symbols, runtimeArguments, genericParameters)
  if (!result.ok) {
    // Unmarked JavaScript functions cannot carry contextual closure roles. For
    // legacy positional APIs such as Button(action, label), preserve the
    // declaration's first distinct closure ordering at runtime; duplicate
    // signatures still produce the required ambiguity error.
    const roleShapes = result.failure.candidates.map(candidate => candidate.parameters.map(parameter => parameter.kind).join("/"))
    const unmarkedClosureOverloads = supplied.length > 0
      && supplied.every(value => typeof value === "function")
      && new Set(roleShapes).size === roleShapes.length
    if (result.failure.kind === "ambiguous" && unmarkedClosureOverloads) {
      const chosen = candidates.find(candidate => result.failure.candidates.some(item => item.signature === candidate.signature))
      const chosenIndex = chosen ? candidates.indexOf(chosen) : -1
      const chosenSymbol = chosenIndex < 0 ? undefined : symbols[chosenIndex]
      const fallback = chosenSymbol ? resolveSemanticInitializer([chosenSymbol], runtimeArguments, genericParameters) : undefined
      if (fallback?.ok && chosen) {
        const normalized = fallback.resolution.arguments.map(argument => argument.value)
        const typed = normalized.map((item, index) => {
          const parameter = chosen.parameters?.[index]
          return typeof item === "function" && parameter && parameter.kind !== "binding"
            ? markMuseClosure(closureForKind(item as (...args: any[]) => any, parameter.kind as MuseClosureKind), parameter.kind)
            : item
        })
        return { initializer: chosen, args: typed }
      }
    }
    const signatures = result.failure.candidates.map(candidate => candidate.signature)
    if (result.failure.kind === "ambiguous") throw new MuseInitializerAmbiguityError(displayNameOf(target), supplied, signatures)
    throw new MuseInitializerError(displayNameOf(target), supplied, signatures)
  }
  const candidate = candidates[result.resolution.initializerIndex]
  if (!candidate) return undefined
  const normalized = result.resolution.arguments.map(argument => argument.value)
  const typed = normalized.map((item, index) => {
    const parameter = candidate.parameters?.[index]
    return typeof item === "function" && parameter && parameter.kind !== "binding"
      ? markMuseClosure(closureForKind(item as (...args: any[]) => any, parameter.kind as MuseClosureKind), parameter.kind)
      : item
  })
  return { initializer: candidate, args: typed }
}

function displayNameOf(target: unknown): string {
  return typeof target === "function" && ((target as { displayName?: string }).displayName || target.name)
    || "View"
}

function metadataOf(target: unknown): readonly InitializerMatch[] {
  return typeof target === "function" ? ((target as Partial<ViewConstructor>)[museInitializers] ?? []) : []
}

export function registerInitializers<T extends Function>(target: T, initializers: readonly InitializerMatch[]): T {
  initializerSpecializations.delete(target as unknown as object)
  initializerSpecializationEligibility.set(target as unknown as object, canSpecialize(initializers))
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
  if (!parameters) return args
  const labels = new Set(parameters.flatMap(parameter => parameter.label ? [parameter.label] : []))
  const properties = new Set(parameters.flatMap(parameter => parameter.properties ?? []))
  const carriers = args.flatMap((value, index) => {
    if (!isNamedObject(value)) return []
    const keys = Object.keys(value)
    if (keys.length === 0 || keys.some(key => !labels.has(key))) return []
    if (properties.size > 0 && keys.every(key => properties.has(key))) return []
    return [{ index, value, keys }]
  })
  if (carriers.length !== 1) {
    if (parameters.some(parameter => parameter.variadic)) return args
    const normalized = Array<unknown>(parameters.length).fill(undefined)
    const align = (parameterIndex: number, argumentIndex: number): boolean => {
      if (parameterIndex === parameters.length) return argumentIndex === args.length
      const parameter = parameters[parameterIndex]
      if (parameter.required === false && align(parameterIndex + 1, argumentIndex)) return true
      if (argumentIndex >= args.length) return false
      const value = args[argumentIndex]
      if (typeMatches(parameter, value) === false) return false
      normalized[parameterIndex] = value
      return align(parameterIndex + 1, argumentIndex + 1)
    }
    return align(0, 0) ? normalized : args
  }
  const carrier = carriers[0]
  const positional = args.filter((_, index) => index !== carrier.index)
  let positionalIndex = 0
  const normalized = parameters.map(parameter => {
    if (parameter.label && Object.prototype.hasOwnProperty.call(carrier.value, parameter.label)) return carrier.value[parameter.label]
    if (positionalIndex < positional.length) return positional[positionalIndex++]
    return undefined
  })
  return positionalIndex === positional.length ? normalized : args
}

function genericConstraint(genericParameters: string | undefined, type: string): string | undefined {
  if (!genericParameters || !/^[$A-Za-z_][A-Za-z0-9_]*$/.test(type.trim())) return undefined
  const match = new RegExp(`(?:^|,)\\s*${type.trim()}\\s*(?:=[^:,>]+)?\\s*(?::\\s*([^,>]+))?`).exec(genericParameters)
  return match?.[1]?.trim() ?? (match ? "unknown" : undefined)
}

function splitTypeAlternatives(type: string): string[] {
  const result: string[] = []
  let start = 0
  let angle = 0
  let square = 0
  let parens = 0
  for (let index = 0; index < type.length; index += 1) {
    switch (type[index]) {
      case "<": angle += 1; break
      case ">": angle = Math.max(0, angle - 1); break
      case "[": square += 1; break
      case "]": square = Math.max(0, square - 1); break
      case "(": parens += 1; break
      case ")": parens = Math.max(0, parens - 1); break
      case "|":
        if (angle === 0 && square === 0 && parens === 0) {
          result.push(type.slice(start, index).trim())
          start = index + 1
        }
        break
    }
  }
  result.push(type.slice(start).trim())
  return result.filter(Boolean)
}

function referenceValue(value: unknown): unknown {
  if (isStateRef(value) || isBinding(value)) return (value as { value: unknown }).value
  return value
}

function typeMatchesSingle(type: string, value: unknown, genericParameters?: string): boolean | undefined {
  const normalized = type.trim().replace(/\s+/g, " ").replace(/\s*\?$/, "")
  if (!normalized || normalized === "unknown" || normalized === "any") return undefined
  if (normalized === "null") return value === null
  if (normalized === "undefined" || normalized === "void") return value === undefined

  const generic = genericConstraint(genericParameters, normalized)
  if (generic) {
    if (/\bView\b/.test(generic)) return isViewNode(value) || (typeof value === "function" && !!(value as { [museView]?: true })[museView])
    return undefined
  }

  const reference = referenceValue(value)
  const stateMatch = /^(?:State|StateRef)\s*<([\s\S]+)>$/.exec(normalized)
  if (stateMatch) return isStateRef(value) && typeMatchesType(stateMatch[1], reference, genericParameters) !== false
  const bindingMatch = /^(?:Binding|BindingRef)\s*<([\s\S]+)>$/.exec(normalized)
  if (bindingMatch) return isBinding(value) && typeMatchesType(bindingMatch[1], reference, genericParameters) !== false
  const valueMatch = /^Value\s*<([\s\S]+)>$/.exec(normalized)
  if (valueMatch) {
    if (typeof value === "function") return true
    if (isStateRef(value) || isBinding(value)) return typeMatchesType(valueMatch[1], reference, genericParameters) !== false
    return typeMatchesType(valueMatch[1], value, genericParameters)
  }

  if (/^(?:some\s+)?View$/.test(normalized)) return isViewNode(value) || (typeof value === "function" && !!(value as { [museView]?: true })[museView])
  if (/^(?:Function|function)$/.test(normalized) || normalized.includes("=>")) return typeof value === "function"
  const arrayMatch = /^(?:ReadonlyArray|Array)\s*<([\s\S]+)>$/.exec(normalized) ?? /^([\s\S]+)\[\]$/.exec(normalized)
  if (arrayMatch) return Array.isArray(reference) && (reference as unknown[]).every(item => typeMatchesType(arrayMatch[1], item, genericParameters) !== false)
  if (normalized.toLowerCase() === "array") return Array.isArray(reference)
  if (normalized === "string") return typeof reference === "string"
  if (normalized === "number") return typeof reference === "number"
  if (normalized === "boolean") return typeof reference === "boolean"
  if (normalized === "object" || normalized.startsWith("Record<")) return typeof reference === "object" && reference !== null && !Array.isArray(reference) && !isViewNode(reference)
  if (/^(?:true|false)$/.test(normalized)) return value === (normalized === "true")
  if (/^(?:\"[^\"]*\"|'[^']*')$/.test(normalized)) return value === normalized.slice(1, -1)
  if (/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return value === Number(normalized)
  return undefined
}

function typeMatchesType(type: string, value: unknown, genericParameters?: string): boolean | undefined {
  const results = splitTypeAlternatives(type).map(alternative => typeMatchesSingle(alternative, value, genericParameters))
  if (results.some(result => result === true)) return true
  return results.some(result => result === undefined) ? undefined : false
}

function typeMatches(parameter: InitializerParameter, value: unknown, genericParameters?: string): boolean | undefined {
  if (value === undefined || value === null) return undefined
  if (parameter.kind === "binding") {
    if (!isBinding(value)) return false
    if (!parameter.type) return true
    if (/^(?:Binding|BindingRef)\s*</.test(parameter.type.trim())) return typeMatchesType(parameter.type, value, genericParameters)
    return typeMatchesType(parameter.type, referenceValue(value), genericParameters)
  }
  if (parameter.kind === "viewBuilder" || parameter.kind === "action") {
    return typeof value === "function"
  }
  if (!parameter.type || parameter.kind !== "value") return undefined
  const results = splitTypeAlternatives(parameter.type).map(type => typeMatchesSingle(type, value, genericParameters))
  if (results.some(result => result === true)) return true
  return results.some(result => result === undefined) ? undefined : false
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

function labelOrderScore(candidate: InitializerMatch, original: readonly unknown[]): number {
  if (!candidate.parameters) return 0
  const carrier = original.find(value => isNamedObject(value) && Object.keys(value).length > 0)
  if (!carrier || !isNamedObject(carrier)) return 0
  const labels = candidate.parameters.flatMap(parameter => parameter.label ? [parameter.label] : [])
  return Object.keys(carrier).reduce((score, key, index) => score + (labels[index] === key ? 1 : 0), 0)
}

function score(candidate: InitializerMatch, original: readonly unknown[], args: readonly unknown[], genericParameters?: string): number {
  if (!candidate.parameters) return 1
  // Labels are the first part of the language contract. A named carrier keeps
  // source order so declarations with the same label set but different call
  // syntax remain distinguishable before closure/type scoring.
  let result = 40 + labelOrderScore(candidate, original) * 1000 + (original === args ? 0 : 80) + (candidate.parameters.length === args.length ? 20 : 0)
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

function declaredParametersAccept(candidate: InitializerMatch, args: readonly unknown[], genericParameters?: string): boolean | undefined {
  if (!candidate.parameters) return undefined
  const parameters = candidate.parameters
  const required = parameters.filter(parameter => parameter.required !== false).length
  const variadic = parameters.at(-1)?.variadic === true
  if (args.length < required || (!variadic && args.length > parameters.length)) return false
  if (variadic && args.slice(parameters.length).some(value => typeof value === "function")) return false
  for (let index = 0; index < parameters.length; index += 1) {
    const value = args[index]
    if (value === undefined) continue
    if (typeMatches(parameters[index], value, genericParameters) === false) return false
  }
  return true
}

function suppliedInitializerArguments(args: readonly unknown[]): readonly unknown[] {
  return args.length === 2 && args[1] === undefined && (args[0] === null || typeof args[0] === "object")
    ? args.slice(0, -1)
    : args
}

function resolveSingleDeclaredInitializer(
  target: unknown,
  candidate: InitializerMatch,
  args: readonly unknown[],
  genericParameters?: string,
): InitializerResolution {
  const supplied = suppliedInitializerArguments(args)
  const normalized = normalizeNamedArguments(candidate, supplied)
  if (declaredParametersAccept(candidate, normalized, genericParameters) !== false) {
    const candidateScore = score(candidate, supplied, normalized, genericParameters)
    if (Number.isFinite(candidateScore)) {
      const typed = normalized.map((item, index) => {
        const parameter = candidate.parameters?.[index]
        return typeof item === "function" && parameter && parameter.kind !== "binding"
          ? markMuseClosure(closureForKind(item as (...args: any[]) => any, parameter.kind as MuseClosureKind), parameter.kind)
          : item
      })
      return { initializer: candidate, args: typed }
    }
  }
  throw new MuseInitializerError(displayNameOf(target), supplied, [candidate.signature])
}

export function resolveInitializer(target: unknown, args: readonly unknown[]): InitializerResolution {
  const supplied = suppliedInitializerArguments(args)
  const cacheTarget = typeof target === "function" ? target as unknown as object : undefined
  const cacheKey = cacheTarget && initializerSpecializationEligibility.get(cacheTarget) ? specializationKey(supplied) : undefined
  const cached = cacheKey && cacheTarget ? initializerSpecializations.get(cacheTarget)?.get(cacheKey) : undefined
  if (cached) {
    const genericParameters = typeof target === "function" ? (target as Partial<ViewConstructor>).viewType?.genericParameters : undefined
    const normalized = normalizeNamedArguments(cached, supplied)
    if (declaredParametersAccept(cached, normalized, genericParameters) !== false) {
      const typed = cached.parameters
        ? normalized.map((item, index) => {
          const parameter = cached.parameters?.[index]
          return typeof item === "function" && parameter && parameter.kind !== "binding"
            ? markMuseClosure(closureForKind(item as (...args: any[]) => any, parameter.kind as MuseClosureKind), parameter.kind)
            : item
        })
        : normalized
      return { initializer: cached, args: typed }
    }
  }
  const candidates = metadataOf(target)
  const genericParameters = typeof target === "function" ? (target as Partial<ViewConstructor>).viewType?.genericParameters : undefined
  const shared = sharedRuntimeResolution(target, candidates, supplied)
  if (shared) return shared
  if (candidates.length === 1 && candidates[0].parameters) {
    return resolveSingleDeclaredInitializer(target, candidates[0], supplied, genericParameters)
  }
  const matches = candidates.map(candidate => {
    const normalized = normalizeNamedArguments(candidate, supplied)
    const declared = declaredParametersAccept(candidate, normalized, genericParameters)
    // Parameter metadata is the canonical resolver contract. Predicates remain
    // available for legacy variadic initializers that intentionally have no
    // finite parameter list.
    if (declared === false || (declared === undefined && !candidate.accepts(normalized))) return null
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
    .sort((left, right) => right.score - left.score)
  const match = matches[0]
  if (!match) throw new MuseInitializerError(displayNameOf(target), supplied, candidates.map(candidate => candidate.signature))
  const tied = matches.filter(candidate => candidate.score === match.score)
  if (tied.length > 1) {
    throw new MuseInitializerAmbiguityError(
      displayNameOf(target),
      supplied,
      tied.map(candidate => candidate.candidate.signature),
    )
  }
  if (cacheKey && cacheTarget && canSpecialize(candidates)) {
    initializerSpecializationEligibility.set(cacheTarget, true)
    const cache = initializerSpecializations.get(cacheTarget) ?? new Map<string, InitializerMatch>()
    cache.set(cacheKey, match.candidate)
    initializerSpecializations.set(cacheTarget, cache)
  }
  return { initializer: match.candidate, args: match.args }
}

export function assertInitializerCall(target: unknown, args: readonly unknown[]): void {
  if (metadataOf(target).length > 0) resolveInitializer(target, args)
}

/** Statically valid result of a declared @ViewBuilder closure. */
export type ViewBuilderContent = ModifiableViewNode | readonly ViewBuilderContent[] | null | undefined | false
export type ViewBuilderClosure = () => ViewBuilderContent
/** Runtime normalization input retained for renderer and compatibility boundaries. */
export type ViewBuilderResult = ViewValue | readonly ViewBuilderResult[] | false

export const viewBuilderSemanticSymbol: SemanticBuilderTypeSymbol = Object.freeze({
  kind: "builder",
  name: "ViewBuilder",
  contentType: "View",
  operations: ["buildBlock", "buildOptional", "buildEither", "buildArray"] as const,
})

export function flattenViewBuilder(value: ViewBuilderResult): ViewValue[] {
  if (value === null || value === undefined || value === false) return []
  if (Array.isArray(value)) return value.flatMap(item => flattenViewBuilder(item))
  return [value]
}

export const ViewBuilder = Object.freeze({
  semanticSymbol: viewBuilderSemanticSymbol,
  buildBlock: (...values: ViewBuilderResult[]) => values.flatMap(flattenViewBuilder),
  buildOptional: (value: ViewBuilderResult | null | undefined) => flattenViewBuilder(value as ViewBuilderResult),
  buildEither: (first: ViewBuilderResult, second?: ViewBuilderResult) => flattenViewBuilder(second === undefined ? first : second),
  buildArray: (values: readonly ViewBuilderResult[]) => values.flatMap(flattenViewBuilder),
})

export function resolveBuilderClosure(closure: () => ViewBuilderResult): ViewValue[] {
  return ViewBuilder.buildBlock(markMuseClosure(closure, "viewBuilder")())
}

export class ViewType<Props extends object = Record<string, unknown>> {
  readonly name: string
  readonly genericParameters?: string
  readonly fields: readonly ViewFieldDefinition[]
  readonly definition: ViewDefinition<Props>
  readonly initializers: readonly InitializerMatch[]
  /** Canonical semantic symbol consumed by compiler/IDE/runtime adapters. */
  readonly semanticSymbol: SemanticViewTypeSymbol
  private target: unknown

  constructor(name: string, definition: ViewDefinition<Props>) {
    this.name = name
    this.genericParameters = definition.genericParameters
    this.fields = definition.fields ?? []
    this.definition = definition
    this.initializers = definition.initializers
    this.semanticSymbol = {
      kind: "view",
      name,
      qualifiedName: name,
      genericParameters: definition.genericParameters,
      fields: this.fields,
      initializers: this.initializers.flatMap((item, index) => {
        const symbol = semanticInitializerSymbol(item, index)
        return symbol ? [symbol] : []
      }),
    }
  }

  bind(target: unknown): void { this.target = target }

  createNode(args: readonly unknown[]): ModifiableViewNode {
    if (!this.target) throw new TypeError(`View type ${this.name} is not bound to a constructor`)
    const resolution = resolveInitializer(this.target, args)
    return this.createNodeFromResolution(resolution)
  }

  /**
   * Materialize a compiler-selected declaration initializer without scanning
   * the overload set again. The compiler only emits this for an unambiguous
   * declaration-defined call; the guard keeps hand-written callers safe.
   */
  createNodeSpecialized(initializerIndex: number, args: readonly unknown[]): ModifiableViewNode {
    if (!this.target) throw new TypeError(`View type ${this.name} is not bound to a constructor`)
    const candidate = this.initializers[initializerIndex]
    if (!candidate?.parameters) return this.createNode(args)
    return this.createNodeFromResolution(resolveSingleDeclaredInitializer(this.target, candidate, args, this.genericParameters))
  }

  private createNodeFromResolution(resolution: InitializerResolution): ModifiableViewNode {
    const props = (resolution.initializer.build?.(resolution.args) ?? {}) as Props
    validateGenericViewBuilders(this.target, resolution, props as Record<string, unknown>)
    if (this.definition.intrinsic) {
      const value = this.definition.body(props)
      return isViewNode(value) ? decorate(value) : viewFragment([value as ViewGraphChild])
    }
    return viewHost(this.name, this, props as Record<string, unknown>, next => this.definition.body(next as Props), this.definition.state as ((props: Record<string, unknown>) => Record<string, unknown>) | undefined)
  }
}

export function defineView<
  Props extends object = Record<string, unknown>,
  Args extends readonly unknown[] = readonly unknown[],
>(name: string, definition: ViewDefinition<Props>): ViewConstructor<Props, Args> {
  const viewType = new ViewType(name, definition)
  const Type = ((...args: unknown[]) => viewType.createNode(args)) as unknown as ViewConstructor<Props, Args>
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
  value: (required = true, label?: string, properties?: readonly string[], type?: string, variadic = false): InitializerParameter => ({
    kind: "value",
    required,
    label,
    properties,
    type,
    ...(variadic ? { variadic: true } : {}),
  }),
  binding: (required = true, label?: string, type?: string): InitializerParameter => ({ kind: "binding", required, label, type }),
  viewBuilder: (required = true, label?: string, type?: string): InitializerParameter => ({ kind: "viewBuilder", required, label, type }),
  action: (required = true, label?: string, type?: string): InitializerParameter => ({ kind: "action", required, label, type }),
})
