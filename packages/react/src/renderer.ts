import {
  Fragment,
  cloneElement,
  createElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react"
import { createRoot, hydrateRoot, type Root } from "react-dom/client"
import {
  animationCSSStyle,
  collectStateReads,
  currentRenderTransaction,
  classNameOf,
  edgeInsetsFromCss,
  frameStyle,
  isForeignComponent,
  layoutLength,
  renderViewNode,
  stateTransaction,
  stateVersion,
  subscribeState,
  swiftUIAnimatableModifierNames,
  viewIdentityKey,
  withRenderTransaction,
  zeroGeometry,
  type Animation,
  type CompiledTemplateValue,
  type GeometryProxy,
  type ModifiableViewNode,
  type VuneRenderer,
  type StateRef,
  type Transaction,
  type ViewGraphValue,
  type ViewHostNode,
  type ViewModifierNode,
} from "@vune-ui/core"

function modifierProps(modifier: ViewModifierNode): Record<string, unknown> {
  const [value] = modifier.arguments
  let result: Record<string, unknown>
  switch (modifier.name) {
    case "padding": result = { style: { padding: layoutLength(value) } }; break
    case "margin": result = { style: { margin: layoutLength(value) } }; break
    case "gap": result = { style: { gap: layoutLength(value) } }; break
    case "font": result = { style: { font: value } }; break
    case "fontSize": result = { style: { fontSize: layoutLength(value) } }; break
    case "bold": result = { style: { fontWeight: value === false ? "normal" : 600 } }; break
    case "foreground":
    case "foregroundStyle": result = { style: { color: value } }; break
    case "background": result = { style: { background: value } }; break
    case "opacity": {
      const opacity = typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1
      result = { style: { opacity } }
      break
    }
    case "scaleEffect": {
      const scale = typeof value === "number" ? `${value}`
        : value && typeof value === "object" ? `${Number((value as { x?: unknown; width?: unknown }).x ?? (value as { width?: unknown }).width ?? 1)}, ${Number((value as { y?: unknown; height?: unknown }).y ?? (value as { height?: unknown }).height ?? 1)}` : "1"
      result = { style: { transform: `scale(${scale})` } }
      break
    }
    case "rotationEffect": result = { style: { transform: `rotate(${typeof value === "number" && Number.isFinite(value) ? value : 0}deg)` } }; break
    case "offset": {
      const second = modifier.arguments[1]
      let x = 0
      let y = 0
      if (typeof value === "number") { x = value; y = typeof second === "number" ? second : 0 }
      else if (value && typeof value === "object") {
        const point = value as { x?: unknown; y?: unknown; width?: unknown; height?: unknown }
        x = Number(point.x ?? point.width ?? 0); y = Number(point.y ?? point.height ?? 0)
      }
      result = { style: { transform: `translate(${Number.isFinite(x) ? x : 0}px, ${Number.isFinite(y) ? y : 0}px)` } }
      break
    }
    case "mask": result = { style: modifier.props && typeof modifier.props === "object" && "style" in modifier.props ? (modifier.props as { style?: unknown }).style : {} }; break
    case "style": result = { style: value }; break
    case "className": result = { className: classNameOf(value) }; break
    case "withProps": result = value && typeof value === "object" ? value as Record<string, unknown> : {}; break
    case "keyed": result = { key: value }; break
    case "elementRef": result = { ref: value }; break
    case "frame": result = { style: frameStyle(value && typeof value === "object" ? value : {}) }; break
    case "animation": result = { style: animationCSSStyle(value as Animation | null) ?? {} }; break
    default: result = {}
  }
  const transaction = currentRenderTransaction()
  if (swiftUIAnimatableModifierNames.has(modifier.name) && transaction.animation && !transaction.disablesAnimations) {
    const animationStyle = animationCSSStyle(transaction.animation)
    if (animationStyle) result = { ...result, style: { ...(result.style && typeof result.style === "object" ? result.style : {}), ...animationStyle } }
  }
  return result
}

function nativeElementProps(props: Record<string, unknown>): Record<string, unknown> {
  try {
    const normalized: Record<string, unknown> = {}
    for (const key of Reflect.ownKeys(props)) {
      if (typeof key !== "string") continue
      const descriptor = Object.getOwnPropertyDescriptor(props, key)
      if (!descriptor || !("value" in descriptor)) continue
      const value = descriptor.value
      const primitive = value === undefined || value === null || typeof value === "string" || typeof value === "boolean"
        || (typeof value === "number" && Number.isFinite(value))
      if (primitive
        || (key === "style" && typeof value === "object" && value !== null)
        || (key === "ref" && (typeof value === "object" || typeof value === "function"))
        || (/^on[A-Za-z]/.test(key) && typeof value === "function")) {
        Object.defineProperty(normalized, key, { ...descriptor, configurable: true })
      }
    }
    return normalized
  } catch {
    return {}
  }
}

function applyProps(content: ReactNode, extra: Record<string, unknown>): ReactNode {
  if (content && typeof content === "object" && "type" in content && "props" in content) {
    const element = content as Parameters<typeof cloneElement>[0]
    const appliedExtra = typeof element.type === "string" && !element.type.includes("-") ? nativeElementProps(extra) : extra
    const current = (element.props ?? {}) as Record<string, unknown>
    const currentStyle = current.style && typeof current.style === "object" ? current.style as CSSProperties : {}
    const nextStyle = appliedExtra.style && typeof appliedExtra.style === "object" ? appliedExtra.style as CSSProperties : undefined
    const currentClass = typeof current.className === "string" ? current.className : ""
    const nextClass = typeof appliedExtra.className === "string" ? appliedExtra.className : ""
    const className = [currentClass, nextClass].filter(Boolean).join(" ")
    const composedStyle = nextStyle ? { ...currentStyle, ...nextStyle } : currentStyle
    if (nextStyle?.transform && currentStyle.transform) composedStyle.transform = `${currentStyle.transform} ${nextStyle.transform}`
    const props = {
      ...appliedExtra,
      ...(className ? { className } : {}),
      ...( "style" in appliedExtra ? { style: composedStyle } : {}),
    }
    return cloneElement(element, props)
  }
  return createElement(Fragment, null, content)
}

function normalizeElementProps(props: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!props) return null
  const next = { ...props }
  if ("class" in next && !("className" in next)) {
    next.className = next.class
    delete next.class
  }
  if ("for" in next && !("htmlFor" in next)) {
    next.htmlFor = next.for
    delete next.for
  }
  if (typeof next.style === "string") {
    next.style = Object.fromEntries(next.style.split(";").flatMap(declaration => {
      const colon = declaration.indexOf(":")
      if (colon < 0) return []
      const rawName = declaration.slice(0, colon).trim()
      const value = declaration.slice(colon + 1).trim()
      if (!rawName || !value) return []
      const name = rawName.startsWith("--") ? rawName : rawName.replace(/-([a-z])/g, (_match, character: string) => character.toUpperCase())
      return [[name, value]]
    }))
  }
  for (const [key, value] of Object.entries(next)) {
    if (typeof value === "function" && /^on[a-z]/.test(key)) {
      delete next[key]
      next[`on${key[2].toUpperCase()}${key.slice(3)}`] = value
    }
  }
  return next
}

