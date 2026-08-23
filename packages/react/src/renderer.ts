import {
  Fragment,
  cloneElement,
  createElement,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react"
import { createRoot, hydrateRoot, type Root } from "react-dom/client"
import {
  collectStateReads,
  classNameOf,
  edgeInsetsFromCss,
  frameStyle,
  isForeignComponent,
  layoutLength,
  renderViewNode,
  stateVersion,
  subscribeState,
  viewIdentityKey,
  zeroGeometry,
  type GeometryProxy,
  type ModifiableViewNode,
  type VuneRenderer,
  type StateRef,
  type ViewGraphValue,
  type ViewHostNode,
  type ViewModifierNode,
} from "@vune-ui/core"

function modifierProps(modifier: ViewModifierNode): Record<string, unknown> {
  const [value] = modifier.arguments
  switch (modifier.name) {
    case "padding": return { style: { padding: layoutLength(value) } }
    case "margin": return { style: { margin: layoutLength(value) } }
    case "gap": return { style: { gap: layoutLength(value) } }
    case "font": return { style: { font: value } }
    case "fontSize": return { style: { fontSize: layoutLength(value) } }
    case "bold": return { style: { fontWeight: 600 } }
    case "foreground": return { style: { color: value } }
    case "background": return { style: { background: value } }
    case "style": return { style: value }
    case "className": return { className: classNameOf(value) }
    case "withProps": return value && typeof value === "object" ? value as Record<string, unknown> : {}
    case "keyed": return { key: value }
    case "elementRef": return { ref: value }
    case "frame": {
      return { style: frameStyle(value && typeof value === "object" ? value : {}) }
    }
    default: return {}
  }
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
    const props = {
      ...appliedExtra,
      ...(className ? { className } : {}),
      ...( "style" in appliedExtra ? { style: { ...currentStyle, ...nextStyle } } : {}),
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

function useReactiveGraph<T>(compute: () => T): T {
  const dependencies = new Set<StateRef<unknown>>()
  const value = collectStateReads(compute, dependency => dependencies.add(dependency))
  useSyncExternalStore(
    listener => {
      const unsubscribers = [...dependencies].map(dependency => subscribeState(dependency, listener))
      return () => unsubscribers.forEach(unsubscribe => unsubscribe())
    },
    () => [...dependencies].reduce((version, dependency) => version + stateVersion(dependency), 0),
    () => [...dependencies].reduce((version, dependency) => version + stateVersion(dependency), 0),
  )
  return value
}

function geometryFromElement(element: Element): GeometryProxy {
  const rect = element.getBoundingClientRect()
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
  if (!view?.getComputedStyle || !document.body) return { frame, size: { width: rect.width, height: rect.height }, safeAreaInsets: zeroGeometry.safeAreaInsets }
  const probe = document.createElement("div")
  probe.style.cssText = "position:fixed;inset:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)"
  document.body.appendChild(probe)
  const style = view.getComputedStyle(probe)
  const safeAreaInsets = edgeInsetsFromCss({ top: style.paddingTop, right: style.paddingRight, bottom: style.paddingBottom, left: style.paddingLeft })
  probe.remove()
  return { frame, size: { width: rect.width, height: rect.height }, safeAreaInsets }
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
  const value = useReactiveGraph(() => render(geometry))
  useEffect(() => {
    const element = host.current
    if (!element) return undefined
    const update = () => {
      const next = geometryFromElement(element)
      setGeometry(previous => sameGeometry(previous, next) ? previous : next)
    }
    update()
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update)
    observer?.observe(element)
    window.addEventListener("resize", update)
    return () => {
      observer?.disconnect()
      window.removeEventListener("resize", update)
    }
  }, [])
  return createElement("div", { ref: host, "data-vune": "GeometryReader", style: { boxSizing: "border-box", width: "100%" } }, value)
}

function renderStatefulView({ node, ...forwardedProps }: { node: ViewHostNode } & Record<string, unknown>): ReactNode {
  const [state] = useState(() => node.state?.(node.props) ?? {})
  const resolvedProps = { ...node.props, ...state }
  const value = useReactiveGraph(() => node.render(resolvedProps))
  return applyProps(renderViewNode(value, renderer), forwardedProps)
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
  const resolved = useReactiveGraph(() => body ? body() : value ?? null)
  return renderViewNode(resolved, renderer)
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
  const value = useReactiveGraph(() => definition.body(state, props))
  return createElement(RenderValue, { value })
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
