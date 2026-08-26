import { animationCSSStyle, classNameOf, currentRenderTransaction, frameStyle, layoutLength, swiftUIAnimatableModifierNames, type Animation, type GeometryProxy, type LazyViewNode, type LazyViewRange, type Transaction, type ViewModifierNode } from "@vune-ui/core"
export { classNameOf }

const htmlAttributeAliases: Readonly<Record<string, string>> = Object.freeze({
  allowFullScreen: "allowfullscreen",
  autoFocus: "autofocus",
  autoPlay: "autoplay",
  className: "class",
  contentEditable: "contenteditable",
  formNoValidate: "formnovalidate",
  htmlFor: "for",
  itemScope: "itemscope",
  noModule: "nomodule",
  noValidate: "novalidate",
  playsInline: "playsinline",
  readOnly: "readonly",
  spellCheck: "spellcheck",
  tabIndex: "tabindex",
  xlinkHref: "xlink:href",
  xmlLang: "xml:lang",
  xmlSpace: "xml:space",
})

const booleanHtmlAttributes = new Set([
  "allowfullscreen", "async", "autofocus", "autoplay", "checked", "controls", "default", "defer",
  "disabled", "formnovalidate", "hidden", "inert", "ismap", "itemscope", "loop", "multiple", "muted",
  "nomodule", "novalidate", "open", "playsinline", "readonly", "required", "reversed", "selected",
])

const enumeratedBooleanAttributes = new Set(["contenteditable", "draggable", "spellcheck", "translate"])

// DOM createElement/setAttribute validate names against the XML Name production.
const htmlNamePattern = /^(?:[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]|[\u{10000}-\u{EFFFF}])(?:[:A-Z_a-z\-.0-9\u00B7\u0300-\u036F\u203F-\u2040\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]|[\u{10000}-\u{EFFFF}])*$/u

export function assertHtmlName(value: string, kind: "tag" | "attribute"): string {
  if (!htmlNamePattern.test(value)) throw new TypeError(`Invalid HTML ${kind} name: ${JSON.stringify(value)}`)
  return value
}

export function htmlAttributeName(key: string): string {
  return htmlAttributeAliases[key] ?? key
}

export function isBooleanHtmlAttribute(name: string): boolean {
  return booleanHtmlAttributes.has(name.toLowerCase())
}

export function isEnumeratedBooleanAttribute(name: string): boolean {
  return enumeratedBooleanAttributes.has(name.toLowerCase())
}

export function escape(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

export function styleOf(modifier: ViewModifierNode, includeAnimationFallback = true): Record<string, string> {
  const value = modifier.arguments[0]
  let style: Record<string, string>
  switch (modifier.name) {
    case "padding": style = { padding: layoutLength(value) ?? "" }; break
    case "margin": style = { margin: layoutLength(value) ?? "" }; break
    case "gap": style = { gap: layoutLength(value) ?? "" }; break
    case "font": style = { font: String(value) }; break
    case "fontSize": style = { "font-size": layoutLength(value) ?? "" }; break
    case "bold": style = { "font-weight": value === false ? "normal" : "600" }; break
    case "foreground":
    case "foregroundStyle": style = { color: String(value) }; break
    case "background": style = { background: String(value) }; break
    case "opacity": {
      const opacity = typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1
      style = { opacity: String(opacity) }
      break
    }
    case "scaleEffect": {
      let x = 1
      let y = 1
      if (typeof value === "number" && Number.isFinite(value)) { x = value; y = value }
      else if (value && typeof value === "object") {
        const scale = value as { x?: unknown; y?: unknown; width?: unknown; height?: unknown }
        const rawX = Number(scale.x ?? scale.width ?? 1)
        const rawY = Number(scale.y ?? scale.height ?? rawX)
        x = Number.isFinite(rawX) ? rawX : 1
        y = Number.isFinite(rawY) ? rawY : x
      }
      // Keep transform components on separate CSS channels. This lets scale,
      // rotation and translation run with independent motion plans instead of
      // fighting over one monolithic `transform` string.
      style = { scale: x === y ? `${x}` : `${x} ${y}` }
      break
    }
    case "rotationEffect": {
      const degrees = typeof value === "number" && Number.isFinite(value) ? value : 0
      style = { rotate: `${degrees}deg` }
      break
    }
    case "offset": {
      const second = modifier.arguments[1]
      let x = 0
      let y = 0
      if (typeof value === "number") { x = value; y = typeof second === "number" ? second : 0 }
      else if (value && typeof value === "object") {
        const point = value as { x?: unknown; y?: unknown; width?: unknown; height?: unknown }
        x = Number(point.x ?? point.width ?? 0)
        y = Number(point.y ?? point.height ?? 0)
      }
      style = { translate: `${Number.isFinite(x) ? x : 0}px ${Number.isFinite(y) ? y : 0}px` }
      break
    }
    case "mask": {
      const props = modifier.props && typeof modifier.props === "object" && "style" in modifier.props ? (modifier.props as { style?: unknown }).style : undefined
      style = props && typeof props === "object" ? Object.fromEntries(Object.entries(props as Record<string, unknown>).map(([key, item]) => [cssPropertyName(key), String(item)])) : {}
      break
    }
    case "frame": {
      style = Object.fromEntries(Object.entries(frameStyle(value && typeof value === "object" ? value : {}))
        .map(([key, item]) => [cssPropertyName(key), item ?? ""]))
      break
    }
    case "style": style = typeof value === "object" && value !== null
      ? normalizedStyle(value as Record<string, unknown>)
      : {}; break
    case "animation": {
      const animationStyle = includeAnimationFallback ? animationCSSStyle(value as Animation | null) : undefined
      style = animationStyle ? Object.fromEntries(Object.entries(animationStyle).map(([key, item]) => [cssPropertyName(key), item])) : {}
      break
    }
    default: style = {}
  }
  const transaction = currentRenderTransaction()
  if (includeAnimationFallback && swiftUIAnimatableModifierNames.has(modifier.name) && !transaction.disablesAnimations && transaction.animation) {
    const animationStyle = animationCSSStyle(transaction.animation)
    if (animationStyle) style = { ...style, ...Object.fromEntries(Object.entries(animationStyle).map(([key, item]) => [cssPropertyName(key), item])) }
  }
  return style
}

export function propsOf(modifier: ViewModifierNode): Record<string, unknown> {
  const [value] = modifier.arguments
  switch (modifier.name) {
    case "className": return { class: classNameOf(value) }
    case "withProps": return value && typeof value === "object" ? value as Record<string, unknown> : {}
    default: return {}
  }
}

export function styleText(value: Record<string, string>): string {
  return Object.entries(value).filter(([, item]) => item !== "undefined" && item !== "").map(([key, item]) => `${key}:${item}`).join(";")
}

export function cssPropertyName(value: string): string {
  return value.startsWith("--") ? value : value.replace(/[A-Z]/g, character => `-${character.toLowerCase()}`)
}

function normalizedStyle(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) =>
    item === undefined || item === null ? [] : [[cssPropertyName(key), String(item)]],
  ))
}

