/**
 * SWC-compatible transform helpers.
 *
 * This module exposes a dependency-free transform adapter. SWC/Babel hosts can
 * pass the source through this adapter before their own AST pipeline without
 * forcing Rui to depend on a specific compiler.
 */
import { transformRuiBuilderSyntax, DEFAULT_BUILDER_COMPONENTS } from './builder-transform.js'

export interface RuiTransformOptions {
  components?: readonly string[]
}

export function createRuiSwcVisitor(options: RuiTransformOptions = {}) {
  const components = options.components ?? DEFAULT_BUILDER_COMPONENTS

  return {
    name: 'rui-builder-transform',
    components: new Set(components),
    transform(code: string) {
      return transformRuiBuilderSyntax(code, components)
    },
  }
}
