import { classNameOf } from "@muse/core"
import { cssPropertyName, htmlAttributeName, isBooleanHtmlAttribute, isEnumeratedBooleanAttribute, type DomRenderContext } from "./shared.js"

const XLINK_NS = "http://www.w3.org/1999/xlink"
const XML_NS = "http://www.w3.org/XML/1998/namespace"

function styleDeclaration(element: Element): CSSStyleDeclaration | undefined {
  return (element as Element & { style?: CSSStyleDeclaration }).style
}

function domStyle(element: Element, value: unknown): void {
  if (typeof value !== "object" || value === null) {
    if (typeof value === "string") element.setAttribute("style", value)
    return
  }
  const style = styleDeclaration(element)
  if (!style) return
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === undefined || item === null) continue
    style.setProperty(cssPropertyName(key), String(item))
  }
}

export function setDomRef(reference: unknown, element: Element): () => void {
  if (typeof reference === "function") {
    reference(element)
    return () => reference(null)
  }
  if (reference && typeof reference === "object" && "current" in reference) {
    const target = reference as { current: unknown }
    target.current = element
    return () => {
      if (target.current === element) target.current = null
    }
  }
  return () => undefined
}

function eventName(key: string): string {
  const raw = key.slice(2).toLowerCase()
  return raw === "doubleclick" ? "dblclick" : raw
}

export function setDomEvent(element: Element, key: string, value: unknown, context: DomRenderContext, attach = true): void {
  const name = eventName(key)
  const listeners = context.eventListeners.get(element) ?? new Map<string, EventListener>()
  const previous = listeners.get(name)
  if (previous) element.removeEventListener(name, previous)
  listeners.delete(name)
  if (attach && typeof value === "function") {
    const listener = value as EventListener
    element.addEventListener(name, listener)
    listeners.set(name, listener)
  }
  context.eventListeners.set(element, listeners)
}

function namespacedAttribute(name: string): { readonly namespace?: string; readonly localName: string; readonly qualifiedName: string } {
  if (name.startsWith("xlink:")) return { namespace: XLINK_NS, localName: name.slice(6), qualifiedName: name }
  if (name.startsWith("xml:")) return { namespace: XML_NS, localName: name.slice(4), qualifiedName: name }
  return { localName: name, qualifiedName: name }
}

function setAttribute(element: Element, name: string, value: string): void {
  const attribute = namespacedAttribute(name)
  if (attribute.namespace) element.setAttributeNS(attribute.namespace, attribute.qualifiedName, value)
  else element.setAttribute(attribute.qualifiedName, value)
}

function removeAttribute(element: Element, name: string): void {
  const attribute = namespacedAttribute(name)
  if (attribute.namespace) element.removeAttributeNS(attribute.namespace, attribute.localName)
  else element.removeAttribute(attribute.qualifiedName)
}

function setDomProperty(element: Element, name: string, value: unknown): void {
  if (name !== "value" && name !== "checked" && name !== "selected" && name !== "disabled" && name !== "multiple" && name !== "muted") return
  try { (element as unknown as Record<string, unknown>)[name] = value } catch { /* attribute remains authoritative */ }
}

function applyAttributeValue(element: Element, key: string, value: unknown): void {
  const name = htmlAttributeName(key)
  if (isBooleanHtmlAttribute(name)) {
    setDomProperty(element, name, Boolean(value))
    if (value) setAttribute(element, name, "")
    else removeAttribute(element, name)
    return
  }
  if (value === false || value === true) {
    if (name.startsWith("aria-") || name.startsWith("data-") || isEnumeratedBooleanAttribute(name)) {
      setAttribute(element, name, String(value))
    } else if (value) {
      setAttribute(element, name, "")
    } else {
      setAttribute(element, name, "false")
    }
    setDomProperty(element, name, value)
    return
  }
  setDomProperty(element, name, value)
  setAttribute(element, name, String(value))
}

