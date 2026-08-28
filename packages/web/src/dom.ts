import {
  collectLogicalViewIdentities,
  collectStateReads,
  edgeInsetsFromCss,
  frameStyle,
  renderViewNode,
  renderViewNodeAt,
  subscribeState,
  viewIdentityKey,
  withRenderTransaction,
  zeroGeometry,
  type VuneRenderer,
  type CompiledTemplateDescriptor,
  type CompiledTemplateValue,
  type GeometryProxy,
  type LazyViewNode,
  type LazyViewRange,
  type StateRef,
  type Transaction,
  type Animation,
  type Transition,
  type ViewGraphValue,
  type ViewHostNode,
  type ViewModifierNode,
} from "@vune-ui/core"
import { renderToHTML } from "./ssr.js"
import { hydrateNode } from "./hydration.js"
import { applyDomProps, clearDomEvents, commitStagedDomProps, patchDomProps, setDomRef, synchronizeDomSelectValue, type DomStyleMotionPolicy } from "./props.js"
import { animateDomLayout, cancelDomAnimations, type DomLayoutBox } from "./motion.js"
import { recordVuneBoundaryDisposed, recordVuneBoundaryRender, vuneDevtoolsEnabled } from "./devtools.js"
import { classNameOf, cssPropertyName, domContentContainer, nativeElementProps, normalizedRawTextValue, propsOf, rawTextHtmlElements, styleOf, validTableChildElements, voidHtmlElements, type DomRenderContext } from "./shared.js"
import { disposeFocusScope } from "./focus.js"
import { LazyMeasurementIndex, lazyViewportOffset } from "./lazy-index.js"
import { playWebTransition, type WebTransitionPlayback } from "./transition.js"
import { activateWebPresentation, disposeWebPresentation } from "./presentation.js"

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

interface DomCompiledTemplateInstance {
  readonly template: CompiledTemplateDescriptor
  roots: Node[]
  /** Static root props captured before any outer modifiers are staged. */
  readonly rootProps: readonly (Record<string, unknown> | null)[]
  readonly textSlots: Array<Text | undefined>
  /** Live DOM ranges produced by compiler-proven generic View slots. */
  readonly viewSlots: Array<Node[] | undefined>
}

interface DomCompiledTemplateBinding {
  readonly key: string
  readonly index: number
}

interface DomAnimationDomain {
  readonly animation: Animation | null
  readonly trigger: unknown
  readonly properties: readonly string[]
}

interface DomMotionRenderState {
  readonly pendingProperties: Set<string>
  readonly domains: DomAnimationDomain[]
  /** True when this state only describes modifiers layered onto a reused View. */
  readonly partial: boolean
}

interface DomTransitionState {
  readonly transition: Transition
  readonly animation?: Animation | null
}

const directCompiledBodyModifierNames = new Set([
  "padding", "margin", "gap", "font", "fontSize", "bold",
  "foreground", "foregroundStyle", "background", "opacity",
  "scaleEffect", "rotationEffect", "offset", "style", "className", "animation",
])

function compiledTextSlotValue(value: unknown): { readonly ok: true; readonly value: string } | { readonly ok: false } {
  if (value === null || value === undefined || typeof value === "boolean") return { ok: true, value: "" }
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") return { ok: true, value: String(value) }
  return { ok: false }
}

