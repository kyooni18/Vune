import {
  collectStateReads,
  edgeInsetsFromCss,
  frameStyle,
  isForeignComponent,
  renderViewNode,
  subscribeState,
  viewIdentityKey,
  classNameOf,
  zeroGeometry,
  type MuseRenderer,
  type GeometryProxy,
  type StateRef,
  type ViewGraphValue,
  type ViewHostNode,
  type ViewModifierNode,
} from "@muse/core"

function escape(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function length(value: unknown): string | undefined {
  return typeof value === "number" ? `${value}px` : typeof value === "string" ? value : undefined
}

function styleOf(modifier: ViewModifierNode): Record<string, string> {
  const value = modifier.arguments[0]
  switch (modifier.name) {
    case "padding": return { padding: length(value) ?? "0" }
    case "margin": return { margin: length(value) ?? "0" }
    case "gap": return { gap: length(value) ?? "0" }
    case "font": return { font: String(value) }
    case "fontSize": return { "font-size": length(value) ?? "inherit" }
    case "bold": return { "font-weight": "600" }
    case "foreground": return { color: String(value) }
    case "background": return { background: String(value) }
    case "frame": {
      return Object.fromEntries(Object.entries(frameStyle(value && typeof value === "object" ? value : {}))
        .map(([key, item]) => [cssPropertyName(key), item ?? ""]))
    }
    case "style": return typeof value === "object" && value !== null
      ? Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, String(item)]))
      : {}
    default: return {}
  }
}

function propsOf(modifier: ViewModifierNode): Record<string, unknown> {
  const [value] = modifier.arguments
  switch (modifier.name) {
    case "className": return { class: classNameOf(value) }
    case "withProps": return value && typeof value === "object" ? value as Record<string, unknown> : {}
    default: return {}
  }
}

function styleText(value: Record<string, string>): string {
  return Object.entries(value).filter(([, item]) => item !== "undefined" && item !== "").map(([key, item]) => `${key}:${item}`).join(";")
}

function cssPropertyName(value: string): string {
  return value.startsWith("--") ? value : value.replace(/[A-Z]/g, character => `-${character.toLowerCase()}`)
}

function styleAttribute(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return typeof value === "string" ? value : undefined
  return styleText(Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [cssPropertyName(key), String(item)])))
}

function escapeAttribute(value: unknown): string {
  return escape(value).replaceAll("'", "&#39;")
}

const voidHtmlElements = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"])

