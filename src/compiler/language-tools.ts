import { transformMuseBuilderSyntax } from './builder-transform.js'
import { transformMuseStructSyntax } from './struct-transform.js'

export interface MuseDiagnostic {
  severity: 'error'
  code: 'MUSE_SYNTAX'
  message: string
  line: number
  column: number
}

/** The canonical formatter/compiler entry used by editor integrations. */
export function formatMuseSource(source: string): string {
  return transformMuseBuilderSyntax(transformMuseStructSyntax(source))
}

/** Return structured diagnostics without making an editor parse exceptions. */
export function diagnoseMuseSource(source: string): readonly MuseDiagnostic[] {
  try {
    formatMuseSource(source)
    return []
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const lineMatch = /line\s+(\d+)/i.exec(message)
    const line = lineMatch ? Number(lineMatch[1]) : 1
    return [{ severity: 'error', code: 'MUSE_SYNTAX', message, line, column: 1 }]
  }
}