function normalizeForeignProps(
  type: Parameters<NonNullable<VuneRenderer<ReactNode>["element"]>>[0],
  props: Record<string, unknown> | null,
  children: ReactNode[],
): Record<string, unknown> | null {
  if (!isForeignComponent(type)) return normalizeElementProps(props)
  const next = normalizeElementProps({ ...type.props, ...type.events, ...(props ?? {}) }) ?? {}
  if (type.key !== undefined) next.key = type.key
  for (const [name, slot] of Object.entries(type.slots)) {
    next[name] = (...args: unknown[]) => renderViewNode(typeof slot === "function" ? slot(...args) : slot, renderer)
  }
  if (children.length > 0 && !("children" in next)) next.children = children
  return next
}

interface ReactiveGraph<T> {
  readonly value: T
  readonly transaction?: Transaction
}

let nextStateDependencyId = 1
const stateDependencyIds = new WeakMap<StateRef<unknown>, number>()

function stateDependencyId(state: StateRef<unknown>): number {
  let id = stateDependencyIds.get(state)
  if (id === undefined) {
    id = nextStateDependencyId++
    stateDependencyIds.set(state, id)
  }
  return id
}

function useReactiveGraph<T>(
  compute: () => T,
  staticDependencies?: () => readonly StateRef<unknown>[],
  staticDependenciesComplete = false,
): ReactiveGraph<T> {
  const previousVersions = useRef(new Map<StateRef<unknown>, number>())
  let transaction: Transaction | undefined
  for (const [dependency, previousVersion] of previousVersions.current) {
    if (stateVersion(dependency) === previousVersion) continue
    const candidate = stateTransaction(dependency)
    if (!transaction || candidate.animation || candidate.disablesAnimations) transaction = candidate
  }
  const declaredDependencies = staticDependencies?.()
  const dependencies = new Set<StateRef<unknown>>(declaredDependencies ?? [])
  const value = withRenderTransaction(transaction, () => declaredDependencies && staticDependenciesComplete
    ? compute()
    : collectStateReads(compute, dependency => dependencies.add(dependency)))
  const dependencyList = [...dependencies]
  const nextVersions = new Map<StateRef<unknown>, number>()
  for (const dependency of dependencyList) nextVersions.set(dependency, stateVersion(dependency))
  previousVersions.current = nextVersions
  // Subscribe keyed by the dependency-set identity so useSyncExternalStore
  // only re-subscribes when the set actually changes instead of every commit.
  const dependencyKey = dependencyList.map(stateDependencyId).sort((left, right) => left - right).join(",")
  const subscribe = useMemo(
    () => (listener: () => void) => {
      const unsubscribers = dependencyList.map(dependency => subscribeState(dependency, listener))
      return () => unsubscribers.forEach(unsubscribe => unsubscribe())
    },
    // The dependency list is rebuilt every render, but this key changes only
    // when the actual set changes.
    [dependencyKey],
  )
  const getSnapshot = useMemo(
    () => () => {
      let version = 0
      for (const dependency of dependencyList) version += stateVersion(dependency)
      return version
    },
    [dependencyKey],
  )
  useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  )
  return { value, transaction }
}

