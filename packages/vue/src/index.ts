import {
  Fragment,
  cloneVNode,
  createApp,
  customRef,
  defineComponent,
  getCurrentScope,
  h,
  createSSRApp,
  onBeforeUnmount,
  onMounted,
  onScopeDispose,
  shallowRef,
  watchEffect,
  type Component as VueComponentType,
  type ComponentPublicInstance,
  type PropType,
  type Ref,
  type VNode,
  type VNodeChild,
} from "vue"
import {
  animationCSSStyle,
  Animation,
  Binding,
  classNameOf,
  currentRenderTransaction,
  collectStateReads,
  defineView,
  ForeignComponent,
  frameStyle,
  initializer,
  isForeignComponent,
  layoutLength,
  renderViewNode,
  swiftUIAnimatableModifierNames,
  subscribeState,
  withRenderTransaction,
  viewIdentityKey,
  zeroGeometry,
  type CompiledTemplateValue,
  type GeometryProxy,
  type BindingRef,
  type ModifiableViewNode,
  type VuneRenderer,
  type StateRef,
  type Transaction,
  type ViewGraphValue,
  type ViewHostNode,
  type ViewModifierNode,
  type ViewValue,
  viewElement,
} from "@vune-ui/core"

import { geometryFromElement, sameGeometry } from "./geometry.js"

const vuneVueSlots = Symbol.for("vune.vue.slots")

function sync(
  active: Map<StateRef<unknown>, () => void>,
  next: ReadonlySet<StateRef<unknown>>,
  invalidate: (transaction: Transaction) => void,
): void {
  for (const [state, stop] of active) {
    if (next.has(state)) continue
    stop()
    active.delete(state)
  }
  for (const state of next) {
    if (active.has(state)) continue
    active.set(state, subscribeState(state, invalidate))
  }
}

export type VuneVueSlot = ViewValue | ((props: any, ...args: any[]) => ViewValue)
export type VueComponentProps<C> = C extends abstract new (...args: any[]) => { $props: infer Props }
  ? Props
  : C extends (props: infer Props, ...args: any[]) => any ? Props : Record<string, unknown>
type VueComponentEmitProps<C> = C extends { emits?: infer Emits }
  ? Emits extends Record<string, unknown>
    ? { [Key in keyof Emits as Key extends string ? `on${Capitalize<Key>}` : never]?: Emits[Key] extends (...args: infer Args) => any ? (...args: Args) => any : (...args: any[]) => any }
    : {}
  : {}
type RequiredVuePropKeys<Props> = {
  [Key in keyof Props]-?: object extends Pick<Props, Key> ? never : Key
}[keyof Props]
type VuneVueComponentProps<C> = Omit<VueComponentProps<C>, "slots"> & VueComponentEmitProps<C> & { readonly slots?: Record<string, VuneVueSlot> }
type VueComponentArguments<C> = [RequiredVuePropKeys<VueComponentProps<C>>] extends [never]
  ? [props?: VuneVueComponentProps<C> | null, ...children: ViewValue[]]
  : [props: VuneVueComponentProps<C>, ...children: ViewValue[]]
