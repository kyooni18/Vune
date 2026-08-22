import { classNameOf, frameStyle, type GeometryProxy, type LazyViewNode, type LazyViewRange, type ViewModifierNode } from "@muse/core"
export { classNameOf }

export function escape(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

export function length(value: unknown): string | undefined {
  return typeof value === "number" ? `${value}px` : typeof value === "string" ? value : undefined
}

export function styleOf(modifier: ViewModifierNode): Record<string, string> {
  const value = modifier.arguments[0]
  switch (modifier.name) {
    case "padding": return { padding: length(value) ?? "0" }
    case "margin": return { margin: length(value) ?? "0" }
    case "gap": return { gap: length(value) ?? "0" }
    case "font": return { font: String(value) }
    case "fontSize": return { "font-size": length(value) ?? "inherit" }
    case "bold": return { "font-weight": "600" }
    case "foreground": return { color: String(value) }
    case "background": return { background: String(value) }
    case "frame": {
      return Object.fromEntries(Object.entries(frameStyle(value && typeof value === "object" ? value : {}))
        .map(([key, item]) => [cssPropertyName(key), item ?? ""]))
    }
    case "style": return typeof value === "object" && value !== null
      ? Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, String(item)]))
      : {}
    default: return {}
  }
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

export function styleAttribute(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return typeof value === "string" ? value : undefined
  return styleText(Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [cssPropertyName(key), String(item)])))
}

export function escapeAttribute(value: unknown): string {
  return escape(value).replaceAll("'", "&#39;")
}

export const voidHtmlElements = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"])

export interface DomRenderContext {
  readonly document: Document
  readonly states: Map<string, { readonly host: unknown; readonly value: Record<string, unknown> }>
  readonly visitedStateIdentities: Set<string>
  readonly refs: Array<() => void>
  readonly geometries: Map<number, GeometryProxy>
  readonly hydrationProps: WeakMap<Element, Record<string, unknown> | null | undefined>
  readonly domProps: WeakMap<Element, Record<string, unknown>>
  readonly eventListeners: WeakMap<Element, Map<string, EventListener>>
  readonly domKeys: WeakMap<Node, string | number | undefined>
  readonly lazyRanges: Map<string, LazyViewRange>
  readonly lazyMeasurements: Map<string, number>
  readonly lazyNodes: Map<string, LazyViewNode>
  readonly visitedLazyIdentities: Set<string>
  readonly lazyKeys: WeakMap<Node, string>
  geometryIndex: number
  hydrating: boolean
}
