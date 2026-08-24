import { vuneForeignComponent } from "./symbols.js"
import { arrayCheck, snapshotArrayValues } from "./arrays.js"
import { decorate, modifiedContent, snapshotRecord } from "./modifiers.js"
import type { StateRef } from "../state.js"
import type {
  CompiledTemplateDescriptor,
  CompiledTemplateValue,
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

function mergeSnapshotRecords(...records: readonly Record<string, unknown>[]): Record<string, unknown> {
  const descriptors = new Map<PropertyKey, PropertyDescriptor>()
  for (const record of records) {
    for (const key of Reflect.ownKeys(record)) {
      const descriptor = Object.getOwnPropertyDescriptor(record, key)
      if (descriptor && "value" in descriptor) descriptors.set(key, descriptor)
    }
  }
  const merged: Record<PropertyKey, unknown> = {}
  for (const [key, descriptor] of descriptors) {
    Object.defineProperty(merged, key, { ...descriptor, configurable: true })
  }
  return merged as Record<string, unknown>
}

function snapshotForeignSchema(schema: NonNullable<ForeignComponentOptions["schema"]>): NonNullable<ForeignComponentDescriptor["schema"]> {
  const snapshot = mergeSnapshotRecords(schema as unknown as Record<string, unknown>)
  for (const key of ["props", "events", "slots"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(snapshot, key)
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "object" || descriptor.value === null) continue
    Object.defineProperty(snapshot, key, { ...descriptor, configurable: true, value: snapshotRecord(descriptor.value) })
  }
  return Object.freeze(snapshot)
}

function ownDataValue(value: unknown, key: PropertyKey): unknown {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return undefined
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && "value" in descriptor ? descriptor.value : undefined
  } catch {
    return undefined
  }
}

function snapshotElementProps(type: unknown, props: Record<string, unknown>): Record<string, unknown> {
  const snapshot = snapshotRecord(props, true) as Record<string, unknown>
  if (typeof type !== "string" || type.includes("-")) return snapshot
  try {
    const normalized: Record<string, unknown> = {}
    for (const key of Reflect.ownKeys(snapshot)) {
      if (typeof key !== "string") continue
      const descriptor = Object.getOwnPropertyDescriptor(snapshot, key)
      if (!descriptor || !("value" in descriptor)) continue
      const value = descriptor.value
      const primitive = value === undefined || value === null || typeof value === "string" || typeof value === "boolean"
        || (typeof value === "number" && Number.isFinite(value))
      const supported = primitive
        || (key === "style" && typeof value === "object" && value !== null)
        || (key === "ref" && (typeof value === "object" || typeof value === "function"))
        || (/^on[A-Za-z]/.test(key) && typeof value === "function")
      if (supported) Object.defineProperty(normalized, key, { ...descriptor, configurable: true })
    }
    return Object.freeze(normalized)
  } catch {
    return Object.freeze({})
  }
}

export function viewElement(type: unknown, props: Record<string, unknown> | null = null, children: readonly ViewGraphChild[] = []): ModifiableViewNode {
  const normalizedProps = props === null ? null : snapshotElementProps(type, props)
  return decorate({ kind: "element" as const, type, props: normalizedProps, children: snapshotArrayValues(children) as readonly ViewGraphChild[] }, true)
}

/** Construct a renderer-neutral foreign component boundary. */
export function ForeignComponent(
  component: unknown,
  options: ForeignComponentOptions = {},
  ...children: ViewGraphChild[]
): ModifiableViewNode {
  const normalizedOptions = snapshotRecord(options) as ForeignComponentOptions
  const props = snapshotRecord(normalizedOptions.props ?? {}, true) as Record<string, unknown>
  const events = snapshotRecord(normalizedOptions.events ?? {}) as Record<string, unknown>
  const slots = snapshotRecord(normalizedOptions.slots ?? {}) as NonNullable<ForeignComponentOptions["slots"]>
  const componentName = ownDataValue(component, "name")
  const descriptor: ForeignComponentDescriptor = Object.freeze({
    [vuneForeignComponent]: true,
    component,
    props,
    events,
    slots,
    ...(normalizedOptions.ref === undefined ? {} : { ref: normalizedOptions.ref }),
    ...(normalizedOptions.key === undefined ? {} : { key: normalizedOptions.key }),
    ...(normalizedOptions.adapter === undefined ? {} : { adapter: normalizedOptions.adapter }),
    ...(normalizedOptions.schema === undefined ? {} : { schema: snapshotForeignSchema(normalizedOptions.schema) }),
    name: typeof normalizedOptions.name === "string" && normalizedOptions.name
      ? normalizedOptions.name
      : typeof componentName === "string" && componentName ? componentName : "ForeignComponent",
  })
  return viewElement(descriptor, mergeSnapshotRecords(
    descriptor.props,
    descriptor.events,
    descriptor.ref === undefined ? {} : { ref: descriptor.ref },
  ), children)
}

export function isForeignComponent(value: unknown): value is ForeignComponentDescriptor {
  if (typeof value !== "object" || value === null) return false
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, vuneForeignComponent)
    return !!descriptor && "value" in descriptor && descriptor.value === true
  } catch {
    return false
  }
}


