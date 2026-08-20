import { DEFAULT_BUILDER_COMPONENTS, transformMuseBuilderSyntax } from './builder-transform.js'

export interface MuseViteBuilderOptions {
  components?: readonly string[]
}

export function createMuseVitePlugin(options: MuseViteBuilderOptions = {}) {
  const components = options.components ?? DEFAULT_BUILDER_COMPONENTS
  return {
    name: 'muse-builder-transform',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (!/\.[cm]?[jt]sx?$/.test(id.split('?', 1)[0])) return null
      const result = transformMuseBuilderSyntax(code, components)
      return result === code ? null : { code: result, map: null }
    }
  }
}
