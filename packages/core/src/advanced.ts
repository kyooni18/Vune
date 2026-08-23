import {
  defineBuiltinView,
  initializer,
  initializerKinds,
  lazyView,
  resolveBuilderClosure,
  type ModifiableViewNode,
  type TypedViewConstructor,
  type ViewBuilderClosure,
  type ViewBuilderContent,
  type ViewValue,
  viewElement,
} from "./graph.js"
import { isBinding, isStateRef, resolveValue, type BindingRef, type Value } from "./state.js"
import { HStack, ScrollView, Text } from "./views.js"

function flattenChildren(values: readonly ViewBuilderContent[]): ViewValue[] {
  return values.flatMap(value => Array.isArray(value) ? flattenChildren(value) : value === null || value === undefined || value === false ? [] : [value]) as ViewValue[]
}

const staticChildren = (args: readonly unknown[]) => args.every(value => typeof value !== "function")
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

export interface BoxProps { readonly children: ViewValue[] }
interface BoxCall {
  (content: ViewBuilderClosure): ModifiableViewNode
  (...children: ViewBuilderContent[]): ModifiableViewNode
}

export const Box = defineBuiltinView<BoxProps>(
  "Box",
  [
    initializer("Box(@ViewBuilder content)", args => args.length === 1 && typeof args[0] === "function", args => ({ children: resolveBuilderClosure(args[0] as () => ViewValue) }), [initializerKinds.viewBuilder(true, "content")]),
    initializer("Box(...children)", staticChildren, args => ({ children: flattenChildren(args as ViewBuilderContent[]) })),
  ],
  ({ children }) => viewElement("div", { "data-muse": "Box" }, children),
) as TypedViewConstructor<BoxProps, BoxCall>

const emptyView = (name: string, style?: Record<string, unknown>) => defineBuiltinView(
  name,
  [initializer(`${name}()`, args => args.length === 0)],
  () => viewElement("div", { "data-muse": name, style }),
)

export const Rectangle = emptyView("Rectangle") as TypedViewConstructor<Record<string, never>, { (): ModifiableViewNode }>
export const Circle = emptyView("Circle", { borderRadius: "50%" }) as TypedViewConstructor<Record<string, never>, { (): ModifiableViewNode }>
export const Capsule = emptyView("Capsule", { borderRadius: "9999px" }) as TypedViewConstructor<Record<string, never>, { (): ModifiableViewNode }>

export interface RoundedRectangleProps { readonly radius?: number | string }
interface RoundedRectangleCall { (radius?: number | string): ModifiableViewNode }
export const RoundedRectangle = defineBuiltinView<RoundedRectangleProps>(
  "RoundedRectangle",
  [initializer("RoundedRectangle(radius?)", args => args.length <= 1 && (args[0] === undefined || typeof args[0] === "number" || typeof args[0] === "string"), args => ({ radius: args[0] as number | string | undefined }), [initializerKinds.value(false, "radius", undefined, "number | string")])],
  ({ radius = 8 }) => viewElement("div", { "data-muse": "RoundedRectangle", style: { borderRadius: typeof radius === "number" ? `${radius}px` : radius } }),
) as TypedViewConstructor<RoundedRectangleProps, RoundedRectangleCall>

export interface GridOptions { readonly columns?: number | string; readonly rows?: number | string; readonly autoFlow?: string }
export interface GridProps { readonly options?: GridOptions; readonly children: ViewValue[] }
interface GridCall {
  // Keep overload order aligned with the runtime initializer table below.
  (options: GridOptions, content: ViewBuilderClosure): ModifiableViewNode
  (content: ViewBuilderClosure): ModifiableViewNode
  (options: GridOptions, ...children: ViewBuilderContent[]): ModifiableViewNode
  (...children: ViewBuilderContent[]): ModifiableViewNode
}

