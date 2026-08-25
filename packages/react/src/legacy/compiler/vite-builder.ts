import { transformVuneBuilderSyntax } from './builder-transform.js'
import { transformVuneStructSyntax } from './struct-transform.js'
import { createLegacyVuneSourceMap } from './source-map.js'

export interface VuneViteBuilderOptions {}

function containsVuneSyntax(source: string): boolean {
  return /\bstruct\s+[A-Z][A-Za-z0-9_$]*(?:\s*<[^>{}]*>)?\s*:\s*View\b/.test(source)
    || /\b[A-Z][A-Za-z0-9_$]*\s*\([^\n]*\)\s*\{/.test(source)
    || /\b[A-Za-z_$][A-Za-z0-9_$]*\s*:\s*(?:\.|\$|\{)/.test(source)
    || /\.font\s*\(\s*\./.test(source)
}

function ensureRuntimeImport(source: string, name: string): string {
  const existing = /import\s*\{([\s\S]*?)\}\s*from\s*(['"])vune-ui\/legacy\2[\t ]*;?/.exec(source)
  if (!existing) return `import { ${name} } from 'vune-ui/legacy'\n${source}`
  const imported = existing[1].split(',').map(value => value.trim()).filter(Boolean)
  if (imported.includes(name)) return source
  imported.push(name)
  const replacement = `import { ${imported.join(', ')} } from 'vune-ui/legacy'`
  return source.slice(0, existing.index) + replacement + source.slice(existing.index + existing[0].length)
}

export function createVuneVitePlugin(_options: VuneViteBuilderOptions = {}) {
  return {
    name: 'vune-builder-transform',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (!/\.[cm]?[jt]sx?$/.test(id.split('?', 1)[0])) return null
      if (!containsVuneSyntax(code)) return null
      const structCode = transformVuneStructSyntax(code)
      const lowered = transformVuneBuilderSyntax(structCode)
      const result = [
        ...(lowered.includes('namedArguments(') ? ['namedArguments'] : []),
        ...(lowered.includes('overloadClosure(') ? ['overloadClosure'] : []),
      ].reduce((value, name) => ensureRuntimeImport(value, name), lowered)
      return result === code ? null : { code: result, map: createLegacyVuneSourceMap(code, result, id.split('?', 1)[0]) }
    }
  }
}
