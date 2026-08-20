import { DEFAULT_BUILDER_COMPONENTS, transformRuiBuilderSyntax } from './builder-transform.js'

export interface RuiViteBuilderOptions {
  components?: readonly string[]
}

export function createRuiVitePlugin(options: RuiViteBuilderOptions = {}) {
  const components = options.components ?? DEFAULT_BUILDER_COMPONENTS
  return {
    name: 'rui-builder-transform',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (!/\.[cm]?[jt]sx?$/.test(id.split('?', 1)[0])) return null
      const result = transformRuiBuilderSyntax(code, components)
      return result === code ? null : { code: result, map: null }
    }
  }
}
