import { keyedViewIdentity, viewTypeIdentity, type ViewIdentity } from "../identity.js"
import { arrayCheck, snapshotArrayValues } from "./arrays.js"
import { isForeignComponent, isViewNode } from "./nodes.js"
import { zeroGeometry } from "./environment.js"
import type { CompiledTemplateValue, GeometryProxy, LazyViewRange, VuneRenderer, ViewGraphValue, ViewHostNode } from "./types.js"

export type { VuneRenderer }

type MutableViewIdentity = Array<string | number>

function pushIdentity(identity: MutableViewIdentity, first: string | number, second?: string | number): number {
  const length = identity.length
  identity.push(first)
  if (second !== undefined) identity.push(second)
  return length
}

function pushIdentitySegments(identity: MutableViewIdentity, segments: readonly (string | number)[]): number {
  const length = identity.length
  for (const segment of segments) identity.push(segment)
  return length
}

function identityWithSegments(identity: readonly (string | number)[], segments: readonly (string | number)[]): ViewIdentity {
  const next = new Array<string | number>(identity.length + segments.length)
  for (let index = 0; index < identity.length; index += 1) next[index] = identity[index]
  for (let index = 0; index < segments.length; index += 1) next[identity.length + index] = segments[index]
  return next
}

function appendLogicalViewIdentities(
  value: ViewGraphValue,
  identity: MutableViewIdentity,
  output: ViewIdentity[],
): void {
  if (arrayCheck(value) === true) {
    const values = snapshotArrayValues(value as readonly unknown[])
    for (let index = 0; index < values.length; index += 1) {
      const length = pushIdentity(identity, "array", index)
      appendLogicalViewIdentities(values[index] as ViewGraphValue, identity, output)
      identity.length = length
    }
    return
  }
  if (!isViewNode(value)) return
  switch (value.kind) {
    case "element": {
      const foreign = isForeignComponent(value.type) ? value.type : undefined
      const elementIdentity = foreign && foreign.key !== undefined
        ? [...keyedViewIdentity(identity, foreign.key)]
        : identity
      for (let index = 0; index < value.children.length; index += 1) {
        const length = pushIdentity(elementIdentity, "element", index)
        appendLogicalViewIdentities(value.children[index] as ViewGraphValue, elementIdentity, output)
        elementIdentity.length = length
      }
      return
    }
    case "fragment":
      for (let index = 0; index < value.children.length; index += 1) {
        const length = pushIdentity(identity, "fragment", index)
        appendLogicalViewIdentities(value.children[index] as ViewGraphValue, identity, output)
        identity.length = length
      }
      return
    case "template":
      for (let index = 0; index < value.slots.length; index += 1) {
        const segments = value.template.slotIdentities[index] ?? ["template-slot", index]
        const length = pushIdentitySegments(identity, segments)
        appendLogicalViewIdentities(value.slots[index], identity, output)
        identity.length = length
      }
      return
    case "modified": {
      let contentIdentity: MutableViewIdentity = identity
      for (const item of value.modifiers) {
        if (item.name === "keyed") contentIdentity = [...keyedViewIdentity(contentIdentity, item.arguments[0] as string | number)]
      }
      appendLogicalViewIdentities(value.content, contentIdentity, output)
      return
    }
    case "view": {
      const typeIdentity = viewTypeIdentity(value.host, value.name)
      const length = identity.length
      identity.push("view-type", typeIdentity, "view", value.name)
      output.push(identity.slice())
      identity.length = length
      return
    }
    case "geometry":
      return
    case "lazy":
      for (let index = 0; index < value.children.length; index += 1) {
        const length = pushIdentity(identity, "lazy", index)
        appendLogicalViewIdentities(value.children[index] as ViewGraphValue, identity, output)
        identity.length = length
      }
      return
  }
}

/** Collect View host identities already present in a graph without evaluating View bodies. */
export function collectLogicalViewIdentities(value: ViewGraphValue, identity: ViewIdentity = ["root"]): ViewIdentity[] {
  const output: ViewIdentity[] = []
  appendLogicalViewIdentities(value, [...identity], output)
  return output
}

export function renderViewNode<Output>(value: ViewGraphValue, renderer: VuneRenderer<Output>): Output {
  return renderViewNodeWithIdentity(value, renderer, ["root"])
}

function renderCompiledTemplateValue<Output>(
  value: CompiledTemplateValue,
  renderer: VuneRenderer<Output>,
  renderSlot: (index: number) => Output,
): Output {
  if (value !== null && typeof value === "object") {
    if (value.kind === "slot") return renderSlot(value.index)
    if (value.kind === "fragment") {
      const children = new Array<Output>(value.children.length)
      for (let index = 0; index < value.children.length; index += 1) {
        children[index] = renderCompiledTemplateValue(value.children[index], renderer, renderSlot)
      }
      return renderer.fragment(children)
    }
    if (value.kind === "element") {
      const children = new Array<Output>(value.children.length)
      for (let index = 0; index < value.children.length; index += 1) {
        children[index] = renderCompiledTemplateValue(value.children[index], renderer, renderSlot)
      }
      return renderer.element(value.type, value.props, ...children)
    }
  }
  if (value === null || value === undefined || typeof value === "boolean") return renderer.value ? renderer.value(null) : null as Output
  return renderer.value ? renderer.value(value) : value as Output
}

function renderPrimitiveValue<Output>(value: ViewGraphValue, renderer: VuneRenderer<Output>): Output {
  if (value === null || value === undefined || typeof value === "boolean") {
    return renderer.value ? renderer.value(null) : null as Output
  }
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    throw new TypeError("Vune View graph leaves must be renderable primitives or View nodes; wrap renderer-specific values in an explicit adapter.")
  }
  return renderer.value ? renderer.value(value) : value as Output
}

