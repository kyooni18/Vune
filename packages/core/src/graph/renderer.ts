import { keyedViewIdentity, type ViewIdentity } from "../identity.js"
import { isForeignComponent, isViewNode } from "./nodes.js"
import { zeroGeometry } from "./environment.js"
import type { GeometryProxy, LazyViewRange, MuseRenderer, ViewGraphValue, ViewHostNode } from "./types.js"

export type { MuseRenderer }

export function renderViewNode<Output>(value: ViewGraphValue, renderer: MuseRenderer<Output>): Output {
  return renderViewNodeAt(value, renderer, ["root"])
}

function renderViewNodeAt<Output>(value: ViewGraphValue, renderer: MuseRenderer<Output>, identity: ViewIdentity): Output {
  if (Array.isArray(value)) return renderer.fragment(value.map((item, index) => renderViewNodeAt(item, renderer, [...identity, "array", index])))
  if (!isViewNode(value)) return renderer.value ? renderer.value(value) : value as Output
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
      const definitionName = typeof value.host === "object" && value.host !== null
        ? (value.host as { definition?: { name?: unknown } }).definition?.name
        : undefined
      const typeIdentity = typeof definitionName === "string" && definitionName.length > 0 ? definitionName : value.name
      const viewIdentity: ViewIdentity = [...identity, "view", typeIdentity]
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
