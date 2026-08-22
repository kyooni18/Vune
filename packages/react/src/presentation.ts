import {
  defineBuiltinView,
  initializer,
  initializerKinds,
  isBinding,
  resolveBuilderClosure,
  type BindingRef,
  type ViewValue,
  viewElement,
  viewFragment,
} from "@muse/core"
import { Text } from "./views.js"

interface NavigationStackProps { readonly content: ViewValue[] }

export const NavigationStack = defineBuiltinView<NavigationStackProps>(
  "NavigationStack",
  [initializer("NavigationStack(@ViewBuilder content)", args => args.length === 1 && typeof args[0] === "function", args => ({ content: resolveBuilderClosure(args[0] as () => ViewValue) }), [initializerKinds.viewBuilder(true, "content")])],
  ({ content }) => viewElement("main", { "data-muse": "NavigationStack" }, content),
)

interface NavigationLinkProps { readonly destination: string; readonly label: ViewValue[] }

export const NavigationLink = defineBuiltinView<NavigationLinkProps>(
  "NavigationLink",
  [
    initializer("NavigationLink(destination, label)", args => args.length === 2 && typeof args[0] === "string" && typeof args[1] === "string", args => ({ destination: args[0], label: [Text(args[1] as string)] }), [initializerKinds.value(true, "destination", undefined, "string"), initializerKinds.value(true, "label", undefined, "string")]),
    initializer("NavigationLink(destination, @ViewBuilder label)", args => args.length === 2 && typeof args[0] === "string" && typeof args[1] === "function", args => ({ destination: args[0], label: resolveBuilderClosure(args[1] as () => ViewValue) }), [initializerKinds.value(true, "destination", undefined, "string"), initializerKinds.viewBuilder(true, "label")]),
  ],
  ({ destination, label }) => viewElement("a", { href: destination, "data-muse": "NavigationLink" }, label),
)

interface SheetProps { readonly isPresented: BindingRef<boolean>; readonly content: ViewValue[] }

export const Sheet = defineBuiltinView<SheetProps>(
  "Sheet",
  [initializer("Sheet(isPresented, @ViewBuilder content)", args => args.length === 2 && isBinding(args[0]) && typeof args[1] === "function", args => ({ isPresented: args[0], content: resolveBuilderClosure(args[1] as () => ViewValue) }), [initializerKinds.value(true, "isPresented", undefined, "object"), initializerKinds.viewBuilder(true, "content")])],
  ({ isPresented, content }) => isPresented.value
    ? viewElement("div", { role: "dialog", "data-muse": "Sheet" }, content)
    : viewFragment([]),
)

interface AlertProps { readonly isPresented: BindingRef<boolean>; readonly title: string; readonly message?: string }

export const Alert = defineBuiltinView<AlertProps>(
  "Alert",
  [initializer("Alert(isPresented, title, message?)", args => args.length >= 2 && args.length <= 3 && isBinding(args[0]) && typeof args[1] === "string", args => ({ isPresented: args[0], title: args[1], message: args[2] }), [initializerKinds.value(true, "isPresented", undefined, "object"), initializerKinds.value(true, "title", undefined, "string"), initializerKinds.value(false, "message", undefined, "string")])],
  ({ isPresented, title, message }) => isPresented.value
    ? viewElement("div", { role: "alertdialog", "data-muse": "Alert" }, [Text(title), ...(message === undefined ? [] : [Text(message)])])
    : viewFragment([]),
)

interface MenuProps { readonly label: string; readonly content: ViewValue[] }

export const Menu = defineBuiltinView<MenuProps>(
  "Menu",
  [initializer("Menu(label, @ViewBuilder content)", args => args.length === 2 && typeof args[0] === "string" && typeof args[1] === "function", args => ({ label: args[0], content: resolveBuilderClosure(args[1] as () => ViewValue) }), [initializerKinds.value(true, "label", undefined, "string"), initializerKinds.viewBuilder(true, "content")])],
  ({ label, content }) => viewElement("details", { "data-muse": "Menu" }, [Text(label), viewElement("div", { role: "menu" }, content)]),
)