export function styleAttribute(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return typeof value === "string" ? value : undefined
  return styleText(normalizedStyle(value as Record<string, unknown>))
}

export function nativeElementProps(props: Record<string, unknown>): Record<string, unknown> {
  try {
    const normalized: Record<string, unknown> = {}
    for (const key of Reflect.ownKeys(props)) {
      if (typeof key !== "string") continue
      const descriptor = Object.getOwnPropertyDescriptor(props, key)
      if (!descriptor || !("value" in descriptor)) continue
      const value = descriptor.value
      const primitive = value === undefined || value === null || typeof value === "string" || typeof value === "boolean"
        || (typeof value === "number" && Number.isFinite(value))
      if (primitive
        || (key === "style" && typeof value === "object" && value !== null)
        || (key === "ref" && (typeof value === "object" || typeof value === "function"))
        || (/^on[A-Za-z]/.test(key) && typeof value === "function")) {
        Object.defineProperty(normalized, key, { ...descriptor, configurable: true })
      }
    }
    return normalized
  } catch {
    return {}
  }
}

export function escapeAttribute(value: unknown): string {
  return escape(value).replaceAll("'", "&#39;")
}

export function normalizedTextAreaValue(value: unknown): string {
  return String(value).replace(/\r\n?/g, "\n")
}

export const rawTextHtmlElements = new Set(["script", "style"])

export function normalizedRawTextValue(tag: string, value: unknown): string {
  const lowerTag = tag.toLowerCase()
  const text = String(value).replace(/\r\n?/g, "\n").replaceAll("\0", "\uFFFD")
  if (new RegExp(`</${lowerTag}`, "i").test(text)) {
    throw new TypeError(`<${lowerTag}> text cannot contain its HTML closing-tag sequence`)
  }
  return text
}

export function domContentContainer(element: Element): Element | DocumentFragment {
  const candidate = element as Element & { readonly content?: DocumentFragment }
  return element.namespaceURI === "http://www.w3.org/1999/xhtml"
    && element.localName.toLowerCase() === "template"
    && candidate.content?.nodeType === 11
    ? candidate.content
    : element
}

export const validTableChildElements = new Set(["caption", "colgroup", "thead", "tbody", "tfoot", "script", "template"])

export const voidHtmlElements = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"])

export interface DomRenderContext {
  readonly document: Document
  readonly states: Map<string, { readonly host: unknown; readonly value: Record<string, unknown> }>
  readonly visitedStateIdentities: Set<string>
  readonly geometries: Map<number, GeometryProxy>
  readonly hydrationProps: WeakMap<Element, Record<string, unknown> | null | undefined>
  readonly domProps: WeakMap<Element, Record<string, unknown>>
  readonly eventListeners: WeakMap<Element, Map<string, EventListener>>
  eventTargetCount: number
  readonly domKeys: WeakMap<Node, string | number | undefined>
  hasDomKeys: boolean
  readonly domTags: WeakMap<Element, string>
  readonly lazyRanges: Map<string, LazyViewRange>
  readonly lazyMeasurements: Map<string, number>
  readonly lazyNodes: Map<string, LazyViewNode>
  readonly preservedLazyStatePrefixes: Map<string, Set<string>>
  readonly visitedLazyIdentities: Set<string>
  readonly lazyKeys: WeakMap<Node, string>
  geometryIndex: number
  hasRefs: boolean
  hydrating: boolean
  stagingEvents: boolean
  stagingProps: boolean
  activeTransaction?: Transaction
}
