import {
  collectLogicalViewIdentities,
  collectStateReads,
  edgeInsetsFromCss,
  frameStyle,
  renderViewNode,
  subscribeState,
  viewIdentityKey,
  zeroGeometry,
  type VuneRenderer,
  type GeometryProxy,
  type LazyViewNode,
  type LazyViewRange,
  type StateRef,
  type ViewGraphValue,
  type ViewHostNode,
  type ViewModifierNode,
} from "@vune-ui/core"
import { renderToHTML } from "./ssr.js"
import { hydrateNode } from "./hydration.js"
import { applyDomProps, clearDomEvents, patchDomProps, setDomRef, synchronizeDomSelectValue } from "./props.js"
import { domContentContainer, nativeElementProps, normalizedRawTextValue, propsOf, rawTextHtmlElements, styleOf, validTableChildElements, voidHtmlElements, type DomRenderContext } from "./shared.js"

function nodeKey(node: Node, context: DomRenderContext): string | number | undefined {
  return context.domKeys.get(node)
}

function releaseDomSubtree(node: Node, context: DomRenderContext): void {
  if (node.nodeType === 1) {
    const element = node as Element
    clearDomEvents(element, context)
    for (const child of domContentContainer(element).childNodes) releaseDomSubtree(child, context)
    return
  }
  for (const child of node.childNodes) releaseDomSubtree(child, context)
}

function collectDomElements(root: Node): Element[] {
  const elements: Element[] = []
  const visit = (node: Node): void => {
    for (const child of node.childNodes) {
      if (child.nodeType !== 1) {
        visit(child)
        continue
      }
      const element = child as Element
      elements.push(element)
      visit(domContentContainer(element))
    }
  }
  visit(root)
  return elements
}

function replaceDomNode(parent: Node, current: Node, next: Node, context: DomRenderContext): Node {
  releaseDomSubtree(current, context)
  parent.replaceChild(next, current)
  return next
}

function reconcileDomChildren(parent: Node, nextChildren: ArrayLike<Node>, context: DomRenderContext): void {
  const currentNodes = parent.childNodes
  if (currentNodes.length === nextChildren.length) {
    let unkeyed = true
    for (let index = 0; index < nextChildren.length; index += 1) {
      if (nodeKey(currentNodes[index], context) !== undefined || nodeKey(nextChildren[index], context) !== undefined) {
        unkeyed = false
        break
      }
    }
    if (unkeyed) {
      for (let index = 0; index < nextChildren.length; index += 1) {
        reconcileDomNode(parent, currentNodes[index], nextChildren[index], context)
      }
      return
    }
  }
  const currentChildren = [...currentNodes]
  const nextArray = Array.from(nextChildren)
  const keyed = new Map<string | number, Node>()
  const used = new Set<Node>()
  for (const child of currentChildren) {
    const key = nodeKey(child, context)
    if (key !== undefined) keyed.set(key, child)
  }
  const unkeyed = currentChildren.filter(child => nodeKey(child, context) === undefined)
  let nextUnkeyed = 0

  for (let index = 0; index < nextArray.length; index += 1) {
    const next = nextArray[index]
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
    if (!used.has(child) && child.parentNode === parent) {
      releaseDomSubtree(child, context)
      parent.removeChild(child)
    }
  }
}

function reconcileDomNode(parent: Node, current: Node, next: Node, context: DomRenderContext): Node {
  if (current.nodeType !== next.nodeType) return replaceDomNode(parent, current, next, context)
  if (current.nodeType === 3 && next.nodeType === 3) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue
    return current
  }
  if (current.nodeType !== 1 || next.nodeType !== 1) return current
  const currentElement = current as Element
  const nextElement = next as Element
  if (currentElement.namespaceURI !== nextElement.namespaceURI || currentElement.tagName !== nextElement.tagName) {
    return replaceDomNode(parent, current, next, context)
  }
  const lazyKey = context.lazyKeys.get(nextElement)
  if (lazyKey) context.lazyKeys.set(currentElement, lazyKey)
  patchDomProps(currentElement, context.domProps.get(nextElement), context)
  const nextKey = nodeKey(nextElement, context)
  if (nextKey !== undefined) context.domKeys.set(currentElement, nextKey)
  else if (nodeKey(currentElement, context) !== undefined) context.domKeys.delete(currentElement)
  reconcileDomChildren(domContentContainer(currentElement), domContentContainer(nextElement).childNodes, context)
  synchronizeDomSelectValue(currentElement, context.domProps.get(nextElement))
  return current
}