const htmlRenderer: MuseRenderer<string> = {
  element(type, props, ...children) {
    const foreign = isForeignComponent(type) ? type : undefined
    const tag = typeof type === "string" ? type : "div"
    const effectiveProps = foreign
      ? { ...foreign.props, ...foreign.events, ...(foreign.ref === undefined ? {} : { ref: foreign.ref }), ...(props ?? {}), "data-muse-foreign": foreign.name }
      : props
    const attributes = Object.entries(effectiveProps ?? {})
      .filter(([key, value]) => value !== undefined && value !== null && value !== false && typeof value !== "function" && key !== "children")
      .map(([key, value]) => {
        const name = key === "className" ? "class" : key === "htmlFor" ? "for" : key
        if (value === true) return name
        const serialized = key === "style" ? styleAttribute(value) : String(value)
        return serialized === undefined ? "" : `${name}="${escapeAttribute(serialized)}"`
      })
      .filter(Boolean)
      .join(" ")
    const opening = `<${tag}${attributes ? ` ${attributes}` : ""}>`
    return voidHtmlElements.has(tag.toLowerCase()) ? opening : `${opening}${children.join("")}</${tag}>`
  },
  fragment(children) { return children.join("") },
  value(value) { return value === null || value === undefined || value === false ? "" : escape(value) },
  modifier(content, modifier) {
    if (modifier.name === "frame") {
      const style = styleText(styleOf(modifier))
      return `<div${style ? ` style="${escapeAttribute(style)}"` : ""}>${content}</div>`
    }
    const extraStyle = styleText(styleOf(modifier))
    const extraProps = propsOf(modifier)
    const propStyle = styleAttribute(extraProps.style)
    const propClass = classNameOf(extraProps.className ?? extraProps.class)
    if (!extraStyle && !propStyle && !propClass && Object.keys(extraProps).length === 0) return content
    return content.replace(/^(<[^ >]+)([^>]*)(>)/, (_match, start: string, attributes: string, end: string) => {
      let nextAttributes = attributes
      const styleMatch = /\sstyle="([^"]*)"/.exec(attributes)
      const extraStyles = [extraStyle, propStyle].filter(Boolean).join(";")
      if (styleMatch && extraStyles) {
        const merged = `${styleMatch[1]};${extraStyles}`
        nextAttributes = nextAttributes.replace(styleMatch[0], ` style="${merged}"`)
      } else if (extraStyles) {
        nextAttributes += ` style="${extraStyles}"`
      }
      if (propClass) {
        const classMatch = /\sclass="([^"]*)"/.exec(nextAttributes)
        const merged = [classMatch?.[1], propClass].filter(Boolean).join(" ")
        if (classMatch) nextAttributes = nextAttributes.replace(classMatch[0], ` class="${escapeAttribute(merged)}"`)
        else nextAttributes += ` class="${escapeAttribute(propClass)}"`
      }
      for (const [key, value] of Object.entries(extraProps)) {
        if (value === undefined || value === null || value === false || typeof value === "function") continue
        const name = key === "className" ? "class" : key === "htmlFor" ? "for" : key
        if (name === "class" || name === "style") continue
        const serialized = name === "style" ? styleAttribute(value) : String(value)
        const escaped = value === true ? "" : serialized === undefined ? "" : `="${escapeAttribute(serialized)}"`
        const pattern = new RegExp(`\\s${name}="[^"]*"`)
        nextAttributes = pattern.test(nextAttributes)
          ? nextAttributes.replace(pattern, escaped ? ` ${name}${escaped}` : ` ${name}`)
          : `${nextAttributes} ${name}${escaped}`
      }
      return `${start}${nextAttributes}${end}`
    })
  },
  view(node: ViewHostNode, render) {
    const state = node.state?.(node.props) ?? {}
    return render({ ...node.props, ...state })
  },
  geometry(_node, render) {
    return `<div data-muse="GeometryReader">${render(zeroGeometry)}</div>`
  },
}

interface DomRenderContext {
  readonly document: Document
  readonly states: Map<string, { readonly host: unknown; readonly value: Record<string, unknown> }>
  readonly visitedStateIdentities: Set<string>
  readonly refs: Array<() => void>
  readonly geometries: Map<number, GeometryProxy>
  readonly hydrationProps: WeakMap<Element, Record<string, unknown> | null | undefined>
  geometryIndex: number
  hydrating: boolean
}

function domStyle(element: HTMLElement, value: unknown): void {
  if (typeof value !== "object" || value === null) {
    if (typeof value === "string") element.setAttribute("style", value)
    return
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === undefined || item === null) continue
    element.style.setProperty(cssPropertyName(key), String(item))
  }
}

function setDomRef(reference: unknown, element: Element, context: DomRenderContext): void {
  if (typeof reference === "function") {
    reference(element)
    context.refs.push(() => reference(null))
  } else if (reference && typeof reference === "object" && "current" in reference) {
    const target = reference as { current: unknown }
    target.current = element
    context.refs.push(() => { target.current = null })
  }
}

function applyDomProps(element: HTMLElement, props: Record<string, unknown> | null | undefined, context: DomRenderContext): void {
  if (context.hydrating) context.hydrationProps.set(element, props)
  for (const [key, value] of Object.entries(props ?? {})) {
    if (key === "children" || key === "key" || value === undefined || value === null || value === false) continue
    if (key === "style") { domStyle(element, value); continue }
    if (key === "className" || key === "class") { element.className = [element.className, classNameOf(value)].filter(Boolean).join(" "); continue }
    if (key === "ref") {
      if (!context.hydrating) setDomRef(value, element, context)
      continue
    }
    if (typeof value === "function" && /^on[A-Za-z]/.test(key)) {
      if (!context.hydrating) element.addEventListener(key.slice(2).toLowerCase(), value as EventListener)
      continue
    }
    const name = key === "htmlFor" ? "for" : key
    if (value === true) { element.setAttribute(name, ""); continue }
    if (name === "value" || name === "checked" || name === "selected" || name === "disabled") {
      try { (element as unknown as Record<string, unknown>)[name] = value } catch { /* attribute remains authoritative */ }
    }
    element.setAttribute(name, String(value))
  }
}

