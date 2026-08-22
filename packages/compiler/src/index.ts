import { createMuseSourceMap } from "./source-map.js"
import { createSemanticModel, type MuseSemanticModel } from "./semantic.js"
import { transformMuseSource } from "./pipeline.js"
import { diagnoseMuseSource } from "./diagnostics.js"
import type { MuseLanguageService, MuseSourceMap, MuseTransformResult } from "./types.js"

export { transformMuseSource } from "./pipeline.js"
export { diagnoseMuseSource } from "./diagnostics.js"
export { createMuseVitePlugin } from "./vite.js"
export type { MuseDiagnostic, MuseLanguageService, MuseSourceMap, MuseTransformResult, MuseVitePluginOptions } from "./types.js"

export { lowerMuseBuilderAst, parseMuseBuilder, parseMuseStructs } from "./ast.js"
export type {
  MuseArgument,
  MuseAstLowering,
  MuseBuilderNode,
  MuseBuilderProgram,
  MuseCallExpression,
  MuseClosureExpression,
  MuseConditionalExpression,
  MuseRawExpression,
  MuseSourceRange,
  MuseStructDeclaration,
  MuseStructField,
  MuseStructInitializer,
} from "./ast.js"
export type {
  MuseSemanticCall,
  MuseSemanticField,
  MuseSemanticForeignComponent,
  MuseSemanticHtmlDiagnostic,
  MuseSemanticHtmlElement,
  MuseSemanticImport,
  MuseSemanticInitializer,
  MuseSemanticModel,
  MuseSemanticView,
} from "./semantic.js"
export type {
  SemanticArgument,
  SemanticArgumentKind,
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
  SemanticStateSymbol,
  SemanticStructSymbol,
  SemanticSymbol,
  SemanticViewTypeSymbol,
} from "@muse/core"
export { resolveSemanticInitializer, SemanticModel, semanticHtmlAttributeNames, semanticHtmlAttributeSpec, semanticHtmlTagNames, semanticHtmlTagSpec } from "@muse/core"
export { mapGeneratedPosition, mapOriginalPosition } from "./source-map.js"
export type { MuseSourceMapAnchor, MuseSourcePosition } from "./source-map.js"

export function compileMuseFile(source: string, fileName = "muse-source.muse.ts"): MuseTransformResult {
  const code = transformMuseSource(source, fileName)
  return { code, map: createMuseSourceMap(source, code, fileName) }
}

/** Build the shared Muse + TypeScript semantic model used by compiler clients and IDE tooling. */
export function createMuseSemanticModel(source: string, fileName = "muse-source.muse.ts"): MuseSemanticModel {
  return createSemanticModel(source, fileName, transformMuseSource(source, fileName))
}

export function formatMuseSource(source: string): string {
  return transformMuseSource(source)
}

export function createMuseLanguageService(): MuseLanguageService {
  return {
    format: formatMuseSource,
    diagnose: diagnoseMuseSource,
    transform: compileMuseFile,
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
    semantic: createMuseSemanticModel,
  }
}
