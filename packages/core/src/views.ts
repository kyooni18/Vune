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
  type ViewBuilderClosure,
  type ViewBuilderContent,
  type TypedViewConstructor,
  viewElement,
  viewFragment,
} from "./graph.js"
import type { MuseCustomElementAttributes, MuseHtmlAttributes, MuseHtmlTagName } from "./html.js"
import { isStateRef, type BindingRef, type StateRef } from "./state.js"
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

interface TextProps { readonly value: string | number }

interface TextCall { (value: string | number): ReturnType<typeof viewElement> }

export const Text = defineBuiltinView<TextProps>(
  "Text",
  [initializer(
    "Text(value)",
    args => args.length === 1 && (typeof args[0] === "string" || typeof args[0] === "number"),
    args => ({ value: args[0] as string | number }),
    [textValue],
  )],
  ({ value }) => viewElement("span", null, [value]),
) as TypedViewConstructor<TextProps, TextCall>

function stackChildren(value: unknown): ViewValue[] {
  return Array.isArray(value)
    ? value.flatMap(item => stackChildren(item))
    : [value as ViewValue]
}

function isOptions(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !isViewNode(value)
}

function stackInitializers(optionsParameter: ReturnType<typeof initializerKinds.value>) {
  const variadicOptions = initializerKinds.value(true, optionsParameter.label, optionsParameter.properties, optionsParameter.type, true)
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
      [variadicOptions],
    ),
    initializer(
      "...children",
      args => args.every(value => typeof value !== "function"),
      args => ({ content: args.flatMap(stackChildren) }),
    ),
  ]
}

export interface VStackProps { readonly options?: VStackOptions; readonly content: ViewValue[] }
export interface StackCall<Options> {
  (content: ViewBuilderClosure): ReturnType<typeof viewElement>
  (options: Options, content: ViewBuilderClosure): ReturnType<typeof viewElement>
  (options: Options, ...children: ViewBuilderContent[]): ReturnType<typeof viewElement>
  (...children: ViewBuilderContent[]): ReturnType<typeof viewElement>
}

export const VStack = defineBuiltinView<VStackProps>(
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
) as TypedViewConstructor<VStackProps, StackCall<VStackOptions>>

export interface HStackProps { readonly options?: HStackOptions; readonly content: ViewValue[] }
export const HStack = defineBuiltinView<HStackProps>(
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
) as TypedViewConstructor<HStackProps, StackCall<HStackOptions>>

export interface ZStackProps { readonly options?: ZStackOptions; readonly content: ViewValue[] }
const zStackOptions = initializerKinds.value(false, "options", ["alignment"], "object")
const zStackVariadicOptions = initializerKinds.value(true, "options", ["alignment"], "object", true)
function zStackPlaceItems(alignment: ZStackOptions["alignment"]): string {
  switch (alignment) {
    case "leading": return "center start"
    case "trailing": return "center end"
    case "top": return "start center"
    case "bottom": return "end center"
    case "topLeading": return "start start"
    case "topTrailing": return "start end"
    case "bottomLeading": return "end start"
    case "bottomTrailing": return "end end"
    default: return "center"
  }
}

export const ZStack = defineBuiltinView<ZStackProps>(
  "ZStack",
  [
    initializer("@ViewBuilder content", args => args.length === 1 && typeof args[0] === "function", args => ({ content: resolveBuilderClosure(args[0] as () => ViewValue) }), [genericStackContent]),
    initializer("options, @ViewBuilder content", args => args.length === 2 && isOptions(args[0]) && typeof args[1] === "function", args => ({ options: args[0], content: resolveBuilderClosure(args[1] as () => ViewValue) }), [zStackOptions, genericStackContent]),
    initializer("options, ...children", args => args.length >= 1 && isOptions(args[0]) && args.slice(1).every(value => typeof value !== "function"), args => ({ options: args[0], content: args.slice(1).flatMap(stackChildren) }), [zStackVariadicOptions]),
    initializer("...children", args => args.every(value => typeof value !== "function"), args => ({ content: args.flatMap(stackChildren) })),
  ],
  ({ options = {}, content }) => viewElement("div", {
    "data-muse": "ZStack",
    style: {
      display: "grid",
      width: "100%",
      boxSizing: "border-box",
      placeItems: zStackPlaceItems(options.alignment),
    },
  }, content),
  "Content: View",
) as TypedViewConstructor<ZStackProps, StackCall<ZStackOptions>>

export type ScrollAxis = "vertical" | "horizontal" | "both"

const scrollContent = initializerKinds.viewBuilder(true, "content")
const scrollAxis = initializerKinds.value(false, "axis", undefined, "string")

export interface ScrollViewProps { readonly axis?: ScrollAxis; readonly content: ViewValue[] }
export interface ScrollViewCall {
  (content: ViewBuilderClosure): ReturnType<typeof viewElement>
  (axis: ScrollAxis, content: ViewBuilderClosure): ReturnType<typeof viewElement>
  (content: ViewBuilderContent, axis?: ScrollAxis): ReturnType<typeof viewElement>
}
export const ScrollView = defineBuiltinView<ScrollViewProps>(
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
) as TypedViewConstructor<ScrollViewProps, ScrollViewCall>

export type SafeAreaEdge = "top" | "right" | "bottom" | "left" | "all"

