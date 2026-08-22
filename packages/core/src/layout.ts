import type { Length } from "./graph.js"

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

export function layoutLength(value: unknown): string | undefined {
  return typeof value === "number" ? `${value}px` : typeof value === "string" ? value : undefined
}

export function frameStyle(options: FrameOptions): Record<string, string | undefined> {
  return {
    boxSizing: "border-box",
    width: layoutLength(options.width),
    height: layoutLength(options.height),
    minWidth: layoutLength(options.minWidth),
    maxWidth: options.maxWidth === "infinity" ? "100%" : layoutLength(options.maxWidth),
    minHeight: layoutLength(options.minHeight),
    maxHeight: options.maxHeight === "infinity" ? "100%" : layoutLength(options.maxHeight),
  }
}
