import {
  ViewBuilder,
  defineBuiltinView,
  geometryView,
  initializer,
  initializerKinds,
  isViewNode,
  modifier,
  resolveBuilderClosure,
  type ViewValue,
  viewElement,
  viewFragment,
} from "./graph.js"
import type { BindingRef, StateRef } from "./state.js"
import type { GeometryProxy } from "./graph.js"

export interface VStackOptions {
  readonly alignment?: "leading" | "center" | "trailing"
  readonly spacing?: number | string
}

export interface HStackOptions {
  readonly alignment?: "top" | "center" | "bottom"
  readonly spacing?: number | string
}

export interface ZStackOptions {
  readonly alignment?: "center" | "leading" | "trailing" | "top" | "bottom" | "topLeading" | "topTrailing" | "bottomLeading" | "bottomTrailing"
}

const textValue = initializerKinds.value(true, "value", undefined, "string | number")
const stackContent = initializerKinds.viewBuilder(true, "content")
const genericStackContent = initializerKinds.viewBuilder(true, "content", "Content")

export const Text = defineBuiltinView<{ value: string | number }>(
  "Text",
  [initializer(
    "Text(value)",
    args => args.length === 1 && (typeof args[0] === "string" || typeof args[0] === "number"),
    args => ({ value: args[0] as string | number }),
    [textValue],
  )],
  ({ value }) => viewElement("span", null, [value]),
)

function stackChildren(value: unknown): ViewValue[] {
  return Array.isArray(value)
    ? value.flatMap(item => stackChildren(item))
    : [value as ViewValue]
}

function isOptions(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !isViewNode(value)
}

function stackInitializers(optionsParameter: ReturnType<typeof initializerKinds.value>) {
  return [
    initializer(
      "@ViewBuilder content",
      args => args.length === 1 && typeof args[0] === "function",
      args => ({ content: resolveBuilderClosure(args[0] as () => ViewValue) }),
      [genericStackContent],
    ),
    initializer(
      "options, @ViewBuilder content",
      args => args.length === 2 && isOptions(args[0]) && typeof args[1] === "function",
      args => ({ options: args[0], content: resolveBuilderClosure(args[1] as () => ViewValue) }),
      [optionsParameter, genericStackContent],
    ),
    initializer(
      "options, ...children",
      args => args.length >= 1 && isOptions(args[0]) && args.slice(1).every(value => typeof value !== "function"),
      args => ({ options: args[0], content: args.slice(1).flatMap(stackChildren) }),
    ),
    initializer(
      "...children",
      args => args.every(value => typeof value !== "function"),
      args => ({ content: args.flatMap(stackChildren) }),
    ),
  ]
}

export const VStack = defineBuiltinView<{ options?: VStackOptions; content: ViewValue[] }>(
  "VStack",
  stackInitializers(initializerKinds.value(false, "options", ["alignment", "spacing"], "object")),
  ({ options = {}, content }) => viewElement("div", {
    "data-muse": "VStack",
    style: {
      display: "flex",
      flexDirection: "column",
      width: "100%",
      boxSizing: "border-box",
      alignItems: options.alignment === "leading" ? "flex-start" : options.alignment === "trailing" ? "flex-end" : "center",
      gap: typeof options.spacing === "number" ? `${options.spacing}px` : options.spacing,
    },
  }, content),
  "Content: View",
)

export const HStack = defineBuiltinView<{ options?: HStackOptions; content: ViewValue[] }>(
  "HStack",
  stackInitializers(initializerKinds.value(false, "options", ["alignment", "spacing"], "object")),
  ({ options = {}, content }) => viewElement("div", {
    "data-muse": "HStack",
    style: {
      display: "flex",
      flexDirection: "row",
      width: "100%",
      boxSizing: "border-box",
      alignItems: options.alignment === "top" ? "flex-start" : options.alignment === "bottom" ? "flex-end" : "center",
      gap: typeof options.spacing === "number" ? `${options.spacing}px` : options.spacing,
    },
  }, content),
  "Content: View",
)

export const ZStack = defineBuiltinView<{ options?: ZStackOptions; content: ViewValue[] }>(
  "ZStack",
  [
    initializer("@ViewBuilder content", args => args.length === 1 && typeof args[0] === "function", args => ({ content: resolveBuilderClosure(args[0] as () => ViewValue) }), [genericStackContent]),
    initializer("options, @ViewBuilder content", args => args.length === 2 && isOptions(args[0]) && typeof args[1] === "function", args => ({ options: args[0], content: resolveBuilderClosure(args[1] as () => ViewValue) }), [initializerKinds.value(false, "options", ["alignment"], "object"), genericStackContent]),
    initializer("options, ...children", args => args.length >= 1 && isOptions(args[0]) && args.slice(1).every(value => typeof value !== "function"), args => ({ options: args[0], content: args.slice(1).flatMap(stackChildren) })),
    initializer("...children", args => args.every(value => typeof value !== "function"), args => ({ content: args.flatMap(stackChildren) })),
  ],
  ({ options = {}, content }) => viewElement("div", {
    "data-muse": "ZStack",
    style: {
      display: "grid",
      width: "100%",
      boxSizing: "border-box",
      placeItems: options.alignment === "topLeading" ? "start" : options.alignment === "topTrailing" ? "start end" : options.alignment === "bottomLeading" ? "end start" : options.alignment === "bottomTrailing" ? "end" : "center",
    },
  }, content),
  "Content: View",
)