function lazyEstimate(node: LazyViewNode): number {
  const value = node.props["data-vune-lazy-estimate"]
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 44
}

function lazyOverscan(node: LazyViewNode): number {
  const value = node.props["data-vune-lazy-overscan"]
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
    if (child.hasAttribute("data-vune-lazy-spacer")) return []
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
    "data-vune-lazy-spacer": position,
    "aria-hidden": true,
    style: node.axis === "horizontal"
      ? { width: `${Math.max(0, size)}px`, flex: "0 0 auto" }
      : { height: `${Math.max(0, size)}px`, width: "100%", flex: "0 0 auto" },
  }, context)
  return spacer
}

const HTML_NS = "http://www.w3.org/1999/xhtml"
const SVG_NS = "http://www.w3.org/2000/svg"

function createTaggedElement(context: DomRenderContext, tag: string, namespace = HTML_NS): Element {
  const lower = tag.toLowerCase()
  const actualNamespace = namespace === SVG_NS || lower === "svg" ? SVG_NS : HTML_NS
  const element = actualNamespace === SVG_NS
    ? context.document.createElementNS(SVG_NS, tag)
    : context.document.createElement(tag)
  if (tag !== tag.toLowerCase()) context.domTags.set(element, tag)
  return element
}

function childNamespace(parent: Element): string {
  return parent.namespaceURI === SVG_NS && parent.localName.toLowerCase() !== "foreignobject" ? SVG_NS : HTML_NS
}

function copyRawAttributes(source: Element, target: Element): void {
  for (const attribute of [...source.attributes]) {
    if (attribute.namespaceURI) target.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value)
    else target.setAttribute(attribute.name, attribute.value)
  }
}

function normalizeChildNamespace(child: Element, parent: Element, context: DomRenderContext): Element {
  const tag = context.domTags.get(child) ?? child.localName
  const expectedParentNamespace = childNamespace(parent)
  const desiredNamespace = expectedParentNamespace === SVG_NS || tag.toLowerCase() === "svg" ? SVG_NS : HTML_NS
  if (child.namespaceURI === desiredNamespace) return child

  const replacement = createTaggedElement(context, tag, desiredNamespace)
  copyRawAttributes(child, replacement)
  const props = context.domProps.get(child)
  if (props) applyDomProps(replacement, props, context)
  const hydrationProps = context.hydrationProps.get(child)
  if (hydrationProps !== undefined) context.hydrationProps.set(replacement, hydrationProps)
  context.domKeys.set(replacement, context.domKeys.get(child))
  const lazyKey = context.lazyKeys.get(child)
  if (lazyKey) context.lazyKeys.set(replacement, lazyKey)
  for (const nested of [...domContentContainer(child).childNodes]) {
    appendDomChild(domContentContainer(replacement), nested, context)
  }
  return replacement
}

function appendDomChild(parent: Node, child: Node, context: DomRenderContext): void {
  if (child.nodeType === 11) {
    for (const nested of [...child.childNodes]) appendDomChild(parent, nested, context)
    return
  }
  const normalized = parent.nodeType === 1 && child.nodeType === 1
    ? normalizeChildNamespace(child as Element, parent as Element, context)
    : child
  parent.appendChild(normalized)
}

function rawTextContent(tag: string, children: readonly Node[]): string {
  let content = ""
  const append = (node: Node): void => {
    if (node.nodeType === 3) {
      content += node.nodeValue ?? ""
      return
    }
    if (node.nodeType === 11) {
      for (const child of node.childNodes) append(child)
      return
    }
    throw new TypeError(`<${tag.toLowerCase()}> only accepts text children`)
  }
  children.forEach(append)
  return normalizedRawTextValue(tag, content)
}

function flattenedDomChildren(children: readonly Node[]): Node[] {
  return children.flatMap(child => child.nodeType === 11
    ? flattenedDomChildren([...child.childNodes])
    : [child])
}