export const Grid = defineBuiltinView<GridProps>(
  "Grid",
  [
    initializer("Grid(options, @ViewBuilder content)", args => args.length === 2 && isObject(args[0]) && typeof args[1] === "function", args => ({ options: args[0] as GridOptions, children: resolveBuilderClosure(args[1] as () => ViewValue) }), [initializerKinds.value(true, "options", ["columns", "rows", "autoFlow"], "object"), initializerKinds.viewBuilder(true, "content")]),
    initializer("Grid(@ViewBuilder content)", args => args.length === 1 && typeof args[0] === "function", args => ({ children: resolveBuilderClosure(args[0] as () => ViewValue) }), [initializerKinds.viewBuilder(true, "content")]),
    initializer("Grid(options, ...children)", args => args.length >= 1 && isObject(args[0]) && staticChildren(args.slice(1)), args => ({ options: args[0] as GridOptions, children: flattenChildren(args.slice(1) as ViewBuilderContent[]) }), [initializerKinds.value(true, "options", ["columns", "rows", "autoFlow"], "object", true)]),
    initializer("Grid(...children)", staticChildren, args => ({ children: flattenChildren(args as ViewBuilderContent[]) })),
  ],
  ({ options = {}, children }) => viewElement("div", {
    "data-muse": "Grid",
    style: {
      display: "grid",
      gridTemplateColumns: options.columns === undefined ? undefined : typeof options.columns === "number" ? `repeat(${options.columns}, minmax(0, 1fr))` : options.columns,
      gridTemplateRows: options.rows === undefined ? undefined : typeof options.rows === "number" ? `repeat(${options.rows}, minmax(0, 1fr))` : options.rows,
      gridAutoFlow: options.autoFlow,
    },
  }, children),
) as TypedViewConstructor<GridProps, GridCall>

export interface TextAreaProps { readonly value: BindingRef<string>; readonly placeholder?: string }
interface TextAreaCall { (value: BindingRef<string>, placeholder?: string): ModifiableViewNode }
export const TextArea = defineBuiltinView<TextAreaProps>(
  "TextArea",
  [initializer("TextArea(value, placeholder?)", args => args.length >= 1 && args.length <= 2 && isBinding(args[0]) && (args[1] === undefined || typeof args[1] === "string"), args => ({ value: args[0] as BindingRef<string>, placeholder: args[1] as string | undefined }), [initializerKinds.binding(true, "value", "string"), initializerKinds.value(false, "placeholder", undefined, "string")])],
  ({ value, placeholder }) => viewElement("textarea", { "data-muse": "TextArea", value: value.value, placeholder, onInput(event: { target?: { value?: string } }) { value.value = String(event.target && event.target.value !== undefined ? event.target.value : "") } }),
) as TypedViewConstructor<TextAreaProps, TextAreaCall>

export interface PickerOption<T extends string | number> { readonly label: string; readonly value: T; readonly disabled?: boolean }
export interface PickerProps { readonly value: BindingRef<string | number>; readonly options: readonly PickerOption<string | number>[] }
interface PickerCall { <T extends string | number>(value: BindingRef<T>, options: readonly PickerOption<NoInfer<T>>[]): ModifiableViewNode }
export const Picker = defineBuiltinView<PickerProps>(
  "Picker",
  [initializer("Picker(value, options)", args => args.length === 2 && isBinding(args[0]) && Array.isArray(args[1]), args => ({ value: args[0] as BindingRef<string | number>, options: args[1] as readonly PickerOption<string | number>[] }), [initializerKinds.binding(true, "value", "string | number"), initializerKinds.value(true, "options", undefined, "array")])],
  ({ value, options }) => viewElement("select", { "data-muse": "Picker", value: value.value, onChange(event: { target?: { value?: string } }) { const selectedValue = event.target ? event.target.value : undefined; const option = options.find(item => String(item.value) === selectedValue); if (option) value.value = option.value } }, options.map(option => viewElement("option", { value: option.value, disabled: option.disabled }, [option.label]))),
) as TypedViewConstructor<PickerProps, PickerCall>

export interface ProgressViewOptions { readonly label?: string; readonly max?: number }
export interface ProgressViewProps extends ProgressViewOptions { readonly value?: number }
interface ProgressViewCall { (value?: Value<number>, options?: ProgressViewOptions): ModifiableViewNode }
export const ProgressView = defineBuiltinView<ProgressViewProps>(
  "ProgressView",
  [initializer("ProgressView(value?, options?)", args => args.length <= 2 && (args[0] === undefined || typeof args[0] === "number" || typeof args[0] === "function" || isBinding(args[0]) || isStateRef(args[0])) && (args[1] === undefined || isObject(args[1])), args => ({ value: args[0] === undefined ? undefined : Number(resolveValue(args[0] as Value<number>)), ...(isObject(args[1]) ? args[1] : {}) }), [initializerKinds.value(false, "value", undefined, "Value<number>"), initializerKinds.value(false, "options", ["label", "max"], "object")])],
  ({ value, label, max = 1 }) => viewElement("div", { "data-muse": "ProgressView" }, [viewElement("progress", { max, ...(value === undefined ? {} : { value }) }), ...(label === undefined ? [] : [Text(label)])]),
) as TypedViewConstructor<ProgressViewProps, ProgressViewCall>

