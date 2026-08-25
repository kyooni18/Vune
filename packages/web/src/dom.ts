import {
  collectLogicalViewIdentities,
  collectStateReads,
  edgeInsetsFromCss,
  frameStyle,
  renderViewNode,
  subscribeState,
  viewIdentityKey,
  withRenderTransaction,
  zeroGeometry,
  type VuneRenderer,
  type CompiledTemplateValue,
  type GeometryProxy,
  type LazyViewNode,
  type LazyViewRange,
  type StateRef,
  type Transaction,
  type ViewGraphValue,
  type ViewHostNode,
  type ViewModifierNode,
} from "@vune-ui/core"
import { renderToHTML } from "./ssr.js"
import { hydrateNode } from "./hydration.js"
import { applyDomProps, clearDomEvents, commitStagedDomProps, patchDomProps, setDomEvent, setDomRef, synchronizeDomSelectValue } from "./props.js"
import { domContentContainer, nativeElementProps, normalizedRawTextValue, propsOf, rawTextHtmlElements, styleOf, validTableChildElements, voidHtmlElements, type DomRenderContext } from "./shared.js"

interface DomViewBoundary {
  readonly key: string
  identity: readonly (string | number)[]
  host: unknown
  node: ViewHostNode
  render: (props?: Record<string, unknown>) => Node
  resolvedProps: Record<string, unknown>
  dependencies: Set<StateRef<unknown>>
  readonly subscriptions: Map<StateRef<unknown>, () => void>
  readonly children: Set<string>
  readonly nextChildren: Set<string>
  currentNodes: Node[]
  nextNodes: Node[]
  outerModifiers: ViewModifierNode[]
  parentKey?: string
  pendingTransaction?: Transaction
  scheduled: boolean
  mounted: boolean
  localSafe: boolean
  renderedBody: boolean
}

interface DomViewRuntime {
  readonly boundaries: Map<string, DomViewBoundary>
  readonly nodeKeys: WeakMap<Node, Set<string>>
  readonly reuseCandidates: WeakMap<Node, Node>
  readonly stack: string[]
  renderedKeys: Set<string>
  passVisitedStates: Set<string>
  readonly rootChildren: Set<string>
  readonly rootNextChildren: Set<string>
  forceAll: boolean
  replayingModifiers: boolean
  boundaryRootKey?: string
  materializeView?: (
    node: ViewHostNode,
    render: (props?: Record<string, unknown>) => Node,
    identity: readonly (string | number)[],
    force?: boolean,
  ) => Node
}

const domViewRuntimes = new WeakMap<DomRenderContext, DomViewRuntime>()

function runtimeFor(context: DomRenderContext): DomViewRuntime | undefined {
  return domViewRuntimes.get(context)
}

function shallowRecordEqual(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  if (left === right) return true
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key) || !Object.is(left[key], right[key])) return false
  }
  return true
}

function outputNodes(output: Node): Node[] {
  return output.nodeType === 11 ? [...output.childNodes] : [output]
}

function addBoundaryKey(node: Node, key: string, runtime: DomViewRuntime): void {
  const keys = runtime.nodeKeys.get(node) ?? new Set<string>()
  keys.add(key)
  runtime.nodeKeys.set(node, keys)
}

function markBoundaryOutput(output: Node, key: string, runtime: DomViewRuntime): void {
  outputNodes(output).forEach(node => addBoundaryKey(node, key, runtime))
}

function bindCandidateNode(candidate: Node, live: Node, context: DomRenderContext): void {
  const runtime = runtimeFor(context)
  if (!runtime) return
  const candidateKeys = runtime.nodeKeys.get(candidate)
  if (!candidateKeys || candidateKeys.size === 0) return
  const liveKeys = runtime.nodeKeys.get(live) ?? new Set<string>()
  for (const key of candidateKeys) {
    liveKeys.add(key)
    const boundary = runtime.boundaries.get(key)
    if (boundary && !boundary.nextNodes.includes(live)) boundary.nextNodes.push(live)
  }
  runtime.nodeKeys.set(live, liveKeys)
}

function commitStagedSubtree(node: Node, context: DomRenderContext): void {
  if (node.nodeType === 1) commitStagedDomProps(node as Element, context)
  const content = node.nodeType === 1 ? domContentContainer(node as Element) : node
  for (const child of [...content.childNodes]) commitStagedSubtree(child, context)
  if (node.nodeType === 1) synchronizeDomSelectValue(node as Element, context.domProps.get(node as Element))
}

function bindInsertedSubtree(node: Node, context: DomRenderContext): void {
  const runtime = runtimeFor(context)
  const reusable = runtime?.reuseCandidates.get(node)
  if (reusable && reusable !== node && node.parentNode) {
    // A reused View may be carried through a newly-created ancestor. Patch any
    // staged outer modifiers onto the original root, then move that live node
    // into the candidate position instead of committing a clone/placeholder.
    if (node.nodeType === 1 && reusable.nodeType === 1) {
      reconcileDomNode(reusable.parentNode ?? node.parentNode, reusable, node, context)
    }
    const parent = node.parentNode
    parent.replaceChild(reusable, node)
    bindCandidateNode(node, reusable, context)
    bindInsertedSubtree(reusable, context)
    return
  }
  bindCandidateNode(node, node, context)
  if (node.nodeType === 1) {
    const element = node as Element
    const props = context.domProps.get(element)
    for (const [key, value] of Object.entries(props ?? {})) {
      if (/^on[A-Za-z]/.test(key) && typeof value === "function") {
        // Candidate trees intentionally stage event props without native
        // listeners. Attach only when a node actually becomes live.
        setDomEvent(element, key, value, context, true)
      }
    }
  }
  const content = node.nodeType === 1 ? domContentContainer(node as Element) : node
  for (const child of [...content.childNodes]) bindInsertedSubtree(child, context)
}