function activateHydratedProps(source: Element, target: HTMLElement, context: DomRenderContext): void {
  const props = context.hydrationProps.get(source)
  for (const [key, value] of Object.entries(props ?? {})) {
    if (key === "children" || key === "key" || value === undefined || value === null || value === false) continue
    if (key === "ref") { setDomRef(value, target, context); continue }
    if (typeof value === "function" && /^on[A-Za-z]/.test(key)) {
      target.addEventListener(key.slice(2).toLowerCase(), value as EventListener)
      continue
    }
    if (key === "value" || key === "checked" || key === "selected" || key === "disabled") {
      try { (target as unknown as Record<string, unknown>)[key] = value } catch { /* attribute remains authoritative */ }
    }
  }
}

function hydrateNode(source: Node, target: Node, context: DomRenderContext): boolean {
  if (source.nodeType !== target.nodeType) return false
  if (source.nodeType === 3) {
    target.nodeValue = source.nodeValue
    return true
  }
  if (source.nodeType !== 1 || target.nodeType !== 1) return source.nodeType === target.nodeType
  const sourceElement = source as Element
  const targetElement = target as HTMLElement
  if (sourceElement.tagName !== targetElement.tagName) return false
  activateHydratedProps(sourceElement, targetElement, context)
  const sourceChildren = [...source.childNodes]
  const targetChildren = [...target.childNodes]
  if (sourceChildren.length !== targetChildren.length) return false
  return sourceChildren.every((child, index) => hydrateNode(child, targetChildren[index], context))
}

function activateHydratedTree(node: Node, context: DomRenderContext): void {
  if (node.nodeType !== 1) return
  activateHydratedProps(node as Element, node as HTMLElement, context)
  node.childNodes.forEach(child => activateHydratedTree(child, context))
}

function appendDomChild(parent: Node, child: Node): void {
  parent.appendChild(child)
}

function createDomRenderer(context: DomRenderContext): MuseRenderer<Node> {
  return {
    element(type, props, ...children) {
      const element = context.document.createElement(typeof type === "string" ? type : "div")
      applyDomProps(element, props, context)
      children.forEach(child => appendDomChild(element, child))
      return element
    },
    fragment(children) {
      const fragment = context.document.createDocumentFragment()
      children.forEach(child => appendDomChild(fragment, child))
      return fragment
    },
    value(value) {
      return context.document.createTextNode(value === null || value === undefined || value === false ? "" : String(value))
    },
    modifier(content, modifier) {
      if (modifier.name === "frame") {
        const wrapper = context.document.createElement("div")
        applyDomProps(wrapper, { style: frameStyle(modifier.arguments[0] && typeof modifier.arguments[0] === "object" ? modifier.arguments[0] : {}) }, context)
        appendDomChild(wrapper, content)
        return wrapper
      }
      const extraStyle = styleOf(modifier)
      const extraProps = propsOf(modifier)
      const style = Object.keys(extraStyle).length > 0 || extraProps.style
        ? { ...extraStyle, ...(extraProps.style && typeof extraProps.style === "object" ? extraProps.style : {}) }
        : undefined
      const props = { ...extraProps, ...(style ? { style } : {}) }
      const nodes = content.nodeType === 11 ? [...content.childNodes] : [content]
      nodes.forEach(node => { if (node.nodeType === 1) applyDomProps(node as HTMLElement, props, context) })
      return content
    },
    view(node, render, identity) {
      const key = viewIdentityKey(identity)
      context.visitedStateIdentities.add(key)
      let entry = context.states.get(key)
      if (!entry || entry.host !== node.host) {
        entry = { host: node.host, value: node.state?.(node.props) ?? {} }
        context.states.set(key, entry)
      }
      return render({ ...node.props, ...entry.value })
    },
    geometry(_node, render) {
      const index = context.geometryIndex++
      const wrapper = context.document.createElement("div")
      wrapper.dataset.muse = "GeometryReader"
      wrapper.dataset.museGeometry = String(index)
      wrapper.style.boxSizing = "border-box"
      wrapper.style.width = "100%"
      wrapper.appendChild(render(context.geometries.get(index) ?? zeroGeometry))
      return wrapper
    },
  }
}

