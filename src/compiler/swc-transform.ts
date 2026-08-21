/**
 * SWC-compatible transform helpers.
 *
 * This module exposes a dependency-free transform adapter. SWC/Babel hosts can
 * pass the source through this adapter before their own AST pipeline without
 * forcing Muse to depend on a specific compiler.
 */
import { transformMuseBuilderSyntax } from './builder-transform.js'
import { transformMuseStructSyntax } from './struct-transform.js'

export interface MuseTransformOptions {}

export function createMuseSwcVisitor(_options: MuseTransformOptions = {}) {

  return {
    name: 'muse-builder-transform',
    transform(code: string) {
      return transformMuseBuilderSyntax(transformMuseStructSyntax(code))
    },
  }
}
