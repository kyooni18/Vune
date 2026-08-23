import { createVuneSourceMap } from "./source-map.js"
import { createSemanticModel, type VuneSemanticModel } from "./semantic.js"
import { transformVuneSource } from "./pipeline.js"
import { diagnoseVuneSource } from "./diagnostics.js"
import type { VuneLanguageService, VuneSourceMap, VuneTransformResult } from "./types.js"

export { transformVuneSource } from "./pipeline.js"
export { diagnoseVuneSource } from "./diagnostics.js"
export { createVuneVitePlugin } from "./vite.js"
export type { VuneDiagnostic, VuneLanguageService, VuneSourceMap, VuneTransformResult, VuneVitePluginOptions } from "./types.js"

export { lowerVuneBuilderAst, parseVuneBuilder, parseVuneStructs } from "./ast.js"
export type {
  VuneArgument,
  VuneAstLowering,
  VuneBuilderNode,
  VuneBuilderProgram,
  VuneCallExpression,
  VuneClosureExpression,
  VuneConditionalExpression,
  VuneRawExpression,
  VuneSourceRange,
  VuneStructDeclaration,
  VuneStructField,
  VuneStructInitializer,
} from "./ast.js"
export type {
  VuneSemanticCall,
  VuneSemanticField,
  VuneSemanticForeignComponent,
  VuneSemanticHtmlDiagnostic,
  VuneSemanticHtmlElement,
  VuneSemanticImport,
  VuneSemanticInitializer,
  VuneSemanticModel,
  VuneSemanticView,
} from "./semantic.js"
export type {
  SemanticArgument,
  SemanticArgumentKind,
  SemanticCallResolution,
  SemanticClosureRole,
  SemanticBindingSymbol,
  SemanticBuilderTypeSymbol,
  SemanticFieldSymbol,
  SemanticForeignComponentTypeSymbol,
  SemanticHtmlAttributeSpec,
  SemanticHtmlAttributeSymbol,
  SemanticHtmlElementSymbol,
  SemanticHtmlTagSpec,
  SemanticHtmlAttributeCategory,
  SemanticHtmlAttributeValueType,
  SemanticInitializerParameter,
  SemanticInitializerParameterKind,
  SemanticInitializerResolution,
  SemanticInitializerResolutionFailure,
  SemanticInitializerResolutionResult,
  SemanticInitializerSymbol,
  SemanticResolutionDiagnostic,
  SemanticStateSymbol,
  SemanticStructSymbol,
  SemanticSymbol,
  SemanticViewTypeSymbol,
} from "@vune-ui/core"
export { resolveSemanticCall, resolveSemanticInitializer, SemanticModel, semanticHtmlAttributeNames, semanticHtmlAttributeSpec, semanticHtmlTagNames, semanticHtmlTagSpec } from "@vune-ui/core"
export { mapGeneratedPosition, mapOriginalPosition } from "./source-map.js"
export type { VuneSourceMapAnchor, VuneSourcePosition } from "./source-map.js"

export function compileVuneFile(source: string, fileName = "vune-source.vune.ts"): VuneTransformResult {
  const code = transformVuneSource(source, fileName)
  return { code, map: createVuneSourceMap(source, code, fileName) }
}

/** Build the shared Vune + TypeScript semantic model used by compiler clients and IDE tooling. */
export function createVuneSemanticModel(source: string, fileName = "vune-source.vune.ts"): VuneSemanticModel {
  return createSemanticModel(source, fileName, transformVuneSource(source, fileName))
}

export function formatVuneSource(source: string): string {
  return transformVuneSource(source)
}

export function createVuneLanguageService(): VuneLanguageService {
  return {
    format: formatVuneSource,
    diagnose: diagnoseVuneSource,
    transform: compileVuneFile,
    positionAt(source, offset) {
      const bounded = Math.max(0, Math.min(source.length, offset))
      const before = source.slice(0, bounded)
      return { line: before.split("\n").length, column: bounded - before.lastIndexOf("\n") }
    },
    offsetAt(source, position) {
      const lines = source.split("\n")
      const line = Math.max(1, Math.min(lines.length, position.line))
      return lines.slice(0, line - 1).reduce((offset, item) => offset + item.length + 1, 0) + Math.max(0, position.column - 1)
    },
    semantic: createVuneSemanticModel,
  }
}
