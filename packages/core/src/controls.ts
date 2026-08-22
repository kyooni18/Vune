import {
  defineBuiltinView,
  initializer,
  initializerKinds,
  type ModifiableViewNode,
  type TypedViewConstructor,
  viewElement,
} from "./graph.js"
import { isBinding, resolveValue, type BindingRef, type Value } from "./state.js"
import { Text } from "./views.js"

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export interface ToggleProps { readonly title: string; readonly isOn: BindingRef<boolean> }
interface ToggleCall { (title: string, isOn: BindingRef<boolean>): ModifiableViewNode }

export const Toggle = defineBuiltinView<ToggleProps>(
  "Toggle",
  [initializer(
    "Toggle(title, isOn)",
    args => args.length === 2 && typeof args[0] === "string" && isBinding(args[1]),
    args => ({ title: args[0] as string, isOn: args[1] as BindingRef<boolean> }),
    [initializerKinds.value(true, "title", undefined, "string"), initializerKinds.binding(true, "isOn", "boolean")],
  )],
  ({ title, isOn }) => viewElement("label", { "data-muse": "Toggle" }, [
    viewElement("input", {
      type: "checkbox",
      checked: Boolean(isOn.value),
      onChange(event: { target?: { checked?: boolean } }) { isOn.value = Boolean(event.target ? event.target.checked : undefined) },
    }),
    Text(title),
  ]),
) as TypedViewConstructor<ToggleProps, ToggleCall>

export interface TextFieldProps { readonly value: BindingRef<string>; readonly placeholder?: string }
interface TextFieldCall { (value: BindingRef<string>, placeholder?: string): ModifiableViewNode }

export const TextField = defineBuiltinView<TextFieldProps>(
  "TextField",
  [initializer(
    "TextField(value, placeholder?)",
    args => args.length >= 1 && args.length <= 2 && isBinding(args[0]) && (args[1] === undefined || typeof args[1] === "string"),
    args => ({ value: args[0] as BindingRef<string>, placeholder: args[1] as string | undefined }),
    [initializerKinds.binding(true, "value", "string"), initializerKinds.value(false, "placeholder", undefined, "string")],
  )],
  ({ value, placeholder }) => viewElement("input", {
    "data-muse": "TextField",
    type: "text",
    value: value.value,
    placeholder,
    onInput(event: { target?: { value?: string } }) { value.value = String(event.target && event.target.value !== undefined ? event.target.value : "") },
  }),
) as TypedViewConstructor<TextFieldProps, TextFieldCall>

export interface SliderOptions { readonly min?: number; readonly max?: number; readonly step?: number }
export interface SliderProps extends SliderOptions { readonly value: BindingRef<number> }
interface SliderCall { (value: BindingRef<number>, options?: SliderOptions): ModifiableViewNode }

export const Slider = defineBuiltinView<SliderProps>(
  "Slider",
  [initializer(
    "Slider(value, range?)",
    args => args.length >= 1 && args.length <= 2 && isBinding(args[0]) && (args[1] === undefined || isObject(args[1])),
    args => ({ value: args[0] as BindingRef<number>, ...(isObject(args[1]) ? args[1] : {}) }),
    [initializerKinds.binding(true, "value", "number"), initializerKinds.value(false, "range", ["min", "max", "step"], "object")],
  )],
  ({ value, min = 0, max = 1, step }) => viewElement("input", {
    "data-muse": "Slider",
    type: "range",
    value: value.value,
    min,
    max,
    step,
    onInput(event: { target?: { value?: string } }) { value.value = Number(event.target && event.target.value !== undefined ? event.target.value : 0) },
  }),
) as TypedViewConstructor<SliderProps, SliderCall>

export interface ImageOptions { readonly alt?: string }
export interface ImageProps extends ImageOptions { readonly source: string }
interface ImageCall { (source: Value<string>, options?: ImageOptions): ModifiableViewNode }

export const Image = defineBuiltinView<ImageProps>(
  "Image",
  [initializer(
    "Image(source, options?)",
    args => args.length >= 1 && args.length <= 2 && (typeof args[0] === "string" || typeof args[0] === "function") && (args[1] === undefined || isObject(args[1])),
    args => ({ source: String(resolveValue(args[0] as Value<string>)), ...(isObject(args[1]) ? args[1] : {}) }),
    [initializerKinds.value(true, "source", undefined, "Value<string>"), initializerKinds.value(false, "options", ["alt"], "object")],
  )],
  ({ source, alt }) => viewElement("img", { src: source, alt }),
) as TypedViewConstructor<ImageProps, ImageCall>

export interface LinkProps { readonly label: string; readonly href: string }
interface LinkCall { (label: string, href: Value<string>): ModifiableViewNode }

export const Link = defineBuiltinView<LinkProps>(
  "Link",
  [initializer(
    "Link(label, href)",
    args => args.length === 2 && typeof args[0] === "string" && (typeof args[1] === "string" || typeof args[1] === "function"),
    args => ({ label: args[0] as string, href: String(resolveValue(args[1] as Value<string>)) }),
    [initializerKinds.value(true, "label", undefined, "string"), initializerKinds.value(true, "href", undefined, "Value<string>")],
  )],
  ({ label, href }) => viewElement("a", { href }, [Text(label)]),
) as TypedViewConstructor<LinkProps, LinkCall>
