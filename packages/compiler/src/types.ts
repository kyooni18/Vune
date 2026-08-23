import type { VuneSemanticModel } from "./semantic.js"

export interface VuneSourceMap {
  readonly version: 3
  readonly file?: string
  readonly sources: readonly string[]
  readonly sourcesContent: readonly string[]
  readonly names: readonly string[]
  readonly mappings: string
  readonly x_vune?: {
    readonly lineMappings: readonly { readonly line: number; readonly column: number; readonly generatedColumn: number }[]
    readonly segments: readonly (readonly { readonly line: number; readonly column: number; readonly generatedColumn: number }[])[]
  }
}

export interface VuneTransformResult {
  readonly code: string
  readonly map: VuneSourceMap
}

export interface VuneDiagnostic {
  readonly severity: "error" | "warning"
  readonly code: "VUNE_SYNTAX" | "VUNE_INITIALIZER" | "VUNE_TYPESCRIPT" | "VUNE_HTML_ATTRIBUTE" | "VUNE_HTML_VALUE" | "VUNE_STATE_SCOPE"
  readonly message: string
  readonly line: number
  readonly column: number
}

export interface VuneLanguageService {
  readonly format: (source: string) => string
  readonly diagnose: (source: string) => readonly VuneDiagnostic[]
  readonly transform: (source: string, id?: string) => VuneTransformResult
  readonly positionAt: (source: string, offset: number) => { line: number; column: number }
  readonly offsetAt: (source: string, position: { line: number; column: number }) => number
  readonly semantic: (source: string, fileName?: string) => VuneSemanticModel
}

export interface VuneVitePluginOptions {
  readonly include?: RegExp
}