function appendElementChildren(element: Element, tag: string, children: readonly Node[], context: DomRenderContext): void {
  const content = domContentContainer(element)
  if (element.namespaceURI !== HTML_NS || tag.toLowerCase() !== "table") {
    children.forEach(child => appendDomChild(content, child, context))
    return
  }
  let implicitGroup: { readonly kind: "row" | "column" | "cell"; readonly parent: Element } | undefined
  for (const child of flattenedDomChildren(children)) {
    const childTag = child.nodeType === 1 && (child as Element).namespaceURI === HTML_NS
      ? (child as Element).localName.toLowerCase()
      : undefined
    const kind = childTag === "tr" ? "row" : childTag === "col" ? "column" : childTag === "td" || childTag === "th" ? "cell" : undefined
    if (!kind) {
      implicitGroup = undefined
      const isWhitespace = child.nodeType === 3 && !(child.nodeValue ?? "").trim()
      if (!isWhitespace && (!childTag || !validTableChildElements.has(childTag))) {
        throw new TypeError("<table> only accepts table sections, rows, columns, cells, scripts, templates, or whitespace")
      }
      appendDomChild(content, child, context)
      continue
    }
    if (implicitGroup?.kind !== kind) {
      const wrapper = createTaggedElement(context, kind === "column" ? "colgroup" : "tbody")
      appendDomChild(content, wrapper, context)
      const parent = kind === "cell" ? createTaggedElement(context, "tr") : wrapper
      if (kind === "cell") appendDomChild(wrapper, parent, context)
      implicitGroup = { kind, parent }
    }
    appendDomChild(implicitGroup.parent, child, context)
  }
}

