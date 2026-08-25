export { transformVuneBuilderSyntax } from './builder-transform.js'
export { transformVuneStructSyntax } from './struct-transform.js'
export { lowerVuneBuilderAst, parseVuneBuilder, parseVuneStructs } from './ast.js'
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
} from './ast.js'
export { diagnoseVuneSource, formatVuneSource } from './language-tools.js'
export type { VuneDiagnostic } from './language-tools.js'
export { createVuneLanguageService } from './language-service.js'
export type {
  VuneLanguageService,
  VuneLanguageTransform,
  VuneSourcePosition,
} from './language-service.js'
export { createVuneTypeScriptLanguageService } from './typescript-language-service.js'
export type { VuneTypeScriptLanguageServiceOptions } from './typescript-language-service.js'
export {
  createVuneSourceMap,
  mapGeneratedPosition,
  mapOriginalPosition,
} from './source-map.js'
export type { VuneSourceMap } from './source-map.js'
export { createVuneVitePlugin } from './vite-builder.js'

export * from './swc-transform.js'
