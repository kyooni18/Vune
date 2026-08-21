import { transformMuseBuilderSyntax } from './builder-transform.js'
import { transformMuseStructSyntax } from './struct-transform.js'
import { createMuseSourceMap } from './source-map.js'

export interface MuseViteBuilderOptions {}

export function createMuseVitePlugin(_options: MuseViteBuilderOptions = {}) {
  return {
    name: 'muse-builder-transform',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (!/\.[cm]?[jt]sx?$/.test(id.split('?', 1)[0])) return null
      const structCode = transformMuseStructSyntax(code)
      const result = transformMuseBuilderSyntax(structCode)
      return result === code ? null : { code: result, map: createMuseSourceMap(code, result, id.split('?', 1)[0]) }
    }
  }
}