function bindHydratedSubtree(candidate: Node, live: Node, context: DomRenderContext): void {
  bindCandidateNode(candidate, live, context)
  const candidateContent = candidate.nodeType === 1 ? domContentContainer(candidate as Element) : candidate
  const liveContent = live.nodeType === 1 ? domContentContainer(live as Element) : live
  const count = Math.min(candidateContent.childNodes.length, liveContent.childNodes.length)
  for (let index = 0; index < count; index += 1) {
    bindHydratedSubtree(candidateContent.childNodes[index], liveContent.childNodes[index], context)
  }
}

function copyCandidateMetadata(source: Node, target: Node, context: DomRenderContext): void {
  const runtime = runtimeFor(context)
  const props = source.nodeType === 1 ? context.domProps.get(source as Element) : undefined
  if (props && target.nodeType === 1) {
    context.domProps.set(target as Element, {
      ...props,
      ...(props.style && typeof props.style === "object" ? { style: { ...(props.style as Record<string, unknown>) } } : {}),
    })
  }
  const key = context.domKeys.get(source)
  if (key !== undefined) context.domKeys.set(target, key)
  if (source.nodeType === 1 && target.nodeType === 1) {
    const tag = context.domTags.get(source as Element)
    if (tag !== undefined) context.domTags.set(target as Element, tag)
    const lazyKey = context.lazyKeys.get(source)
    if (lazyKey !== undefined) context.lazyKeys.set(target, lazyKey)
  }
  if (runtime) {
    const boundaryKeys = runtime.nodeKeys.get(source)
    if (boundaryKeys) runtime.nodeKeys.set(target, new Set(boundaryKeys))
    runtime.reuseCandidates.set(target, source)
  }
}

function reusableBoundaryCandidate(current: Node, context: DomRenderContext): Node {
  // Unchanged View boundaries only need an identity carrier while their parent
  // is staged. A comment avoids cloning real DOM nodes and their attributes.
  const candidate = context.document.createComment("vune-reuse")
  copyCandidateMetadata(current, candidate, context)
  return candidate
}

function reusableBoundaryOutput(boundary: DomViewBoundary, context: DomRenderContext): Node {
  if (boundary.currentNodes.length === 1) return reusableBoundaryCandidate(boundary.currentNodes[0], context)
  const fragment = context.document.createDocumentFragment()
  for (const current of boundary.currentNodes) fragment.appendChild(reusableBoundaryCandidate(current, context))
  return fragment
}

function promoteReusableCandidate(candidate: Node, context: DomRenderContext): Node {
  const live = runtimeFor(context)?.reuseCandidates.get(candidate)
  if (candidate.nodeType !== 8 || !live || live.nodeType !== 1) return candidate
  const element = live as Element
  const promoted = context.document.createElementNS(element.namespaceURI, element.localName)
  copyCandidateMetadata(live, promoted, context)
  if (candidate.parentNode) candidate.parentNode.replaceChild(promoted, candidate)
  return promoted
}

function promoteReusableContent(content: Node, context: DomRenderContext): Node {
  if (content.nodeType === 8) return promoteReusableCandidate(content, context)
  if (content.nodeType !== 11) return content
  for (const child of [...content.childNodes]) promoteReusableCandidate(child, context)
  return content
}

function markUnsafeViewAncestors(context: DomRenderContext): void {
  const runtime = runtimeFor(context)
  if (!runtime) return
  for (const key of runtime.stack) {
    const boundary = runtime.boundaries.get(key)
    if (boundary) boundary.localSafe = false
  }
}

function retainBoundaryStateTree(key: string, context: DomRenderContext, runtime: DomViewRuntime): void {
  const boundary = runtime.boundaries.get(key)
  if (!boundary) return
  context.visitedStateIdentities.add(key)
  runtime.passVisitedStates.add(key)
  for (const child of boundary.children) retainBoundaryStateTree(child, context, runtime)
}

function nodeKey(node: Node, context: DomRenderContext): string | number | undefined {
  return context.domKeys.get(node)
}

function longestIncreasingSubsequenceIndices(values: readonly number[]): Set<number> {
  if (values.length === 0) return new Set()
  const predecessors = new Array<number>(values.length).fill(-1)
  const tails: number[] = []
  for (let index = 0; index < values.length; index += 1) {
    let low = 0
    let high = tails.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (values[tails[middle]] < values[index]) low = middle + 1
      else high = middle
    }
    if (low > 0) predecessors[index] = tails[low - 1]
    tails[low] = index
  }
  const indices = new Set<number>()
  let cursor = tails[tails.length - 1]
  while (cursor !== undefined && cursor >= 0) {
    indices.add(cursor)
    cursor = predecessors[cursor]
  }
  return indices
}

