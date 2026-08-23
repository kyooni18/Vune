import { keyedViewIdentity, viewTypeIdentity, type ViewIdentity } from "../identity.js"
import { isForeignComponent, isViewNode } from "./nodes.js"
import { zeroGeometry } from "./environment.js"
import type { GeometryProxy, LazyViewRange, VuneRenderer, ViewGraphValue, ViewHostNode } from "./types.js"

export type { VuneRenderer }

/** Collect View host identities already present in a graph without evaluating View bodies. */
export function collectLogicalViewIdentities(value: ViewGraphValue, identity: ViewIdentity = ["root"]): ViewIdentity[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectLogicalViewIdentities(item, [...identity, "array", index]))
  }
  if (!isViewNode(value)) return []
  switch (value.kind) {
    case "element": {
      const foreign = isForeignComponent(value.type) ? value.type : undefined
      const elementIdentity = foreign && foreign.key !== undefined ? keyedViewIdentity(identity, foreign.key) : identity
      return value.children.flatMap((child, index) => collectLogicalViewIdentities(child, [...elementIdentity, "element", index]))
    }
    case "fragment":
      return value.children.flatMap((child, index) => collectLogicalViewIdentities(child, [...identity, "fragment", index]))
    case "modified": {
      let contentIdentity = identity
      for (const item of value.modifiers) {
        if (item.name === "keyed") contentIdentity = keyedViewIdentity(contentIdentity, item.arguments[0] as string | number)
      }
      return collectLogicalViewIdentities(value.content, contentIdentity)
    }
    case "view": {
      const typeIdentity = viewTypeIdentity(value.host, value.name)
      return [[...identity, "view-type", typeIdentity, "view", value.name]]
    }
    case "geometry":
      return []
    case "lazy":
      return value.children.flatMap((child, index) => collectLogicalViewIdentities(child, [...identity, "lazy", index]))
  }
}

export function renderViewNode<Output>(value: ViewGraphValue, renderer: VuneRenderer<Output>): Output {
  return renderViewNodeAt(value, renderer, ["root"])
}

function renderViewNodeAt<Output>(value: ViewGraphValue, renderer: VuneRenderer<Output>, identity: ViewIdentity): Output {
  if (Array.isArray(value)) return renderer.fragment(value.map((item, index) => renderViewNodeAt(item, renderer, [...identity, "array", index])))
  if (!isViewNode(value)) {
    if (value === null || value === undefined || typeof value === "boolean") {
      return renderer.value ? renderer.value(null) : null as Output
    }
    if (typeof value === "object") {
      throw new TypeError("Vune View graph leaves must be renderable primitives or View nodes; wrap renderer-specific values in an explicit adapter.")
    }
    return renderer.value ? renderer.value(value) : value as Output
  }
  switch (value.kind) {
    case "element": {
      const foreign = isForeignComponent(value.type) ? value.type : undefined
      const elementIdentity = foreign && foreign.key !== undefined ? keyedViewIdentity(identity, foreign.key) : identity
      return renderer.element(value.type, value.props, ...value.children.map((child, index) => renderViewNodeAt(child, renderer, [...elementIdentity, "element", index])))
    }
    case "fragment":
      return renderer.fragment(value.children.map((child, index) => renderViewNodeAt(child, renderer, [...identity, "fragment", index])))
    case "modified": {
      let contentIdentity = identity
      for (const item of value.modifiers) {
        if (item.name === "keyed") contentIdentity = keyedViewIdentity(contentIdentity, item.arguments[0] as string | number)
      }
      let rendered = renderViewNodeAt(value.content, renderer, contentIdentity)
      for (const item of value.modifiers) rendered = renderer.modifier(rendered, item)
      return rendered
    }
    case "view": {
      const typeIdentity = viewTypeIdentity(value.host, value.name)
      const viewIdentity: ViewIdentity = [...identity, "view-type", typeIdentity, "view", value.name]
      const renderWithProps = (props: Record<string, unknown> = value.props): Output => renderViewNodeAt(value.render(props), renderer, [...viewIdentity, "body"])
      if (renderer.view) return renderer.view(value, renderWithProps, viewIdentity)
      const state = value.state?.(value.props) ?? {}
      return renderWithProps({ ...value.props, ...state })
    }
    case "geometry":
      return renderer.geometry
        ? renderer.geometry(value, geometry => renderViewNodeAt(value.content(geometry), renderer, [...identity, "geometry"]))
        : renderViewNodeAt(value.content(zeroGeometry), renderer, [...identity, "geometry"])
    case "lazy": {
      const renderChildren = (range?: LazyViewRange): Output => {
        const start = Math.max(0, range?.start ?? 0)
        const end = Math.min(value.children.length, range?.end ?? value.children.length)
        return renderer.fragment(value.children.slice(start, end).map((child, index) => renderViewNodeAt(child, renderer, [...identity, "lazy", start + index])))
      }
      return renderer.lazy
        ? renderer.lazy(value, renderChildren, identity)
        : renderer.element("div", value.props, ...value.children.map((child, index) => renderViewNodeAt(child, renderer, [...identity, "lazy", index])))
    }
  }
}
