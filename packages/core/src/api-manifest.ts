import type { SemanticInitializerParameter, SemanticInitializerSymbol } from "./semantic.js"

export type SwiftUIApiKind = "view" | "modifier" | "value"

export interface SwiftUIInitializerSpec {
  readonly signature: string
  readonly parameters: readonly SemanticInitializerParameter[]
}

export interface SwiftUIViewSpec {
  readonly kind: "view"
  readonly name: string
  /** Canonical SwiftUI authoring initializers. Compatibility overloads stay runtime-only. */
  readonly initializers: readonly SwiftUIInitializerSpec[]
}

export interface SwiftUIModifierSpec {
  readonly kind: "modifier"
  readonly name: string
  readonly signatures: readonly string[]
  readonly animatable?: boolean
  /** Vune-only compatibility API. It is intentionally excluded from parity counts. */
  readonly compatibility?: boolean
  /** How Swift-style labeled arguments lower to the JavaScript runtime call. */
  readonly lowering?: SwiftUIModifierLoweringSpec
}

export type SwiftUIModifierLoweringSpec =
  | { readonly kind: "object"; readonly labels: readonly string[] }
  | { readonly kind: "ordered"; readonly labels: readonly string[] }
  | { readonly kind: "hybrid"; readonly objectLabels: readonly string[]; readonly orderedLabels: readonly string[] }

const value = (name: string, label = name, required = true, type?: string): SemanticInitializerParameter => ({
  kind: "value",
  name,
  label,
  labelRequired: true,
  required,
  ...(type ? { type } : {}),
})

const builder = (name = "content", label = name, trailing = true): SemanticInitializerParameter => ({
  kind: "viewBuilder",
  name,
  label,
  labelRequired: !trailing,
  required: true,
  trailing,
})

const action = (name = "action", label = name, trailing = false): SemanticInitializerParameter => ({
  kind: "action",
  name,
  label,
  labelRequired: !trailing,
  required: true,
  trailing,
  type: "function",
})

const views = Object.freeze({
  VStack: Object.freeze({
    kind: "view" as const,
    name: "VStack",
    initializers: Object.freeze([Object.freeze({
      signature: "init(alignment:spacing:content:)",
      parameters: Object.freeze([
        value("alignment", "alignment", false, "string"),
        value("spacing", "spacing", false, "number"),
        builder(),
      ]),
    })]),
  }),
  HStack: Object.freeze({
    kind: "view" as const,
    name: "HStack",
    initializers: Object.freeze([Object.freeze({
      signature: "init(alignment:spacing:content:)",
      parameters: Object.freeze([
        value("alignment", "alignment", false, "string"),
        value("spacing", "spacing", false, "number"),
        builder(),
      ]),
    })]),
  }),
  ZStack: Object.freeze({
    kind: "view" as const,
    name: "ZStack",
    initializers: Object.freeze([Object.freeze({
      signature: "init(alignment:content:)",
      parameters: Object.freeze([
        value("alignment", "alignment", false, "string"),
        builder(),
      ]),
    })]),
  }),
  Button: Object.freeze({
    kind: "view" as const,
    name: "Button",
    initializers: Object.freeze([
      Object.freeze({
        signature: "init(_:action:)",
        parameters: Object.freeze([
          { kind: "value" as const, name: "title", required: true, type: "string | number" },
          action("action", "action", true),
        ]),
      }),
      Object.freeze({
        signature: "init(action:label:)",
        parameters: Object.freeze([action(), builder("label", "label", false)]),
      }),
    ]),
  }),
}) satisfies Readonly<Record<string, SwiftUIViewSpec>>

