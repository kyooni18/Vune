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
  type LazyViewNode,
  type LazyViewRange,
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
  readonly domProps: WeakMap<Element, Record<string, unknown>>
  readonly eventListeners: WeakMap<Element, Map<string, EventListener>>
  readonly domKeys: WeakMap<Node, string | number | undefined>
  readonly lazyRanges: Map<string, LazyViewRange>
  readonly lazyMeasurements: Map<string, number>
  readonly lazyNodes: Map<string, LazyViewNode>
  readonly visitedLazyIdentities: Set<string>
  readonly lazyKeys: WeakMap<Node, string>
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

function eventName(key: string): string {
  return key.slice(2).toLowerCase()
}

function setDomEvent(element: HTMLElement, key: string, value: unknown, context: DomRenderContext, attach = true): void {
  const name = eventName(key)
  const listeners = context.eventListeners.get(element) ?? new Map<string, EventListener>()
  const previous = listeners.get(name)
  if (previous) element.removeEventListener(name, previous)
  listeners.delete(name)
  if (attach && typeof value === "function") {
    const listener = value as EventListener
    element.addEventListener(name, listener)
    listeners.set(name, listener)
  }
  context.eventListeners.set(element, listeners)
}

function rememberDomProps(element: Element, props: Record<string, unknown> | null | undefined, context: DomRenderContext): void {
  const previous = context.domProps.get(element) ?? {}
  const currentStyle = previous.style && typeof previous.style === "object" ? previous.style : {}
  const nextStyle = props?.style && typeof props.style === "object" ? props.style : undefined
  const remembered: Record<string, unknown> = {
    ...previous,
    ...(props ?? {}),
    ...(nextStyle ? { style: { ...currentStyle, ...nextStyle } } : {}),
  }
  if (element.getAttribute("class") !== null) {
    remembered.class = element.getAttribute("class") ?? ""
    delete remembered.className
  }
  context.domProps.set(element, remembered)
  context.domKeys.set(element, typeof props?.key === "string" || typeof props?.key === "number" ? props.key : context.domKeys.get(element))
}

function applyDomProps(element: HTMLElement, props: Record<string, unknown> | null | undefined, context: DomRenderContext): void {
  if (context.hydrating) context.hydrationProps.set(element, props)
  rememberDomProps(element, props, context)
  for (const [key, value] of Object.entries(props ?? {})) {
    if (key === "children" || key === "key" || value === undefined || value === null || value === false) continue
    if (key === "style") { domStyle(element, value); continue }
    if (key === "className" || key === "class") { element.className = [element.className, classNameOf(value)].filter(Boolean).join(" "); continue }
    if (key === "ref") {
      if (!context.hydrating) setDomRef(value, element, context)
      continue
    }
    if (typeof value === "function" && /^on[A-Za-z]/.test(key)) {
      setDomEvent(element, key, value, context, !context.hydrating)
      continue
    }
    const name = key === "htmlFor" ? "for" : key
    if (value === true) { element.setAttribute(name, ""); continue }
    if (name === "value" || name === "checked" || name === "selected" || name === "disabled") {
      try { (element as unknown as Record<string, unknown>)[name] = value } catch { /* attribute remains authoritative */ }
    }
    element.setAttribute(name, String(value))
  }
  rememberDomProps(element, props, context)
}

function removeDomProp(element: HTMLElement, key: string): void {
  if (key === "style") {
    element.removeAttribute("style")
    return
  }
  if (key === "class" || key === "className") {
    element.removeAttribute("class")
    return
  }
  if (key === "value" || key === "checked" || key === "selected" || key === "disabled") {
    try { (element as unknown as Record<string, unknown>)[key] = key === "value" ? "" : false } catch { /* attribute remains authoritative */ }
  }
  if (key !== "children" && key !== "key" && key !== "ref" && !/^on[A-Za-z]/.test(key)) {
    element.removeAttribute(key === "htmlFor" ? "for" : key)
  }
}