function geometryFromElement(element: Element): GeometryProxy {
  let rect: DOMRect
  try { rect = element.getBoundingClientRect() } catch { return zeroGeometry }
  const frame = {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
  }
  const document = element.ownerDocument
  const view = document.defaultView
  const fallback = { frame, size: { width: rect.width, height: rect.height }, safeAreaInsets: zeroGeometry.safeAreaInsets }
  if (!view?.getComputedStyle || !document.body) return fallback
  const probe = document.createElement("div")
  probe.style.cssText = "position:fixed;inset:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)"
  try {
    document.body.appendChild(probe)
    const style = view.getComputedStyle(probe)
    const safeAreaInsets = edgeInsetsFromCss({ top: style.paddingTop, right: style.paddingRight, bottom: style.paddingBottom, left: style.paddingLeft })
    return { frame, size: { width: rect.width, height: rect.height }, safeAreaInsets }
  } catch {
    // Geometry is still useful when CSSOM access is unavailable (sandboxed or
    // synthetic documents). Safe-area measurement is optional, not fatal.
    return fallback
  } finally {
    try { probe.remove() } catch { /* detached/synthetic DOM cleanup is best-effort */ }
  }
}

function sameGeometry(left: GeometryProxy, right: GeometryProxy): boolean {
  return left.frame.x === right.frame.x
    && left.frame.y === right.frame.y
    && left.frame.width === right.frame.width
    && left.frame.height === right.frame.height
    && left.safeAreaInsets.top === right.safeAreaInsets.top
    && left.safeAreaInsets.right === right.safeAreaInsets.right
    && left.safeAreaInsets.bottom === right.safeAreaInsets.bottom
    && left.safeAreaInsets.left === right.safeAreaInsets.left
}