interface DomViewRuntime {
  readonly boundaries: Map<string, DomViewBoundary>
  readonly nodeKeys: WeakMap<Node, Set<string>>
  readonly reuseCandidates: WeakMap<Node, Node>
  /** Baseline props for compiler-template identity carriers. */
  readonly reuseCandidateBaseProps: WeakMap<Node, Record<string, unknown> | null>
  readonly compiledTemplates: Map<string, DomCompiledTemplateInstance>
  readonly compiledTemplateRoots: WeakMap<Node, DomCompiledTemplateBinding>
  readonly compiledTemplateTextSlots: WeakMap<Node, DomCompiledTemplateBinding>
  readonly compiledTemplateViewSlots: WeakMap<Node, DomCompiledTemplateBinding>
  readonly compiledTemplatePatches: WeakMap<Node, () => void>
  /** Per-render animation domains attached by .animation(_:value:). */
  readonly motionStates: WeakMap<Node, DomMotionRenderState>
  readonly transitionStates: WeakMap<Node, DomTransitionState>
  readonly enteredTransitions: WeakSet<Node>
  readonly exitTransitions: Map<Node, WebTransitionPlayback>
  transitionLayer?: HTMLElement
  /** Geometry reads are collected before a mutation and committed as one FLIP batch. */
  readonly layoutSnapshots: Map<Element, { readonly before: DomLayoutBox; animation: Animation }>
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

const layoutAffectingMotionProperties = new Set([
  "width", "height", "min-width", "min-height", "max-width", "max-height",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "gap", "row-gap", "column-gap", "font", "font-size", "line-height",
  "letter-spacing", "word-spacing", "border-width", "border-top-width",
  "border-right-width", "border-bottom-width", "border-left-width",
  "flex-basis", "grid-template-columns", "grid-template-rows",
])

function motionStateFor(node: Node, runtime: DomViewRuntime): DomMotionRenderState {
  let state = runtime.motionStates.get(node)
  if (!state) {
    state = { pendingProperties: new Set(), domains: [], partial: node.nodeType === 8 }
    runtime.motionStates.set(node, state)
  }
  return state
}

function recordMotionStyleProperties(content: Node, properties: readonly string[], context: DomRenderContext): void {
  if (properties.length === 0) return
  const runtime = runtimeFor(context)
  if (!runtime) return
  for (const node of outputNodes(content)) {
    if (node.nodeType !== 1 && node.nodeType !== 8) continue
    const state = motionStateFor(node, runtime)
    for (const property of properties) state.pendingProperties.add(property)
  }
}

function recordAnimationDomain(content: Node, animation: Animation | null, trigger: unknown, context: DomRenderContext): void {
  const runtime = runtimeFor(context)
  if (!runtime) return
  for (const node of outputNodes(content)) {
    if (node.nodeType !== 1 && node.nodeType !== 8) continue
    const state = motionStateFor(node, runtime)
    state.domains.push({ animation, trigger, properties: [...state.pendingProperties] })
    state.pendingProperties.clear()
  }
}

function copyMotionRenderState(source: Node, target: Node, runtime: DomViewRuntime): void {
  const state = runtime.motionStates.get(source)
  if (!state) return
  runtime.motionStates.set(target, {
    pendingProperties: new Set(state.pendingProperties),
    domains: state.domains.map(domain => ({ ...domain, properties: [...domain.properties] })),
    partial: state.partial,
  })
}

interface ResolvedMotionState {
  readonly policy?: DomStyleMotionPolicy
  readonly merged?: DomMotionRenderState
  /** undefined inherits the active transaction, null explicitly disables layout motion. */
  readonly layoutAnimation?: Animation | null
}

function resolveMotionRenderState(
  live: Element,
  nextState: DomMotionRenderState,
  context: DomRenderContext,
): ResolvedMotionState {
  const runtime = runtimeFor(context)
  if (!runtime) return {}
  const previous = runtime.motionStates.get(live)
  const previousDomains = previous?.domains ?? []
  const offset = nextState.partial ? Math.max(0, previousDomains.length - nextState.domains.length) : 0
  const comparedPrevious = nextState.partial ? previousDomains.slice(offset) : previousDomains
  const changed = nextState.domains.map((domain, index) => !Object.is(domain.trigger, comparedPrevious[index]?.trigger))
  const mergedDomains = nextState.partial
    ? [...previousDomains.slice(0, offset), ...nextState.domains]
    : [...nextState.domains]
  const merged: DomMotionRenderState = {
    pendingProperties: new Set(nextState.pendingProperties),
    domains: mergedDomains.map(domain => ({ ...domain, properties: [...domain.properties] })),
    partial: false,
  }

  let layoutAnimation: Animation | null | undefined
  let hasLayoutDecision = false
  for (let index = nextState.domains.length - 1; index >= 0; index -= 1) {
    const domain = nextState.domains[index]
    if (!changed[index]) continue
    if (domain.properties.length === 0 || domain.properties.some(property => layoutAffectingMotionProperties.has(property))) {
      layoutAnimation = domain.animation
      hasLayoutDecision = true
      break
    }
  }
  if (!hasLayoutDecision) {
    for (let index = nextState.domains.length - 1; index >= 0; index -= 1) {
      const domain = nextState.domains[index]
      if (!changed[index]) continue
      // Intrinsic content changes (for example text length) may resize a view
      // even when the modifier domain only owns opacity or color. The latest
      // changed domain is therefore the semantic layout trigger too.
      layoutAnimation = domain.animation
      hasLayoutDecision = true
      break
    }
  }

  const policy: DomStyleMotionPolicy = {
    animationForProperty(property) {
      for (let index = nextState.domains.length - 1; index >= 0; index -= 1) {
        const domain = nextState.domains[index]
        if (!domain.properties.includes(property)) continue
        return changed[index] ? domain.animation : undefined
      }
      return undefined
    },
  }
  return { policy, merged, layoutAnimation }
}

function resolveMotionState(
  live: Element,
  candidate: Node,
  context: DomRenderContext,
): ResolvedMotionState {
  const runtime = runtimeFor(context)
  const nextState = runtime?.motionStates.get(candidate)
  return nextState ? resolveMotionRenderState(live, nextState, context) : {}
}

function commitResolvedMotionState(live: Element, resolved: ResolvedMotionState, context: DomRenderContext): void {
  const runtime = runtimeFor(context)
  if (!runtime) return
  if (resolved.merged) runtime.motionStates.set(live, resolved.merged)
}

function readLayoutBox(element: Element): DomLayoutBox | undefined {
  const read = (element as Element & { getBoundingClientRect?: () => DOMRect }).getBoundingClientRect
  if (typeof read !== "function") return undefined
  const rect = read.call(element)
  const box = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  return Object.values(box).every(Number.isFinite) && box.width > 0 && box.height > 0 ? box : undefined
}

function captureLayoutElement(element: Element, animation: Animation | null | undefined, context: DomRenderContext): void {
  if (context.activeTransaction?.disablesAnimations) return
  const selected = animation === undefined ? context.activeTransaction?.animation : animation
  if (!selected) return
  const runtime = runtimeFor(context)
  if (!runtime) return
  const existing = runtime.layoutSnapshots.get(element)
  if (existing) {
    // A property-scoped .animation(value:) discovered later in reconciliation
    // is more specific than the surrounding transaction. Keep the first box,
    // but allow the animation plan to be upgraded before commit.
    if (animation !== undefined && animation !== null) existing.animation = animation
    return
  }
  const before = readLayoutBox(element)
  if (before) runtime.layoutSnapshots.set(element, { before, animation: selected })
}

function captureLayoutNeighborhood(element: Element, animation: Animation | null | undefined, context: DomRenderContext): void {
  captureLayoutElement(element, animation, context)
  const parent = element.parentElement
  if (!parent) return
  // A size change can move siblings without changing their own props. Capture
  // the local sibling set before the mutation so those positional changes can
  // receive the same semantic animation without scanning the whole document.
  for (const sibling of parent.children) captureLayoutElement(sibling, animation, context)
}

function captureLayoutChildren(parent: Node, animation: Animation | null | undefined, context: DomRenderContext): void {
  if (parent.nodeType === 1) captureLayoutElement(parent as Element, animation, context)
  for (const child of parent.childNodes) {
    if (child.nodeType === 1) captureLayoutElement(child as Element, animation, context)
  }
}

function flushLayoutMotion(context: DomRenderContext): void {
  const runtime = runtimeFor(context)
  if (!runtime || runtime.layoutSnapshots.size === 0) return
  const changed: Array<{ readonly element: Element; readonly before: DomLayoutBox; readonly after: DomLayoutBox; readonly animation: Animation }> = []
  for (const [element, snapshot] of runtime.layoutSnapshots) {
    const after = readLayoutBox(element)
    if (!after) continue
    const { before } = snapshot
    const differs = Math.abs(before.left - after.left) >= 0.01
      || Math.abs(before.top - after.top) >= 0.01
      || Math.abs(before.width - after.width) >= 0.01
      || Math.abs(before.height - after.height) >= 0.01
    if (differs) changed.push({ element, before, after, animation: snapshot.animation })
  }
  runtime.layoutSnapshots.clear()

  const changedElements = new Map(changed.map(entry => [entry.element, entry] as const))
  for (const entry of changed) {
    // When an ancestor and descendant are being driven by the exact same plan,
    // animating both FLIP transforms would double-apply the same geometric
    // movement. Let the nearest changed ancestor carry that visual delta. A
    // descendant with a different Animation remains independent by design.
    let ancestor = entry.element.parentElement
    let covered = false
    while (ancestor) {
      const parentChange = changedElements.get(ancestor)
      if (parentChange && parentChange.animation === entry.animation) {
        covered = true
        break
      }
      ancestor = ancestor.parentElement
    }
    if (!covered) animateDomLayout(entry.element, entry.before, entry.after, entry.animation)
  }
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

  // Compiled-template bindings are renderer metadata just like View-boundary
  // identities. Transfer them before the boundary early-return so text-only
  // templates also work outside defineView() boundaries and during hydration.
  const rootBinding = runtime.compiledTemplateRoots.get(candidate)
  if (rootBinding) {
    const instance = runtime.compiledTemplates.get(rootBinding.key)
    if (instance && rootBinding.index < instance.roots.length) instance.roots[rootBinding.index] = live
    runtime.compiledTemplateRoots.set(live, rootBinding)
  }
  const slotBinding = runtime.compiledTemplateTextSlots.get(candidate)
  if (slotBinding && live.nodeType === 3) {
    const instance = runtime.compiledTemplates.get(slotBinding.key)
    if (instance && slotBinding.index < instance.textSlots.length) instance.textSlots[slotBinding.index] = live as Text
    runtime.compiledTemplateTextSlots.set(live, slotBinding)
  }
  const viewSlotBinding = runtime.compiledTemplateViewSlots.get(candidate)
  if (viewSlotBinding) {
    const instance = runtime.compiledTemplates.get(viewSlotBinding.key)
    const nodes = instance?.viewSlots[viewSlotBinding.index]
    if (instance && nodes) {
      const position = nodes.indexOf(candidate)
      if (position >= 0 && candidate !== live) {
        const nextNodes = [...nodes]
        nextNodes[position] = live
        instance.viewSlots[viewSlotBinding.index] = nextNodes
      }
    }
    runtime.compiledTemplateViewSlots.set(live, viewSlotBinding)
  }
  const candidateMotion = runtime.motionStates.get(candidate)
  if (candidateMotion && live.nodeType === 1) {
    runtime.motionStates.set(live, {
      pendingProperties: new Set(candidateMotion.pendingProperties),
      domains: candidateMotion.domains.map(domain => ({ ...domain, properties: [...domain.properties] })),
      partial: false,
    })
  }
  const candidateTransition = runtime.transitionStates.get(candidate)
  if (candidateTransition && live.nodeType === 1) runtime.transitionStates.set(live, candidateTransition)

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

function activateDomPresentation(node: Node): void {
  if (node.nodeType !== 1) return
  const element = node as HTMLElement
  if (!element.hasAttribute("data-vune-presentation")) return
  queueMicrotask(() => {
    if (!element.isConnected) return
    activateWebPresentation(element)
  })
}

function activateDomTransition(node: Node, context: DomRenderContext): void {
  if (node.nodeType !== 1) return
  const runtime = runtimeFor(context)
  if (!runtime || runtime.enteredTransitions.has(node)) return
  const state = runtime.transitionStates.get(node)
  if (!state) return
  runtime.enteredTransitions.add(node)
  if (state.transition.descriptor.insertion.length === 0) return
  playWebTransition(node as Element, state.transition, true, state.animation)
}

function ensureTransitionLayer(context: DomRenderContext): HTMLElement | undefined {
  const runtime = runtimeFor(context)
  if (!runtime) return undefined
  if (runtime.transitionLayer?.isConnected) return runtime.transitionLayer
  const body = context.document.body
  if (!body) return undefined
  const layer = context.document.createElement("div")
  layer.setAttribute("data-vune-transition-layer", "")
  layer.setAttribute("aria-hidden", "true")
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;overflow:visible;z-index:2147483646;contain:layout style;"
  body.appendChild(layer)
  runtime.transitionLayer = layer
  return layer
}

function canExitWithTransition(node: Node, context: DomRenderContext): boolean {
  if (node.nodeType !== 1) return false
  const runtime = runtimeFor(context)
  const state = runtime?.transitionStates.get(node)
  return Boolean(state && state.transition.descriptor.removal.length > 0 && context.document.body)
}

function beginExitTransition(parent: Node, node: Node, context: DomRenderContext): boolean {
  if (!canExitWithTransition(node, context) || node.parentNode !== parent) return false
  const runtime = runtimeFor(context)
  const state = runtime?.transitionStates.get(node)
  if (!runtime || !state) return false
  if (runtime.exitTransitions.has(node)) return true
  const layer = ensureTransitionLayer(context)
  if (!layer) return false

  const element = node as HTMLElement
  const rect = safeBoundingRect(element)
	// Native dialog/popover elements live in the browser top layer. Moving the
	// live presentation into our transition layer can either make it disappear
	// immediately (closed dialog) or leave native top-layer state attached to a
	// node that is no longer part of reconciliation. Animate a visual clone for
	// presentation exits and release the live node immediately instead. Normal
	// elements keep using the live node so local DOM state is preserved during
	// their exit animation.
	const isPresentation = element.hasAttribute("data-vune-presentation")
	const transitionElement = isPresentation ? element.cloneNode(true) as HTMLElement : element
	if (isPresentation) {
		releaseDomSubtree(node, context)
		if (node.parentNode === parent) parent.removeChild(node)
	}
	layer.appendChild(transitionElement)
  if (rect) {
		transitionElement.style.position = "fixed"
		transitionElement.style.left = `${rect.left}px`
		transitionElement.style.top = `${rect.top}px`
		if (rect.width > 0) transitionElement.style.width = `${rect.width}px`
		if (rect.height > 0) transitionElement.style.height = `${rect.height}px`
		transitionElement.style.margin = "0"
		transitionElement.style.pointerEvents = "none"
		transitionElement.style.boxSizing = "border-box"
  }

	const playback = playWebTransition(transitionElement, state.transition, false, state.animation, () => {
    runtime.exitTransitions.delete(node)
		try {
			if (!isPresentation) releaseDomSubtree(node, context)
		} finally {
			try { transitionElement.parentNode?.removeChild(transitionElement) } catch { /* detached during teardown */ }
      if (runtime.transitionLayer && runtime.transitionLayer.childNodes.length === 0) {
        try { runtime.transitionLayer.remove() } catch { /* detached */ }
        runtime.transitionLayer = undefined
      }
    }
  })
  runtime.exitTransitions.set(node, playback)
  return true
}

function removeDomNode(parent: Node, node: Node, context: DomRenderContext): void {
  if (beginExitTransition(parent, node, context)) return
  releaseDomSubtree(node, context)
  if (node.parentNode === parent) parent.removeChild(node)
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
  // commitStagedSubtree() has already activated props (including events) for
  // every newly inserted descendant. This phase only binds runtime metadata;
  // walking props again would repeat event-map work for every live element.
  const content = node.nodeType === 1 ? domContentContainer(node as Element) : node
  for (const child of [...content.childNodes]) bindInsertedSubtree(child, context)
  activateDomPresentation(node)
  activateDomTransition(node, context)
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
    const rootBinding = runtime.compiledTemplateRoots.get(source)
    if (rootBinding) runtime.compiledTemplateRoots.set(target, rootBinding)
    const slotBinding = runtime.compiledTemplateTextSlots.get(source)
    if (slotBinding) runtime.compiledTemplateTextSlots.set(target, slotBinding)
    const viewSlotBinding = runtime.compiledTemplateViewSlots.get(source)
    if (viewSlotBinding) runtime.compiledTemplateViewSlots.set(target, viewSlotBinding)
    copyMotionRenderState(source, target, runtime)
    const transition = runtime.transitionStates.get(source)
    if (transition) runtime.transitionStates.set(target, transition)
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

function cloneStoredDomProps(value: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!value) return null
  const style = value.style && typeof value.style === "object" ? value.style as Record<string, unknown> : undefined
  return { ...value, ...(style ? { style: { ...style } } : {}) }
}

function reusableCompiledTemplateCandidate(
  current: Node,
  baseProps: Record<string, unknown> | null,
  context: DomRenderContext,
): Node {
  const candidate = reusableBoundaryCandidate(current, context)
  runtimeFor(context)?.reuseCandidateBaseProps.set(candidate, cloneStoredDomProps(baseProps))
  return candidate
}

function reusableBoundaryOutput(boundary: DomViewBoundary, context: DomRenderContext): Node {
  if (boundary.currentNodes.length === 1) return reusableBoundaryCandidate(boundary.currentNodes[0], context)
  const fragment = context.document.createDocumentFragment()
  for (const current of boundary.currentNodes) fragment.appendChild(reusableBoundaryCandidate(current, context))
  return fragment
}

function promoteReusableCandidate(candidate: Node, context: DomRenderContext): Node {
  const runtime = runtimeFor(context)
  const live = runtime?.reuseCandidates.get(candidate)
  if (candidate.nodeType !== 8 || !live || live.nodeType !== 1) return candidate
  const element = live as Element
  const promoted = context.document.createElementNS(element.namespaceURI, element.localName)
  copyCandidateMetadata(live, promoted, context)
  if (runtime?.reuseCandidateBaseProps.has(candidate)) {
    const baseProps = runtime.reuseCandidateBaseProps.get(candidate) ?? null
    if (baseProps) context.domProps.set(promoted, cloneStoredDomProps(baseProps)!)
    else context.domProps.delete(promoted)
  }
  const patch = runtime?.compiledTemplatePatches.get(candidate)
  if (patch) runtime?.compiledTemplatePatches.set(promoted, patch)
  if (candidate.parentNode) candidate.parentNode.replaceChild(promoted, candidate)
  return promoted
}

function promoteReusableContent(content: Node, context: DomRenderContext): Node {
  if (content.nodeType === 8) return promoteReusableCandidate(content, context)
  if (content.nodeType !== 11) return content
  for (const child of [...content.childNodes]) promoteReusableCandidate(child, context)
  return content
}

function mergeReusableCandidateProps(
  previous: Record<string, unknown> | null,
  incoming: Record<string, unknown>,
): Record<string, unknown> | null {
  const before = previous ?? {}
  const previousStyle = before.style && typeof before.style === "object" ? before.style as Record<string, unknown> : undefined
  const nextStyle = incoming.style && typeof incoming.style === "object" ? incoming.style as Record<string, unknown> : undefined
  const merged: Record<string, unknown> = {
    ...before,
    ...incoming,
    ...(nextStyle ? { style: { ...(previousStyle ?? {}), ...nextStyle } } : {}),
  }
  const hasClass = Object.prototype.hasOwnProperty.call(incoming, "class") || Object.prototype.hasOwnProperty.call(incoming, "className")
  if (hasClass) {
    const beforeClass = classNameOf(before.class ?? before.className)
    const incomingClass = classNameOf(incoming.class ?? incoming.className)
    const combined = [beforeClass, incomingClass].filter(Boolean).join(" ")
    delete merged.className
    if (combined) merged.class = combined
    else delete merged.class
  }
  return Object.keys(merged).length > 0 ? merged : null
}

/**
 * Stage non-structural modifier changes directly on a compiler-template reuse
 * carrier. The live DOM is not mutated until reconciliation succeeds, but we
 * avoid allocating a shallow clone merely to carry the next props snapshot.
 */
function stageReusableModifierPatch(
  content: Node,
  modifier: ViewModifierNode,
  extraProps: Record<string, unknown>,
  baseStyle: Record<string, unknown> | undefined,
  context: DomRenderContext,
): boolean {
  if (modifier.name === "frame" || modifier.name === "keyed" || modifier.name === "withProps" || modifier.name === "elementRef") return false
  const runtime = runtimeFor(context)
  if (!runtime) return false
  const candidates = content.nodeType === 8
    ? [content]
    : content.nodeType === 11
      ? [...content.childNodes]
      : []
  if (candidates.length === 0) return false

  const targets: Array<{ readonly candidate: Node; readonly live: Element; readonly props: Record<string, unknown> | null }> = []
  for (const candidate of candidates) {
    const live = runtime.reuseCandidates.get(candidate)
    if (candidate.nodeType !== 8 || live?.nodeType !== 1 || !runtime.reuseCandidateBaseProps.has(candidate)) return false
    targets.push({ candidate, live: live as Element, props: runtime.reuseCandidateBaseProps.get(candidate) ?? null })
  }

  for (const { candidate, live, props: previous } of targets) {
    const style = baseStyle ? { ...baseStyle } : undefined
    if (style && typeof style.transform === "string") {
      const remembered = previous?.style
      const currentTransform = remembered && typeof remembered === "object"
        ? (remembered as Record<string, unknown>).transform
        : undefined
      if (typeof currentTransform === "string" && currentTransform) style.transform = `${currentTransform} ${style.transform}`
    }
    const props = { ...extraProps, ...(style ? { style } : {}) }
    const appliedProps = live.localName.includes("-") ? props : nativeElementProps(props)
    runtime.reuseCandidateBaseProps.set(candidate, mergeReusableCandidateProps(previous, appliedProps))
  }
  return true
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

function removeNodeBatch(parent: Node, nodes: readonly Node[], context: DomRenderContext): void {
  if (nodes.length === 0) return
  // Preserve the fast all-at-once path for the overwhelmingly common case.
  // Lifecycle transitions opt individual nodes out of synchronous removal.
  if (!nodes.some(node => canExitWithTransition(node, context))) {
    for (const node of nodes) releaseDomSubtree(node, context)
    const current = parent.childNodes
    let coversParent = current.length === nodes.length
    if (coversParent) {
      for (let index = 0; index < nodes.length; index += 1) {
        if (current[index] !== nodes[index]) {
          coversParent = false
          break
        }
      }
    }
    const replaceChildren = (parent as Node & { replaceChildren?: (...nodes: Node[]) => void }).replaceChildren
    if (coversParent && typeof replaceChildren === "function") {
      replaceChildren.call(parent)
      return
    }
    for (const node of nodes) if (node.parentNode === parent) parent.removeChild(node)
    return
  }
  for (const node of nodes) removeDomNode(parent, node, context)
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
  const runtime = runtimeFor(context)
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
  let alreadyOrdered = true
  let strictlyDescending = true
  for (const next of nextChildren) {
    const key = nodeKey(next, context)
    if (key === undefined || seen.has(key)) return false
    seen.add(key)
    const live = runtime?.reuseCandidates.get(next) ?? keyed.get(key)
    if (!live || live.parentNode !== parent || nodeKey(live, context) !== key) return false
    const index = oldIndex.get(live)
    if (index === undefined) return false
    if (index !== desired.length) alreadyOrdered = false
    if (indices.length > 0 && index >= indices[indices.length - 1]) strictlyDescending = false
    desired.push(live)
    indices.push(index)
  }

  for (let index = 0; index < nextChildren.length; index += 1) {
    reconcileDomNode(parent, desired[index], nextChildren[index], context)
  }
  if (alreadyOrdered) return true

  // A full reverse is common in tables and feeds. Computing an LIS only tells
  // us that every node but one must move, so batch the permutation directly.
  if (strictlyDescending) {
    appendNodeBatch(parent, desired)
    return true
  }

  const stable = longestIncreasingSubsequenceIndices(indices)
  const moveCount = desired.length - stable.size

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
    if (element.hasAttribute("data-vune-presentation")) disposeWebPresentation(element as HTMLElement)
    cancelDomAnimations(element)
    disposeFocusScope(element)
    if (context.eventTargetCount > 0) clearDomEvents(element, context)
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
  const anchor = current.nextSibling
  const exiting = beginExitTransition(parent, current, context)
  if (!exiting) releaseDomSubtree(current, context)
  commitStagedSubtree(next, context)
  if (exiting) parent.insertBefore(next, anchor)
  else parent.replaceChild(next, current)
  bindInsertedSubtree(next, context)
  return next
}

function reconcileDomChildren(parent: Node, nextChildren: ArrayLike<Node>, context: DomRenderContext): void {
  const currentNodes = parent.childNodes
  if (currentNodes.length !== nextChildren.length || context.hasDomKeys) captureLayoutChildren(parent, undefined, context)
  if (nextChildren.length === 0) {
    if (currentNodes.length > 0) removeNodeBatch(parent, [...currentNodes], context)
    return
  }
  if (currentNodes.length === 0) {
    const additions = Array.from(nextChildren)
    for (const addition of additions) commitStagedSubtree(addition, context)
    appendNodeBatch(parent, additions)
    for (const addition of additions) bindInsertedSubtree(addition, context)
    return
  }
  // Most trees are entirely unkeyed. Avoid probing two WeakMaps for every
  // child before taking the simple positional reconciliation path. Once a key
  // has appeared we keep the flag set for the lifetime of the mount, so this
  // remains conservative when a later pass removes that keyed branch.
  if (!context.hasDomKeys && currentNodes.length === nextChildren.length) {
    const nextSnapshot = Array.from(nextChildren)
    for (let index = 0; index < nextSnapshot.length; index += 1) {
      reconcileDomNode(parent, currentNodes[index], nextSnapshot[index], context)
    }
    return
  }
  if (currentNodes.length === nextChildren.length) {
    let unkeyed = true
    for (let index = 0; index < nextChildren.length; index += 1) {
      if (nodeKey(currentNodes[index], context) !== undefined || nodeKey(nextChildren[index], context) !== undefined) {
        unkeyed = false
        break
      }
    }
    if (unkeyed) {
      // nextChildren is often a live NodeList owned by a detached candidate. If
      // a replacement moves one of those nodes into the live tree, that list
      // shrinks immediately and a direct loop can skip later siblings. Only
      // the candidate side needs a snapshot; replacements keep live length.
      const nextSnapshot = Array.from(nextChildren)
      for (let index = 0; index < nextSnapshot.length; index += 1) {
        reconcileDomNode(parent, currentNodes[index], nextSnapshot[index], context)
      }
      return
    }
  }
  const currentChildren = [...currentNodes]
  const nextArray = Array.from(nextChildren)
  if (reconcileTailAppend(parent, currentChildren, nextArray, context)) return
  if (reconcilePureKeyedPermutation(parent, currentChildren, nextArray, context)) return
  const runtime = runtimeFor(context)
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
    const reusable = runtime?.reuseCandidates.get(next)
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
    if (!used.has(child) && child.parentNode === parent) removeDomNode(parent, child, context)
  }
}

function reconcileDomNode(parent: Node, current: Node, next: Node, context: DomRenderContext): Node {
  const runtime = runtimeFor(context)
  const stagedReuse = runtime?.reuseCandidates.get(next)
  if (stagedReuse === current && next.nodeType === 8) {
    const resolvedMotion = current.nodeType === 1 ? resolveMotionState(current as Element, next, context) : undefined
    if (current.nodeType === 1) captureLayoutNeighborhood(current as Element, resolvedMotion?.layoutAnimation, context)
    if (runtime?.reuseCandidateBaseProps.has(next) && current.nodeType === 1) {
      patchDomProps(current as Element, runtime.reuseCandidateBaseProps.get(next) ?? undefined, context, resolvedMotion?.policy)
    }
    runtime?.compiledTemplatePatches.get(next)?.()
    bindCandidateNode(next, current, context)
    if (current.nodeType === 1 && resolvedMotion) commitResolvedMotionState(current as Element, resolvedMotion, context)
    return current
  }
  if (current.nodeType !== next.nodeType) return replaceDomNode(parent, current, next, context)
  if (current.nodeType === 3 && next.nodeType === 3) {
    if (current.nodeValue !== next.nodeValue) {
      if (current.parentElement) captureLayoutNeighborhood(current.parentElement, undefined, context)
      current.nodeValue = next.nodeValue
    }
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
  const resolvedMotion = resolveMotionState(currentElement, nextElement, context)
  captureLayoutNeighborhood(currentElement, resolvedMotion.layoutAnimation, context)
  patchDomProps(currentElement, context.domProps.get(nextElement), context, resolvedMotion.policy)
  const nextKey = nodeKey(nextElement, context)
  if (nextKey !== undefined) {
    context.hasDomKeys = true
    context.domKeys.set(currentElement, nextKey)
  }
  else if (nodeKey(currentElement, context) !== undefined) context.domKeys.delete(currentElement)
  bindCandidateNode(next, current, context)
  commitResolvedMotionState(currentElement, resolvedMotion, context)
  if (reusable === current) runtime?.compiledTemplatePatches.get(next)?.()
  if (reusable !== current) {
    const currentContent = domContentContainer(currentElement)
    const nextContent = domContentContainer(nextElement)
    const currentChildren = currentContent.childNodes
    const nextChildren = nextContent.childNodes
    if (currentChildren.length === 1 && nextChildren.length === 1 && currentChildren[0].nodeType === 3 && nextChildren[0].nodeType === 3) {
      const currentText = currentChildren[0]
      const nextText = nextChildren[0]
      if (currentText.nodeValue !== nextText.nodeValue) {
        captureLayoutNeighborhood(currentElement, resolvedMotion.layoutAnimation, context)
        currentText.nodeValue = nextText.nodeValue
      }
      bindCandidateNode(nextText, currentText, context)
    } else if (currentChildren.length !== 0 || nextChildren.length !== 0) {
      reconcileDomChildren(currentContent, nextChildren, context)
    }
  }
  synchronizeDomSelectValue(currentElement, context.domProps.get(nextElement))
  return current
}

function reconcileDomRange(parent: Node, currentNodes: readonly Node[], nextNodes: readonly Node[], context: DomRenderContext): Node[] {
  const current = currentNodes.filter(node => node.parentNode === parent)
  if (current.length !== nextNodes.length || context.hasDomKeys) captureLayoutChildren(parent, undefined, context)
  if (current.length === 0) {
    for (const next of nextNodes) commitStagedSubtree(next, context)
    appendNodeBatch(parent, nextNodes)
    for (const next of nextNodes) bindInsertedSubtree(next, context)
    return [...nextNodes]
  }
  if (nextNodes.length === 0) {
    removeNodeBatch(parent, current, context)
    return []
  }
  const after = current[current.length - 1].nextSibling
  const keyed = new Map<string | number, Node>()
  const used = new Set<Node>()
  const liveNodes: Node[] = []
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
      live = reconcileDomNode(parent, live, next, context)
    }
    liveNodes.push(live)
    cursor = live.nextSibling
  }
  for (const node of current) {
    if (used.has(node) || node.parentNode !== parent) continue
    removeDomNode(parent, node, context)
  }
  return liveNodes
}

function safeBoundingRect(element: Element): DOMRect | undefined {
  try { return element.getBoundingClientRect() } catch { return undefined }
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
    let overflow = parent.style[property]
    try {
      overflow = parent.ownerDocument.defaultView?.getComputedStyle(parent)?.[property] || overflow
    } catch { /* inaccessible CSSOM: fall back to the inline declaration */ }
    if (overflow === "auto" || overflow === "scroll" || overflow === "overlay") return parent
    parent = parent.parentElement
  }
  return null
}