function patchDomProps(element: HTMLElement, next: Record<string, unknown> | null | undefined, context: DomRenderContext): void {
  const previous = context.domProps.get(element) ?? {}
  for (const [key, value] of Object.entries(previous)) {
    if (key === "ref" || key === "key" || key === "children") continue
    if (next && Object.prototype.hasOwnProperty.call(next, key)) continue
    if (/^on[A-Za-z]/.test(key)) setDomEvent(element, key, undefined, context, false)
    else removeDomProp(element, key)
  }
  if (next?.style && typeof next.style === "object") element.removeAttribute("style")
  for (const [key, value] of Object.entries(next ?? {})) {
    if (key === "children" || key === "key" || value === undefined || value === null || value === false) {
      if (value === false && previous[key] !== undefined && key !== "children" && key !== "key") removeDomProp(element, key)
      continue
    }
    if (key === "style") { domStyle(element, value); continue }
    if (key === "className" || key === "class") { element.className = classNameOf(value); continue }
    if (key === "ref") { setDomRef(value, element, context); continue }
    if (typeof value === "function" && /^on[A-Za-z]/.test(key)) { setDomEvent(element, key, value, context); continue }
    const name = key === "htmlFor" ? "for" : key
    if (value === true) { element.setAttribute(name, ""); continue }
    if (name === "value" || name === "checked" || name === "selected" || name === "disabled") {
      try { (element as unknown as Record<string, unknown>)[name] = value } catch { /* attribute remains authoritative */ }
    }
    element.setAttribute(name, String(value))
  }
  rememberDomProps(element, next, context)
}