function createDomRenderer(context: DomRenderContext): VuneRenderer<Node> {
  return {
    element(type, props, ...children) {
      const tag = typeof type === "string" ? type : "div"
      const element = createTaggedElement(context, tag)
      applyDomProps(element, props, context)
      const hasTextAreaValue = element.namespaceURI === HTML_NS
        && tag.toLowerCase() === "textarea"
        && props?.value !== undefined
        && props.value !== null
      const isRawText = element.namespaceURI === HTML_NS && rawTextHtmlElements.has(tag.toLowerCase())
      if (isRawText) {
        element.textContent = rawTextContent(tag, children)
      } else if (!voidHtmlElements.has(tag.toLowerCase()) && !hasTextAreaValue) {
        appendElementChildren(element, tag, children, context)
      }
      synchronizeDomSelectValue(element, props)
      return element
    },
    fragment(children) {
      const fragment = context.document.createDocumentFragment()
      children.forEach(child => appendDomChild(fragment, child, context))
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
      const preserved = new Set<string>()
      node.children.forEach((child, index) => {
        if (index >= range.start && index < range.end) return
        for (const logicalIdentity of collectLogicalViewIdentities(child, [...identity, "lazy", index])) {
          preserved.add(viewIdentityKey(logicalIdentity))
        }
      })
      context.preservedLazyStatePrefixes.set(key, preserved)
      const itemSize = estimate ?? lazyEstimate(node)
      if (range.start > 0) appendDomChild(element, lazySpacer(context, node, range.start * itemSize, "before"), context)
      appendDomChild(element, render(range), context)
      if (range.end < node.children.length) appendDomChild(element, lazySpacer(context, node, (node.children.length - range.end) * itemSize, "after"), context)
      const measured = measuredLazySize(element, node)
      if (measured !== undefined) context.lazyMeasurements.set(key, measured)
      return element
    },
    modifier(content, modifier) {
      if (modifier.name === "frame") {
        const wrapper = context.document.createElement("div")
        applyDomProps(wrapper, { style: frameStyle(modifier.arguments[0] && typeof modifier.arguments[0] === "object" ? modifier.arguments[0] : {}) }, context)
        appendDomChild(wrapper, content, context)
        return wrapper
      }
      const extraStyle = styleOf(modifier)
      const extraProps = propsOf(modifier)
      const key = modifier.name === "keyed" && (typeof modifier.arguments[0] === "string" || typeof modifier.arguments[0] === "number")
        ? modifier.arguments[0]
        : undefined
      if (Object.keys(extraProps).length === 0 && Object.keys(extraStyle).length === 0 && key === undefined) return content
      const style = Object.keys(extraStyle).length > 0 || extraProps.style
        ? { ...extraStyle, ...(extraProps.style && typeof extraProps.style === "object" ? extraProps.style : {}) }
        : undefined
      const props = { ...extraProps, ...(style ? { style } : {}) }
      const nodes = content.nodeType === 11 ? [...content.childNodes] : [content]
      nodes.forEach(node => {
        if (node.nodeType !== 1) return
        if (key !== undefined) context.domKeys.set(node, key)
        const element = node as Element
        const appliedProps = element.localName.includes("-") ? props : nativeElementProps(props)
        if (Object.keys(appliedProps).length > 0) applyDomProps(element, appliedProps, context)
      })
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
      wrapper.dataset.vune = "GeometryReader"
      wrapper.dataset.vuneGeometry = String(index)
      wrapper.style.boxSizing = "border-box"
      wrapper.style.width = "100%"
      appendDomChild(wrapper, render(context.geometries.get(index) ?? zeroGeometry), context)
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
      geometries: new Map(),
      hydrationProps: new WeakMap(),
      domProps: new WeakMap(),
      eventListeners: new WeakMap(),
      domKeys: new WeakMap(),
      domTags: new WeakMap(),
      lazyRanges: new Map(),
      lazyMeasurements: new Map(),
      lazyNodes: new Map(),
      preservedLazyStatePrefixes: new Map(),
      visitedLazyIdentities: new Set(),
      lazyKeys: new WeakMap(),
      geometryIndex: 0,
      hasRefs: false,
      hydrating: false,
    }
    const renderer = createDomRenderer(context)
    let activeRefs = new Map<Element, { readonly reference: unknown; readonly cleanup: () => void }>()
    let geometryScheduled = false
    let lazyMeasureScheduled = false
    const lazyViewportTargets = new Set<EventTarget>()
    const lazyViewportCleanups: Array<() => void> = []
    let hasMounted = false
    const commitRefs = () => {
      if (!context.hasRefs && activeRefs.size === 0) return
      const desired = new Map<Element, unknown>()
      collectDomElements(container).forEach(element => {
        const reference = context.domProps.get(element)?.ref
        if (reference !== undefined && reference !== null) desired.set(element, reference)
      })
      const next = new Map<Element, { readonly reference: unknown; readonly cleanup: () => void }>()
      for (const [element, reference] of desired) {
        const previous = activeRefs.get(element)
        if (previous && previous.reference === reference) {
          next.set(element, previous)
          continue
        }
        previous?.cleanup()
        next.set(element, { reference, cleanup: setDomRef(reference, element) })
      }
      for (const [element, previous] of activeRefs) {
        if (!desired.has(element)) previous.cleanup()
      }
      activeRefs = next
    }
    const updateGeometry = () => {
      if (stopped || context.geometryIndex === 0) return
      let changed = false
      container.querySelectorAll<HTMLElement>('[data-vune="GeometryReader"][data-vune-geometry]').forEach(element => {
        const index = Number(element.dataset.vuneGeometry)
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
      if (context.lazyNodes.size === 0) return false
      let changed = false
      const elements = [...container.querySelectorAll<HTMLElement>("[data-vune-lazy]")]
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
      if (context.lazyNodes.size === 0) return
      const targets: EventTarget[] = []
      const window = document.defaultView
      if (window) targets.push(window)
      targets.push(container)
      container.querySelectorAll<HTMLElement>("[data-vune-lazy]").forEach(element => {
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
      if (context.lazyNodes.size === 0) return positions
      container.querySelectorAll<HTMLElement>("[data-vune-lazy]").forEach(element => {
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
      context.geometryIndex = 0
      context.hasRefs = false
      context.visitedStateIdentities.clear()
      context.visitedLazyIdentities.clear()
      context.lazyNodes.clear()
      context.preservedLazyStatePrefixes.clear()
      const dependencies = new Set<StateRef<unknown>>()
      context.hydrating = Boolean(options.hydrate && !hasMounted)
      let output = collectStateReads(() => renderViewNode(value, renderer), dependency => dependencies.add(dependency))
      const preservedStatePrefixes = [...context.preservedLazyStatePrefixes.values()].flatMap(prefixes => [...prefixes])
      for (const key of context.states.keys()) {
        if (context.visitedStateIdentities.has(key)) continue
        if (preservedStatePrefixes.some(prefix => key === prefix || key.startsWith(`${prefix}|`))) continue
        context.states.delete(key)
      }
      let outputChildren = output.nodeType === 11 ? [...output.childNodes] : [output]
      const existingChildren = [...container.childNodes]
      const hydrated = context.hydrating
        && existingChildren.length === outputChildren.length
        && outputChildren.every((child, index) => hydrateNode(child, existingChildren[index], context))
      if (!hydrated) {
        context.hydrating = false
        // A failed structural match may already have activated refs/listeners
        // on the prefix that matched. Release those bindings before replacing
        // or reconciling the server tree, then materialize a fresh client tree
        // with normal DOM prop activation enabled.
        context.geometryIndex = 0
        context.hasRefs = false
        context.visitedLazyIdentities.clear()
        context.lazyNodes.clear()
        output = collectStateReads(() => renderViewNode(value, renderer), dependency => dependencies.add(dependency))
        outputChildren = output.nodeType === 11 ? [...output.childNodes] : [output]
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
      commitRefs()
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
      activeRefs.forEach(entry => entry.cleanup())
      activeRefs.clear()
      lazyViewportCleanups.forEach(cleanup => cleanup())
      lazyViewportCleanups.length = 0
      for (const child of container.childNodes) releaseDomSubtree(child, context)
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
