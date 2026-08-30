/** Renderer-independent replacement animation for content inside a stable View. */

export type SymbolReplacementMode = "automatic" | "byLayer" | "wholeSymbol" | "magicReplace"
export type SymbolReplacementFallback = "downUp" | "upDown" | "opacity"
export type TextTransitionDirection = "up" | "down" | "leading" | "trailing"

export interface SymbolEffectDescriptor {
  readonly mode: SymbolReplacementMode
  readonly fallback: SymbolReplacementFallback
}

export class SymbolEffect {
  readonly descriptor: SymbolEffectDescriptor

  private constructor(mode: SymbolReplacementMode, fallback: SymbolReplacementFallback = "downUp") {
    this.descriptor = Object.freeze({ mode, fallback })
    Object.freeze(this)
  }

  static readonly automatic = new SymbolEffect("automatic")
  static readonly byLayer = new SymbolEffect("byLayer")
  static readonly wholeSymbol = new SymbolEffect("wholeSymbol")

  static magicReplace(fallback: SymbolReplacementFallback = "downUp"): SymbolEffect {
    return new SymbolEffect("magicReplace", fallback)
  }
}

export type ContentTransitionDescriptor =
  | Readonly<{ kind: "identity" }>
  | Readonly<{ kind: "opacity" }>
  | Readonly<{ kind: "interpolate" }>
  | Readonly<{ kind: "blurReplace"; radius: number }>
  | Readonly<{ kind: "push"; direction: TextTransitionDirection }>
  | Readonly<{ kind: "scale"; scale: number }>
  | Readonly<{ kind: "numericText"; value?: number }>
  | Readonly<{ kind: "symbolEffect"; effect: SymbolEffect }>

export class ContentTransition {
  readonly descriptor: ContentTransitionDescriptor

  private constructor(descriptor: ContentTransitionDescriptor) {
    this.descriptor = Object.freeze({ ...descriptor }) as ContentTransitionDescriptor
    Object.freeze(this)
  }

  static readonly identity = new ContentTransition({ kind: "identity" })
  static readonly opacity = new ContentTransition({ kind: "opacity" })
  static readonly interpolate = new ContentTransition({ kind: "interpolate" })

  static blurReplace(radius = 8): ContentTransition {
    return new ContentTransition({
      kind: "blurReplace",
      radius: Number.isFinite(radius) ? Math.max(0, radius) : 8,
    })
  }

  static push(direction: TextTransitionDirection = "up"): ContentTransition {
    return new ContentTransition({ kind: "push", direction })
  }

  static scale(scale = 0.92): ContentTransition {
    return new ContentTransition({
      kind: "scale",
      scale: Number.isFinite(scale) ? Math.max(0, scale) : 0.92,
    })
  }

  static numericText(value?: number): ContentTransition {
    return new ContentTransition({
      kind: "numericText",
      ...(typeof value === "number" && Number.isFinite(value) ? { value } : {}),
    })
  }

  static symbolEffect(effect: SymbolEffect = SymbolEffect.magicReplace()): ContentTransition {
    return new ContentTransition({ kind: "symbolEffect", effect })
  }
}