function geometryFromElement(element: Element): GeometryProxy {
  const rect = element.getBoundingClientRect()
  const frame = { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left }
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

export function renderToHTML(value: ViewGraphValue): string {
  return renderViewNode(value, htmlRenderer)
}

export interface WebMountOptions {
  readonly hydrate?: boolean
}

export function mount(value: ViewGraphValue, container: Element, options: WebMountOptions = {}): () => void {
  let stopped = false
  let scheduled = false
  let unsubscribers: Array<() => void> = []
  const document = container.ownerDocument
  const canMaterializeDOM = typeof document?.createElement === "function" && typeof (container as Element & { replaceChildren?: unknown }).replaceChildren === "function"

  if (canMaterializeDOM) {
    const context: DomRenderContext = {
      document,
      states: new Map(),
      visitedStateIdentities: new Set(),
      refs: [],
      geometries: new Map(),
      hydrationProps: new WeakMap(),
      geometryIndex: 0,
      hydrating: false,
    }
    const renderer = createDomRenderer(context)
    let activeRefCleanup: Array<() => void> = []
    let geometryScheduled = false
    let hasMounted = false
    const updateGeometry = () => {
      if (stopped) return
      let changed = false
      container.querySelectorAll<HTMLElement>('[data-muse="GeometryReader"][data-muse-geometry]').forEach(element => {
        const index = Number(element.dataset.museGeometry)
        if (!Number.isInteger(index)) return
        const next = geometryFromElement(element)
        const previous = context.geometries.get(index)
        if (!previous || !sameGeometry(previous, next)) {
          context.geometries.set(index, next)
          changed = true
        }
      })
      if (changed && !geometryScheduled) {
        geometryScheduled = true
        queueMicrotask(() => {
          geometryScheduled = false
          update()
        })
      }
    }
    const update = () => {
      if (stopped) return
      scheduled = false
      unsubscribers.forEach(unsubscribe => unsubscribe())
      activeRefCleanup.forEach(cleanup => cleanup())
      activeRefCleanup = []
      context.refs.length = 0
      context.geometryIndex = 0
      context.visitedStateIdentities.clear()
      const dependencies = new Set<StateRef<unknown>>()
      context.hydrating = Boolean(options.hydrate && !hasMounted)
      const output = collectStateReads(() => renderViewNode(value, renderer), dependency => dependencies.add(dependency))
      for (const key of context.states.keys()) {
        if (!context.visitedStateIdentities.has(key)) context.states.delete(key)
      }
      const outputChildren = output.nodeType === 11 ? [...output.childNodes] : [output]
      const existingChildren = [...container.childNodes]
      const hydrated = context.hydrating
        && existingChildren.length === outputChildren.length
        && outputChildren.every((child, index) => hydrateNode(child, existingChildren[index], context))
      if (!hydrated) {
        context.hydrating = false
        ;(container as Element & { replaceChildren(...nodes: Node[]): void }).replaceChildren(...outputChildren)
        outputChildren.forEach(child => activateHydratedTree(child, context))
      }
      activeRefCleanup = [...context.refs]
      unsubscribers = [...dependencies].map(dependency => subscribeState(dependency, () => {
        if (scheduled || stopped) return
        scheduled = true
        queueMicrotask(update)
      }))
      updateGeometry()
      hasMounted = true
    }
    update()
    return () => {
      if (stopped) return
      stopped = true
      unsubscribers.forEach(unsubscribe => unsubscribe())
      unsubscribers = []
      activeRefCleanup.forEach(cleanup => cleanup())
      activeRefCleanup = []
      ;(container as Element & { replaceChildren(...nodes: Node[]): void }).replaceChildren()
    }
  }

  const update = () => {
    if (stopped) return
    scheduled = false
    unsubscribers.forEach(unsubscribe => unsubscribe())
    const dependencies = new Set<StateRef<unknown>>()
    const html = collectStateReads(() => renderToHTML(value), dependency => dependencies.add(dependency))
    container.innerHTML = html
    unsubscribers = [...dependencies].map(dependency => subscribeState(dependency, () => {
      if (scheduled || stopped) return
      scheduled = true
      queueMicrotask(update)
    }))
  }
  update()
  return () => {
    if (stopped) return
    stopped = true
    unsubscribers.forEach(unsubscribe => unsubscribe())
    unsubscribers = []
    if (container.innerHTML) container.innerHTML = ""
  }
}
