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
  Binding,
  classNameOf,
  collectStateReads,
  defineView,
  edgeInsetsFromCss,
  ForeignComponent,
  frameStyle,
  initializer,
  isForeignComponent,
  renderViewNode,
  subscribeState,
  viewIdentityKey,
  zeroGeometry,
  type GeometryProxy,
  type BindingRef,
  type ModifiableViewNode,
  type VuneRenderer,
  type StateRef,
  type ViewGraphValue,
  type ViewHostNode,
  type ViewModifierNode,
  type ViewValue,
  viewElement,
} from "@vune-ui/core"

const vuneVueSlots = Symbol.for("vune.vue.slots")

export type VuneVueSlot = ViewValue | ((...args: any[]) => ViewValue)
export type VueComponentProps<C> = C extends abstract new (...args: any[]) => { $props: infer Props }
  ? Props
  : C extends (props: infer Props, ...args: any[]) => any ? Props : Record<string, unknown>
type RequiredVuePropKeys<Props> = {
  [Key in keyof Props]-?: object extends Pick<Props, Key> ? never : Key
}[keyof Props]
type VuneVueComponentProps<C> = VueComponentProps<C> & { readonly slots?: Record<string, VuneVueSlot> }
type VueComponentArguments<C> = [RequiredVuePropKeys<VueComponentProps<C>>] extends [never]
  ? [props?: VuneVueComponentProps<C> | null, ...children: ViewValue[]]
  : [props: VuneVueComponentProps<C>, ...children: ViewValue[]]
export type VueComponentView<C extends VueComponentType> = ((...args: VueComponentArguments<C>) => ModifiableViewNode) & {
  readonly component: C
}

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
    case "style": return value && typeof value === "object" ? { style: value } : {}
    case "className": return { class: classNameOf(value) }
    case "withProps": return value && typeof value === "object" ? value as Record<string, unknown> : {}
    case "keyed": return { key: value }
    case "elementRef": return { ref: value }
    case "frame": {
      return { style: frameStyle(value && typeof value === "object" ? value : {}) }
    }
    default: return {}
  }
}

