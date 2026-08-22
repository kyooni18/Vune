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

export function layoutLength(value: unknown): string | undefined {
  return typeof value === "number" ? `${value}px` : typeof value === "string" ? value : undefined
}

export function frameStyle(options: FrameOptions): Record<string, string | undefined> {
  return {
    boxSizing: "border-box",
    display: "grid",
    placeItems: framePlaceItems(options.alignment),
    width: layoutLength(options.width),
    height: layoutLength(options.height),
    minWidth: layoutLength(options.minWidth),
    maxWidth: options.maxWidth === "infinity" ? "100%" : layoutLength(options.maxWidth),
    minHeight: layoutLength(options.minHeight),
    maxHeight: options.maxHeight === "infinity" ? "100%" : layoutLength(options.maxHeight),
  }
}