export type ScrollAxis = "vertical" | "horizontal" | "both"

const scrollContent = initializerKinds.viewBuilder(true, "content")
const scrollAxis = initializerKinds.value(false, "axis", undefined, "string")

export const ScrollView = defineBuiltinView<{ axis?: ScrollAxis; content: ViewValue[] }>(
  "ScrollView",
  [
    initializer(
      "ScrollView(@ViewBuilder content)",
      args => args.length === 1 && typeof args[0] === "function",
      args => ({ content: resolveBuilderClosure(args[0] as () => ViewValue) }),
      [scrollContent],
    ),
    initializer(
      "ScrollView(axis, @ViewBuilder content)",
      args => args.length === 2 && typeof args[0] === "string" && typeof args[1] === "function",
      args => ({ axis: args[0] as ScrollAxis, content: resolveBuilderClosure(args[1] as () => ViewValue) }),
      [initializerKinds.value(true, "axis", undefined, "string"), scrollContent],
    ),
    initializer(
      "ScrollView(content, axis?)",
      args => args.length >= 1 && args.length <= 2 && typeof args[0] !== "function",
      args => ({ content: stackChildren(args[0] as ViewValue), axis: args[1] as ScrollAxis | undefined }),
      [initializerKinds.value(true, "content"), scrollAxis],
    ),
  ],
  ({ axis = "vertical", content }) => viewElement("div", {
    "data-muse": "ScrollView",
    style: {
      overflowX: axis === "horizontal" || axis === "both" ? "auto" : "hidden",
      overflowY: axis === "vertical" || axis === "both" ? "auto" : "hidden",
      WebkitOverflowScrolling: "touch",
    },
  }, content),
)

export type SafeAreaEdge = "top" | "right" | "bottom" | "left" | "all"

function hasSafeAreaEdge(edges: SafeAreaEdge | readonly SafeAreaEdge[], edge: Exclude<SafeAreaEdge, "all">): boolean {
  return edges === "all" || (Array.isArray(edges) ? edges.includes("all") || edges.includes(edge) : edges === edge)
}

const safeAreaContent = initializerKinds.viewBuilder(true, "content")

export const SafeArea = defineBuiltinView<{ edges?: SafeAreaEdge | readonly SafeAreaEdge[]; content: ViewValue[] }>(
  "SafeArea",
  [
    initializer(
      "SafeArea(@ViewBuilder content)",
      args => args.length === 1 && typeof args[0] === "function",
      args => ({ content: resolveBuilderClosure(args[0] as () => ViewValue) }),
      [safeAreaContent],
    ),
    initializer(
      "SafeArea(edges, @ViewBuilder content)",
      args => args.length === 2 && (typeof args[0] === "string" || Array.isArray(args[0])) && typeof args[1] === "function",
      args => ({ edges: args[0] as SafeAreaEdge | readonly SafeAreaEdge[], content: resolveBuilderClosure(args[1] as () => ViewValue) }),
      [initializerKinds.value(true, "edges"), safeAreaContent],
    ),
  ],
  ({ edges = "all", content }) => viewElement("div", {
    "data-muse": "SafeArea",
    style: {
      paddingTop: hasSafeAreaEdge(edges, "top") ? "env(safe-area-inset-top)" : undefined,
      paddingRight: hasSafeAreaEdge(edges, "right") ? "env(safe-area-inset-right)" : undefined,
      paddingBottom: hasSafeAreaEdge(edges, "bottom") ? "env(safe-area-inset-bottom)" : undefined,
      paddingLeft: hasSafeAreaEdge(edges, "left") ? "env(safe-area-inset-left)" : undefined,
      boxSizing: "border-box",
    },
  }, content),
)

export const GeometryReader = defineBuiltinView<{ content: (geometry: GeometryProxy) => ViewValue }>(
  "GeometryReader",
  [initializer(
    "GeometryReader(@ViewBuilder content)",
    args => args.length === 1 && typeof args[0] === "function",
    args => ({ content: args[0] as (geometry: GeometryProxy) => ViewValue }),
    [initializerKinds.viewBuilder(true, "content")],
  )],
  ({ content }) => geometryView(content),
)

export const Spacer = defineBuiltinView<{ minLength?: number | string }>(
  "Spacer",
  [initializer("Spacer(minLength?)", args => args.length <= 1 && typeof args[0] !== "function", args => ({ minLength: args[0] as number | string | undefined }), [initializerKinds.value(false, "minLength")])],
  ({ minLength }) => viewElement("div", { "data-muse": "Spacer", style: { flexGrow: 1, minWidth: minLength, minHeight: minLength, flexBasis: typeof minLength === "number" ? `${minLength}px` : minLength } }),
)

export const Divider = defineBuiltinView("Divider", [initializer("Divider()", args => args.length === 0)], () => viewElement("hr", { "data-muse": "Divider" }))

