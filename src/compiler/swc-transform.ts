/**
 * SWC-compatible transform helpers.
 *
 * This module exposes a dependency-free transform adapter. SWC/Babel hosts can
 * pass the source through this adapter before their own AST pipeline without
 * forcing Muse to depend on a specific compiler.
 */
import { transformMuseBuilderSyntax, DEFAULT_BUILDER_COMPONENTS } from './builder-transform.js'

export interface MuseTransformOptions {
  components?: readonly string[]
}

export function createMuseSwcVisitor(options: MuseTransformOptions = {}) {
  const components = options.components ?? DEFAULT_BUILDER_COMPONENTS

  return {
    name: 'muse-builder-transform',
    components: new Set(components),
    transform(code: string) {
      return transformMuseBuilderSyntax(code, components)
    },
  }
}
