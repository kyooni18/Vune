import {
  Binding,
  defineBuiltinView,
  initializer,
  initializerKinds,
  isBinding,
  resolveValue,
  type BindingRef,
  type Value,
  viewElement,
} from "@muse/core"
import { HStack, Text } from "./views.js"

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

interface ToggleProps { readonly title: string; readonly isOn: BindingRef<boolean> }

export const Toggle = defineBuiltinView<ToggleProps>(
  "Toggle",
  [initializer(
    "Toggle(title, isOn)",
    args => args.length === 2 && typeof args[0] === "string" && isBinding(args[1]),
    args => ({ title: args[0], isOn: args[1] }),
    [initializerKinds.value(true, "title", undefined, "string"), initializerKinds.value(true, "isOn", undefined, "object")],
  )],
  ({ title, isOn }) => viewElement("label", { "data-muse": "Toggle" }, [
    viewElement("input", {
      type: "checkbox",
      checked: Boolean(isOn.value),
      onChange(event: { target?: { checked?: boolean } }) { isOn.value = Boolean(event.target?.checked) },
    }),
    Text(title),
  ]),
)

interface TextFieldProps { readonly value: BindingRef<string>; readonly placeholder?: string }

export const TextField = defineBuiltinView<TextFieldProps>(
  "TextField",
  [initializer(
    "TextField(value, placeholder?)",
    args => args.length >= 1 && args.length <= 2 && isBinding(args[0]),
    args => ({ value: args[0], placeholder: args[1] }),
    [initializerKinds.binding(true, "value"), initializerKinds.value(false, "placeholder", undefined, "string")],
  )],
  ({ value, placeholder }) => viewElement("input", {
    "data-muse": "TextField",
    type: "text",
    value: value.value,
    placeholder,
    onInput(event: { target?: { value?: string } }) { value.value = String(event.target?.value ?? "") },
  }),
)

interface SliderProps { readonly value: BindingRef<number>; readonly min?: number; readonly max?: number; readonly step?: number }

export const Slider = defineBuiltinView<SliderProps>(
  "Slider",
  [initializer(
    "Slider(value, range?)",
    args => args.length >= 1 && args.length <= 2 && isBinding(args[0]),
    args => ({ value: args[0], ...(isObject(args[1]) ? args[1] : {}) }),
    [initializerKinds.binding(true, "value"), initializerKinds.value(false, "range", undefined, "object")],
  )],
  ({ value, min = 0, max = 1, step }) => viewElement("input", {
    "data-muse": "Slider",
    type: "range",
    value: value.value,
    min,
    max,
    step,
    onInput(event: { target?: { value?: string } }) { value.value = Number(event.target?.value ?? 0) },
  }),
)

export const Image = defineBuiltinView<{ source: string; alt?: string }>(
  "Image",
  [initializer("Image(source, options?)", args => args.length >= 1 && args.length <= 2 && (typeof args[0] === "string" || typeof args[0] === "function"), args => ({ source: String(resolveValue(args[0] as Value<string>)), ...(isObject(args[1]) ? args[1] : {}) }), [initializerKinds.value(true, "source"), initializerKinds.value(false, "options")])],
  ({ source, alt }) => viewElement("img", { src: source, alt }),
)

export const Link = defineBuiltinView<{ label: string; href: string }>(
  "Link",
  [initializer("Link(label, href)", args => args.length === 2 && typeof args[0] === "string" && (typeof args[1] === "string" || typeof args[1] === "function"), args => ({ label: String(args[0]), href: String(resolveValue(args[1] as Value<string>)) }), [initializerKinds.value(true, "label"), initializerKinds.value(true, "href")])],
  ({ label, href }) => viewElement("a", { href }, [Text(label)]),
)

export { Binding }
