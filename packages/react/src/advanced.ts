import {
  defineBuiltinView,
  initializer,
  initializerKinds,
  isBinding,
  resolveValue,
  ScrollView as CoreScrollView,
  type BindingRef,
  type Value,
  viewElement,
  viewFragment,
} from "@muse/core"
import { HStack, Text, VStack } from "./views.js"

const childrenOf = (args: readonly unknown[]) => args.flatMap(value => Array.isArray(value) ? value : [value])
const noFunctions = (args: readonly unknown[]) => args.every(value => typeof value !== "function")

export const Box = defineBuiltinView<{ children: unknown[] }>(
  "Box",
  [initializer("Box(...children)", noFunctions, args => ({ children: childrenOf(args) }))],
  ({ children }) => viewElement("div", { "data-muse": "Box" }, children as any),
)

export const ScrollView = CoreScrollView

export const Rectangle = defineBuiltinView("Rectangle", [initializer("Rectangle()", args => args.length === 0)], () => viewElement("div", { "data-muse": "Rectangle" }))
export const RoundedRectangle = defineBuiltinView<{ radius?: number | string }>("RoundedRectangle", [initializer("RoundedRectangle(radius?)", args => args.length <= 1 && typeof args[0] !== "function", args => ({ radius: args[0] as number | string | undefined }), [initializerKinds.value(false, "radius")])], ({ radius = 8 }) => viewElement("div", { "data-muse": "RoundedRectangle", style: { borderRadius: typeof radius === "number" ? `${radius}px` : radius } }))
export const Circle = defineBuiltinView("Circle", [initializer("Circle()", args => args.length === 0)], () => viewElement("div", { "data-muse": "Circle", style: { borderRadius: "50%" } }))
export const Capsule = defineBuiltinView("Capsule", [initializer("Capsule()", args => args.length === 0)], () => viewElement("div", { "data-muse": "Capsule", style: { borderRadius: "9999px" } }))

interface GridOptions { readonly columns?: number | string; readonly rows?: number | string; readonly autoFlow?: string }

export const Grid = defineBuiltinView<{ options?: GridOptions; children: unknown[] }>(
  "Grid",
  [
    initializer("Grid(options, ...children)", args => args.length >= 1 && typeof args[0] === "object" && args.slice(1).every(value => typeof value !== "function"), args => ({ options: args[0] as GridOptions, children: childrenOf(args.slice(1)) }), [initializerKinds.value(true, "options", ["columns", "rows", "autoFlow"])]),
    initializer("Grid(...children)", noFunctions, args => ({ children: childrenOf(args) })),
  ],
  ({ options = {}, children }) => viewElement("div", { "data-muse": "Grid", style: { display: "grid", gridTemplateColumns: options.columns === undefined ? undefined : typeof options.columns === "number" ? `repeat(${options.columns}, minmax(0, 1fr))` : options.columns, gridTemplateRows: options.rows === undefined ? undefined : typeof options.rows === "number" ? `repeat(${options.rows}, minmax(0, 1fr))` : options.rows, gridAutoFlow: options.autoFlow } }, children as any),
)

interface TextAreaProps { readonly value: BindingRef<string>; readonly placeholder?: string }
export const TextArea = defineBuiltinView<TextAreaProps>("TextArea", [initializer("TextArea(value, placeholder?)", args => args.length >= 1 && args.length <= 2 && isBinding(args[0]), args => ({ value: args[0], placeholder: args[1] }), [initializerKinds.binding(true, "value"), initializerKinds.value(false, "placeholder", undefined, "string")])], ({ value, placeholder }) => viewElement("textarea", { "data-muse": "TextArea", value: value.value, placeholder, onInput(event: { target?: { value?: string } }) { value.value = String(event.target?.value ?? "") } }))

export interface PickerOption<T extends string | number> { readonly label: string; readonly value: T; readonly disabled?: boolean }
export const Picker = defineBuiltinView<{ value: BindingRef<string | number>; options: readonly PickerOption<string | number>[] }>("Picker", [initializer("Picker(value, options)", args => args.length === 2 && isBinding(args[0]) && Array.isArray(args[1]), args => ({ value: args[0], options: args[1] as readonly PickerOption<string | number>[] }), [initializerKinds.binding(true, "value"), initializerKinds.value(true, "options", undefined, "array")])], ({ value, options }) => viewElement("select", { "data-muse": "Picker", value: value.value, onChange(event: { target?: { value?: string } }) { const next = event.target?.value; const option = options.find(item => String(item.value) === next); if (option) value.value = option.value } }, options.map(option => viewElement("option", { value: option.value, disabled: option.disabled }, [option.label])) as any))

export const ProgressView = defineBuiltinView<{ value?: number; label?: string }>("ProgressView", [initializer("ProgressView(value?, options?)", args => args.length <= 2 && (args.length === 0 || typeof args[0] === "number" || isBinding(args[0])), args => ({ value: args[0] === undefined ? undefined : Number(resolveValue(args[0] as Value<number>)), ...(typeof args[1] === "object" && args[1] !== null ? args[1] : {}) }), [initializerKinds.value(false, "value"), initializerKinds.value(false, "options")])], ({ value, label }) => viewElement("div", { "data-muse": "ProgressView" }, [viewElement("progress", { max: 1, ...(value === undefined ? {} : { value }) }), ...(label === undefined ? [] : [Text(label)])]))

export const Label = defineBuiltinView<{ title: string; icon: unknown }>("Label", [initializer("Label(title, icon)", args => args.length === 2 && typeof args[0] === "string", args => ({ title: args[0], icon: args[1] }), [initializerKinds.value(true, "title", undefined, "string"), initializerKinds.value(true, "icon")])], ({ title, icon }) => HStack(icon as any, Text(title)))

export const Stepper = defineBuiltinView<{ value: BindingRef<number>; step?: number }>("Stepper", [initializer("Stepper(value, step?)", args => args.length >= 1 && args.length <= 2 && isBinding(args[0]), args => ({ value: args[0], step: args[1] }), [initializerKinds.binding(true, "value"), initializerKinds.value(false, "step", undefined, "number")])], ({ value, step = 1 }) => HStack(Text(String(value.value)), viewElement("button", { type: "button", onClick() { value.value += step } }, ["+"])).withProps({ "data-muse": "Stepper" }))

export const LazyGrid = Grid

export function Key<T>(key: string | number, child: T): T {
  return typeof (child as { keyed?: unknown }).keyed === "function"
    ? (child as { keyed(value: string | number): T }).keyed(key)
    : child
}

export function ElementRef<T>(reference: unknown, child: T): T {
  return typeof (child as { elementRef?: unknown }).elementRef === "function"
    ? (child as { elementRef(value: unknown): T }).elementRef(reference)
    : child
}