function appendNodeBatch(parent: Node, nodes: readonly Node[]): void {
  if (nodes.length === 0) return
  const append = (parent as Node & { append?: (...nodes: Node[]) => void }).append
  if (typeof append === "function") {
    const chunkSize = 4096
    for (let index = 0; index < nodes.length; index += chunkSize) {
      append.call(parent, ...nodes.slice(index, index + chunkSize))
    }
    return
  }
  const fragment = parent.ownerDocument?.createDocumentFragment()
  if (!fragment) {
    for (const node of nodes) parent.appendChild(node)
    return
  }
  for (const node of nodes) fragment.appendChild(node)
  parent.appendChild(fragment)
}

function reconcileTailAppend(
  parent: Node,
  currentChildren: readonly Node[],
  nextChildren: readonly Node[],
  context: DomRenderContext,
): boolean {
  if (currentChildren.length === 0 || nextChildren.length <= currentChildren.length) return false
  const runtime = runtimeFor(context)
  const currentKeys = new Set<string | number>()
  for (let index = 0; index < currentChildren.length; index += 1) {
    const current = currentChildren[index]
    const next = nextChildren[index]
    const currentKey = nodeKey(current, context)
    const nextKey = nodeKey(next, context)
    const reusable = runtime?.reuseCandidates.get(next)
    if (currentKey !== undefined) currentKeys.add(currentKey)
    if (reusable && reusable !== current) return false
    if ((currentKey !== undefined || nextKey !== undefined) && currentKey !== nextKey) return false
  }
  for (let index = currentChildren.length; index < nextChildren.length; index += 1) {
    const next = nextChildren[index]
    const reusable = runtime?.reuseCandidates.get(next)
    if (reusable?.parentNode) return false
    const key = nodeKey(next, context)
    if (key !== undefined && currentKeys.has(key)) return false
  }
  for (let index = 0; index < currentChildren.length; index += 1) {
    reconcileDomNode(parent, currentChildren[index], nextChildren[index], context)
  }
  const additions = nextChildren.slice(currentChildren.length)
  for (const addition of additions) commitStagedSubtree(addition, context)
  appendNodeBatch(parent, additions)
  for (const addition of additions) bindInsertedSubtree(addition, context)
  return true
}

function reconcilePureKeyedPermutation(
  parent: Node,
  currentChildren: readonly Node[],
  nextChildren: readonly Node[],
  context: DomRenderContext,
): boolean {
  if (currentChildren.length < 2 || currentChildren.length !== nextChildren.length) return false
  const keyed = new Map<string | number, Node>()
  const oldIndex = new Map<Node, number>()
  for (let index = 0; index < currentChildren.length; index += 1) {
    const child = currentChildren[index]
    const key = nodeKey(child, context)
    if (key === undefined || keyed.has(key)) return false
    keyed.set(key, child)
    oldIndex.set(child, index)
  }
  const desired: Node[] = []
  const indices: number[] = []
  const seen = new Set<string | number>()
  for (const next of nextChildren) {
    const key = nodeKey(next, context)
    if (key === undefined || seen.has(key)) return false
    seen.add(key)
    const live = runtimeFor(context)?.reuseCandidates.get(next) ?? keyed.get(key)
    if (!live || live.parentNode !== parent || nodeKey(live, context) !== key) return false
    const index = oldIndex.get(live)
    if (index === undefined) return false
    desired.push(live)
    indices.push(index)
  }

  const stable = longestIncreasingSubsequenceIndices(indices)
  const moveCount = desired.length - stable.size
  for (let index = 0; index < nextChildren.length; index += 1) {
    reconcileDomNode(parent, desired[index], nextChildren[index], context)
  }
  if (moveCount === 0) return true

  // When most rows move, repeatedly editing the live child list can become
  // quadratic in DOM implementations. Move the permutation through a detached
  // fragment so style/layout work is deferred until a single final insertion.
  if (desired.length >= 64 && moveCount * 2 >= desired.length) {
    appendNodeBatch(parent, desired)
    return true
  }

  // Otherwise keep the LIS in place and move only the minimal set of nodes.
  for (let index = desired.length - 1; index >= 0; index -= 1) {
    if (stable.has(index)) continue
    const anchor = index + 1 < desired.length ? desired[index + 1] : null
    if (desired[index].nextSibling !== anchor) parent.insertBefore(desired[index], anchor)
  }
  return true
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
  commitStagedSubtree(next, context)
  parent.replaceChild(next, current)
  bindInsertedSubtree(next, context)
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
  if (reconcileTailAppend(parent, currentChildren, nextArray, context)) return
  if (reconcilePureKeyedPermutation(parent, currentChildren, nextArray, context)) return
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
    const reusable = runtimeFor(context)?.reuseCandidates.get(next)
    let current = reusable && reusable.parentNode ? reusable : key === undefined ? unkeyed[nextUnkeyed++] : keyed.get(key)
    if (current) used.add(current)
    if (!current) {
      commitStagedSubtree(next, context)
      parent.insertBefore(next, parent.childNodes[index] ?? null)
      current = next
      bindInsertedSubtree(next, context)
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
  const stagedReuse = runtimeFor(context)?.reuseCandidates.get(next)
  if (stagedReuse === current && next.nodeType === 8) {
    bindCandidateNode(next, current, context)
    return current
  }
  if (current.nodeType !== next.nodeType) return replaceDomNode(parent, current, next, context)
  if (current.nodeType === 3 && next.nodeType === 3) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue
    bindCandidateNode(next, current, context)
    return current
  }
  if (current.nodeType !== 1 || next.nodeType !== 1) return current
  const currentElement = current as Element
  const nextElement = next as Element
  if (currentElement.namespaceURI !== nextElement.namespaceURI || currentElement.tagName !== nextElement.tagName) {
    return replaceDomNode(parent, current, next, context)
  }
  const reusable = runtimeFor(context)?.reuseCandidates.get(next)
  const lazyKey = context.lazyKeys.get(nextElement)
  if (lazyKey) context.lazyKeys.set(currentElement, lazyKey)
  patchDomProps(currentElement, context.domProps.get(nextElement), context)
  const nextKey = nodeKey(nextElement, context)
  if (nextKey !== undefined) context.domKeys.set(currentElement, nextKey)
  else if (nodeKey(currentElement, context) !== undefined) context.domKeys.delete(currentElement)
  bindCandidateNode(next, current, context)
  if (reusable !== current) reconcileDomChildren(domContentContainer(currentElement), domContentContainer(nextElement).childNodes, context)
  synchronizeDomSelectValue(currentElement, context.domProps.get(nextElement))
  return current
}