function snapshotCompiledTemplateValue(
  value: CompiledTemplateValue,
  slotCount: number,
  slotIdentities: Array<readonly (string | number)[] | undefined>,
): CompiledTemplateValue {
  if (value === null || value === undefined || typeof value === "string" || typeof value === "boolean" || typeof value === "bigint") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  if (typeof value !== "object") throw new TypeError("Compiled template values must be static primitives, host elements, fragments, or slots")
  if (value.kind === "slot") {
    if (!Number.isSafeInteger(value.index) || value.index < 0 || value.index >= slotCount) throw new RangeError(`Compiled template slot ${String(value.index)} is outside 0..<${slotCount}`)
    if (slotIdentities[value.index] !== undefined) throw new RangeError(`Compiled template slot ${value.index} appears more than once`)
    const identity = Object.freeze([...value.identity])
    slotIdentities[value.index] = identity
    return Object.freeze({ kind: "slot" as const, index: value.index, identity })
  }
  if (value.kind === "fragment") {
    return Object.freeze({ kind: "fragment" as const, children: Object.freeze(value.children.map(child => snapshotCompiledTemplateValue(child, slotCount, slotIdentities))) })
  }
  if (value.kind === "element") {
    if (typeof value.type !== "string" || value.type.length === 0) throw new TypeError("Compiled templates only contain renderer-native host element names")
    return Object.freeze({
      kind: "element" as const,
      type: value.type,
      props: value.props === null ? null : snapshotRecord(value.props, true) as Record<string, unknown>,
      children: Object.freeze(value.children.map(child => snapshotCompiledTemplateValue(child, slotCount, slotIdentities))),
    })
  }
  throw new TypeError("Unknown compiled template instruction")
}

/** Freeze, validate, and index a renderer-neutral AOT template once at module evaluation. */
export function defineCompiledTemplate(root: CompiledTemplateValue, slotCount: number): CompiledTemplateDescriptor {
  if (!Number.isSafeInteger(slotCount) || slotCount < 0) throw new RangeError("Compiled template slotCount must be a non-negative safe integer")
  const slotIdentities: Array<readonly (string | number)[] | undefined> = Array(slotCount).fill(undefined)
  const snapshot = snapshotCompiledTemplateValue(root, slotCount, slotIdentities)
  const missing = slotIdentities.findIndex(identity => identity === undefined)
  if (missing >= 0) throw new RangeError(`Compiled template slot ${missing} is declared but never referenced`)
  return Object.freeze({
    root: snapshot,
    slotCount,
    slotIdentities: Object.freeze(slotIdentities as readonly (readonly (string | number)[])[]),
  })
}

/** Instantiate an immutable compiler template with only the dynamic graph/value slots allocated per evaluation. */
export function compiledTemplate(template: CompiledTemplateDescriptor, slots: readonly ViewGraphValue[] = []): ModifiableViewNode {
  if (slots.length !== template.slotCount) throw new RangeError(`Compiled template expected ${template.slotCount} slots but received ${slots.length}`)
  return decorate({ kind: "template" as const, template, slots: snapshotArrayValues(slots) as readonly ViewGraphValue[] }, true)
}

export function viewFragment(children: readonly ViewGraphChild[] = []): ModifiableViewNode {
  return decorate({ kind: "fragment" as const, children: snapshotArrayValues(children) as readonly ViewGraphChild[] }, true)
}

export function viewHost(
  name: string,
  host: unknown,
  props: Record<string, unknown>,
  render: (props: Record<string, unknown>) => ViewGraphValue,
  state?: (props: Record<string, unknown>) => Record<string, unknown>,
  dependencies?: (props: Record<string, unknown>) => readonly StateRef<unknown>[],
  dependenciesComplete = false,
): ModifiableViewNode {
  const normalizedState = state
    ? (props: Record<string, unknown>): Record<string, unknown> => {
        const value = state(props)
        if (typeof value !== "object" || value === null || arrayCheck(value) !== false) return Object.freeze({})
        try {
          const prototype = Object.getPrototypeOf(value)
          if (prototype !== Object.prototype && prototype !== null) return Object.freeze({})
        } catch {
          return Object.freeze({})
        }
        return snapshotRecord(value) as Record<string, unknown>
      }
    : undefined
  return decorate({
    kind: "view" as const,
    name,
    host,
    props: snapshotRecord(props, true) as Record<string, unknown>,
    render,
    state: normalizedState,
    ...(dependencies ? { dependencies } : {}),
    ...(dependenciesComplete ? { dependenciesComplete: true } : {}),
  }, true)
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
  return decorate({
    kind: "lazy" as const,
    name,
    axis,
    props: snapshotRecord(props, true) as Record<string, unknown>,
    children: snapshotArrayValues(children) as readonly ViewGraphChild[],
  }, true)
}

export function isViewNode(value: unknown): value is ViewNode {
  if (typeof value !== "object" || value === null) return false
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, "kind")
    if (!descriptor || !("value" in descriptor)) return false
    const kind = descriptor.value
    return kind === "element" || kind === "fragment" || kind === "template" || kind === "view" || kind === "geometry" || kind === "lazy" || kind === "modified"
  } catch {
    return false
  }
}