function mergeProps(current: Record<string, unknown> | null | undefined, extra: Record<string, unknown>): Record<string, unknown> {
  const currentStyle = current?.style && typeof current.style === "object" ? current.style : {}
  const extraStyle = extra.style && typeof extra.style === "object" ? extra.style : undefined
  return {
    ...(current ?? {}),
    ...extra,
    ...(extraStyle ? { style: { ...currentStyle, ...extraStyle } } : {}),
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
  if (typeof type === "string") return h(type, normalizedProps, children)
  const slots = foreign?.slots
    ? {
        ...Object.fromEntries(Object.entries(foreign.slots).map(([name, slot]) => [name, (...args: unknown[]) => render(typeof slot === "function" ? slot(...args) : slot)])),
        ...(children.length > 0 && !foreign.slots.default ? { default: () => children } : {}),
      }
    : rawSlots
    ? {
        ...Object.fromEntries(Object.entries(rawSlots).map(([name, slot]) => [name, (...args: unknown[]) => render(typeof slot === "function" ? slot(...args) : slot)])),
        ...(children.length > 0 && !rawSlots.default ? { default: () => children } : {}),
      }
    : children.length > 0 ? { default: () => children } : undefined
  return h((foreign?.component ?? type) as VueComponentType, normalizedProps, slots)
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
  modifier(content, modifier) {
    if (modifier.name === "frame") {
      return h("div", modifierProps(modifier), [content])
    }
    return content && typeof content === "object" && "type" in content
      ? cloneVNode(content as VNode, modifierProps(modifier))
      : h(Fragment, modifierProps(modifier), [content])
  },
  view(node, _render, identity) {
    return h(VuneViewHost, { key: viewIdentityKey(identity), node })
  },
  geometry(_node, render) {
    return h(GeometryVuneValue, { render })
  },
}

function RenderValue({ value }: { value: ViewGraphValue }): VNodeChild {
  return renderViewNode(value, renderer)
}

const ReactiveVuneValue = defineComponent({
  name: "ReactiveVuneValue",
  props: {
    factory: { type: Function as PropType<() => ViewGraphValue>, required: true },
  },
  setup(props) {
    const value = shallowRef<ViewGraphValue>(null)
    const version = shallowRef(0)
    watchEffect(onCleanup => {
      void version.value
      const dependencies = new Set<StateRef<unknown>>()
      value.value = collectStateReads(props.factory, dependency => dependencies.add(dependency))
      const unsubscribers = [...dependencies].map(dependency => subscribeState(dependency, () => {
        version.value += 1
      }))
      onCleanup(() => unsubscribers.forEach(unsubscribe => unsubscribe()))
    })
    return () => h(RenderValue, { value: value.value })
  },
})

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
    let disconnect = () => undefined
    watchEffect(onCleanup => {
      void version.value
      const dependencies = new Set<StateRef<unknown>>()
      value.value = collectStateReads(() => props.render(geometry.value), dependency => dependencies.add(dependency))
      const unsubscribers = [...dependencies].map(dependency => subscribeState(dependency, () => { version.value += 1 }))
      onCleanup(() => unsubscribers.forEach(unsubscribe => unsubscribe()))
    })
    onMounted(() => {
      const element = host.value
      if (!element) return
      const update = () => {
        const next = geometryFromElement(element)
        if (!sameGeometry(geometry.value, next)) geometry.value = next
      }
      update()
      const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update)
      observer?.observe(element)
      window.addEventListener("resize", update)
      disconnect = () => {
        observer?.disconnect()
        window.removeEventListener("resize", update)
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
    return () => h(ReactiveVuneValue, { factory: () => props.node.render({ ...props.node.props, ...state }) })
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

/** Place a Vue component or native HTML element in the same Vune graph. */
export function Component<C extends VueComponentType>(type: C, ...args: VueComponentArguments<C>): ModifiableViewNode
export function Component(type: string, props?: Record<string, unknown> | null, ...children: ViewValue[]): ModifiableViewNode
export function Component(
  type: VueComponentType | string,
  props: (Record<string, unknown> & { readonly slots?: Record<string, VuneVueSlot> }) | null = null,
  ...children: ViewValue[]
): ModifiableViewNode {
  if (typeof type === "string") return viewElement(type, props, children)
  const { slots, ...componentProps } = props ?? {}
  return ForeignComponent(type, { props: componentProps, slots }, ...children)
}

/** Adapt a Vue component definition into a Vune-callable, preserving its Vue prop surface. */
export function vueComponent<C extends VueComponentType>(type: C): VueComponentView<C> {
  const name = typeof type === "function" && type.name ? type.name : "VueComponent"
  const View = defineView(name, {
    initializers: [initializer(
      "VueComponent(props?)",
      args => args.length <= 1 && (args.length === 0 || (typeof args[0] === "object" && args[0] !== null && !Array.isArray(args[0]))),
      args => ({ props: args[0] ?? null }),
    )],
    intrinsic: true,
    body: ({ props }: { readonly props: Record<string, unknown> | null }) => Component(type, (props ?? {}) as VuneVueComponentProps<C>),
  }) as unknown as VueComponentView<C>
  Object.defineProperty(View, "component", { configurable: false, enumerable: false, value: type })
  return View
}

/** Generic foreign-component callable layer; Vue is the first host implementation. */
export function foreignComponent<C extends VueComponentType>(type: C): VueComponentView<C> {
  return vueComponent(type)
}

/** Bridge Vune State to a Vue Ref without making State a Vue primitive. */
export function toVueRef<T>(state: StateRef<T>): Ref<T> {
  return customRef<T>((track, trigger) => {
    const unsubscribe = subscribeState(state, trigger)
    if (getCurrentScope()) onScopeDispose(unsubscribe)
    return {
      get() { track(); return state.value },
      set(value) { state.value = value; trigger() },
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
