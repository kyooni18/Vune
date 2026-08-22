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
import {
  collectStateReads,
  classNameOf,
  edgeInsetsFromCss,
  renderViewNode,
  stateVersion,
  subscribeState,
  zeroGeometry,
  type GeometryProxy,
  type ModifiableViewNode,
  type MuseRenderer,
  type StateRef,
  type ViewGraphValue,
  type ViewHostNode,
  type ViewModifierNode,
} from "@muse/core"

function cssLength(value: unknown): string | number | undefined {
  return typeof value === "number" ? `${value}px` : typeof value === "string" ? value : undefined
}

function modifierProps(modifier: ViewModifierNode): Record<string, unknown> {
  const [value] = modifier.arguments
  switch (modifier.name) {
    case "padding": return { style: { padding: cssLength(value) } }
    case "margin": return { style: { margin: cssLength(value) } }
    case "gap": return { style: { gap: cssLength(value) } }
    case "font": return { style: { font: value } }
    case "fontSize": return { style: { fontSize: cssLength(value) } }
    case "bold": return { style: { fontWeight: 600 } }
    case "foreground": return { style: { color: value } }
    case "background": return { style: { background: value } }
    case "style": return { style: value }
    case "className": return { className: classNameOf(value) }
    case "withProps": return value && typeof value === "object" ? value as Record<string, unknown> : {}
    case "keyed": return { key: value }
    case "elementRef": return { ref: value }
    case "frame": {
      const frame = value && typeof value === "object" ? value as Record<string, unknown> : {}
      return { style: {
        boxSizing: "border-box",
        width: cssLength(frame.width),
        height: cssLength(frame.height),
        minWidth: cssLength(frame.minWidth),
        maxWidth: frame.maxWidth === "infinity" ? "100%" : cssLength(frame.maxWidth),
        minHeight: cssLength(frame.minHeight),
        maxHeight: frame.maxHeight === "infinity" ? "100%" : cssLength(frame.maxHeight),
      } }
    }
    default: return {}
  }
}

function applyProps(content: ReactNode, extra: Record<string, unknown>): ReactNode {
  if (content && typeof content === "object" && "type" in content && "props" in content) {
    const element = content as Parameters<typeof cloneElement>[0]
    const current = (element.props ?? {}) as Record<string, unknown>
    const currentStyle = current.style && typeof current.style === "object" ? current.style as CSSProperties : {}
    const nextStyle = extra.style && typeof extra.style === "object" ? extra.style as CSSProperties : undefined
    const currentClass = typeof current.className === "string" ? current.className : ""
    const nextClass = typeof extra.className === "string" ? extra.className : ""
    const className = [currentClass, nextClass].filter(Boolean).join(" ")
    const props = {
      ...extra,
      ...(className ? { className } : {}),
      ...( "style" in extra ? { style: { ...currentStyle, ...nextStyle } } : {}),
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
  for (const [key, value] of Object.entries(next)) {
    if (typeof value === "function" && /^on[a-z]/.test(key)) {
      delete next[key]
      next[`on${key[2].toUpperCase()}${key.slice(3)}`] = value
    }
  }
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
  return createElement("div", { ref: host, "data-muse": "GeometryReader", style: { boxSizing: "border-box", width: "100%" } }, value)
}

function renderStatefulView({ node }: { node: ViewHostNode }): ReactNode {
  const [state] = useState(() => node.state?.(node.props) ?? {})
  const resolvedProps = { ...node.props, ...state }
  const value = useReactiveGraph(() => node.render(resolvedProps))
  return createElement(RenderValue, { value })
}

const renderer: MuseRenderer<ReactNode> = {
  element(type, props, ...children) {
    return createElement(type as any, normalizeElementProps(props) as any, ...children)
  },
  fragment(children) {
    return createElement(Fragment, null, ...children)
  },
  value(value) {
    return value as ReactNode
  },
  modifier(content, modifier) {
    return applyProps(content, modifierProps(modifier))
  },
  view(node) {
    return createElement(renderStatefulView, { node })
  },
  geometry(_node, render) {
    return createElement(GeometryHost, { render })
  },
}

function RenderValue({ value }: { value: ViewGraphValue }): ReactNode {
  return renderViewNode(value, renderer)
}

export function render(value: ViewGraphValue): ReactNode {
  return renderViewNode(value, renderer)
}

export function MuseView<Props extends Record<string, unknown> = Record<string, unknown>>({
  body,
  props,
}: {
  body: (props: Props) => ViewGraphValue
  props: Props
}): ReactNode {
  const value = useReactiveGraph(() => body(props))
  return createElement(RenderValue, { value })
}

export interface StatefulViewDefinition<State extends object, Props extends object = Record<string, unknown>> {
  readonly state: (props: Props) => State
  readonly body: (state: State, props: Props) => ViewGraphValue
}

function StatefulMuseView<State extends object, Props extends object>({
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
  return (props: Props) => createElement(StatefulMuseView as any, { definition, props })
}

export function view<State extends object, Props extends object = Record<string, unknown>>(
  definition: StatefulViewDefinition<State, Props>,
): (props: Props) => ReactNode
export function view<Props extends Record<string, unknown> = Record<string, unknown>>(
  body: (props: Props) => ViewGraphValue,
): (props: Props) => ReactNode
export function view(input: ((props: Record<string, unknown>) => ViewGraphValue) | StatefulViewDefinition<object, Record<string, unknown>>): (props: Record<string, unknown>) => ReactNode {
  if (typeof input === "function") return (props: Record<string, unknown>) => createElement(MuseView as any, { body: input, props })
  return (props: Record<string, unknown>) => createElement(StatefulMuseView as any, { definition: input, props })
}

export function createRenderer(): MuseRenderer<ReactNode> {
  return renderer
}

export type ReactView = ModifiableViewNode
