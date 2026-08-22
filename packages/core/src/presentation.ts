import {
  defineView,
  initializer,
  initializerKinds,
  resolveBuilderClosure,
  type ModifiableViewNode,
  type TypedViewConstructor,
  type ViewBuilderClosure,
  type ViewValue,
  viewElement,
  viewFragment,
} from "./graph.js"
import { isBinding, type BindingRef } from "./state.js"
import { Text } from "./views.js"

export interface NavigationStackProps { readonly content: ViewValue[] }
interface NavigationStackCall { (content: ViewBuilderClosure): ModifiableViewNode }
export const NavigationStack = defineView<NavigationStackProps>("NavigationStack", {
  initializers: [initializer("NavigationStack(@ViewBuilder content)", args => args.length === 1 && typeof args[0] === "function", args => ({ content: resolveBuilderClosure(args[0] as () => ViewValue) }), [initializerKinds.viewBuilder(true, "content")])],
  body: ({ content }) => viewElement("main", { "data-muse": "NavigationStack" }, content),
}) as TypedViewConstructor<NavigationStackProps, NavigationStackCall>

export interface NavigationLinkProps { readonly destination: string; readonly label: ViewValue[] }
interface NavigationLinkCall {
  (destination: string, label: string): ModifiableViewNode
  (destination: string, label: ViewBuilderClosure): ModifiableViewNode
}
export const NavigationLink = defineView<NavigationLinkProps>("NavigationLink", {
  initializers: [
    initializer("NavigationLink(destination, label)", args => args.length === 2 && typeof args[0] === "string" && typeof args[1] === "string", args => ({ destination: args[0] as string, label: [Text(args[1] as string)] }), [initializerKinds.value(true, "destination", undefined, "string"), initializerKinds.value(true, "label", undefined, "string")]),
    initializer("NavigationLink(destination, @ViewBuilder label)", args => args.length === 2 && typeof args[0] === "string" && typeof args[1] === "function", args => ({ destination: args[0] as string, label: resolveBuilderClosure(args[1] as () => ViewValue) }), [initializerKinds.value(true, "destination", undefined, "string"), initializerKinds.viewBuilder(true, "label")]),
  ],
  body: ({ destination, label }) => viewElement("a", { href: destination, "data-muse": "NavigationLink" }, label),
}) as TypedViewConstructor<NavigationLinkProps, NavigationLinkCall>

export interface SheetProps { readonly isPresented: BindingRef<boolean>; readonly content: ViewValue[] }
interface SheetCall { (isPresented: BindingRef<boolean>, content: ViewBuilderClosure): ModifiableViewNode }
export const Sheet = defineView<SheetProps>("Sheet", {
  initializers: [initializer("Sheet(isPresented, @ViewBuilder content)", args => args.length === 2 && isBinding(args[0]) && typeof args[1] === "function", args => ({ isPresented: args[0] as BindingRef<boolean>, content: resolveBuilderClosure(args[1] as () => ViewValue) }), [initializerKinds.binding(true, "isPresented", "boolean"), initializerKinds.viewBuilder(true, "content")])],
  body: ({ isPresented, content }) => isPresented.value
    ? viewElement("div", { role: "dialog", "data-muse": "Sheet" }, content)
    : viewFragment([]),
}) as TypedViewConstructor<SheetProps, SheetCall>

export interface AlertProps { readonly isPresented: BindingRef<boolean>; readonly title: string; readonly message?: string }
interface AlertCall { (isPresented: BindingRef<boolean>, title: string, message?: string): ModifiableViewNode }
export const Alert = defineView<AlertProps>("Alert", {
  initializers: [initializer("Alert(isPresented, title, message?)", args => args.length >= 2 && args.length <= 3 && isBinding(args[0]) && typeof args[1] === "string" && (args[2] === undefined || typeof args[2] === "string"), args => ({ isPresented: args[0] as BindingRef<boolean>, title: args[1] as string, message: args[2] as string | undefined }), [initializerKinds.binding(true, "isPresented", "boolean"), initializerKinds.value(true, "title", undefined, "string"), initializerKinds.value(false, "message", undefined, "string")])],
  body: ({ isPresented, title, message }) => isPresented.value
    ? viewElement("div", { role: "alertdialog", "data-muse": "Alert" }, [Text(title), ...(message === undefined ? [] : [Text(message)])])
    : viewFragment([]),
}) as TypedViewConstructor<AlertProps, AlertCall>

export interface MenuProps { readonly label: string; readonly content: ViewValue[] }
interface MenuCall { (label: string, content: ViewBuilderClosure): ModifiableViewNode }
export const Menu = defineView<MenuProps>("Menu", {
  initializers: [initializer("Menu(label, @ViewBuilder content)", args => args.length === 2 && typeof args[0] === "string" && typeof args[1] === "function", args => ({ label: args[0] as string, content: resolveBuilderClosure(args[1] as () => ViewValue) }), [initializerKinds.value(true, "label", undefined, "string"), initializerKinds.viewBuilder(true, "content")])],
  body: ({ label, content }) => viewElement("details", { "data-muse": "Menu" }, [Text(label), viewElement("div", { role: "menu" }, content)]),
}) as TypedViewConstructor<MenuProps, MenuCall>
