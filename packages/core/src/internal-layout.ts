import { layoutLength, type Edge, type LayoutEdgeInsets } from "./layout.js"

const edgeNames = new Set<Edge>(["top", "leading", "bottom", "trailing"])

function normalizedEdges(value: unknown): readonly Edge[] | undefined {
  if (value === "all") return ["top", "leading", "bottom", "trailing"]
  if (value === "horizontal") return ["leading", "trailing"]
  if (value === "vertical") return ["top", "bottom"]
  if (typeof value === "string" && edgeNames.has(value as Edge)) return [value as Edge]
  if (!Array.isArray(value)) return undefined
  const edges = value.filter((edge): edge is Edge => typeof edge === "string" && edgeNames.has(edge as Edge))
  return edges.length === value.length ? edges : undefined
}

function edgeInsetStyle(value: object): Record<string, string> | undefined {
  const own = (key: keyof LayoutEdgeInsets): unknown => {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      return descriptor && "value" in descriptor ? descriptor.value : undefined
    } catch {
      return undefined
    }
  }
  const top = layoutLength(own("top"))
  const leading = layoutLength(own("leading") ?? own("left"))
  const bottom = layoutLength(own("bottom"))
  const trailing = layoutLength(own("trailing") ?? own("right"))
  if (!top && !leading && !bottom && !trailing) return undefined
  return {
    ...(top ? { paddingTop: top } : {}),
    ...(trailing ? { paddingRight: trailing } : {}),
    ...(bottom ? { paddingBottom: bottom } : {}),
    ...(leading ? { paddingLeft: leading } : {}),
  }
}

/** Internal renderer approximation for SwiftUI's uniform, edge-set, and EdgeInsets padding overloads. */
export function paddingStyle(valueOrEdges: unknown = 16, length?: unknown): Record<string, string> {
  if (valueOrEdges && typeof valueOrEdges === "object" && !Array.isArray(valueOrEdges)) {
    return edgeInsetStyle(valueOrEdges) ?? {}
  }
  const edges = normalizedEdges(valueOrEdges)
  if (!edges) {
    const value = layoutLength(valueOrEdges === undefined ? 16 : valueOrEdges)
    return value ? { padding: value } : {}
  }
  const resolved = layoutLength(length === undefined ? 16 : length)
  if (!resolved) return {}
  const result: Record<string, string> = {}
  for (const edge of edges) {
    if (edge === "top") result.paddingTop = resolved
    else if (edge === "bottom") result.paddingBottom = resolved
    else if (edge === "leading") result.paddingLeft = resolved
    else result.paddingRight = resolved
  }
  return result
}

/** Internal renderer approximation for SwiftUI safe-area padding. */
export function safeAreaPaddingStyle(valueOrEdges: unknown = "all", length?: unknown): Record<string, string> {
  const edges = normalizedEdges(valueOrEdges)
  const resolvedEdges = edges ?? ["top", "leading", "bottom", "trailing"]
  const extra = layoutLength(edges ? length ?? 0 : valueOrEdges) ?? "0px"
  const result: Record<string, string> = {}
  for (const edge of resolvedEdges) {
    if (edge === "top") result.paddingTop = `calc(env(safe-area-inset-top, 0px) + ${extra})`
    else if (edge === "trailing") result.paddingRight = `calc(env(safe-area-inset-right, 0px) + ${extra})`
    else if (edge === "bottom") result.paddingBottom = `calc(env(safe-area-inset-bottom, 0px) + ${extra})`
    else result.paddingLeft = `calc(env(safe-area-inset-left, 0px) + ${extra})`
  }
  return result
}

/** Internal renderer approximation for extending content through selected safe-area edges. */
export function ignoresSafeAreaStyle(edgesValue: unknown = "all"): Record<string, string> {
  const edges = normalizedEdges(edgesValue) ?? ["top", "leading", "bottom", "trailing"]
  const result: Record<string, string> = {}
  for (const edge of edges) {
    if (edge === "top") result.marginTop = "calc(-1 * env(safe-area-inset-top, 0px))"
    else if (edge === "trailing") result.marginRight = "calc(-1 * env(safe-area-inset-right, 0px))"
    else if (edge === "bottom") result.marginBottom = "calc(-1 * env(safe-area-inset-bottom, 0px))"
    else result.marginLeft = "calc(-1 * env(safe-area-inset-left, 0px))"
  }
  return result
}
