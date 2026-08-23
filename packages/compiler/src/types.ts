import type { MuseSemanticModel } from "./semantic.js"

export interface MuseSourceMap {
  readonly version: 3
  readonly file?: string
  readonly sources: readonly string[]
  readonly sourcesContent: readonly string[]
  readonly names: readonly string[]
  readonly mappings: string
  readonly x_muse?: {
    readonly lineMappings: readonly { readonly line: number; readonly column: number; readonly generatedColumn: number }[]
    readonly segments: readonly (readonly { readonly line: number; readonly column: number; readonly generatedColumn: number }[])[]
  }
}

export interface MuseTransformResult {
  readonly code: string
  readonly map: MuseSourceMap
}

export interface MuseDiagnostic {
  readonly severity: "error" | "warning"
  readonly code: "MUSE_SYNTAX" | "MUSE_INITIALIZER" | "MUSE_TYPESCRIPT" | "MUSE_HTML_ATTRIBUTE" | "MUSE_HTML_VALUE" | "MUSE_STATE_SCOPE"
  readonly message: string
  readonly line: number
  readonly column: number
}

export interface MuseLanguageService {
  readonly format: (source: string) => string
  readonly diagnose: (source: string) => readonly MuseDiagnostic[]
  readonly transform: (source: string, id?: string) => MuseTransformResult
  readonly positionAt: (source: string, offset: number) => { line: number; column: number }
  readonly offsetAt: (source: string, position: { line: number; column: number }) => number
  readonly semantic: (source: string, fileName?: string) => MuseSemanticModel
}

export interface MuseVitePluginOptions {
  readonly include?: RegExp
}
