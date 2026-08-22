export { transformMuseBuilderSyntax } from './builder-transform.js'
export { transformMuseStructSyntax } from './struct-transform.js'
export { lowerMuseBuilderAst, parseMuseBuilder, parseMuseStructs } from './ast.js'
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
} from './ast.js'
export { diagnoseMuseSource, formatMuseSource } from './language-tools.js'
export type { MuseDiagnostic } from './language-tools.js'
export { createMuseLanguageService } from './language-service.js'
export type {
  MuseLanguageService,
  MuseLanguageTransform,
  MuseSourcePosition,
} from './language-service.js'
export { createMuseTypeScriptLanguageService } from './typescript-language-service.js'
export type { MuseTypeScriptLanguageServiceOptions } from './typescript-language-service.js'
export {
  createMuseSourceMap,
  mapGeneratedPosition,
  mapOriginalPosition,
} from './source-map.js'
export type { MuseSourceMap } from './source-map.js'
export { createMuseVitePlugin } from './vite-builder.js'

export * from './swc-transform.js'
