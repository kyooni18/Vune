import type { Length } from "./graph/types.js"

export type FrameAlignment = "center" | "leading" | "trailing" | "top" | "bottom" | "topLeading" | "topTrailing" | "bottomLeading" | "bottomTrailing"

export interface FrameOptions {
  readonly width?: Length
  readonly height?: Length
  readonly minWidth?: Length
  readonly maxWidth?: Length | "infinity"
  readonly minHeight?: Length
  readonly maxHeight?: Length | "infinity"
  readonly alignment?: FrameAlignment
}

function framePlaceItems(alignment: FrameAlignment = "center"): string {
  switch (alignment) {
    case "leading": return "center start"
    case "trailing": return "center end"
    case "top": return "start center"
    case "bottom": return "end center"
    case "topLeading": return "start start"
    case "topTrailing": return "start end"
    case "bottomLeading": return "end start"
    case "bottomTrailing": return "end end"
    default: return "center"
  }
}

function ownFrameValue(options: FrameOptions, key: keyof FrameOptions): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(options, key)
    return descriptor && "value" in descriptor ? descriptor.value : undefined
  } catch {
    return undefined
  }
}

export function layoutLength(value: unknown): string | undefined {
  return typeof value === "number" ? Number.isFinite(value) ? `${value}px` : undefined : typeof value === "string" ? value : undefined
}

export function frameStyle(options: FrameOptions): Record<string, string | undefined> {
  const width = ownFrameValue(options, "width")
  const height = ownFrameValue(options, "height")
  const minWidth = ownFrameValue(options, "minWidth")
  const maxWidth = ownFrameValue(options, "maxWidth")
  const minHeight = ownFrameValue(options, "minHeight")
  const maxHeight = ownFrameValue(options, "maxHeight")
  const alignment = ownFrameValue(options, "alignment")
  return {
    boxSizing: "border-box",
    display: "grid",
    placeItems: framePlaceItems(typeof alignment === "string" ? alignment as FrameAlignment : undefined),
    width: layoutLength(width),
    height: layoutLength(height),
    minWidth: layoutLength(minWidth),
    maxWidth: maxWidth === "infinity" ? "100%" : layoutLength(maxWidth),
    minHeight: layoutLength(minHeight),
    maxHeight: maxHeight === "infinity" ? "100%" : layoutLength(maxHeight),
  }
}
