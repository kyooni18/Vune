const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function vlq(value: number): string {
  let current = value < 0 ? ((-value) << 1) | 1 : value << 1
  let output = ''
  do {
    let digit = current & 31
    current >>>= 5
    if (current > 0) digit |= 32
    output += alphabet[digit]
  } while (current > 0)
  return output
}

/**
 * Produce a line-preserving source map for lexical transforms. The transform
 * keeps original expression text wherever possible, so line anchors are more
 * useful than returning `null`; generated columns that are synthesized by a
 * builder are intentionally anchored at the beginning of their source line.
 */
export function createMuseSourceMap(source: string, generated: string, id: string) {
  const sourceLines = Math.max(1, source.split('\n').length)
  let previousOriginalLine = 0
  const mappings = generated.split('\n').map((_, line) => {
    const originalLine = Math.min(line, sourceLines - 1)
    const mapping = `A${vlq(0)}${vlq(originalLine - previousOriginalLine)}A`
    previousOriginalLine = originalLine
    return mapping
  }).join(';')
  return {
    version: 3,
    file: id,
    sources: [id],
    sourcesContent: [source],
    names: [],
    mappings,
  }
}