export type VueComponentView<C extends object> = ((...args: VueComponentArguments<C>) => ModifiableViewNode) & {
  readonly component: C
}

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
      result = { style: { opacity } }; break
    }
    case "scaleEffect": {
      const scale = typeof value === "number" ? `${value}`
        : value && typeof value === "object" ? `${Number((value as { x?: unknown; width?: unknown }).x ?? (value as { width?: unknown }).width ?? 1)}, ${Number((value as { y?: unknown; height?: unknown }).y ?? (value as { height?: unknown }).height ?? 1)}` : "1"
      result = { style: { transform: `scale(${scale})` } }; break
    }
    case "rotationEffect": result = { style: { transform: `rotate(${typeof value === "number" && Number.isFinite(value) ? value : 0}deg)` } }; break
    case "offset": {
      const second = modifier.arguments[1]
      let x = 0; let y = 0
      if (typeof value === "number") { x = value; y = typeof second === "number" ? second : 0 }
      else if (value && typeof value === "object") {
        const point = value as { x?: unknown; y?: unknown; width?: unknown; height?: unknown }
        x = Number(point.x ?? point.width ?? 0); y = Number(point.y ?? point.height ?? 0)
      }
      result = { style: { transform: `translate(${Number.isFinite(x) ? x : 0}px, ${Number.isFinite(y) ? y : 0}px)` } }; break
    }
    case "mask": {
      const mask = modifier.props && typeof modifier.props === "object" && "style" in modifier.props ? (modifier.props as { style?: unknown }).style : undefined
      result = { style: mask && typeof mask === "object" ? Object.fromEntries(Object.entries(mask as Record<string, unknown>).map(([key, item]) => [key === "WebkitMask" ? "-webkit-mask" : key, item])) : {} }
      break
    }
    case "continuousCorners": {
      const smoothing = typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.6
      result = { style: { cornerShape: "squircle", "--vune-corner-style": "continuous", "--vune-corner-smoothing": smoothing } }
      break
    }
    case "style": result = value && typeof value === "object" ? { style: value } : {}; break
    case "className": result = { class: classNameOf(value) }; break
    case "withProps": result = value && typeof value === "object" ? value as Record<string, unknown> : {}; break
    case "keyed": result = { key: value }; break
    case "elementRef": result = { ref: value }; break
    case "frame": result = { style: frameStyle(value && typeof value === "object" ? value : {}) }; break
    case "animation": {
      // `.animation()` deliberately has no Animation argument: the renderer
      // selects the default policy and animates only values that actually
      // change. Treating `undefined` as disabled made every zero-argument
      // animation silently become a 0 ms patch in the Vue host.
      const selected = modifier.arguments.length === 0 ? Animation.default : value as Animation | null
      result = { style: animationCSSStyle(selected) ?? {} }
      break
    }
    case "animationAuto": {
      const properties = Array.isArray(value)
        ? value.filter((property): property is string => typeof property === "string")
        : []
      const style = animationCSSStyle(Animation.default)
      result = {
        style: style
          ? { ...style, ...(properties.length > 0 ? { transitionProperty: properties.join(", ") } : {}) }
          : {},
      }
      break
    }
    default: result = {}
  }
  const transaction = currentRenderTransaction()
  if (swiftUIAnimatableModifierNames.has(modifier.name) && transaction.animation && !transaction.disablesAnimations) {
    const animationStyle = animationCSSStyle(transaction.animation)
    if (animationStyle) result = { ...result, style: { ...(result.style && typeof result.style === "object" ? result.style : {}), ...animationStyle } }
  }
  return result
}