const modifiers = Object.freeze([
  { kind: "modifier", name: "padding", signatures: ["padding(_:)"] },
  {
    kind: "modifier",
    name: "frame",
    signatures: ["frame(width:height:alignment:)", "frame(minWidth:idealWidth:maxWidth:minHeight:idealHeight:maxHeight:alignment:)"],
    lowering: {
      kind: "object",
      labels: ["width", "height", "alignment", "minWidth", "idealWidth", "maxWidth", "minHeight", "idealHeight", "maxHeight"],
    },
  },
  { kind: "modifier", name: "font", signatures: ["font(_:)"] },
  { kind: "modifier", name: "bold", signatures: ["bold(_:)"] },
  { kind: "modifier", name: "foregroundStyle", signatures: ["foregroundStyle(_:)"] },
  { kind: "modifier", name: "background", signatures: ["background(_:alignment:)"], lowering: { kind: "ordered", labels: ["alignment"] } },
  { kind: "modifier", name: "opacity", signatures: ["opacity(_:)"] , animatable: true },
  {
    kind: "modifier",
    name: "scaleEffect",
    signatures: ["scaleEffect(_:anchor:)", "scaleEffect(x:y:anchor:)"],
    animatable: true,
    lowering: { kind: "hybrid", objectLabels: ["x", "y"], orderedLabels: ["anchor"] },
  },
  { kind: "modifier", name: "rotationEffect", signatures: ["rotationEffect(_:anchor:)"], animatable: true, lowering: { kind: "ordered", labels: ["anchor"] } },
  { kind: "modifier", name: "offset", signatures: ["offset(_:)", "offset(x:y:)"], animatable: true, lowering: { kind: "object", labels: ["x", "y"] } },
  { kind: "modifier", name: "animation", signatures: ["animation(_:value:)"], lowering: { kind: "ordered", labels: ["value"] } },
  { kind: "modifier", name: "transition", signatures: ["transition(_:)"] },
  // Compatibility surface. These remain callable while the canonical SwiftUI
  // surface is expanded, but the parity tool does not count them as SwiftUI.
  { kind: "modifier", name: "margin", signatures: ["margin(_:)"] , compatibility: true },
  { kind: "modifier", name: "gap", signatures: ["gap(_:)"] , compatibility: true },
  { kind: "modifier", name: "fontSize", signatures: ["fontSize(_:)"] , compatibility: true },
  { kind: "modifier", name: "foreground", signatures: ["foreground(_:)"] , compatibility: true },
  { kind: "modifier", name: "style", signatures: ["style(_:)"] , compatibility: true },
  { kind: "modifier", name: "className", signatures: ["className(_:)"] , compatibility: true },
  { kind: "modifier", name: "withProps", signatures: ["withProps(_:)"] , compatibility: true },
  { kind: "modifier", name: "keyed", signatures: ["keyed(_:)"] , compatibility: true },
  { kind: "modifier", name: "elementRef", signatures: ["elementRef(_:)"] , compatibility: true },
  { kind: "modifier", name: "continuousCorners", signatures: ["continuousCorners(_:)"], compatibility: true },
] as const satisfies readonly SwiftUIModifierSpec[])

/** Seed manifest. It is the single compiler/runtime source of truth as parity expands. */
export const swiftUIApiManifest = Object.freeze({
  schemaVersion: 1,
  views,
  modifiers,
})

export const swiftUIStaticModifierNames: ReadonlySet<string> = new Set(modifiers.map(modifier => modifier.name))
export const swiftUIAnimatableModifierNames: ReadonlySet<string> = new Set(modifiers.filter(modifier => "animatable" in modifier && modifier.animatable).map(modifier => modifier.name))
export const swiftUICanonicalModifierNames: ReadonlySet<string> = new Set(modifiers.filter(modifier => !("compatibility" in modifier && modifier.compatibility)).map(modifier => modifier.name))

export function swiftUIModifierLowering(name: string): SwiftUIModifierLoweringSpec | undefined {
  const modifier = modifiers.find(modifier => modifier.name === name)
  return modifier && "lowering" in modifier ? modifier.lowering : undefined
}

/** Compiler-ready semantic symbols generated from the canonical manifest. */
export function swiftUIInitializerSymbols(name: string): readonly SemanticInitializerSymbol[] | undefined {
  const spec = views[name as keyof typeof views]
  if (!spec) return undefined
  return spec.initializers.map((initializer, index) => Object.freeze({
    kind: "initializer" as const,
    index,
    signature: initializer.signature,
    parameters: initializer.parameters,
  }))
}

export function swiftUIViewNames(): readonly string[] {
  return Object.keys(views)
}