function reconcileDomRange(parent: Node, currentNodes: readonly Node[], nextNodes: readonly Node[], context: DomRenderContext): void {
  const current = currentNodes.filter(node => node.parentNode === parent)
  if (current.length === 0) {
    for (const next of nextNodes) {
      commitStagedSubtree(next, context)
      parent.appendChild(next)
      bindInsertedSubtree(next, context)
    }
    return
  }
  const after = current[current.length - 1].nextSibling
  const keyed = new Map<string | number, Node>()
  const used = new Set<Node>()
  const unkeyed = current.filter(node => nodeKey(node, context) === undefined)
  for (const node of current) {
    const key = nodeKey(node, context)
    if (key !== undefined) keyed.set(key, node)
  }
  let unkeyedIndex = 0
  let cursor: Node | null = current[0] ?? after
  for (const next of nextNodes) {
    const reusable = runtimeFor(context)?.reuseCandidates.get(next)
    const key = nodeKey(next, context)
    let live = reusable && reusable.parentNode ? reusable : key === undefined ? unkeyed[unkeyedIndex++] : keyed.get(key)
    if (live) used.add(live)
    if (!live) {
      commitStagedSubtree(next, context)
      parent.insertBefore(next, cursor ?? after)
      live = next
      bindInsertedSubtree(next, context)
    } else {
      if (live !== cursor) parent.insertBefore(live, cursor ?? after)
      reconcileDomNode(parent, live, next, context)
    }
    cursor = live.nextSibling
  }
  for (const node of current) {
    if (used.has(node) || node.parentNode !== parent) continue
    releaseDomSubtree(node, context)
    parent.removeChild(node)
  }
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
    // DocumentFragment insertion already moves all of its children in one DOM
    // operation. Flatten only when an SVG parent needs per-element namespace
    // normalization; ordinary HTML/fragment parents can take the fragment as-is.
    if (parent.nodeType !== 1 || childNamespace(parent as Element) === HTML_NS) {
      parent.appendChild(child)
      return
    }
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
  const renderElement = (type: unknown, props: Record<string, unknown> | null, children: readonly Node[]): Node => {
    const tag = typeof type === "string" ? type : "div"
    const element = createTaggedElement(context, tag)
    applyDomProps(element, props, context)
    const hasTextAreaValue = element.namespaceURI === HTML_NS
      && tag.toLowerCase() === "textarea"
      && props?.value !== undefined
      && props.value !== null
    if (hasTextAreaValue && context.stagingProps && !context.hydrating) {
      element.textContent = String(props?.value).replace(/\r\n?/g, "\n")
    }
    const isRawText = element.namespaceURI === HTML_NS && rawTextHtmlElements.has(tag.toLowerCase())
    if (isRawText) {
      element.textContent = rawTextContent(tag, children)
    } else if (!voidHtmlElements.has(tag.toLowerCase()) && !hasTextAreaValue) {
      appendElementChildren(element, tag, children, context)
    }
    synchronizeDomSelectValue(element, props)
    return element
  }
  type DomTemplateFactory = (renderSlot: (index: number) => Node) => Node
  const templateFactories = new WeakMap<object, DomTemplateFactory>()
  const compileTemplate = (value: CompiledTemplateValue): DomTemplateFactory => {
    if (value !== null && typeof value === "object") {
      if (value.kind === "slot") {
        const index = value.index
        return renderSlot => renderSlot(index)
      }
      if (value.kind === "fragment") {
        const children = value.children.map(compileTemplate)
        return renderSlot => {
          const fragment = context.document.createDocumentFragment()
          children.forEach(child => appendDomChild(fragment, child(renderSlot), context))
          return fragment
        }
      }
      if (value.kind === "element") {
        const type = value.type
        const props = value.props
        const children = value.children.map(compileTemplate)
        return renderSlot => renderElement(type, props, children.map(child => child(renderSlot)))
      }
    }
    const text = value === null || value === undefined || value === false || value === true ? "" : String(value)
    return () => context.document.createTextNode(text)
  }
  const runtime = runtimeFor(context)
  let renderer!: VuneRenderer<Node>

  const recordDirectModifiers = (content: Node, modifier: ViewModifierNode): void => {
    if (!runtime || runtime.replayingModifiers || modifier.name === "frame") return
    const seen = new Set<string>()
    for (const node of outputNodes(content)) {
      const keys = runtime.nodeKeys.get(node)
      if (!keys) continue
      for (const key of keys) {
        if (seen.has(key)) continue
        seen.add(key)
        const boundary = runtime.boundaries.get(key)
        if (boundary) boundary.outerModifiers.push(modifier)
      }
    }
  }

  const applyModifier = (content: Node, modifier: ViewModifierNode): Node => {
    recordDirectModifiers(content, modifier)
    if (modifier.name === "keyed") {
      const key = typeof modifier.arguments[0] === "string" || typeof modifier.arguments[0] === "number"
        ? modifier.arguments[0]
        : undefined
      if (key === undefined) return content
      for (const node of outputNodes(content)) context.domKeys.set(node, key)
      return content
    }
    if (modifier.name === "frame") {
      const wrapper = context.document.createElement("div")
      applyDomProps(wrapper, { style: frameStyle(modifier.arguments[0] && typeof modifier.arguments[0] === "object" ? modifier.arguments[0] : {}) }, context)
      appendDomChild(wrapper, content, context)
      return wrapper
    }
    const extraStyle = styleOf(modifier)
    const extraProps = propsOf(modifier)
    if (Object.keys(extraProps).length === 0 && Object.keys(extraStyle).length === 0) return content
    const baseStyle = Object.keys(extraStyle).length > 0 || extraProps.style
      ? { ...extraStyle, ...(extraProps.style && typeof extraProps.style === "object" ? extraProps.style : {}) }
      : undefined
    if (Object.keys(extraProps).length > 0 || baseStyle) content = promoteReusableContent(content, context)
    const nodes = outputNodes(content)
    nodes.forEach(node => {
      if (node.nodeType !== 1) return
      const element = node as Element
      const style = baseStyle ? { ...baseStyle } as Record<string, unknown> : undefined
      if (style && typeof style.transform === "string") {
        const remembered = context.domProps.get(element)?.style
        const currentTransform = remembered && typeof remembered === "object"
          ? (remembered as Record<string, unknown>).transform
          : (element as Element & { readonly style?: CSSStyleDeclaration }).style?.transform
        if (typeof currentTransform === "string" && currentTransform) style.transform = `${currentTransform} ${style.transform}`
      }
      const props = { ...extraProps, ...(style ? { style } : {}) }
      const appliedProps = element.localName.includes("-") ? props : nativeElementProps(props)
      if (Object.keys(appliedProps).length > 0) applyDomProps(element, appliedProps, context)
    })
    return content
  }

  const materializeView = (
    node: ViewHostNode,
    render: (props?: Record<string, unknown>) => Node,
    identity: readonly (string | number)[],
    force = false,
  ): Node => {
    const key = viewIdentityKey(identity)
    context.visitedStateIdentities.add(key)
    runtime?.passVisitedStates.add(key)
    let entry = context.states.get(key)
    if (!entry || entry.host !== node.host) {
      entry = { host: node.host, value: node.state?.(node.props) ?? {} }
      context.states.set(key, entry)
    }
    const resolvedProps = { ...node.props, ...entry.value }
    if (!runtime) return render(resolvedProps)

    const parentKey = runtime.stack.at(-1)
    if (!force || runtime.boundaryRootKey !== key) {
      if (parentKey) runtime.boundaries.get(parentKey)?.nextChildren.add(key)
      else runtime.rootNextChildren.add(key)
    }

    let boundary = runtime.boundaries.get(key)
    if (!boundary || boundary.host !== node.host) {
      if (boundary) {
        boundary.subscriptions.forEach(unsubscribe => unsubscribe())
        boundary.subscriptions.clear()
      }
      boundary = {
        key,
        identity: [...identity],
        host: node.host,
        node,
        render,
        resolvedProps,
        dependencies: new Set(),
        subscriptions: new Map(),
        children: new Set(),
        nextChildren: new Set(),
        currentNodes: [],
        nextNodes: [],
        outerModifiers: [],
        parentKey,
        scheduled: false,
        mounted: false,
        localSafe: true,
        renderedBody: true,
      }
      runtime.boundaries.set(key, boundary)
    }

    const canReuse = !force
      && !runtime.forceAll
      && boundary.mounted
      && !boundary.scheduled
      && boundary.host === node.host
      && shallowRecordEqual(boundary.resolvedProps, resolvedProps)
      && boundary.currentNodes.length > 0
      && boundary.currentNodes.every(current => current.parentNode !== null)

    boundary.host = node.host
    boundary.identity = [...identity]
    boundary.node = node
    boundary.render = render
    boundary.resolvedProps = resolvedProps
    boundary.parentKey = parentKey
    boundary.nextNodes = []
    boundary.nextChildren.clear()
    runtime.renderedKeys.add(key)

    if (canReuse) {
      boundary.renderedBody = false
      boundary.children.forEach(child => boundary!.nextChildren.add(child))
      boundary.children.forEach(child => retainBoundaryStateTree(child, context, runtime))
      boundary.outerModifiers = []
      const output = reusableBoundaryOutput(boundary, context)
      markBoundaryOutput(output, key, runtime)
      return output
    }

    const previousOuterModifiers = force ? [...boundary.outerModifiers] : []
    if (!force) boundary.outerModifiers = []
    boundary.renderedBody = true
    boundary.localSafe = true
    const declared = node.dependencies
      ? collectStateReads(() => node.dependencies!(resolvedProps), () => undefined)
      : undefined
    const dependencies = new Set<StateRef<unknown>>(declared ?? [])
    runtime.stack.push(key)
    let output: Node
    try {
      output = withRenderTransaction(boundary.pendingTransaction, () => collectStateReads(
        () => render(resolvedProps),
        dependency => { if (!(declared && node.dependenciesComplete === true)) dependencies.add(dependency) },
      ))
    } finally {
      runtime.stack.pop()
    }
    boundary.dependencies = dependencies
    boundary.scheduled = false
    boundary.pendingTransaction = undefined
    markBoundaryOutput(output, key, runtime)

    if (force && previousOuterModifiers.length > 0) {
      runtime.replayingModifiers = true
      try {
        for (const modifier of previousOuterModifiers) output = applyModifier(output, modifier)
      } finally {
        runtime.replayingModifiers = false
      }
      boundary.outerModifiers = previousOuterModifiers
      markBoundaryOutput(output, key, runtime)
    }
    return output
  }

  runtime && Object.assign(runtime, { materializeView })

  renderer = {
    element(type, props, ...children) {
      return renderElement(type, props, children)
    },
    fragment(children) {
      const fragment = context.document.createDocumentFragment()
      children.forEach(child => appendDomChild(fragment, child, context))
      return fragment
    },
    value(value) {
      return context.document.createTextNode(value === null || value === undefined || value === false ? "" : String(value))
    },
    template(node, renderSlot) {
      let factory = templateFactories.get(node.template)
      if (!factory) {
        factory = compileTemplate(node.template.root)
        templateFactories.set(node.template, factory)
      }
      return factory(renderSlot)
    },
    lazy(node, render, identity) {
      markUnsafeViewAncestors(context)
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
      return applyModifier(content, modifier)
    },
    view(node, render, identity) {
      return materializeView(node, render, identity)
    },
    geometry(_node, render) {
      markUnsafeViewAncestors(context)
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
  return renderer
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
  let pendingTransaction: Transaction | undefined
  const subscriptions = new Map<StateRef<unknown>, () => void>()
  const syncSubscriptions = (dependencies: Set<StateRef<unknown>>, schedule: (transaction: Transaction) => void) => {
    for (const [dependency, unsubscribe] of subscriptions) {
      if (dependencies.has(dependency)) continue
      unsubscribe()
      subscriptions.delete(dependency)
    }
    for (const dependency of dependencies) {
      if (subscriptions.has(dependency)) continue
      subscriptions.set(dependency, subscribeState(dependency, schedule))
    }
  }
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
      stagingEvents: true,
      stagingProps: true,
    }
    const viewRuntime: DomViewRuntime = {
      boundaries: new Map(),
      nodeKeys: new WeakMap(),
      reuseCandidates: new WeakMap(),
      stack: [],
      renderedKeys: new Set(),
      passVisitedStates: new Set(),
      rootChildren: new Set(),
      rootNextChildren: new Set(),
      forceAll: false,
      replayingModifiers: false,
    }
    domViewRuntimes.set(context, viewRuntime)
    const renderer = createDomRenderer(context)
    let activeRefs = new Map<Element, { readonly reference: unknown; readonly cleanup: () => void }>()
    let geometryScheduled = false
    let lazyMeasureScheduled = false
    const lazyViewportTargets = new Set<EventTarget>()
    const lazyViewportCleanups: Array<() => void> = []
    let hasMounted = false
    let update: () => void

    const preservedStatePrefixes = () => [...context.preservedLazyStatePrefixes.values()].flatMap(prefixes => [...prefixes])
    const isPreservedStateKey = (key: string): boolean => preservedStatePrefixes().some(prefix => key === prefix || key.startsWith(`${prefix}|`))
    const disposeBoundary = (key: string, preserveState = false): void => {
      const boundary = viewRuntime.boundaries.get(key)
      if (!boundary) {
        if (!preserveState) context.states.delete(key)
        return
      }
      for (const child of [...boundary.children]) disposeBoundary(child, preserveState || isPreservedStateKey(child))
      boundary.subscriptions.forEach(unsubscribe => unsubscribe())
      boundary.subscriptions.clear()
      boundary.scheduled = false
      boundary.currentNodes = []
      viewRuntime.boundaries.delete(key)
      if (!preserveState) context.states.delete(key)
    }
    const beginViewPass = (boundaryRootKey?: string): void => {
      viewRuntime.renderedKeys = new Set()
      viewRuntime.passVisitedStates = new Set()
      viewRuntime.boundaryRootKey = boundaryRootKey
      if (!boundaryRootKey) viewRuntime.rootNextChildren.clear()
    }
    const requestRootUpdate = (transaction?: Transaction, forceAll = true): void => {
      if (transaction) pendingTransaction = transaction
      if (forceAll) viewRuntime.forceAll = true
      if (scheduled || stopped) return
      scheduled = true
      queueMicrotask(() => update())
    }
    const syncBoundarySubscriptions = (boundary: DomViewBoundary): void => {
      for (const [dependency, unsubscribe] of boundary.subscriptions) {
        if (boundary.dependencies.has(dependency)) continue
        unsubscribe()
        boundary.subscriptions.delete(dependency)
      }
      for (const dependency of boundary.dependencies) {
        if (boundary.subscriptions.has(dependency)) continue
        boundary.subscriptions.set(dependency, subscribeState(dependency, transaction => {
          boundary.pendingTransaction = transaction
          if (boundary.scheduled || stopped) return
          boundary.scheduled = true
          if (!boundary.mounted || boundary.currentNodes.length === 0) {
            // A View that currently renders no DOM has no stable local range
            // to patch. Schedule the root pass immediately so a single state
            // microtask can materialize the newly-visible branch. Force the
            // pass because an unchanged mounted ancestor could otherwise be
            // reused before traversal reaches this empty descendant.
            requestRootUpdate(transaction, true)
            return
          }
          if (!boundary.localSafe) {
            // The owning boundary itself must be re-evaluated at the root so
            // geometry/lazy indexes stay globally coherent, but unaffected
            // child View boundaries can still be reused.
            requestRootUpdate(transaction, false)
            return
          }
          queueMicrotask(() => updateBoundary(boundary))
        }))
      }
    }
    const commitViewPass = (rootPass: boolean): void => {
      for (const key of viewRuntime.renderedKeys) {
        const boundary = viewRuntime.boundaries.get(key)
        if (!boundary) continue
        // Reused boundaries keep the same live node range, dependency set, and
        // child boundary graph. Their parent/key metadata was already updated
        // during materialization, so rebuilding Sets and resyncing subscribers
        // here is pure list-size-proportional bookkeeping.
        if (!boundary.renderedBody) continue
        const uniqueNodes = [...new Set(boundary.nextNodes)]
        boundary.currentNodes = uniqueNodes
        boundary.mounted = boundary.currentNodes.length > 0 && boundary.currentNodes.some(node => node.parentNode !== null)
        syncBoundarySubscriptions(boundary)
        if (boundary.renderedBody) {
          for (const child of [...boundary.children]) {
            if (boundary.nextChildren.has(child)) continue
            disposeBoundary(child, isPreservedStateKey(child))
          }
          boundary.children.clear()
          boundary.nextChildren.forEach(child => boundary.children.add(child))
        }
      }
      if (rootPass) {
        for (const child of [...viewRuntime.rootChildren]) {
          if (viewRuntime.rootNextChildren.has(child)) continue
          disposeBoundary(child, isPreservedStateKey(child))
        }
        viewRuntime.rootChildren.clear()
        viewRuntime.rootNextChildren.forEach(child => viewRuntime.rootChildren.add(child))
      }
      viewRuntime.boundaryRootKey = undefined
    }
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
      if (stopped || context.geometryIndex === 0) {
        // GeometryReaders removed since the last pass must not leave stale
        // frames behind: a recycled render-order index would otherwise
        // inherit the removed reader's measurements.
        if (context.geometries.size > 0) context.geometries.clear()
        return
      }
      let changed = false
      const seen = new Set<number>()
      container.querySelectorAll<HTMLElement>('[data-vune="GeometryReader"][data-vune-geometry]').forEach(element => {
        const index = Number(element.dataset.vuneGeometry)
        if (!Number.isInteger(index)) return
        seen.add(index)
        const next = geometryFromElement(element)
        const previous = context.geometries.get(index)
        if (!previous || !sameGeometry(previous, next)) {
          context.geometries.set(index, next)
          changed = true
        }
      })
      for (const index of [...context.geometries.keys()]) {
        if (!seen.has(index)) {
          context.geometries.delete(index)
          changed = true
        }
      }
      if (changed && !geometryScheduled) {
        geometryScheduled = true
        queueMicrotask(() => {
          geometryScheduled = false
          requestRootUpdate(undefined, true)
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
        requestRootUpdate(undefined, true)
      })
    }
    const observeLazyViewport = () => {
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
      // Detached or replaced scroll parents keep handler references alive
      // until unmount unless pruned on every pass.
      const listener = scheduleLazyMeasure as EventListener
      for (const target of [...lazyViewportTargets]) {
        if (targets.includes(target)) continue
        lazyViewportTargets.delete(target)
        target.removeEventListener("scroll", listener)
        target.removeEventListener("resize", listener)
      }
      for (const target of targets) {
        if (lazyViewportTargets.has(target)) continue
        target.addEventListener("scroll", listener, { passive: true })
        target.addEventListener("resize", listener)
        lazyViewportTargets.add(target)
      }
      // The cleanup list mirrors the live target set; the shared listener is
      // removed per remaining target when the mount is disposed.
      lazyViewportCleanups.length = 0
      if (lazyViewportTargets.size > 0) {
        lazyViewportCleanups.push(() => {
          for (const target of lazyViewportTargets) {
            target.removeEventListener("scroll", listener)
            target.removeEventListener("resize", listener)
          }
          lazyViewportTargets.clear()
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
    const updateBoundary = (boundary: DomViewBoundary): void => {
      if (stopped || viewRuntime.boundaries.get(boundary.key) !== boundary || !boundary.scheduled) return
      let parentKey = boundary.parentKey
      while (parentKey) {
        const parentBoundary = viewRuntime.boundaries.get(parentKey)
        if (parentBoundary?.scheduled) return
        parentKey = parentBoundary?.parentKey
      }
      const currentNodes = [...boundary.currentNodes]
      const parent = currentNodes[0]?.parentNode
      if (!parent || currentNodes.some(node => node.parentNode !== parent)) {
        boundary.scheduled = false
        requestRootUpdate(boundary.pendingTransaction, true)
        return
      }
      const renderTransaction = boundary.pendingTransaction
      beginViewPass(boundary.key)
      context.hasRefs = false
      const materialize = viewRuntime.materializeView
      if (!materialize) {
        boundary.scheduled = false
        requestRootUpdate(renderTransaction, true)
        return
      }
      const output = materialize(boundary.node, boundary.render, boundary.identity, true)
      if (!boundary.localSafe) {
        // A branch introduced GeometryReader/Lazy content that was not present
        // when this boundary was classified. Do not commit with local indexes;
        // rerun it through the root transaction instead.
        requestRootUpdate(renderTransaction, false)
        return
      }
      reconcileDomRange(parent, currentNodes, outputNodes(output), context)
      commitViewPass(false)
      commitRefs()
    }

    update = () => {
      if (stopped) return
      scheduled = false
      const scrollPositions = captureLazyScrollPositions()
      context.geometryIndex = 0
      context.hasRefs = false
      context.visitedStateIdentities.clear()
      context.visitedLazyIdentities.clear()
      context.lazyNodes.clear()
      context.preservedLazyStatePrefixes.clear()
      beginViewPass()
      const dependencies = new Set<StateRef<unknown>>()
      context.hydrating = Boolean(options.hydrate && !hasMounted)
      const renderTransaction = pendingTransaction
      pendingTransaction = undefined
      let output = withRenderTransaction(renderTransaction, () => collectStateReads(() => renderViewNode(value, renderer), dependency => dependencies.add(dependency)))
      const preservedStatePrefixes = [...context.preservedLazyStatePrefixes.values()].flatMap(prefixes => [...prefixes])
      for (const key of context.states.keys()) {
        if (context.visitedStateIdentities.has(key)) continue
        if (preservedStatePrefixes.some(prefix => key === prefix || key.startsWith(`${prefix}|`))) continue
        context.states.delete(key)
      }
      let outputChildren = output.nodeType === 11 ? [...output.childNodes] : [output]
      const existingChildren = [...container.childNodes]
      const attemptedHydration = context.hydrating
      const hydrated = attemptedHydration
        && existingChildren.length === outputChildren.length
        && outputChildren.every((child, index) => hydrateNode(child, existingChildren[index], context))
      if (hydrated) {
        outputChildren.forEach((child, index) => bindHydratedSubtree(child, existingChildren[index], context))
      }
      if (!hydrated) {
        context.hydrating = false
        // Ordinary client rendering can reconcile the first candidate tree
        // directly. A failed hydration attempt is the exception: its
        // candidate intentionally skipped event activation, and the partial
        // hydration walk may already have touched live nodes, so materialize
        // one clean client candidate only for that rare fallback path.
        if (attemptedHydration) {
          context.geometryIndex = 0
          context.hasRefs = false
          context.visitedLazyIdentities.clear()
          context.lazyNodes.clear()
          output = withRenderTransaction(renderTransaction, () => collectStateReads(() => renderViewNode(value, renderer), dependency => dependencies.add(dependency)))
          outputChildren = output.nodeType === 11 ? [...output.childNodes] : [output]
        }
        reconcileDomChildren(container, outputChildren, context)
      }
      commitViewPass(true)
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
      syncSubscriptions(dependencies, transaction => {
        requestRootUpdate(transaction, true)
      })
      updateGeometry()
      observeLazyViewport()
      if (refreshLazyRanges() && !scheduled) {
        requestRootUpdate(undefined, true)
      }
      hasMounted = true
      // A geometry/lazy measurement may have queued the next root pass while
      // this one was committing. Keep the force flag for that queued pass;
      // otherwise the top View could be reused and the changed range would
      // never be materialized.
      if (!scheduled) viewRuntime.forceAll = false
    }
    update()
    return () => {
      if (stopped) return
      stopped = true
      subscriptions.forEach(unsubscribe => unsubscribe())
      subscriptions.clear()
      for (const key of [...viewRuntime.rootChildren]) disposeBoundary(key)
      viewRuntime.rootChildren.clear()
      viewRuntime.rootNextChildren.clear()
      for (const boundary of viewRuntime.boundaries.values()) {
        boundary.subscriptions.forEach(unsubscribe => unsubscribe())
        boundary.subscriptions.clear()
      }
      viewRuntime.boundaries.clear()
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
    const dependencies = new Set<StateRef<unknown>>()
    const renderTransaction = pendingTransaction
    pendingTransaction = undefined
    const html = withRenderTransaction(renderTransaction, () => collectStateReads(() => renderToHTML(value), dependency => dependencies.add(dependency)))
    container.innerHTML = html
    syncSubscriptions(dependencies, transaction => {
      pendingTransaction = transaction
      if (scheduled || stopped) return
      scheduled = true
      queueMicrotask(update)
    })
  }
  update()
  return () => {
    if (stopped) return
    stopped = true
    subscriptions.forEach(unsubscribe => unsubscribe())
    subscriptions.clear()
    if (container.innerHTML) container.innerHTML = ""
  }
}