function mergeProps(current: Record<string, unknown> | null | undefined, extra: Record<string, unknown>): Record<string, unknown> {
  const currentStyle: Record<string, unknown> = current?.style && typeof current.style === "object" ? current.style as Record<string, unknown> : {}
  const extraStyle: Record<string, unknown> | undefined = extra.style && typeof extra.style === "object" ? extra.style as Record<string, unknown> : undefined
  const style: Record<string, unknown> = extraStyle ? { ...currentStyle, ...extraStyle } : currentStyle
  if (extraStyle && typeof extraStyle.transform === "string" && typeof currentStyle.transform === "string") {
    style.transform = `${currentStyle.transform} ${extraStyle.transform}`
  }
  return {
    ...(current ?? {}),
    ...extra,
    ...(extraStyle ? { style } : {}),
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

function renderVueElement(type: unknown, props: Record<string, unknown> | null, children: VNodeChild[]): VNode {
  const rawSlots = (props as Record<PropertyKey, unknown> | null)?.[vuneVueSlots] as Record<string, VuneVueSlot> | undefined
  let normalizedProps = props ? { ...props } : null
  if (normalizedProps) delete (normalizedProps as Record<PropertyKey, unknown>)[vuneVueSlots]
  if (normalizedProps) {
    for (const [key, value] of Object.entries(normalizedProps)) {
      if (typeof value === "function" && /^on[a-z]/.test(key)) {
        delete normalizedProps[key]
        normalizedProps[`on${key[2].toUpperCase()}${key.slice(3)}`] = value
      }
    }
  }
  const foreign = isForeignComponent(type) ? type : undefined
  if (foreign) {
    normalizedProps = { ...foreign.props, ...foreign.events, ...(normalizedProps ?? {}) }
    if (foreign.ref !== undefined) normalizedProps.ref = foreign.ref
    if (foreign.key !== undefined) normalizedProps.key = foreign.key
  }
  const style = normalizedProps?.style
  if (style && typeof style === "object" && (style as Record<string, unknown>)["--vune-corner-style"] === "continuous") {
    const previousRef = normalizedProps!.ref
    normalizedProps!.ref = (value: unknown) => {
      if (typeof previousRef === "function") previousRef(value)
      else if (previousRef && typeof previousRef === "object" && "value" in previousRef) (previousRef as { value: unknown }).value = value
      void import("./continuous-corners.js").then(({ attachContinuousCornerRef }) => attachContinuousCornerRef(value))
    }
  }
  if (typeof type === "string") return h(type, normalizedProps, children)
  const slots = foreign?.slots
    ? {
        ...Object.fromEntries(Object.entries(foreign.slots).map(([name, slot]) => [name, (...args: unknown[]) => render(typeof slot === "function" ? slot(...args) : slot)])),
        ...(children.length > 0 && !foreign.slots.default ? { default: () => children } : {}),
      }
    : rawSlots
    ? {
        ...Object.fromEntries(Object.entries(rawSlots).map(([name, slot]) => [name, (...args: unknown[]) => render(typeof slot === "function" ? slot(...(args as [any, ...any[]])) : slot)])),
        ...(children.length > 0 && !rawSlots.default ? { default: () => children } : {}),
      }
    : children.length > 0 ? { default: () => children } : undefined
  return h((foreign?.component ?? type) as VueComponentType, normalizedProps, slots)
}

type VueTemplateFactory = (renderSlot: (index: number) => VNodeChild) => VNodeChild
const vueTemplateFactories = new WeakMap<object, VueTemplateFactory>()

function compileVueTemplate(value: CompiledTemplateValue): VueTemplateFactory {
  if (value !== null && typeof value === "object") {
    if (value.kind === "slot") {
      const index = value.index
      return renderSlot => renderSlot(index)
    }
    if (value.kind === "fragment") {
      const children = value.children.map(compileVueTemplate)
      return renderSlot => h(Fragment, null, children.map(child => child(renderSlot)))
    }
    if (value.kind === "element") {
      const type = value.type
      const props = value.props
      const children = value.children.map(compileVueTemplate)
      return renderSlot => renderVueElement(type, props, children.map(child => child(renderSlot)))
    }
  }
  const staticValue = value === null || value === undefined || value === false || value === true ? null : value as VNodeChild
  return () => staticValue
}

const renderer: VuneRenderer<VNodeChild> = {
  element(type, props, ...children) {
    return renderVueElement(type, props, children)
  },
  fragment(children) {
    return h(Fragment, null, children)
  },
  value(value) {
    return value === null || value === undefined || value === false ? null : value as VNodeChild
  },
  template(node, renderSlot) {
    let factory = vueTemplateFactories.get(node.template)
    if (!factory) {
      factory = compileVueTemplate(node.template.root)
      vueTemplateFactories.set(node.template, factory)
    }
    return factory(renderSlot)
  },
  modifier(content, modifier) {
    if (modifier.name === "frame") {
      return h("div", modifierProps(modifier), [content])
    }
    const extra = modifierProps(modifier)
    if (content && typeof content === "object" && "type" in content) {
      const vnode = content as VNode
      const merged = mergeProps(vnode.props as Record<string, unknown> | null | undefined, extra)
      return cloneVNode(vnode, typeof vnode.type === "string" && !vnode.type.includes("-") ? nativeElementProps(merged) : merged)
    }
    return h(Fragment, extra, [content])
  },
  view(node, _render, identity) {
    return h(VuneViewHost, { key: viewIdentityKey(identity), node })
  },
  geometry(_node, render) {
    return h(GeometryVuneValue, { render })
  },
}

function RenderValue({ value, transaction }: { value: ViewGraphValue; transaction?: Transaction }): VNodeChild {
  return withRenderTransaction(transaction, () => renderViewNode(value, renderer))
}

const ReactiveVuneValue = defineComponent({
  name: "ReactiveVuneValue",
  props: {
    factory: { type: Function as PropType<() => ViewGraphValue>, required: true },
    dependencies: { type: Function as PropType<() => readonly StateRef<unknown>[]>, required: false },
    dependenciesComplete: { type: Boolean, required: false, default: false },
  },
  setup(props) {
    const value = shallowRef<ViewGraphValue>(null)
    const version = shallowRef(0)
    const transaction = shallowRef<Transaction | undefined>(undefined)
    const subscriptions = new Map<StateRef<unknown>, () => void>()
    let pendingTransaction: Transaction | undefined
    const invalidate = (nextTransaction: Transaction) => {
      pendingTransaction = nextTransaction
      version.value += 1
    }
    watchEffect(() => {
      void version.value
      const declaredDependencies = props.dependencies?.()
      const dependencies = new Set<StateRef<unknown>>(declaredDependencies ?? [])
      transaction.value = pendingTransaction
      value.value = withRenderTransaction(pendingTransaction, () => declaredDependencies && props.dependenciesComplete
        ? props.factory()
        : collectStateReads(props.factory, dependency => dependencies.add(dependency)))
      pendingTransaction = undefined
      sync(subscriptions, dependencies, invalidate)
    })
    onScopeDispose(() => subscriptions.forEach(stop => stop()))
    return () => h(RenderValue, { value: value.value, transaction: transaction.value })
  },
})

const GeometryVuneValue = defineComponent({
  name: "VuneGeometryReader",
  props: {
    render: { type: Function as PropType<(geometry: GeometryProxy) => VNodeChild>, required: true },
  },
  setup(props) {
    const host = shallowRef<Element | null>(null)
    const geometry = shallowRef<GeometryProxy>(zeroGeometry)
    const value = shallowRef<VNodeChild>(null)
    const version = shallowRef(0)
    let pendingTransaction: Transaction | undefined
    let disconnect = () => undefined
    const subscriptions = new Map<StateRef<unknown>, () => void>()
    watchEffect(() => {
      void version.value
      const dependencies = new Set<StateRef<unknown>>()
      value.value = withRenderTransaction(pendingTransaction, () => collectStateReads(() => props.render(geometry.value), dependency => dependencies.add(dependency)))
      pendingTransaction = undefined
      sync(subscriptions, dependencies, transaction => { pendingTransaction = transaction; version.value += 1 })
    })
    onScopeDispose(() => subscriptions.forEach(stop => stop()))
    onMounted(() => {
      const element = host.value
      if (!element) return
      const update = () => {
        const next = geometryFromElement(element)
        if (!sameGeometry(geometry.value, next)) geometry.value = next
      }
      update()
      let observer: ResizeObserver | undefined
      try {
        observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update)
        observer?.observe(element)
      } catch {
        try { observer?.disconnect() } catch {}
        observer = undefined
      }
      const view = element.ownerDocument.defaultView
      try { view?.addEventListener("resize", update) } catch {}
      disconnect = () => {
        try { observer?.disconnect() } catch {}
        try { view?.removeEventListener("resize", update) } catch {}
      }
    })
    onBeforeUnmount(() => disconnect())
    return () => h("div", { ref: host, "data-vune": "GeometryReader", style: { boxSizing: "border-box", width: "100%" } }, value.value === null ? undefined : [value.value])
  },
})

const VuneViewHost = defineComponent({
  name: "VuneViewHost",
  props: {
    node: { type: Object as PropType<ViewHostNode>, required: true },
  },
  setup(props) {
    const state = props.node.state?.(props.node.props) ?? {}
    return () => {
      const resolvedProps = { ...props.node.props, ...state }
      return h(ReactiveVuneValue, {
        factory: () => props.node.render(resolvedProps),
        ...(props.node.dependencies ? { dependencies: () => props.node.dependencies!(resolvedProps) } : {}),
        ...(props.node.dependenciesComplete ? { dependenciesComplete: true } : {}),
      })
    }
  },
})

/** Render any renderer-independent Vune ViewGraph value as Vue VNodes. */
export function render(value: ViewGraphValue): VNodeChild {
  return renderViewNode(value, renderer)
}

export interface VuneViewProps {
  readonly value?: ViewGraphValue
  readonly render?: () => ViewGraphValue
}

/** Component for direct use from a Vue SFC template. */
export const VuneView = defineComponent({
  name: "VuneView",
  props: {
    value: { type: null as unknown as PropType<ViewGraphValue>, required: false },
    render: { type: Function as PropType<() => ViewGraphValue>, required: false },
  },
  setup(props) {
    return () => h(ReactiveVuneValue, { factory: () => props.render ? props.render() : props.value ?? null })
  },
})

/** Wrap a graph factory as a Vue component, retaining Vue props at the bridge. */
export function createVueView<Props extends Record<string, unknown> = Record<string, unknown>>(
  body: (props: Props) => ViewGraphValue,
): VueComponentType<Props> {
  return defineComponent({
    name: "VuneViewAdapter",
    setup(_props, { attrs }) {
      return () => h(ReactiveVuneValue, { factory: () => body(attrs as Props) })
    },
  }) as VueComponentType<Props>
}

function isComponentPropsRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false
  try {
    return !Array.isArray(value)
  } catch {
    return false
  }
}