function lazyGap(node: LazyViewNode): number {
  const style = node.props.style
  if (!style || typeof style !== "object") return 0
  const raw = (style as Record<string, unknown>).gap
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number.parseFloat(raw) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function lazyMeasurementIndex(context: DomRenderContext, key: string, node: LazyViewNode): LazyMeasurementIndex {
  const estimate = lazyEstimate(node)
  const gap = lazyGap(node)
  let index = context.lazySizeIndexes.get(key)
  if (!index) {
    index = new LazyMeasurementIndex(node.children.length, estimate, gap)
    context.lazySizeIndexes.set(key, index)
  } else {
    index.configure(node.children.length, estimate, gap)
  }
  return index
}

function lazyViewportMetrics(element: HTMLElement, node: LazyViewNode): { readonly offset: number; readonly viewport: number } {
  const vertical = node.axis !== "horizontal"
  const rect = safeBoundingRect(element)
  const parent = lazyScrollParent(element, node.axis)
  const window = element.ownerDocument.defaultView
  const elementOffset = vertical ? rect?.top ?? 0 : rect?.left ?? 0
  let offset = -elementOffset
  let viewport = vertical ? window?.innerHeight ?? 800 : window?.innerWidth ?? 1200
  if (parent) {
    const parentRect = safeBoundingRect(parent)
    const parentOffset = vertical ? parentRect?.top ?? 0 : parentRect?.left ?? 0
    // Bounding rects are viewport-relative already; their difference is the
    // scroll viewport origin in lazy-container coordinates. Adding scrollTop
    // or scrollLeft here would count the parent's scroll position twice.
    offset = lazyViewportOffset(parentOffset, elementOffset)
    viewport = vertical ? parent.clientHeight : parent.clientWidth
    if (!viewport) viewport = vertical ? window?.innerHeight ?? 800 : window?.innerWidth ?? 1200
  }
  return { offset: lazyViewportOffset(offset, 0), viewport: Math.max(1, viewport) }
}

function lazyRangeForElement(element: HTMLElement, node: LazyViewNode, index: LazyMeasurementIndex): LazyViewRange {
  const metrics = lazyViewportMetrics(element, node)
  return index.rangeForViewport(metrics.offset, metrics.viewport, lazyOverscan(node))
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
    if (modifier.name === "animation") {
      const animation = modifier.arguments[0] instanceof Object
        ? modifier.arguments[0] as Animation
        : modifier.arguments[0] === null ? null : null
      recordAnimationDomain(content, animation, modifier.arguments[1], context)
      return content
    }
    if (modifier.name === "transition") {
      const transition = modifier.arguments[0]
      if (runtime && transition && typeof transition === "object" && "descriptor" in transition) {
        const state: DomTransitionState = {
          transition: transition as Transition,
          animation: context.activeTransaction?.animation,
        }
        for (const node of outputNodes(content)) {
          if (node.nodeType === 1) runtime.transitionStates.set(node, state)
        }
      }
      return content
    }
    if (modifier.name === "keyed") {
      const key = typeof modifier.arguments[0] === "string" || typeof modifier.arguments[0] === "number"
        ? modifier.arguments[0]
        : undefined
      if (key === undefined) return content
      context.hasDomKeys = true
      for (const node of outputNodes(content)) context.domKeys.set(node, key)
      return content
    }
    if (modifier.name === "frame") {
      const wrapper = context.document.createElement("div")
      applyDomProps(wrapper, { style: frameStyle(modifier.arguments[0] && typeof modifier.arguments[0] === "object" ? modifier.arguments[0] : {}) }, context)
      recordMotionStyleProperties(wrapper, Object.keys(styleOf(modifier, false)), context)
      appendDomChild(wrapper, content, context)
      return wrapper
    }
    const extraStyle = styleOf(modifier, false)
    const extraProps = propsOf(modifier)
    if (Object.keys(extraProps).length === 0 && Object.keys(extraStyle).length === 0) return content
    const baseStyle = Object.keys(extraStyle).length > 0 || extraProps.style
      ? { ...extraStyle, ...(extraProps.style && typeof extraProps.style === "object" ? extraProps.style : {}) }
      : undefined
    if (baseStyle) recordMotionStyleProperties(content, Object.keys(baseStyle).map(cssPropertyName), context)
    if ((Object.keys(extraProps).length > 0 || baseStyle)
      && stageReusableModifierPatch(content, modifier, extraProps, baseStyle, context)) return content
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
    template(node, renderSlot, identity) {
      let factory = templateFactories.get(node.template)
      if (!factory) {
        factory = compileTemplate(node.template.root)
        templateFactories.set(node.template, factory)
      }

      const key = viewIdentityKey([...identity, "compiled-template"])
      const textOnly = node.template.slotKinds.length === node.template.slotCount
        && node.template.slotKinds.every(kind => kind === "text")
      const previous = runtime?.compiledTemplates.get(key)

      // Compiler-proven text-only templates do not need their immutable host
      // tree rebuilt on every evaluation. Render only the dynamic primitive
      // slots, carry the existing roots through reconciliation as tiny comment
      // identities, and patch the bound live Text nodes in place. Static
      // zero-slot templates take this path too and allocate no candidate DOM.
      if (runtime && textOnly && previous?.template === node.template
        && previous.roots.length > 0
        && previous.roots.every(root => root.parentNode !== null)
        && previous.textSlots.length === node.template.slotCount
        && previous.textSlots.every(slot => slot?.parentNode !== null)) {
        const nextText = new Array<string>(node.template.slotCount)
        let valid = true
        for (let index = 0; index < node.template.slotCount; index += 1) {
          // The compiler proved this slot came from Text's primitive value
          // initializer. Read the graph slot directly instead of materializing a
          // throwaway Text node just to discover the next text payload.
          const slot = compiledTextSlotValue(node.slots[index])
          if (!slot.ok) {
            valid = false
            break
          }
          nextText[index] = slot.value
        }
        if (valid) {
          let patched = false
          const patch = () => {
            if (patched) return
            patched = true
            for (let index = 0; index < nextText.length; index += 1) {
              const live = previous.textSlots[index]
              if (live && live.nodeValue !== nextText[index]) live.nodeValue = nextText[index]
            }
          }
          if (previous.roots.length === 1) {
            const candidate = reusableCompiledTemplateCandidate(previous.roots[0], previous.rootProps[0] ?? null, context)
            runtime.compiledTemplatePatches.set(candidate, patch)
            return candidate
          }
          const fragment = context.document.createDocumentFragment()
          for (let index = 0; index < previous.roots.length; index += 1) {
            const candidate = reusableCompiledTemplateCandidate(previous.roots[index], previous.rootProps[index] ?? null, context)
            runtime.compiledTemplatePatches.set(candidate, patch)
            fragment.appendChild(candidate)
          }
          return fragment
        }
      }

      const renderedSlots = new Array<Node | undefined>(node.template.slotCount)
      const slotNodes = new Array<Text | undefined>(node.template.slotCount)
      const viewSlotNodes = new Array<Node[] | undefined>(node.template.slotCount)
      const renderCachedSlot = (index: number): Node => {
        const cached = renderedSlots[index]
        if (cached) return cached
        const slot = renderSlot(index)
        renderedSlots[index] = slot
        if (runtime && node.template.slotKinds[index] === "text" && slot.nodeType === 3) {
          slotNodes[index] = slot as Text
          runtime.compiledTemplateTextSlots.set(slot, { key, index })
        } else if (runtime && node.template.slotKinds[index] === "view") {
          const nodes = outputNodes(slot)
          viewSlotNodes[index] = nodes
          for (const root of nodes) runtime.compiledTemplateViewSlots.set(root, { key, index })
        }
        return slot
      }
      const output = factory(renderCachedSlot)
      if (runtime) {
        const roots = outputNodes(output)
        const rootProps = roots.map(root => root.nodeType === 1
          ? cloneStoredDomProps(context.domProps.get(root as Element))
          : null)
        const instance: DomCompiledTemplateInstance = { template: node.template, roots: [...roots], rootProps, textSlots: slotNodes, viewSlots: viewSlotNodes }
        runtime.compiledTemplates.set(key, instance)
        roots.forEach((root, index) => runtime.compiledTemplateRoots.set(root, { key, index }))
      }
      return output
    },
    lazy(node, render, identity, renderItem) {
      markUnsafeViewAncestors(context)
      const key = viewIdentityKey(identity)
      context.visitedLazyIdentities.add(key)
      context.lazyNodes.set(key, node)
      const element = context.document.createElement("div")
      applyDomProps(element, node.props, context)
      context.lazyKeys.set(element, key)
      const measurement = lazyMeasurementIndex(context, key, node)
      const requested = context.lazyRanges.get(key) ?? lazyRangeForElement(element, node, measurement)
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
      if (range.start > 0) appendDomChild(element, lazySpacer(context, node, measurement.hiddenBeforeSize(range.start), "before"), context)
      if (renderItem) {
        for (let index = range.start; index < range.end; index += 1) {
          const wrapper = context.document.createElement("div")
          wrapper.setAttribute("data-vune-lazy-item", "")
          wrapper.setAttribute("data-vune-lazy-index", String(index))
          wrapper.style.boxSizing = "border-box"
          wrapper.style.flex = "0 0 auto"
          if (node.axis !== "horizontal") wrapper.style.width = "100%"
          context.lazyItemMetadata.set(wrapper, { key, index })
          appendDomChild(wrapper, renderItem(index), context)
          appendDomChild(element, wrapper, context)
        }
      } else {
        appendDomChild(element, render(range), context)
      }
      if (range.end < node.children.length) appendDomChild(element, lazySpacer(context, node, measurement.hiddenAfterSize(range.end), "after"), context)
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

function geometryFromElement(element: Element, persistentProbe?: HTMLElement): GeometryProxy {
  const rect = safeBoundingRect(element)
  if (!rect) return zeroGeometry
  const frame = { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left }
  const document = element.ownerDocument
  const view = document.defaultView
  const fallback = { frame, size: { width: rect.width, height: rect.height }, safeAreaInsets: zeroGeometry.safeAreaInsets }
  if (!view?.getComputedStyle || !document.body) return fallback
  const probe = persistentProbe ?? document.createElement("div")
  const ownsProbe = persistentProbe === undefined
  let measured = false
  probe.style.cssText = "position:fixed;inset:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)"
  try {
    if (!probe.parentNode) document.body.appendChild(probe)
    const style = view.getComputedStyle(probe)
    const safeAreaInsets = edgeInsetsFromCss({ top: style.paddingTop, right: style.paddingRight, bottom: style.paddingBottom, left: style.paddingLeft })
    measured = true
    return { frame, size: { width: rect.width, height: rect.height }, safeAreaInsets }
  } catch {
    // Geometry is still useful when CSSOM access is unavailable (sandboxed or
    // synthetic documents). Safe-area measurement is optional, not fatal.
    return fallback
  } finally {
    if (ownsProbe || !measured) {
      try { probe.remove() } catch { /* detached/synthetic DOM cleanup is best-effort */ }
    }
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
      eventTargetCount: 0,
      domKeys: new WeakMap(),
      hasDomKeys: false,
      domTags: new WeakMap(),
      lazyRanges: new Map(),
      lazyMeasurements: new Map(),
      lazySizeIndexes: new Map(),
      lazyItemMetadata: new WeakMap(),
      lazyNodes: new Map(),
      preservedLazyStatePrefixes: new Map(),
      visitedLazyIdentities: new Set(),
      lazyKeys: new WeakMap(),
      geometryIndex: 0,
      hasRefs: false,
      hydrating: false,
      stagingEvents: true,
      stagingProps: true,
      activeTransaction: undefined,
    }
    const viewRuntime: DomViewRuntime = {
      boundaries: new Map(),
      nodeKeys: new WeakMap(),
      reuseCandidates: new WeakMap(),
      reuseCandidateBaseProps: new WeakMap(),
      compiledTemplates: new Map(),
      compiledTemplateRoots: new WeakMap(),
      compiledTemplateTextSlots: new WeakMap(),
      compiledTemplateViewSlots: new WeakMap(),
      compiledTemplatePatches: new WeakMap(),
      motionStates: new WeakMap(),
      transitionStates: new WeakMap(),
      enteredTransitions: new WeakSet(),
      exitTransitions: new Map(),
      layoutSnapshots: new Map(),
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
    let lazyItemObserver: ResizeObserver | undefined
    const lazyViewportTargets = new Set<EventTarget>()
    const lazyViewportCleanups: Array<() => void> = []
    let hasMounted = false
    let update: () => void
    // Reuse one hidden safe-area probe for every GeometryReader in this mount.
    // Appending/removing a probe per reader forces avoidable style/layout work.
    const geometryProbe = document.createElement("div")
    geometryProbe.style.cssText = "position:fixed;inset:0;visibility:hidden;pointer-events:none"

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
      recordVuneBoundaryDisposed(key)
      if (!preserveState) context.states.delete(key)
    }
    const beginViewPass = (boundaryRootKey?: string): void => {
      viewRuntime.renderedKeys = new Set()
      viewRuntime.passVisitedStates = new Set()
      viewRuntime.boundaryRootKey = boundaryRootKey
      if (!boundaryRootKey) viewRuntime.rootNextChildren.clear()
    }
    const scheduledBoundaryUpdates = new Set<DomViewBoundary>()
    let boundaryFlushScheduled = false
    let updateBoundary!: (boundary: DomViewBoundary) => void
    const boundaryDepth = (boundary: DomViewBoundary): number => {
      let depth = 0
      let parentKey = boundary.parentKey
      const seen = new Set<string>()
      while (parentKey && !seen.has(parentKey)) {
        seen.add(parentKey)
        depth += 1
        parentKey = viewRuntime.boundaries.get(parentKey)?.parentKey
      }
      return depth
    }
    const flushBoundaryUpdates = (): void => {
      boundaryFlushScheduled = false
      if (stopped || scheduledBoundaryUpdates.size === 0) return
      const batch = [...scheduledBoundaryUpdates]
      scheduledBoundaryUpdates.clear()
      // Parent-first processing lets one ancestor reconciliation absorb all of
      // its dirty descendants instead of running N independent microtasks.
      batch.sort((left, right) => boundaryDepth(left) - boundaryDepth(right))
      for (const boundary of batch) {
        if (!boundary.scheduled) continue
        updateBoundary(boundary)
      }
      if (scheduledBoundaryUpdates.size > 0 && !boundaryFlushScheduled) {
        boundaryFlushScheduled = true
        queueMicrotask(flushBoundaryUpdates)
      }
    }
    const enqueueBoundaryUpdate = (boundary: DomViewBoundary): void => {
      scheduledBoundaryUpdates.add(boundary)
      if (boundaryFlushScheduled || stopped) return
      boundaryFlushScheduled = true
      queueMicrotask(flushBoundaryUpdates)
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
          enqueueBoundaryUpdate(boundary)
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
      // Identity-keyed template instances are retained only while at least one
      // of their live roots is still mounted. This keeps the fast-path cache
      // bounded when keyed/list branches disappear.
      for (const [key, instance] of viewRuntime.compiledTemplates) {
        if (instance.roots.length === 0 || instance.roots.every(root => root.parentNode === null)) {
          viewRuntime.compiledTemplates.delete(key)
        }
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
        const next = geometryFromElement(element, geometryProbe)
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
        const measurement = lazyMeasurementIndex(context, key, node)
        const next = lazyRangeForElement(element, node, measurement)
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
    const observeLazyItems = () => {
      if (typeof ResizeObserver === "undefined") return
      lazyItemObserver ??= new ResizeObserver(entries => {
        let changed = false
        for (const entry of entries) {
          const element = entry.target as HTMLElement
          const metadata = context.lazyItemMetadata.get(element)
          if (!metadata) continue
          const node = context.lazyNodes.get(metadata.key)
          const measurement = context.lazySizeIndexes.get(metadata.key)
          if (!node || !measurement) continue
          const rect = safeBoundingRect(element)
          const size = node.axis === "horizontal" ? rect?.width : rect?.height
          if (!size || !Number.isFinite(size) || size <= 0) continue
          const delta = measurement.set(metadata.index, size)
          if (Math.abs(delta) < 0.01) continue
          changed = true

          // Keep the same logical content under the viewport when an overscan
          // row above it changes height. The normal root pass snapshots this
          // adjusted position and therefore does not undo the correction.
          const containerElement = element.parentElement
          if (!containerElement) continue
          const scrollParent = lazyScrollParent(containerElement, node.axis)
          const elementRect = safeBoundingRect(element)
          if (scrollParent) {
            const parentRect = safeBoundingRect(scrollParent)
            const beforeViewport = node.axis === "horizontal"
              ? (elementRect?.right ?? 0) <= (parentRect?.left ?? 0)
              : (elementRect?.bottom ?? 0) <= (parentRect?.top ?? 0)
            if (beforeViewport) {
              if (node.axis === "horizontal") scrollParent.scrollLeft += delta
              else scrollParent.scrollTop += delta
            }
          } else {
            const window = document.defaultView
            const beforeViewport = node.axis === "horizontal"
              ? (elementRect?.right ?? 0) <= 0
              : (elementRect?.bottom ?? 0) <= 0
            if (window && beforeViewport) {
              window.scrollBy(node.axis === "horizontal" ? delta : 0, node.axis === "horizontal" ? 0 : delta)
            }
          }
        }
        if (changed) scheduleLazyMeasure()
      })
      lazyItemObserver.disconnect()
      container.querySelectorAll<HTMLElement>("[data-vune-lazy-item]").forEach(element => lazyItemObserver!.observe(element))
    }

    const observeLazyViewport = () => {
      const targets = new Set<EventTarget>()
      const window = document.defaultView
      if (window) targets.add(window)
      targets.add(container)
      container.querySelectorAll<HTMLElement>("[data-vune-lazy]").forEach(element => {
        const key = context.lazyKeys.get(element)
        const node = key ? context.lazyNodes.get(key) : undefined
        const parent = node ? lazyScrollParent(element, node.axis) : null
        if (parent) targets.add(parent)
      })
      // Detached or replaced scroll parents keep handler references alive
      // until unmount unless pruned on every pass.
      const listener = scheduleLazyMeasure as EventListener
      for (const target of [...lazyViewportTargets]) {
        if (targets.has(target)) continue
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
    const patchCompiledBoundary = (boundary: DomViewBoundary, transaction?: Transaction): boolean => {
      const plan = boundary.node.compiledBody
      if (!plan || boundary.node.dependenciesComplete !== true) return false
      // Outer modifiers are applied after the View body. Safe non-structural
      // modifiers can be replayed directly on top of the compiled body plan;
      // anything structural or effectful keeps the conservative generic path.
      const directOuterModifiers = plan.patchesModifiers ? boundary.outerModifiers : []
      if (directOuterModifiers.some(modifier => !directCompiledBodyModifierNames.has(modifier.name))) return false
      const template = plan.template
      if (template.slotKinds.length !== template.slotCount || template.slotKinds.some(kind => kind !== "text")) return false

      const templateKey = viewIdentityKey([...boundary.identity, "body", "compiled-template"])
      const instance = viewRuntime.compiledTemplates.get(templateKey)
      if (!instance || instance.template !== template
        || instance.roots.length === 0
        || instance.roots.some(root => root.parentNode === null)
        || instance.textSlots.length !== template.slotCount
        || instance.textSlots.some(slot => slot?.parentNode === null)) return false

      const previousTransaction = context.activeTransaction
      context.activeTransaction = transaction
      try {
        for (const root of instance.roots) {
          if (root.nodeType === 1) captureLayoutNeighborhood(root as Element, undefined, context)
        }
        const patched = withRenderTransaction(transaction, () => {
          const evaluation = plan.evaluate(boundary.resolvedProps)
          if (!evaluation || typeof evaluation !== "object" || !Array.isArray(evaluation.slots)
            || evaluation.slots.length !== template.slotCount) return false

          const nextText = new Array<string>(template.slotCount)
          for (let index = 0; index < template.slotCount; index += 1) {
            const value = compiledTextSlotValue(evaluation.slots[index])
            if (!value.ok) return false
            nextText[index] = value.value
          }

          let nextRootProps: Array<Record<string, unknown> | null> | undefined
          let nextMotionStates: Array<DomMotionRenderState | null> | undefined
          if (plan.patchesModifiers) {
            if (evaluation.modifiers !== undefined && !Array.isArray(evaluation.modifiers)) return false
            nextRootProps = instance.roots.map((root, index) => root.nodeType === 1
              ? cloneStoredDomProps(instance.rootProps[index] ?? null)
              : null)
            nextMotionStates = instance.roots.map(root => root.nodeType === 1
              ? { pendingProperties: new Set<string>(), domains: [], partial: false }
              : null)

            const mergeModifier = (modifier: ViewModifierNode): void => {
              if (modifier.name === "animation") {
                const raw = modifier.arguments[0]
                const animation = raw && typeof raw === "object" ? raw as Animation : null
                const trigger = modifier.arguments[1]
                for (const state of nextMotionStates!) {
                  if (!state) continue
                  state.domains.push({ animation, trigger, properties: [...state.pendingProperties] })
                  state.pendingProperties.clear()
                }
                return
              }

              const extraStyle = styleOf(modifier, false)
              const extraProps = propsOf(modifier)
              const motionProperties = Object.keys(extraStyle).map(cssPropertyName)
              for (const state of nextMotionStates!) {
                if (!state) continue
                for (const property of motionProperties) state.pendingProperties.add(property)
              }
              for (let index = 0; index < instance.roots.length; index += 1) {
                const root = instance.roots[index]
                if (root.nodeType !== 1) continue
                const element = root as Element
                const previous = nextRootProps![index]
                const style = Object.keys(extraStyle).length > 0 ? { ...extraStyle } : undefined
                if (style && typeof style.transform === "string") {
                  const remembered = previous?.style
                  const currentTransform = remembered && typeof remembered === "object"
                    ? (remembered as Record<string, unknown>).transform
                    : undefined
                  if (typeof currentTransform === "string" && currentTransform) style.transform = `${currentTransform} ${style.transform}`
                }
                const incoming = { ...extraProps, ...(style ? { style } : {}) }
                const applied = element.localName.includes("-") ? incoming : nativeElementProps(incoming)
                nextRootProps![index] = mergeReusableCandidateProps(previous, applied)
              }
            }

            for (const spec of evaluation.modifiers ?? []) {
              if (!Array.isArray(spec) || spec.length !== 2 || typeof spec[0] !== "string"
                || !directCompiledBodyModifierNames.has(spec[0]) || !Array.isArray(spec[1])) return false
              mergeModifier({ name: spec[0], arguments: spec[1] } as ViewModifierNode)
            }
            // Preserve normal modifier precedence: template props → body
            // modifiers → modifiers attached to the View at the call site.
            for (const modifier of directOuterModifiers) mergeModifier(modifier)
          } else if (evaluation.modifiers !== undefined) {
            return false
          }

          const resolvedRootMotion = instance.roots.map((root, index) => {
            if (root.nodeType !== 1 || !nextMotionStates?.[index]) return undefined
            const resolved = resolveMotionRenderState(root as Element, nextMotionStates[index]!, context)
            captureLayoutNeighborhood(root as Element, resolved.layoutAnimation, context)
            return resolved
          })

          for (let index = 0; index < nextText.length; index += 1) {
            const live = instance.textSlots[index]
            if (live && live.nodeValue !== nextText[index]) live.nodeValue = nextText[index]
          }
          if (nextRootProps) {
            for (let index = 0; index < instance.roots.length; index += 1) {
              const root = instance.roots[index]
              if (root.nodeType !== 1) continue
              const resolved = resolvedRootMotion[index]
              patchDomProps(root as Element, nextRootProps[index], context, resolved?.policy)
              if (resolved) commitResolvedMotionState(root as Element, resolved, context)
            }
          }
          return true
        })
        if (!patched) return false
        flushLayoutMotion(context)
      } finally {
        context.activeTransaction = previousTransaction
      }
      boundary.scheduled = false
      boundary.pendingTransaction = undefined
      return true
    }

    updateBoundary = (boundary: DomViewBoundary): void => {
      if (stopped || viewRuntime.boundaries.get(boundary.key) !== boundary || !boundary.scheduled) return
      const profile = vuneDevtoolsEnabled()
      const startedAt = profile ? performance.now() : 0
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
      if (patchCompiledBoundary(boundary, renderTransaction)) {
        if (profile) recordVuneBoundaryRender({
          key: boundary.key,
          name: boundary.node.name,
          parentKey: boundary.parentKey,
          durationMs: performance.now() - startedAt,
          dependencyCount: boundary.dependencies.size,
          nodeCount: boundary.currentNodes.length,
          mode: "compiled",
          element: boundary.currentNodes.find(node => node.nodeType === 1) as Element | undefined,
        })
        return
      }
      context.activeTransaction = renderTransaction
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
        // Discard any pre-mutation layout captures from the abandoned local
        // pass. The root pass will take a fresh coherent snapshot.
        viewRuntime.layoutSnapshots.clear()
        context.activeTransaction = undefined
        requestRootUpdate(renderTransaction, false)
        return
      }
      reconcileDomRange(parent, currentNodes, outputNodes(output), context)
      flushLayoutMotion(context)
      commitViewPass(false)
      commitRefs()
      context.activeTransaction = undefined
      if (profile) recordVuneBoundaryRender({
        key: boundary.key,
        name: boundary.node.name,
        parentKey: boundary.parentKey,
        durationMs: performance.now() - startedAt,
        dependencyCount: boundary.dependencies.size,
        nodeCount: boundary.currentNodes.length,
        mode: "reconcile",
        element: boundary.currentNodes.find(node => node.nodeType === 1) as Element | undefined,
      })
    }

    update = () => {
      if (stopped) return
      scheduled = false
      // A root pass owns its before/after geometry snapshot as one atomic
      // unit. Never let a capture from an aborted local pass leak into it.
      viewRuntime.layoutSnapshots.clear()
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
      context.activeTransaction = renderTransaction
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
        if (attemptedHydration) {
          // Once structural hydration fails, some live descendants may never
          // have been visited, so their server-only attributes are unknown to
          // the normal prop diff. Reusing that partially inspected tree can
          // preserve stale nodes/attributes. Commit one clean client tree and
          // replace the failed hydration boundary atomically instead.
          for (const child of outputChildren) commitStagedSubtree(child, context)
          removeNodeBatch(container, [...container.childNodes], context)
          appendNodeBatch(container, outputChildren)
          for (const child of outputChildren) bindInsertedSubtree(child, context)
        } else {
          reconcileDomChildren(container, outputChildren, context)
        }
      }
      flushLayoutMotion(context)
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
      for (const key of context.lazySizeIndexes.keys()) {
        if (!context.visitedLazyIdentities.has(key)) context.lazySizeIndexes.delete(key)
      }
      commitRefs()
      syncSubscriptions(dependencies, transaction => {
        requestRootUpdate(transaction, true)
      })
      updateGeometry()
      observeLazyItems()
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
      context.activeTransaction = undefined
    }
    update()
    return () => {
      if (stopped) return
      stopped = true
      let failed = false
      let failure: unknown
      const cleanup = (action: () => void) => {
        try { action() } catch (error) {
          if (!failed) { failed = true; failure = error }
        }
      }
      subscriptions.forEach(unsubscribe => cleanup(unsubscribe))
      subscriptions.clear()
      for (const key of [...viewRuntime.rootChildren]) cleanup(() => disposeBoundary(key))
      viewRuntime.rootChildren.clear()
      viewRuntime.rootNextChildren.clear()
      for (const boundary of viewRuntime.boundaries.values()) {
        boundary.subscriptions.forEach(unsubscribe => cleanup(unsubscribe))
        boundary.subscriptions.clear()
      }
      viewRuntime.boundaries.clear()
      viewRuntime.layoutSnapshots.clear()
      for (const playback of [...viewRuntime.exitTransitions.values()]) cleanup(playback.cancel)
      viewRuntime.exitTransitions.clear()
      cleanup(() => viewRuntime.transitionLayer?.remove())
      viewRuntime.transitionLayer = undefined
      activeRefs.forEach(entry => cleanup(entry.cleanup))
      activeRefs.clear()
      cleanup(() => lazyItemObserver?.disconnect())
      lazyItemObserver = undefined
      lazyViewportCleanups.forEach(action => cleanup(action))
      lazyViewportCleanups.length = 0
      cleanup(() => geometryProbe.remove())
      for (const child of [...container.childNodes]) cleanup(() => releaseDomSubtree(child, context))
      cleanup(() => (container as Element & { replaceChildren(...nodes: Node[]): void }).replaceChildren())
      if (failed) throw failure
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