function GeometryHost({ render }: { render: (geometry: GeometryProxy) => ReactNode }): ReactNode {
  const host = useRef<HTMLDivElement | null>(null)
  const [geometry, setGeometry] = useState<GeometryProxy>(zeroGeometry)
  const reactive = useReactiveGraph(() => render(geometry))
  useEffect(() => {
    const element = host.current
    if (!element) return undefined
    const update = () => {
      const next = geometryFromElement(element)
      setGeometry(previous => sameGeometry(previous, next) ? previous : next)
    }
    update()
    let observer: ResizeObserver | undefined
    try {
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(update)
        observer.observe(element)
      }
    } catch {
      try { observer?.disconnect() } catch { /* broken observers are already inert */ }
      observer = undefined
    }
    const view = element.ownerDocument.defaultView
    try { view?.addEventListener("resize", update) } catch { /* synthetic window: initial measurement is still valid */ }
    return () => {
      try { observer?.disconnect() } catch { /* best-effort cleanup */ }
      try { view?.removeEventListener("resize", update) } catch { /* best-effort cleanup */ }
    }
  }, [])
  return createElement("div", { ref: host, "data-vune": "GeometryReader", style: { boxSizing: "border-box", width: "100%" } }, reactive.value)
}

function renderStatefulView({ node, ...forwardedProps }: { node: ViewHostNode } & Record<string, unknown>): ReactNode {
  const [state] = useState(() => node.state?.(node.props) ?? {})
  const resolvedProps = { ...node.props, ...state }
  const reactive = useReactiveGraph(
    () => node.render(resolvedProps),
    node.dependencies ? () => node.dependencies!(resolvedProps) : undefined,
    node.dependenciesComplete === true,
  )
  return applyProps(withRenderTransaction(reactive.transaction, () => renderViewNode(reactive.value, renderer)), forwardedProps)
}

type ReactTemplateFactory = (renderSlot: (index: number) => ReactNode) => ReactNode
const reactTemplateFactories = new WeakMap<object, ReactTemplateFactory>()

function compileReactTemplate(value: CompiledTemplateValue): ReactTemplateFactory {
  if (value !== null && typeof value === "object") {
    if (value.kind === "slot") {
      const index = value.index
      return renderSlot => renderSlot(index)
    }
    if (value.kind === "fragment") {
      const children = value.children.map(compileReactTemplate)
      return renderSlot => createElement(Fragment, null, ...children.map(child => child(renderSlot)))
    }
    if (value.kind === "element") {
      const type = value.type
      const props = value.props as any
      const children = value.children.map(compileReactTemplate)
      return renderSlot => createElement(type, props, ...children.map(child => child(renderSlot)))
    }
  }
  const staticValue = value === null || value === undefined || value === false || value === true ? null : value as ReactNode
  return () => staticValue
}

const renderer: VuneRenderer<ReactNode> = {
  element(type, props, ...children) {
    const component = isForeignComponent(type) ? type.component : type
    return createElement(component as any, normalizeForeignProps(type, props, children) as any, ...children)
  },
  fragment(children) {
    return createElement(Fragment, null, ...children)
  },
  value(value) {
    return value as ReactNode
  },
  template(node, renderSlot) {
    let factory = reactTemplateFactories.get(node.template)
    if (!factory) {
      factory = compileReactTemplate(node.template.root)
      reactTemplateFactories.set(node.template, factory)
    }
    return factory(renderSlot)
  },
  modifier(content, modifier) {
    if (modifier.name === "frame") {
      return createElement("div", modifierProps(modifier), content)
    }
    return applyProps(content, modifierProps(modifier))
  },
  view(node, _render, identity) {
    return createElement(renderStatefulView, { key: viewIdentityKey(identity), node })
  },
  geometry(_node, render) {
    return createElement(GeometryHost, { render })
  },
}