function snapshotComponentProps(value: unknown): {
  readonly props: Record<string, unknown>
  readonly slots?: Record<string, VuneVueSlot>
} {
  if (!isComponentPropsRecord(value)) return { props: {} }
  try {
    const props: Record<PropertyKey, unknown> = {}
    let slots: Record<string, VuneVueSlot> | undefined
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !("value" in descriptor)) continue
      if (key === "slots") {
        if (isComponentPropsRecord(descriptor.value)) slots = descriptor.value as Record<string, VuneVueSlot>
        continue
      }
      Object.defineProperty(props, key, { ...descriptor, configurable: true })
    }
    return { props: props as Record<string, unknown>, ...(slots ? { slots } : {}) }
  } catch {
    return { props: {} }
  }
}

/** Place a Vue component or native HTML element in the same Vune graph. */
export function Component<C extends object>(type: C, props: Omit<VuneVueComponentProps<NoInfer<C>>, "slots"> & { readonly slots?: Record<string, any> }, ...children: ViewValue[]): ModifiableViewNode
export function Component<C extends object>(type: C, ...args: VueComponentArguments<NoInfer<C>>): ModifiableViewNode
export function Component(type: string, props?: Record<string, unknown> | null, ...children: ViewValue[]): ModifiableViewNode
export function Component(
  type: VueComponentType | string,
  props: (Record<string, unknown> & { readonly slots?: Record<string, VuneVueSlot> }) | null = null,
  ...children: ViewValue[]
): ModifiableViewNode {
  if (typeof type === "string") return viewElement(type, props, children)
  const snapshot = snapshotComponentProps(props)
  return ForeignComponent(type, snapshot, ...children)
}

