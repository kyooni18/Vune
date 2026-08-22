const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

function vlq(value: number): string {
  let current = value < 0 ? ((-value) << 1) | 1 : value << 1
  let output = ""
  do {
    let digit = current & 31
    current >>>= 5
    if (current > 0) digit |= 32
    output += alphabet[digit]
  } while (current > 0)
  return output
}

export interface MuseSourceMapAnchor {
  readonly line: number
  readonly column: number
  readonly generatedColumn: number
}

export interface MuseSourceMap {
  readonly version: 3
  readonly file?: string
  readonly sources: readonly string[]
  readonly sourcesContent: readonly string[]
  readonly names: readonly string[]
  readonly mappings: string
  readonly x_muse: {
    readonly lineMappings: readonly MuseSourceMapAnchor[]
    readonly segments: readonly (readonly MuseSourceMapAnchor[])[]
  }
}

interface Token {
  readonly value: string
  readonly line: number
  readonly column: number
}

function tokens(line: string): Array<{ value: string; column: number }> {
  return [...line.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)].map(match => ({
    value: match[0],
    column: match.index ?? 0,
  }))
}

function allTokens(source: string): Token[] {
  return source.split("\n").flatMap((line, lineIndex) => tokens(line).map(token => ({
    value: token.value,
    line: lineIndex,
    column: token.column,
  })))
}

function key(line: number, column: number): string {
  return `${line}:${column}`
}

function alignTokens(source: string, generated: string): Map<string, { line: number; column: number }> {
  const original = allTokens(source)
  const generatedTokens = allTokens(generated)
  const anchors = new Map<string, { line: number; column: number }>()
  let cursor = 0
  let previous = { line: 0, column: 0 }
  for (const token of generatedTokens) {
    const relativeIndex = original.slice(cursor).findIndex(candidate => candidate.value === token.value)
    if (relativeIndex >= 0) {
      const anchor = original[cursor + relativeIndex]
      previous = { line: anchor.line, column: anchor.column }
      cursor += relativeIndex + 1
    }
    anchors.set(key(token.line, token.column), previous)
  }
  return anchors
}

function sourceTokensByValue(source: string): Map<string, Array<{ line: number; column: number }>> {
  const result = new Map<string, Array<{ line: number; column: number }>>()
  for (const token of allTokens(source)) {
    const values = result.get(token.value) ?? []
    values.push({ line: token.line, column: token.column })
    result.set(token.value, values)
  }
  return result
}

function fallbackAnchor(sourceLines: number, line: number): { line: number; column: number } {
  return { line: Math.min(Math.max(0, line), sourceLines - 1), column: 0 }
}

function lineAnchors(
  generatedLine: string,
  line: number,
  sourceLines: number,
  sourceTokens: ReadonlyMap<string, readonly { line: number; column: number }[]>,
  aligned: ReadonlyMap<string, { line: number; column: number }>,
): MuseSourceMapAnchor[] {
  const generatedTokens = tokens(generatedLine)
  if (generatedTokens.length === 0) return [{ ...fallbackAnchor(sourceLines, line), generatedColumn: 0 }]
  return generatedTokens.map(token => ({
    ...(aligned.get(key(line, token.column))
      ?? sourceTokens.get(token.value)?.[0]
      ?? fallbackAnchor(sourceLines, line)),
    generatedColumn: token.column,
  }))
}

/** Create a token-anchored VLQ map for the lexical Muse lowering pass. */
export function createMuseSourceMap(source: string, generated: string, id: string): MuseSourceMap {
  const sourceLines = Math.max(1, source.split("\n").length)
  const aligned = alignTokens(source, generated)
  const sourceByValue = sourceTokensByValue(source)
  const segments = generated.split("\n").map((line, index) => lineAnchors(line, index, sourceLines, sourceByValue, aligned))
  let previousLine = 0
  let previousColumn = 0
  const mappings = segments.map(line => {
    let previousGeneratedColumn = 0
    return line.map(anchor => {
      const value = `${vlq(anchor.generatedColumn - previousGeneratedColumn)}${vlq(0)}${vlq(anchor.line - previousLine)}${vlq(anchor.column - previousColumn)}`
      previousGeneratedColumn = anchor.generatedColumn
      previousLine = anchor.line
      previousColumn = anchor.column
      return value
    }).join(",")
  }).join(";")
  return {
    version: 3,
    file: id,
    sources: [id],
    sourcesContent: [source],
    names: [],
    mappings,
    x_muse: { lineMappings: segments.map(line => line[0]), segments },
  }
}

export interface MuseSourcePosition {
  readonly line: number
  readonly column: number
}

export function mapGeneratedPosition(map: MuseSourceMap, position: MuseSourcePosition): MuseSourcePosition {
  const line = Math.max(1, Math.trunc(position.line))
  const column = Math.max(1, Math.trunc(position.column)) - 1
  const anchors = map.x_muse.segments[Math.min(line - 1, map.x_muse.segments.length - 1)] ?? []
  const anchor = [...anchors].reverse().find(item => item.generatedColumn <= column) ?? anchors[0] ?? { line: 0, column: 0, generatedColumn: 0 }
  return { line: anchor.line + 1, column: anchor.column + Math.max(0, column - anchor.generatedColumn) + 1 }
}

export function mapOriginalPosition(map: MuseSourceMap, position: MuseSourcePosition): MuseSourcePosition {
  const line = Math.max(1, Math.trunc(position.line)) - 1
  const column = Math.max(1, Math.trunc(position.column)) - 1
  let bestLine = 0
  let best = map.x_muse.lineMappings[0] ?? { line: 0, column: 0, generatedColumn: 0 }
  let distance = Number.POSITIVE_INFINITY
  for (let generatedLine = 0; generatedLine < map.x_muse.segments.length; generatedLine += 1) {
    for (const candidate of map.x_muse.segments[generatedLine]) {
      const nextDistance = Math.abs(candidate.line - line) * 10000 + Math.abs(candidate.column - column)
      if (nextDistance >= distance) continue
      distance = nextDistance
      bestLine = generatedLine
      best = candidate
    }
  }
  return { line: bestLine + 1, column: Math.max(1, best.generatedColumn + column - best.column + 1) }
}