function RenderValue({ value, body }: { value?: ViewGraphValue; body?: () => ViewGraphValue }): ReactNode {
  const reactive = useReactiveGraph(() => body ? body() : value ?? null)
  return withRenderTransaction(reactive.transaction, () => renderViewNode(reactive.value, renderer))
}

export function render(value: ViewGraphValue): ReactNode {
  return renderViewNode(value, renderer)
}

/** Subscribe a React component to a Vune State without making State a React primitive. */
export function useVuneState<T>(state: StateRef<T>): T {
  useSyncExternalStore(
    listener => subscribeState(state, listener),
    () => stateVersion(state),
    () => stateVersion(state),
  )
  return state.value
}

export interface VuneViewProps<Props extends Record<string, unknown> = Record<string, unknown>> {
  readonly value?: ViewGraphValue
  readonly render?: () => ViewGraphValue
  /** Compatibility graph factory used by the existing `view()` adapter. */
  readonly body?: (props: Props) => ViewGraphValue
  readonly props?: Props
}

export function VuneView<Props extends Record<string, unknown> = Record<string, unknown>>({ value, render: renderBody, body, props }: VuneViewProps<Props>): ReactNode {
  const factory = renderBody ?? (body ? () => body(props ?? {} as Props) : undefined)
  return createElement(RenderValue, { value, body: factory })
}

/** Wrap a graph factory as a React component, retaining React props at the bridge. */
export function createReactView<Props extends Record<string, unknown> = Record<string, unknown>>(
  body: (props: Props) => ViewGraphValue,
): (props: Props) => ReactNode {
  return (props: Props) => createElement(VuneView<Props>, { body, props })
}

export interface StatefulViewDefinition<State extends object, Props extends object = Record<string, unknown>> {
  readonly state: (props: Props) => State
  /** Optional compiler-proven State dependencies for the body. */
  readonly dependencies?: (state: State, props: Props) => readonly StateRef<unknown>[]
  /** True only for compiler-proven exhaustive dependency lists. */
  readonly dependenciesComplete?: boolean
  readonly body: (state: State, props: Props) => ViewGraphValue
}

function StatefulVuneView<State extends object, Props extends object>({
  definition,
  props,
}: {
  definition: StatefulViewDefinition<State, Props>
  props: Props
}): ReactNode {
  const [state] = useState(() => definition.state(props))
  const reactive = useReactiveGraph(
    () => definition.body(state, props),
    definition.dependencies ? () => definition.dependencies!(state, props) : undefined,
    definition.dependenciesComplete === true,
  )
  return withRenderTransaction(reactive.transaction, () => renderViewNode(reactive.value, renderer))
}

export function statefulView<State extends object, Props extends object = Record<string, unknown>>(
  definition: StatefulViewDefinition<State, Props>,
): (props: Props) => ReactNode {
  return (props: Props) => createElement(StatefulVuneView as any, { definition, props })
}

export function view<State extends object, Props extends object = Record<string, unknown>>(
  definition: StatefulViewDefinition<State, Props>,
): (props: Props) => ReactNode
export function view<Props extends Record<string, unknown> = Record<string, unknown>>(
  body: (props: Props) => ViewGraphValue,
): (props: Props) => ReactNode
export function view(input: ((props: Record<string, unknown>) => ViewGraphValue) | StatefulViewDefinition<object, Record<string, unknown>>): (props: Record<string, unknown>) => ReactNode {
  if (typeof input === "function") return createReactView(input)
  return (props: Record<string, unknown>) => createElement(StatefulVuneView as any, { definition: input, props })
}

export interface ReactMountOptions {
  readonly hydrate?: boolean
}

/** Mount a graph into a React-managed DOM root, optionally hydrating SSR markup. */
export function mount(value: ViewGraphValue, target: Element, options: ReactMountOptions = {}): () => void {
  const element = createElement(VuneView, { value })
  let root: Root
  if (options.hydrate) {
    root = hydrateRoot(target, element)
  } else {
    root = createRoot(target)
    root.render(element)
  }
  return () => root.unmount()
}

export function createRenderer(): VuneRenderer<ReactNode> {
  return renderer
}

export type ReactView = ModifiableViewNode