export interface LabelProps { readonly title: string; readonly icon: ModifiableViewNode }
interface LabelCall { (title: string, icon: ModifiableViewNode): ModifiableViewNode }
export const Label = defineBuiltinView<LabelProps>(
  "Label",
  [initializer("Label(title, icon)", args => args.length === 2 && typeof args[0] === "string", args => ({ title: args[0] as string, icon: args[1] as ModifiableViewNode }), [initializerKinds.value(true, "title", undefined, "string"), initializerKinds.value(true, "icon", undefined, "View")])],
  ({ title, icon }) => HStack(icon, Text(title)),
) as TypedViewConstructor<LabelProps, LabelCall>

export interface StepperProps { readonly value: BindingRef<number>; readonly step?: number }
interface StepperCall { (value: BindingRef<number>, step?: number): ModifiableViewNode }
export const Stepper = defineBuiltinView<StepperProps>(
  "Stepper",
  [initializer("Stepper(value, step?)", args => args.length >= 1 && args.length <= 2 && isBinding(args[0]) && (args[1] === undefined || typeof args[1] === "number"), args => ({ value: args[0] as BindingRef<number>, step: args[1] as number | undefined }), [initializerKinds.binding(true, "value", "number"), initializerKinds.value(false, "step", undefined, "number")])],
  ({ value, step = 1 }) => HStack(Text(String(value.value)), viewElement("button", { type: "button", onClick() { value.value += step } }, ["+"])).withProps({ "data-muse": "Stepper" }),
) as TypedViewConstructor<StepperProps, StepperCall>

export interface LazyGridOptions extends GridOptions {
  readonly estimatedItemSize?: number | string
  readonly overscan?: number
}
export interface LazyGridProps { readonly options?: LazyGridOptions; readonly children: ViewValue[] }
interface LazyGridCall {
  // Keep overload order aligned with the runtime initializer table below.
  (options: LazyGridOptions, content: ViewBuilderClosure): ModifiableViewNode
  (content: ViewBuilderClosure): ModifiableViewNode
  (options: LazyGridOptions, ...children: ViewBuilderContent[]): ModifiableViewNode
  (...children: ViewBuilderContent[]): ModifiableViewNode
}

export const LazyGrid = defineBuiltinView<LazyGridProps>(
  "LazyGrid",
  [
    initializer("LazyGrid(options, @ViewBuilder content)", args => args.length === 2 && isObject(args[0]) && typeof args[1] === "function", args => ({ options: args[0] as LazyGridOptions, children: resolveBuilderClosure(args[1] as () => ViewValue) }), [initializerKinds.value(true, "options", ["columns", "rows", "autoFlow", "estimatedItemSize", "overscan"], "object"), initializerKinds.viewBuilder(true, "content")]),
    initializer("LazyGrid(@ViewBuilder content)", args => args.length === 1 && typeof args[0] === "function", args => ({ children: resolveBuilderClosure(args[0] as () => ViewValue) }), [initializerKinds.viewBuilder(true, "content")]),
    initializer("LazyGrid(options, ...children)", args => args.length >= 1 && isObject(args[0]) && staticChildren(args.slice(1)), args => ({ options: args[0] as LazyGridOptions, children: flattenChildren(args.slice(1) as ViewBuilderContent[]) }), [initializerKinds.value(true, "options", ["columns", "rows", "autoFlow", "estimatedItemSize", "overscan"], "object", true)]),
    initializer("LazyGrid(...children)", staticChildren, args => ({ children: flattenChildren(args as ViewBuilderContent[]) })),
  ],
  ({ options = {}, children }) => {
    const estimated = options.estimatedItemSize === undefined ? "44px" : typeof options.estimatedItemSize === "number" ? `${options.estimatedItemSize}px` : options.estimatedItemSize
    return lazyView("LazyGrid", "grid", {
      "data-muse": "LazyGrid",
      "data-muse-lazy": "grid",
      "data-muse-lazy-estimate": options.estimatedItemSize,
      "data-muse-lazy-overscan": options.overscan,
      style: {
        display: "grid",
        gridTemplateColumns: options.columns === undefined ? undefined : typeof options.columns === "number" ? `repeat(${options.columns}, minmax(0, 1fr))` : options.columns,
        gridTemplateRows: options.rows === undefined ? undefined : typeof options.rows === "number" ? `repeat(${options.rows}, minmax(0, 1fr))` : options.rows,
        gridAutoFlow: options.autoFlow,
        contentVisibility: "auto",
        containIntrinsicSize: `auto ${estimated}`,
      },
    }, children)
  },
) as TypedViewConstructor<LazyGridProps, LazyGridCall>

export function Key<T extends ModifiableViewNode>(key: string | number, child: T): T {
  return child.keyed(key) as T
}

export function ElementRef<T extends ModifiableViewNode>(reference: unknown, child: T): T {
  return child.elementRef(reference) as T
}

export { ScrollView }
