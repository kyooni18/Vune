import { keyedViewIdentity, viewTypeIdentity, type ViewIdentity } from "../identity.js"
import { arrayCheck, snapshotArrayValues } from "./arrays.js"
import { isForeignComponent, isViewNode, keyedCollectionEntries } from "./nodes.js"
import { zeroGeometry } from "./environment.js"
import type { CompiledTemplateValue, GeometryProxy, LazyViewRange, VuneRenderer, ViewGraphValue, ViewHostNode } from "./types.js"

export type { VuneRenderer }

/** Collect View host identities already present in a graph without evaluating View bodies. */
export function collectLogicalViewIdentities(value: ViewGraphValue, identity: ViewIdentity = ["root"]): ViewIdentity[] {
  if (arrayCheck(value) === true) {
    return snapshotArrayValues(value as readonly unknown[]).flatMap((item, index) => collectLogicalViewIdentities(item as ViewGraphValue, [...identity, "array", index]))
  }
  if (!isViewNode(value)) return []
  switch (value.kind) {
    case "element": {
      const foreign = isForeignComponent(value.type) ? value.type : undefined
      const elementIdentity = foreign && foreign.key !== undefined ? keyedViewIdentity(identity, foreign.key) : identity
      return value.children.flatMap((child, index) => collectLogicalViewIdentities(child as ViewGraphValue, [...elementIdentity, "element", index]))
    }
    case "fragment":
      return value.children.flatMap((child, index) => collectLogicalViewIdentities(child as ViewGraphValue, [...identity, "fragment", index]))
    case "template":
      return value.slots.flatMap((slot, index) => collectLogicalViewIdentities(slot, [...identity, ...(value.template.slotIdentities[index] ?? ["template-slot", index])]))
    case "collection":
      return keyedCollectionEntries(value).flatMap(entry => collectLogicalViewIdentities(
        value.content(entry.item, entry.index, entry.key), [...identity, "fragment", entry.index]))
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
      return value.children.flatMap((child, index) => collectLogicalViewIdentities(child as ViewGraphValue, [...identity, "lazy", index]))
  }
}

export function renderViewNode<Output>(value: ViewGraphValue, renderer: VuneRenderer<Output>): Output {
  return renderViewNodeAt(value, renderer, ["root"])
}

function renderCompiledTemplateValue<Output>(
  value: CompiledTemplateValue,
  renderer: VuneRenderer<Output>,
  renderSlot: (index: number) => Output,
): Output {
  if (value !== null && typeof value === "object") {
    if (value.kind === "slot") return renderSlot(value.index)
    if (value.kind === "fragment") return renderer.fragment(value.children.map(child => renderCompiledTemplateValue(child, renderer, renderSlot)))
    if (value.kind === "element") return renderer.element(value.type, value.props, ...value.children.map(child => renderCompiledTemplateValue(child, renderer, renderSlot)))
  }
  if (value === null || value === undefined || typeof value === "boolean") return renderer.value ? renderer.value(null) : null as Output
  return renderer.value ? renderer.value(value) : value as Output
}

export function renderViewNodeAt<Output>(value: ViewGraphValue, renderer: VuneRenderer<Output>, identity: ViewIdentity): Output {
  if (arrayCheck(value) === true) return renderer.fragment(snapshotArrayValues(value as readonly unknown[]).map((item, index) => renderViewNodeAt(item as ViewGraphValue, renderer, [...identity, "array", index])))
  if (!isViewNode(value)) {
    if (value === null || value === undefined || typeof value === "boolean") {
      return renderer.value ? renderer.value(null) : null as Output
    }
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
      throw new TypeError("Vune View graph leaves must be renderable primitives or View nodes; wrap renderer-specific values in an explicit adapter.")
    }
    return renderer.value ? renderer.value(value) : value as Output
  }
  switch (value.kind) {
    case "element": {
      const foreign = isForeignComponent(value.type) ? value.type : undefined
      const elementIdentity = foreign && foreign.key !== undefined ? keyedViewIdentity(identity, foreign.key) : identity
      return renderer.element(value.type, value.props, ...value.children.map((child, index) => renderViewNodeAt(child as ViewGraphValue, renderer, [...elementIdentity, "element", index])))
    }
    case "fragment":
      return renderer.fragment(value.children.map((child, index) => renderViewNodeAt(child as ViewGraphValue, renderer, [...identity, "fragment", index])))
    case "template": {
      const renderSlot = (index: number): Output => renderViewNodeAt(value.slots[index] ?? null, renderer, [...identity, ...(value.template.slotIdentities[index] ?? ["template-slot", index])])
      return renderer.template
        ? renderer.template(value, renderSlot, identity)
        : renderCompiledTemplateValue(value.template.root, renderer, renderSlot)
    }
    case "collection": {
      const renderEntry = (entry: ReturnType<typeof keyedCollectionEntries>[number]): Output => renderViewNodeAt(
        value.content(entry.item, entry.index, entry.key), renderer, [...identity, "fragment", entry.index])
      return renderer.collection
        ? renderer.collection(value, renderEntry, identity)
        : renderer.fragment(keyedCollectionEntries(value).map(renderEntry))
    }
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
        return renderer.fragment(value.children.slice(start, end).map((child, index) => renderViewNodeAt(child as ViewGraphValue, renderer, [...identity, "lazy", start + index])))
      }
      const renderItem = (index: number): Output => {
        if (!Number.isSafeInteger(index) || index < 0 || index >= value.children.length) return renderer.fragment([])
        const child = value.children[index]
        return renderViewNodeAt(child as ViewGraphValue, renderer, [...identity, "lazy", index])
      }
      return renderer.lazy
        ? renderer.lazy(value, renderChildren, identity, renderItem)
        : renderer.element("div", value.props, ...value.children.map((child, index) => renderViewNodeAt(child as ViewGraphValue, renderer, [...identity, "lazy", index])))
    }
  }
}
