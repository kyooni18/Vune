import type { VuneSemanticModel } from "./semantic.js"
import type { VuneExecutionPlan } from "./execution-plan.js"
import type { ResidentComputeExperimentalOptions } from "@vune-ui/execution"

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
  /** Opt in to experimental Resident Compute native/GPU planning (default: false). */
  readonly experimentalResidentCompute?: boolean | ResidentComputeExperimentalOptions
  readonly include?: RegExp
  /** Generate detailed compiler maps for transformed modules (default: true). */
  readonly sourceMap?: boolean
  /**
   * Optional transitional Vue-host codegen. When configured, importing a
   * `.vune` source with `?vue-host` emits a thin runtime placement component
   * from the selected Vune initializer plan. Use generateVueHostModule for a
   * physical TypeScript host when consumer-visible `$props` typing is needed.
   */
  readonly vueHost?: {
    readonly factoryImport: string
  }
  /**
   * Optional compiler execution-plan tap for DevTools/profiling integrations.
   * Planning is completely skipped when this callback is absent.
   */
  readonly onExecutionPlan?: (plan: VuneExecutionPlan, id: string) => void
}
