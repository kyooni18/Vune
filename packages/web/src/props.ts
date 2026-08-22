import { classNameOf } from "@muse/core"
import { cssPropertyName, type DomRenderContext } from "./shared.js"

function domStyle(element: HTMLElement, value: unknown): void {
  if (typeof value !== "object" || value === null) {
    if (typeof value === "string") element.setAttribute("style", value)
    return
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === undefined || item === null) continue
    element.style.setProperty(cssPropertyName(key), String(item))
  }
}

export function setDomRef(reference: unknown, element: Element, context: DomRenderContext): void {
  if (typeof reference === "function") {
    reference(element)
    context.refs.push(() => reference(null))
  } else if (reference && typeof reference === "object" && "current" in reference) {
    const target = reference as { current: unknown }
    target.current = element
    context.refs.push(() => { target.current = null })
  }
}

function eventName(key: string): string {
  return key.slice(2).toLowerCase()
}

export function setDomEvent(element: HTMLElement, key: string, value: unknown, context: DomRenderContext, attach = true): void {
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

export function rememberDomProps(element: Element, props: Record<string, unknown> | null | undefined, context: DomRenderContext): void {
  const previous = context.domProps.get(element) ?? {}
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
  context.domKeys.set(element, typeof props?.key === "string" || typeof props?.key === "number" ? props.key : context.domKeys.get(element))
}

export function applyDomProps(element: HTMLElement, props: Record<string, unknown> | null | undefined, context: DomRenderContext): void {
  if (context.hydrating) context.hydrationProps.set(element, props)
  rememberDomProps(element, props, context)
  for (const [key, value] of Object.entries(props ?? {})) {
    if (key === "children" || key === "key" || value === undefined || value === null || value === false) continue
    if (key === "style") { domStyle(element, value); continue }
    if (key === "className" || key === "class") { element.className = [element.className, classNameOf(value)].filter(Boolean).join(" "); continue }
    if (key === "ref") {
      if (!context.hydrating) setDomRef(value, element, context)
      continue
    }
    if (typeof value === "function" && /^on[A-Za-z]/.test(key)) {
      setDomEvent(element, key, value, context, !context.hydrating)
      continue
    }
    const name = key === "htmlFor" ? "for" : key
    if (value === true) { element.setAttribute(name, ""); continue }
    if (name === "value" || name === "checked" || name === "selected" || name === "disabled") {
      try { (element as unknown as Record<string, unknown>)[name] = value } catch { /* attribute remains authoritative */ }
    }
    element.setAttribute(name, String(value))
  }
  rememberDomProps(element, props, context)
}

function removeDomProp(element: HTMLElement, key: string): void {
  if (key === "style") {
    element.removeAttribute("style")
    return
  }
  if (key === "class" || key === "className") {
    element.removeAttribute("class")
    return
  }
  if (key === "value" || key === "checked" || key === "selected" || key === "disabled") {
    try { (element as unknown as Record<string, unknown>)[key] = key === "value" ? "" : false } catch { /* attribute remains authoritative */ }
  }
  if (key !== "children" && key !== "key" && key !== "ref" && !/^on[A-Za-z]/.test(key)) {
    element.removeAttribute(key === "htmlFor" ? "for" : key)
  }
}

export function patchDomProps(element: HTMLElement, next: Record<string, unknown> | null | undefined, context: DomRenderContext): void {
  const previous = context.domProps.get(element) ?? {}
  for (const [key, value] of Object.entries(previous)) {
    if (key === "ref" || key === "key" || key === "children") continue
    if (next && Object.prototype.hasOwnProperty.call(next, key)) continue
    if (/^on[A-Za-z]/.test(key)) setDomEvent(element, key, undefined, context, false)
    else removeDomProp(element, key)
  }
  if (next?.style && typeof next.style === "object") element.removeAttribute("style")
  for (const [key, value] of Object.entries(next ?? {})) {
    if (key === "children" || key === "key" || value === undefined || value === null || value === false) {
      if (value === false && previous[key] !== undefined && key !== "children" && key !== "key") removeDomProp(element, key)
      continue
    }
    if (key === "style") { domStyle(element, value); continue }
    if (key === "className" || key === "class") { element.className = classNameOf(value); continue }
    if (key === "ref") { setDomRef(value, element, context); continue }
    if (typeof value === "function" && /^on[A-Za-z]/.test(key)) { setDomEvent(element, key, value, context); continue }
    const name = key === "htmlFor" ? "for" : key
    if (value === true) { element.setAttribute(name, ""); continue }
    if (name === "value" || name === "checked" || name === "selected" || name === "disabled") {
      try { (element as unknown as Record<string, unknown>)[name] = value } catch { /* attribute remains authoritative */ }
    }
    element.setAttribute(name, String(value))
  }
  rememberDomProps(element, next, context)
}
