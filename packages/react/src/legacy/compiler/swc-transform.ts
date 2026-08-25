/**
 * SWC-compatible transform helpers.
 *
 * This module exposes a dependency-free transform adapter. SWC/Babel hosts can
 * pass the source through this adapter before their own AST pipeline without
 * forcing Vune to depend on a specific compiler.
 */
import { transformVuneBuilderSyntax } from './builder-transform.js'
import { transformVuneStructSyntax } from './struct-transform.js'

export interface VuneTransformOptions {}

export function createVuneSwcVisitor(_options: VuneTransformOptions = {}) {

  return {
    name: 'vune-builder-transform',
    transform(code: string) {
      const lowered = transformVuneBuilderSyntax(transformVuneStructSyntax(code))
      return [
        ...(lowered.includes('namedArguments(') ? ['namedArguments'] : []),
        ...(lowered.includes('overloadClosure(') ? ['overloadClosure'] : []),
      ].reduce((value, name) => ensureRuntimeImport(value, name), lowered)
    },
  }
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
