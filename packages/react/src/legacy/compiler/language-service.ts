import { createMuseSourceMap } from './source-map.js'
import { diagnoseMuseSource, formatMuseSource, type MuseDiagnostic } from './language-tools.js'

export interface MuseSourcePosition {
  readonly line: number
  readonly column: number
}
export interface MuseLanguageTransform {
  readonly code: string
  readonly map: ReturnType<typeof createMuseSourceMap>
}

/**
 * Small editor-facing adapter for hosts that do not run the Vite plugin.
 *
 * The service deliberately keeps offsets in the original source space. This
 * makes diagnostics and text-editor selections useful even when the compiler
 * synthesizes closure wrappers or initializer objects.
 */
export interface MuseLanguageService {
  format(source: string): string
  diagnose(source: string): readonly MuseDiagnostic[]
  transform(source: string, id?: string): MuseLanguageTransform
  positionAt(source: string, offset: number): MuseSourcePosition
  offsetAt(source: string, position: MuseSourcePosition): number
}

function clampOffset(source: string, offset: number): number {
  return Math.max(0, Math.min(source.length, Math.trunc(offset)))
}

function positionAt(source: string, offset: number): MuseSourcePosition {
  const bounded = clampOffset(source, offset)
  const before = source.slice(0, bounded)
  const lineStart = before.lastIndexOf('\n') + 1
  return {
    line: before.split('\n').length,
    column: bounded - lineStart + 1,
  }
}

function offsetAt(source: string, position: MuseSourcePosition): number {
  const line = Math.max(1, Math.trunc(position.line))
  const column = Math.max(1, Math.trunc(position.column))
  const lines = source.split('\n')
  const lineStart = lines.slice(0, Math.min(line - 1, lines.length - 1))
    .reduce((offset, value) => offset + value.length + 1, 0)
  return clampOffset(source, lineStart + column - 1)
}

export function createMuseLanguageService(): MuseLanguageService {
  return {
    format: formatMuseSource,
    diagnose: diagnoseMuseSource,
    transform(source, id = 'muse-source.ts') {
      const code = formatMuseSource(source)
      return { code, map: createMuseSourceMap(source, code, id) }
    },
    positionAt,
    offsetAt,
  }
}
