import { vuneForeignComponent } from "./symbols.js"
import { decorate, modifiedContent } from "./modifiers.js"
import type {
  ForeignComponentDescriptor,
  ForeignComponentOptions,
  GeometryProxy,
  LazyViewNode,
  ModifiableViewNode,
  ViewGraphChild,
  ViewGraphValue,
  ViewHostNode,
  ViewModifierNode,
  ViewNode,
} from "./types.js"

export function viewElement(type: unknown, props: Record<string, unknown> | null = null, children: readonly ViewGraphChild[] = []): ModifiableViewNode {
  return decorate({ kind: "element" as const, type, props, children: [...children] }, true)
}

/** Construct a renderer-neutral foreign component boundary. */
export function ForeignComponent(
  component: unknown,
  options: ForeignComponentOptions = {},
  ...children: ViewGraphChild[]
): ModifiableViewNode {
  const descriptor: ForeignComponentDescriptor = Object.freeze({
    [vuneForeignComponent]: true,
    component,
    props: Object.freeze({ ...(options.props ?? {}) }),
    events: Object.freeze({ ...(options.events ?? {}) }),
    slots: Object.freeze({ ...(options.slots ?? {}) }),
    ...(options.ref === undefined ? {} : { ref: options.ref }),
    ...(options.key === undefined ? {} : { key: options.key }),
    ...(options.adapter === undefined ? {} : { adapter: options.adapter }),
    ...(options.schema === undefined ? {} : { schema: Object.freeze({ ...options.schema }) }),
    name: options.name ?? (typeof component === "function" && component.name ? component.name : "ForeignComponent"),
  })
  return viewElement(descriptor, {
    ...descriptor.props,
    ...descriptor.events,
    ...(descriptor.ref === undefined ? {} : { ref: descriptor.ref }),
  }, children)
}

export function isForeignComponent(value: unknown): value is ForeignComponentDescriptor {
  return typeof value === "object" && value !== null && (value as Partial<ForeignComponentDescriptor>)[vuneForeignComponent] === true
}

export function viewFragment(children: readonly ViewGraphChild[] = []): ModifiableViewNode {
  return decorate({ kind: "fragment" as const, children: [...children] }, true)
}

export function viewHost(
  name: string,
  host: unknown,
  props: Record<string, unknown>,
  render: (props: Record<string, unknown>) => ViewGraphValue,
  state?: (props: Record<string, unknown>) => Record<string, unknown>,
): ModifiableViewNode {
  return decorate({ kind: "view" as const, name, host, props, render, state }, true)
}

/** Create a renderer-neutral geometry observation boundary. */
export function geometryView(content: (geometry: GeometryProxy) => ViewGraphValue): ModifiableViewNode {
  return decorate({ kind: "geometry" as const, content }, true)
}

/** Create a lazy graph boundary. Renderers may window its children by range. */
export function lazyView(
  name: string,
  axis: LazyViewNode["axis"],
  props: Record<string, unknown>,
  children: readonly ViewGraphChild[] = [],
): ModifiableViewNode {
  return decorate({ kind: "lazy" as const, name, axis, props, children: [...children] }, true)
}

export function isViewNode(value: unknown): value is ViewNode {
  if (typeof value !== "object" || value === null) return false
  const kind = (value as { kind?: unknown }).kind
  return kind === "element" || kind === "fragment" || kind === "view" || kind === "geometry" || kind === "lazy" || kind === "modified"
}