function renderViewNodeWithIdentity<Output>(
  value: ViewGraphValue,
  renderer: VuneRenderer<Output>,
  identity: MutableViewIdentity,
): Output {
  if (arrayCheck(value) === true) {
    const values = snapshotArrayValues(value as readonly unknown[])
    const children = new Array<Output>(values.length)
    for (let index = 0; index < values.length; index += 1) {
      const item = values[index] as ViewGraphValue
      if (arrayCheck(item) !== true && !isViewNode(item)) {
        children[index] = renderPrimitiveValue(item, renderer)
        continue
      }
      const length = pushIdentity(identity, "array", index)
      children[index] = renderViewNodeWithIdentity(item, renderer, identity)
      identity.length = length
    }
    return renderer.fragment(children)
  }
  if (!isViewNode(value)) return renderPrimitiveValue(value, renderer)
  switch (value.kind) {
    case "element": {
      const foreign = isForeignComponent(value.type) ? value.type : undefined
      const elementIdentity = foreign && foreign.key !== undefined
        ? [...keyedViewIdentity(identity, foreign.key)]
        : identity
      const children = new Array<Output>(value.children.length)
      for (let index = 0; index < value.children.length; index += 1) {
        const child = value.children[index] as ViewGraphValue
        if (arrayCheck(child) !== true && !isViewNode(child)) {
          children[index] = renderPrimitiveValue(child, renderer)
          continue
        }
        const length = pushIdentity(elementIdentity, "element", index)
        children[index] = renderViewNodeWithIdentity(child, renderer, elementIdentity)
        elementIdentity.length = length
      }
      return renderer.element(value.type, value.props, ...children)
    }
    case "fragment": {
      const children = new Array<Output>(value.children.length)
      for (let index = 0; index < value.children.length; index += 1) {
        const child = value.children[index] as ViewGraphValue
        if (arrayCheck(child) !== true && !isViewNode(child)) {
          children[index] = renderPrimitiveValue(child, renderer)
          continue
        }
        const length = pushIdentity(identity, "fragment", index)
        children[index] = renderViewNodeWithIdentity(child, renderer, identity)
        identity.length = length
      }
      return renderer.fragment(children)
    }
    case "template": {
      const templateIdentity = identity.slice()
      const renderSlot = (index: number): Output => renderViewNodeAt(
        value.slots[index] ?? null,
        renderer,
        identityWithSegments(templateIdentity, value.template.slotIdentities[index] ?? ["template-slot", index]),
      )
      return renderer.template
        ? renderer.template(value, renderSlot, templateIdentity)
        : renderCompiledTemplateValue(value.template.root, renderer, renderSlot)
    }
    case "modified": {
      let contentIdentity: MutableViewIdentity = identity
      for (const item of value.modifiers) {
        if (item.name === "keyed") contentIdentity = [...keyedViewIdentity(contentIdentity, item.arguments[0] as string | number)]
      }
      let rendered = renderViewNodeWithIdentity(value.content, renderer, contentIdentity)
      for (const item of value.modifiers) rendered = renderer.modifier(rendered, item)
      return rendered
    }
    case "view": {
      const typeIdentity = viewTypeIdentity(value.host, value.name)
      const viewIdentity = identityWithSegments(identity, ["view-type", typeIdentity, "view", value.name])
      const renderWithProps = (props: Record<string, unknown> = value.props): Output => renderViewNodeAt(
        value.render(props),
        renderer,
        identityWithSegments(viewIdentity, ["body"]),
      )
      if (renderer.view) return renderer.view(value, renderWithProps, viewIdentity)
      const state = value.state?.(value.props) ?? {}
      return renderWithProps({ ...value.props, ...state })
    }
    case "geometry": {
      const geometryIdentity = identityWithSegments(identity, ["geometry"])
      return renderer.geometry
        ? renderer.geometry(value, geometry => renderViewNodeAt(value.content(geometry), renderer, geometryIdentity))
        : renderViewNodeAt(value.content(zeroGeometry), renderer, geometryIdentity)
    }
    case "lazy": {
      const lazyIdentity = identity.slice()
      const renderChildren = (range?: LazyViewRange): Output => {
        const start = Math.max(0, range?.start ?? 0)
        const end = Math.min(value.children.length, range?.end ?? value.children.length)
        const children = new Array<Output>(Math.max(0, end - start))
        for (let index = start; index < end; index += 1) {
          children[index - start] = renderViewNodeAt(
            value.children[index] as ViewGraphValue,
            renderer,
            identityWithSegments(lazyIdentity, ["lazy", index]),
          )
        }
        return renderer.fragment(children)
      }
      const renderItem = (index: number): Output => {
        if (!Number.isSafeInteger(index) || index < 0 || index >= value.children.length) return renderer.fragment([])
        return renderViewNodeAt(
          value.children[index] as ViewGraphValue,
          renderer,
          identityWithSegments(lazyIdentity, ["lazy", index]),
        )
      }
      if (renderer.lazy) return renderer.lazy(value, renderChildren, lazyIdentity, renderItem)
      const children = new Array<Output>(value.children.length)
      for (let index = 0; index < value.children.length; index += 1) {
        const length = pushIdentity(identity, "lazy", index)
        children[index] = renderViewNodeWithIdentity(value.children[index] as ViewGraphValue, renderer, identity)
        identity.length = length
      }
      return renderer.element("div", value.props, ...children)
    }
  }
}

export function renderViewNodeAt<Output>(value: ViewGraphValue, renderer: VuneRenderer<Output>, identity: ViewIdentity): Output {
  return renderViewNodeWithIdentity(value, renderer, [...identity])
}