export function rememberDomProps(element: Element, props: Record<string, unknown> | null | undefined, context: DomRenderContext, merge = true): void {
  const previous = merge ? context.domProps.get(element) ?? {} : {}
  const currentStyle = previous.style && typeof previous.style === "object" ? previous.style : {}
  const nextStyle = props?.style && typeof props.style === "object" ? props.style : undefined
  const remembered: Record<string, unknown> = {
    ...previous,
    ...(props ?? {}),
    ...(nextStyle ? { style: { ...currentStyle, ...nextStyle } } : {}),
  }
  if (element.getAttribute("class") !== null) {
    remembered.class = element.getAttribute("class") ?? ""
    delete remembered.className
  }
  context.domProps.set(element, remembered)
  const nextKey = typeof props?.key === "string" || typeof props?.key === "number" ? props.key : undefined
  if (nextKey !== undefined) context.domKeys.set(element, nextKey)
}

export function applyDomProps(element: Element, props: Record<string, unknown> | null | undefined, context: DomRenderContext): void {
  if (context.hydrating) context.hydrationProps.set(element, props)
  if (!props || Object.keys(props).length === 0) return
  if (props.ref !== undefined && props.ref !== null) context.hasRefs = true
  for (const [key, value] of Object.entries(props)) {
    if (key === "children" || key === "key" || value === undefined || value === null) continue
    if (key === "style") { domStyle(element, value); continue }
    if (key === "className" || key === "class") {
      const next = [element.getAttribute("class"), classNameOf(value)].filter(Boolean).join(" ")
      if (next) element.setAttribute("class", next)
      continue
    }
    if (key === "ref") continue
    if (typeof value === "function" && /^on[A-Za-z]/.test(key)) {
      setDomEvent(element, key, value, context, !context.hydrating)
      continue
    }
    applyAttributeValue(element, key, value)
  }
  rememberDomProps(element, props, context)
}

function removeDomProp(element: Element, key: string): void {
  if (key === "style") {
    element.removeAttribute("style")
    return
  }
  if (key === "class" || key === "className") {
    element.removeAttribute("class")
    return
  }
  const name = htmlAttributeName(key)
  if (isBooleanHtmlAttribute(name)) setDomProperty(element, name, false)
  else if (name === "value") setDomProperty(element, name, "")
  if (key !== "children" && key !== "key" && key !== "ref" && !/^on[A-Za-z]/.test(key)) removeAttribute(element, name)
}

export function patchDomProps(element: Element, next: Record<string, unknown> | null | undefined, context: DomRenderContext): void {
  const previousStored = context.domProps.get(element)
  if (!previousStored && (!next || Object.keys(next).length === 0)) return
  const previous = previousStored ?? {}
  for (const key of Object.keys(previous)) {
    if (key === "ref" || key === "key" || key === "children") continue
    if (next && Object.prototype.hasOwnProperty.call(next, key)) continue
    if (/^on[A-Za-z]/.test(key)) setDomEvent(element, key, undefined, context, false)
    else removeDomProp(element, key)
  }
  if (next?.style && typeof next.style === "object") element.removeAttribute("style")
  for (const [key, value] of Object.entries(next ?? {})) {
    if (key === "children" || key === "key" || value === undefined || value === null) {
      if ((value === undefined || value === null) && previous[key] !== undefined && key !== "children" && key !== "key") removeDomProp(element, key)
      continue
    }
    if (key === "style") { domStyle(element, value); continue }
    if (key === "className" || key === "class") {
      const className = classNameOf(value)
      if (className) element.setAttribute("class", className)
      else element.removeAttribute("class")
      continue
    }
    if (key === "ref") continue
    if (typeof value === "function" && /^on[A-Za-z]/.test(key)) { setDomEvent(element, key, value, context); continue }
    applyAttributeValue(element, key, value)
  }
  if (!next || Object.keys(next).length === 0) context.domProps.delete(element)
  else rememberDomProps(element, next, context, false)
}