export const Group = defineBuiltinView<{ content: ViewValue[] }>(
  "Group",
  [
    initializer("@ViewBuilder content", args => args.length === 1 && typeof args[0] === "function", args => ({ content: resolveBuilderClosure(args[0] as () => ViewValue) }), [stackContent]),
    initializer("...children", args => args.every(value => typeof value !== "function"), args => ({ content: args.flatMap(stackChildren) })),
  ],
  ({ content }) => viewFragment(content),
)

/** Construct a raw HTML element without involving a renderer or a component allow-list. */
export function Element(tag: string, props: Record<string, unknown> | null = null, ...children: ViewValue[]): ReturnType<typeof viewElement> {
  return viewElement(tag, props, children)
}

interface ButtonProps {
  readonly label?: ViewValue[]
  readonly action: () => unknown
}

const actionParameter = initializerKinds.action(true, "action")
const labelParameter = initializerKinds.viewBuilder(true, "label")

export const Button = defineBuiltinView<ButtonProps>(
  "Button",
  [
    initializer("Button(@Action action)", args => args.length === 1 && typeof args[0] === "function", args => ({ action: args[0] as () => unknown }), [actionParameter]),
    initializer("Button(value, @Action action)", args => args.length === 2 && typeof args[0] !== "function" && typeof args[1] === "function", args => ({ label: [Text(args[0] as string | number)], action: args[1] as () => unknown }), [initializerKinds.value(true, "title", undefined, "string | number"), actionParameter]),
    initializer("Button(@Action action, @ViewBuilder label)", args => args.length === 2 && typeof args[0] === "function" && typeof args[1] === "function", args => ({ action: args[0] as () => unknown, label: resolveBuilderClosure(args[1] as () => ViewValue) }), [actionParameter, labelParameter]),
    initializer("Button(@ViewBuilder label, @Action action)", args => args.length === 2 && typeof args[0] === "function" && typeof args[1] === "function", args => ({ label: resolveBuilderClosure(args[0] as () => ViewValue), action: args[1] as () => unknown }), [labelParameter, actionParameter]),
  ],
  ({ label = [Text("Button")], action }) => viewElement("button", { type: "button", onClick: action }, label),
)

const objectIdentityKeys = new WeakMap<object, number>()
let nextObjectIdentityKey = 0

function collectionKey(item: unknown, index: number): string | number {
  if (typeof item === "string" || typeof item === "number") return item
  if (item && typeof item === "object") {
    const candidate = item as { readonly id?: unknown; readonly key?: unknown }
    if (typeof candidate.id === "string" || typeof candidate.id === "number") return candidate.id
    if (typeof candidate.key === "string" || typeof candidate.key === "number") return candidate.key
    const existing = objectIdentityKeys.get(item)
    if (existing !== undefined) return `object:${existing}`
    const assigned = nextObjectIdentityKey++
    objectIdentityKeys.set(item, assigned)
    return `object:${assigned}`
  }
  return `${typeof item}:${String(item)}:${index}`
}

function keyedCollectionChildren(value: ViewValue, key: string | number): ViewValue[] {
  return ViewBuilder.buildBlock(value).map((child, index) => isViewNode(child)
    ? modifier(child, "keyed", `${String(key)}:${index}`)
    : child)
}

export function ForEach<Item>(items: readonly Item[], content: (item: Item, index: number) => ViewValue): ReturnType<typeof viewFragment> {
  return viewFragment(items.flatMap((item, index) => keyedCollectionChildren(content(item, index), collectionKey(item, index))))
}

export const Section = defineBuiltinView<{ title?: string; content: ViewValue[] }>(
  "Section",
  [
    initializer("@ViewBuilder content", args => args.length === 1 && typeof args[0] === "function", args => ({ content: resolveBuilderClosure(args[0] as () => ViewValue) }), [stackContent]),
    initializer("title, @ViewBuilder content", args => args.length === 2 && typeof args[0] === "string" && typeof args[1] === "function", args => ({ title: args[0] as string, content: resolveBuilderClosure(args[1] as () => ViewValue) }), [initializerKinds.value(true, "title", undefined, "string"), stackContent]),
  ],
  ({ title, content }) => viewElement("section", { "data-muse": "Section" }, [
    ...(title === undefined ? [] : [Text(title)]),
    ...content,
  ]),
)

export const List = defineBuiltinView<{ content: ViewValue[] }>(
  "List",
  [
    initializer("@ViewBuilder content", args => args.length === 1 && typeof args[0] === "function", args => ({ content: resolveBuilderClosure(args[0] as () => ViewValue) }), [stackContent]),
    initializer("...children", args => args.every(value => typeof value !== "function"), args => ({ content: args.flatMap(stackChildren) })),
  ],
  ({ content }) => viewElement("ul", { "data-muse": "List", style: { listStyle: "none", padding: 0, margin: 0 } }, content),
)

export const LazyVStack = VStack
export const LazyHStack = HStack

export function BindingValue<T>(state: StateRef<T> | BindingRef<T>): BindingRef<T> {
  return state as BindingRef<T>
}