/** Adapt a Vue component definition into a Vune-callable, preserving its Vue prop surface. */
export function vueComponent<C extends object>(type: C): VueComponentView<C> {
  const name = typeof type === "function" && (type as { name?: string }).name ? (type as { name: string }).name : "VueComponent"
  const View = defineView(name, {
    initializers: [initializer(
      "VueComponent(props?)",
      args => args.length <= 1 && (args.length === 0 || isComponentPropsRecord(args[0])),
      args => ({ props: args[0] ?? null }),
    )],
    intrinsic: true,
    body: ({ props }: { readonly props: Record<string, unknown> | null }) => Component(type, (props ?? {}) as VuneVueComponentProps<C>),
  }) as unknown as VueComponentView<C>
  Object.defineProperty(View, "component", { configurable: false, enumerable: false, value: type })
  return View
}

/** Generic foreign-component callable layer; Vue is the first host implementation. */
export function foreignComponent<C extends object>(type: C): VueComponentView<C> {
  return vueComponent(type)
}

/** Bridge Vune State to a Vue Ref without making State a Vue primitive. */
export function toVueRef<T>(state: StateRef<T>): Ref<T> {
  return customRef<T>((track, trigger) => {
    const unsubscribe = subscribeState(state, trigger)
    if (getCurrentScope()) onScopeDispose(unsubscribe)
    return {
      get() { track(); return state.value },
      set(value) { state.value = value },
    }
  })
}

/** Bridge any Vue Ref to a writable Vune Binding lens. */
export function fromVueRef<T>(ref: Ref<T>): BindingRef<T> {
  return Binding(() => ref.value, value => { ref.value = value })
}

/** Mount a graph into a Vue-managed DOM root. */
export interface VueMountOptions {
  readonly hydrate?: boolean
}

/** Mount a graph into Vue, optionally hydrating markup produced by SSR. */
export function mount(value: ViewGraphValue, target: Element, options: VueMountOptions = {}): () => void {
  const app = options.hydrate ? createSSRApp(VuneView, { value }) : createApp(VuneView, { value })
  app.mount(target)
  return () => app.unmount()
}

export type VueView = VueComponentType<ComponentPublicInstance>