function hasSafeAreaEdge(edges: SafeAreaEdge | readonly SafeAreaEdge[], edge: Exclude<SafeAreaEdge, "all">): boolean {
  return edges === "all" || (Array.isArray(edges) ? edges.includes("all") || edges.includes(edge) : edges === edge)
}

const safeAreaContent = initializerKinds.viewBuilder(true, "content")

export interface SafeAreaProps { readonly edges?: SafeAreaEdge | readonly SafeAreaEdge[]; readonly content: ViewValue[] }
export interface SafeAreaCall {
  (content: ViewBuilderClosure): ReturnType<typeof viewElement>
  (edges: SafeAreaEdge | readonly SafeAreaEdge[], content: ViewBuilderClosure): ReturnType<typeof viewElement>
}
export const SafeArea = defineBuiltinView<SafeAreaProps>(
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
) as TypedViewConstructor<SafeAreaProps, SafeAreaCall>

export interface GeometryReaderProps { readonly content: (geometry: GeometryProxy) => ViewValue }
export interface GeometryReaderCall { (content: (geometry: GeometryProxy) => ViewBuilderContent): ReturnType<typeof viewElement> }
export const GeometryReader = defineBuiltinView<GeometryReaderProps>(
  "GeometryReader",
  [initializer(
    "GeometryReader(@ViewBuilder content)",
    args => args.length === 1 && typeof args[0] === "function",
    args => ({ content: args[0] as (geometry: GeometryProxy) => ViewValue }),
    [initializerKinds.viewBuilder(true, "content")],
  )],
  ({ content }) => geometryView(content),
) as TypedViewConstructor<GeometryReaderProps, GeometryReaderCall>

export interface SpacerProps { readonly minLength?: number | string }
export interface SpacerCall { (minLength?: number | string): ReturnType<typeof viewElement> }
export const Spacer = defineBuiltinView<SpacerProps>(
  "Spacer",
  [initializer("Spacer(minLength?)", args => args.length <= 1 && typeof args[0] !== "function", args => ({ minLength: args[0] as number | string | undefined }), [initializerKinds.value(false, "minLength")])],
  ({ minLength }) => viewElement("div", { "data-muse": "Spacer", style: { flexGrow: 1, flexShrink: 0, flexBasis: typeof minLength === "number" ? `${minLength}px` : minLength } }),
) as TypedViewConstructor<SpacerProps, SpacerCall>

export const Divider = defineBuiltinView("Divider", [initializer("Divider()", args => args.length === 0)], () => viewElement("hr", { "data-muse": "Divider" }))

export const Group = defineBuiltinView<{ content: ViewValue[] }>(
  "Group",
  [
    initializer("@ViewBuilder content", args => args.length === 1 && typeof args[0] === "function", args => ({ content: resolveBuilderClosure(args[0] as () => ViewValue) }), [stackContent]),
    initializer("...children", args => args.every(value => typeof value !== "function"), args => ({ content: args.flatMap(stackChildren) })),
  ],
  ({ content }) => viewFragment(content),
)

/** Construct typed raw HTML without involving a renderer or a component allow-list. */
export function Element<Tag extends MuseHtmlTagName>(tag: Tag, props?: MuseHtmlAttributes<Tag> | null, ...children: ViewValue[]): ReturnType<typeof viewElement>
export function Element<Tag extends `${string}-${string}`>(tag: Tag, props?: MuseCustomElementAttributes<Tag> | null, ...children: ViewValue[]): ReturnType<typeof viewElement>
export function Element(tag: string, props: object | null = null, ...children: ViewValue[]): ReturnType<typeof viewElement> {
  return viewElement(tag, props as Record<string, unknown> | null, children)
}

interface ButtonProps {
  readonly label?: ViewValue[]
  readonly action: () => unknown
}

type ButtonAction = () => unknown
interface ButtonCall {
  (action: ButtonAction): ReturnType<typeof viewElement>
  (title: string | number, action: ButtonAction): ReturnType<typeof viewElement>
  (action: ButtonAction, label: ViewBuilderClosure): ReturnType<typeof viewElement>
  (label: ViewBuilderClosure, action: ButtonAction): ReturnType<typeof viewElement>
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
) as TypedViewConstructor<ButtonProps, ButtonCall>

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

interface ForEachProps<Item> {
  readonly items: readonly Item[] | StateRef<readonly Item[]>
  readonly content: (item: Item, index: number) => ViewValue
}

interface ForEachCall {
  <Item>(items: readonly Item[] | StateRef<readonly Item[]>, content: (item: Item, index: number) => ViewValue): ReturnType<typeof viewFragment>
}

const ForEachType = defineBuiltinView<ForEachProps<unknown>>(
  "ForEach",
  [initializer(
    "ForEach(items, @ViewBuilder content)",
    args => args.length === 2 && typeof args[1] === "function",
    args => ({ items: args[0] as readonly unknown[] | StateRef<readonly unknown[]>, content: args[1] as (item: unknown, index: number) => ViewValue }),
    [initializerKinds.value(true, "items", undefined, "array"), initializerKinds.viewBuilder(true, "content", "(item: Item, index: number) => View")],
  )],
  ({ items, content }) => {
    const collection = (isStateRef(items) ? items.value : items) as readonly unknown[]
    return viewFragment(collection.flatMap((item, index) => keyedCollectionChildren(content(item, index), collectionKey(item, index))))
  },
  "Item",
)

/** A keyed collection View that also accepts a State-backed collection directly. */
export const ForEach = ForEachType as unknown as ForEachCall & typeof ForEachType

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