function activateHydratedProps(source: Element, target: HTMLElement, context: DomRenderContext): void {
  const props = context.hydrationProps.get(source)
  rememberDomProps(target, props, context)
  for (const [key, value] of Object.entries(props ?? {})) {
    if (key === "children" || key === "key" || value === undefined || value === null || value === false) continue
    if (key === "ref") { setDomRef(value, target, context); continue }
    if (typeof value === "function" && /^on[A-Za-z]/.test(key)) {
      setDomEvent(target, key, value, context)
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

function nodeKey(node: Node, context: DomRenderContext): string | number | undefined {
  return context.domKeys.get(node)
}

function replaceDomNode(parent: Node, current: Node, next: Node, context: DomRenderContext): Node {
  parent.replaceChild(next, current)
  if (next.nodeType === 1) {
    const props = context.domProps.get(next as Element)
    if (props?.ref !== undefined) setDomRef(props.ref, next as Element, context)
  }
  return next
}

function reconcileDomChildren(parent: Node, nextChildren: readonly Node[], context: DomRenderContext): void {
  const currentChildren = [...parent.childNodes]
  const keyed = new Map<string | number, Node>()
  const used = new Set<Node>()
  for (const child of currentChildren) {
    const key = nodeKey(child, context)
    if (key !== undefined) keyed.set(key, child)
  }
  const unkeyed = currentChildren.filter(child => nodeKey(child, context) === undefined)
  let nextUnkeyed = 0

  for (let index = 0; index < nextChildren.length; index += 1) {
    const next = nextChildren[index]
    const key = nodeKey(next, context)
    let current = key === undefined ? unkeyed[nextUnkeyed++] : keyed.get(key)
    if (current) used.add(current)
    if (!current) {
      parent.insertBefore(next, parent.childNodes[index] ?? null)
      current = next
    } else {
      const anchor = parent.childNodes[index]
      if (anchor !== current) parent.insertBefore(current, anchor ?? null)
      reconcileDomNode(parent, current, next, context)
    }
  }

  for (const child of currentChildren) {
    if (!used.has(child) && child.parentNode === parent) parent.removeChild(child)
  }
}

function reconcileDomNode(parent: Node, current: Node, next: Node, context: DomRenderContext): Node {
  if (current.nodeType !== next.nodeType) return replaceDomNode(parent, current, next, context)
  if (current.nodeType === 3 && next.nodeType === 3) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue
    return current
  }
  if (current.nodeType !== 1 || next.nodeType !== 1) return current
  const currentElement = current as HTMLElement
  const nextElement = next as HTMLElement
  if (currentElement.tagName !== nextElement.tagName) return replaceDomNode(parent, current, next, context)
  const lazyKey = context.lazyKeys.get(nextElement)
  if (lazyKey) context.lazyKeys.set(currentElement, lazyKey)
  patchDomProps(currentElement, context.domProps.get(nextElement), context)
  context.domKeys.set(currentElement, typeof context.domProps.get(nextElement)?.key === "string" || typeof context.domProps.get(nextElement)?.key === "number"
    ? context.domProps.get(nextElement)?.key as string | number
    : undefined)
  reconcileDomChildren(currentElement, [...nextElement.childNodes], context)
  return current
}

function lazyEstimate(node: LazyViewNode): number {
  const value = node.props["data-muse-lazy-estimate"]
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 44
}

function lazyOverscan(node: LazyViewNode): number {
  const value = node.props["data-muse-lazy-overscan"]
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : Number.NaN
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 2
}

function lazyScrollParent(element: HTMLElement, axis: LazyViewNode["axis"]): HTMLElement | null {
  const property = axis === "horizontal" ? "overflowX" : "overflowY"
  let parent = element.parentElement
  while (parent) {
    const style = parent.ownerDocument.defaultView?.getComputedStyle(parent)
    const overflow = style?.[property]
    if (overflow === "auto" || overflow === "scroll" || overflow === "overlay") return parent
    parent = parent.parentElement
  }
  return null
}

function measuredLazySize(element: HTMLElement, node: LazyViewNode): number | undefined {
  const values = [...element.children].flatMap(child => {
    if (child.hasAttribute("data-muse-lazy-spacer")) return []
    const rect = child.getBoundingClientRect()
    const value = node.axis === "horizontal" ? rect.width : rect.height
    return Number.isFinite(value) && value > 0 ? [value] : []
  })
  if (values.length === 0) return undefined
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function lazyRangeForElement(element: HTMLElement, node: LazyViewNode, measuredSize?: number): LazyViewRange {
  const vertical = node.axis !== "horizontal"
  const rect = element.getBoundingClientRect()
  const parent = lazyScrollParent(element, node.axis)
  const window = element.ownerDocument.defaultView
  let start = vertical ? -rect.top : -rect.left
  let viewport = vertical ? window?.innerHeight ?? 800 : window?.innerWidth ?? 1200
  if (parent) {
    const parentRect = parent.getBoundingClientRect()
    start = (vertical ? parent.scrollTop : parent.scrollLeft) + (vertical ? parentRect.top - rect.top : parentRect.left - rect.left)
    viewport = vertical ? parent.clientHeight : parent.clientWidth
    if (!viewport) viewport = vertical ? window?.innerHeight ?? 800 : window?.innerWidth ?? 1200
  }
  const estimate = Number.isFinite(measuredSize) && measuredSize && measuredSize > 0 ? measuredSize : lazyEstimate(node)
  const overscan = lazyOverscan(node)
  const first = Math.max(0, Math.floor(Math.max(0, start) / estimate) - overscan)
  const last = Math.min(node.children.length, Math.ceil((Math.max(0, start) + Math.max(1, viewport)) / estimate) + overscan)
  return { start: first, end: Math.max(first, last) }
}

function boundedLazyRange(range: LazyViewRange, count: number): LazyViewRange {
  const start = Math.max(0, Math.min(count, Math.floor(range.start)))
  const end = Math.max(start, Math.min(count, Math.ceil(range.end)))
  return { start, end }
}

function sameLazyRange(left: LazyViewRange | undefined, right: LazyViewRange): boolean {
  return left?.start === right.start && left.end === right.end
}

function lazySpacer(context: DomRenderContext, node: LazyViewNode, size: number, position: "before" | "after"): HTMLElement {
  const spacer = context.document.createElement("div")
  applyDomProps(spacer, {
    "data-muse-lazy-spacer": position,
    "aria-hidden": true,
    style: node.axis === "horizontal"
      ? { width: `${Math.max(0, size)}px`, flex: "0 0 auto" }
      : { height: `${Math.max(0, size)}px`, width: "100%", flex: "0 0 auto" },
  }, context)
  return spacer
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
    lazy(node, render, identity) {
      const key = viewIdentityKey(identity)
      context.visitedLazyIdentities.add(key)
      context.lazyNodes.set(key, node)
      const element = context.document.createElement("div")
      applyDomProps(element, node.props, context)
      context.lazyKeys.set(element, key)
      const estimate = context.lazyMeasurements.get(key)
      const requested = context.lazyRanges.get(key) ?? lazyRangeForElement(element, node, estimate)
      const range = boundedLazyRange(requested, node.children.length)
      context.lazyRanges.set(key, range)
      const itemSize = estimate ?? lazyEstimate(node)
      if (range.start > 0) appendDomChild(element, lazySpacer(context, node, range.start * itemSize, "before"))
      appendDomChild(element, render(range))
      if (range.end < node.children.length) appendDomChild(element, lazySpacer(context, node, (node.children.length - range.end) * itemSize, "after"))
      const measured = measuredLazySize(element, node)
      if (measured !== undefined) context.lazyMeasurements.set(key, measured)
      return element
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
      domProps: new WeakMap(),
      eventListeners: new WeakMap(),
      domKeys: new WeakMap(),
      lazyRanges: new Map(),
      lazyMeasurements: new Map(),
      lazyNodes: new Map(),
      visitedLazyIdentities: new Set(),
      lazyKeys: new WeakMap(),
      geometryIndex: 0,
      hydrating: false,
    }
    const renderer = createDomRenderer(context)
    let activeRefCleanup: Array<() => void> = []
    let geometryScheduled = false
    let lazyMeasureScheduled = false
    const lazyViewportTargets = new Set<EventTarget>()
    const lazyViewportCleanups: Array<() => void> = []
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
    const refreshLazyRanges = (): boolean => {
      let changed = false
      const elements = [...container.querySelectorAll<HTMLElement>("[data-muse-lazy]")]
      for (const element of elements) {
        const key = context.lazyKeys.get(element)
        if (!key) continue
        const node = context.lazyNodes.get(key)
        if (!node) continue
        const measured = measuredLazySize(element, node)
        if (measured !== undefined) context.lazyMeasurements.set(key, measured)
        const next = lazyRangeForElement(element, node, context.lazyMeasurements.get(key))
        if (!sameLazyRange(context.lazyRanges.get(key), next)) {
          context.lazyRanges.set(key, next)
          changed = true
        }
      }
      return changed
    }
    const scheduleLazyMeasure = () => {
      if (stopped || lazyMeasureScheduled) return
      lazyMeasureScheduled = true
      queueMicrotask(() => {
        lazyMeasureScheduled = false
        if (stopped || !refreshLazyRanges() || scheduled) return
        scheduled = true
        queueMicrotask(update)
      })
    }
    const observeLazyViewport = () => {
      const targets: EventTarget[] = []
      const window = document.defaultView
      if (window) targets.push(window)
      targets.push(container)
      container.querySelectorAll<HTMLElement>("[data-muse-lazy]").forEach(element => {
        const key = context.lazyKeys.get(element)
        const node = key ? context.lazyNodes.get(key) : undefined
        const parent = node ? lazyScrollParent(element, node.axis) : null
        if (parent) targets.push(parent)
      })
      for (const target of targets) {
        if (lazyViewportTargets.has(target)) continue
        const listener = scheduleLazyMeasure as EventListener
        target.addEventListener("scroll", listener, { passive: true })
        target.addEventListener("resize", listener)
        lazyViewportTargets.add(target)
        lazyViewportCleanups.push(() => {
          target.removeEventListener("scroll", listener)
          target.removeEventListener("resize", listener)
        })
      }
    }
    const captureLazyScrollPositions = () => {
      const positions = new Map<HTMLElement, { readonly top: number; readonly left: number }>()
      container.querySelectorAll<HTMLElement>("[data-muse-lazy]").forEach(element => {
        const key = context.lazyKeys.get(element)
        const node = key ? context.lazyNodes.get(key) : undefined
        const parent = node ? lazyScrollParent(element, node.axis) : null
        if (parent && !positions.has(parent)) positions.set(parent, { top: parent.scrollTop, left: parent.scrollLeft })
      })
      return positions
    }
    const update = () => {
      if (stopped) return
      scheduled = false
      const scrollPositions = captureLazyScrollPositions()
      unsubscribers.forEach(unsubscribe => unsubscribe())
      activeRefCleanup.forEach(cleanup => cleanup())
      activeRefCleanup = []
      context.refs.length = 0
      context.geometryIndex = 0
      context.visitedStateIdentities.clear()
      context.visitedLazyIdentities.clear()
      context.lazyNodes.clear()
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
        reconcileDomChildren(container, outputChildren, context)
      }
      for (const [parent, position] of scrollPositions) {
        parent.scrollTop = position.top
        parent.scrollLeft = position.left
      }
      for (const key of context.lazyRanges.keys()) {
        if (!context.visitedLazyIdentities.has(key)) context.lazyRanges.delete(key)
      }
      for (const key of context.lazyMeasurements.keys()) {
        if (!context.visitedLazyIdentities.has(key)) context.lazyMeasurements.delete(key)
      }
      activeRefCleanup = [...context.refs]
      unsubscribers = [...dependencies].map(dependency => subscribeState(dependency, () => {
        if (scheduled || stopped) return
        scheduled = true
        queueMicrotask(update)
      }))
      updateGeometry()
      observeLazyViewport()
      if (refreshLazyRanges() && !scheduled) {
        scheduled = true
        queueMicrotask(update)
      }
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
      lazyViewportCleanups.forEach(cleanup => cleanup())
      lazyViewportCleanups.length = 0
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
