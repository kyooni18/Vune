import { transformVuneBuilderSyntax } from './builder-transform.js'
import { transformVuneStructSyntax } from './struct-transform.js'

export interface VuneDiagnostic {
  severity: 'error'
  code: 'VUNE_SYNTAX'
  message: string
  line: number
  column: number
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

/** The canonical formatter/compiler entry used by editor integrations. */
export function formatVuneSource(source: string): string {
  const transformed = transformVuneBuilderSyntax(transformVuneStructSyntax(source))
  return [
    ...(transformed.includes('namedArguments(') ? ['namedArguments'] : []),
    ...(transformed.includes('overloadClosure(') ? ['overloadClosure'] : []),
  ].reduce((value, name) => ensureRuntimeImport(value, name), transformed)
}

/** Return structured diagnostics without making an editor parse exceptions. */
export function diagnoseVuneSource(source: string): readonly VuneDiagnostic[] {
  try {
    formatVuneSource(source)
    return []
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const offset = typeof error === 'object' && error !== null && 'offset' in error && typeof error.offset === 'number'
      ? error.offset
      : undefined
    if (offset === undefined) {
      const lineMatch = /line\s+(\d+)/i.exec(message)
      const line = lineMatch ? Number(lineMatch[1]) : 1
      return [{ severity: 'error', code: 'VUNE_SYNTAX', message, line, column: 1 }]
    }
    const before = source.slice(0, offset)
    const line = before.split('\n').length
    const lineStart = before.lastIndexOf('\n') + 1
    return [{ severity: 'error', code: 'VUNE_SYNTAX', message, line, column: offset - lineStart + 1 }]
  }
}
