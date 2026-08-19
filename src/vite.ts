export interface VuneMacroPlugin {
  name: string
  enforce: 'pre'
  transform(code: string, id: string): { code: string; map: null } | null
}

type Range = { start: number; end: number }
type CallRange = Range & { open: number; close: number }

function isIdentifierPart(char: string | undefined): boolean {
  return !!char && /[A-Za-z0-9_$]/.test(char)
}

function skipQuoted(source: string, index: number, quote: "'" | '"'): number {
  let i = index + 1
  while (i < source.length) {
    if (source[i] === '\\') { i += 2; continue }
    if (source[i] === quote) return i + 1
    i += 1
  }
  return source.length
}

function skipLineComment(source: string, index: number): number {
  const newline = source.indexOf('\n', index + 2)
  return newline === -1 ? source.length : newline + 1
}

function skipBlockComment(source: string, index: number): number {
  const close = source.indexOf('*/', index + 2)
  return close === -1 ? source.length : close + 2
}

function findMatching(source: string, openIndex: number, openChar: string, closeChar: string): number {
  let depth = 0
  let i = openIndex
  while (i < source.length) {
    const char = source[i]
    const next = source[i + 1]
    if (char === "'" || char === '"') { i = skipQuoted(source, i, char); continue }
    if (char === '/' && next === '/') { i = skipLineComment(source, i); continue }
    if (char === '/' && next === '*') { i = skipBlockComment(source, i); continue }
    if (char === openChar) depth += 1
    if (char === closeChar && --depth === 0) return i
    i += 1
  }
  throw new Error(`Unclosed ${openChar} in Vune macro source`)
}

function skipWhitespace(source: string, index: number): number {
  let i = index
  while (/\s/.test(source[i] ?? '')) i += 1
  return i
}

function findCalls(source: string, name: string): CallRange[] {
  const calls: CallRange[] = []
  for (let i = 0; i < source.length;) {
    const char = source[i]
    const next = source[i + 1]
    if (char === "'" || char === '"') { i = skipQuoted(source, i, char); continue }
    if (char === '/' && next === '/') { i = skipLineComment(source, i); continue }
    if (char === '/' && next === '*') { i = skipBlockComment(source, i); continue }
    if (source.startsWith(name, i) && !isIdentifierPart(source[i - 1]) && !isIdentifierPart(source[i + name.length])) {
      const open = skipWhitespace(source, i + name.length)
      if (source[open] === '(') {
        const close = findMatching(source, open, '(', ')')
        calls.push({ start: i, open, close, end: close + 1 })
        i = close + 1
        continue
      }
    }
    i += 1
  }
  return calls
}

function transformActions(source: string): string {
  const edits = findCalls(source, 'Action').map(call => ({
    start: call.start,
    end: call.end,
    replacement: `(() => (${source.slice(call.open + 1, call.close).trim()}))`,
  }))
  let output = source
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end)
  }
  return output
}

export function transformVuneMacros(source: string, id = ''): string | null {
  if (!source.includes('Action(')) return null
  if (id) {
    const pathname = id.split('?', 1)[0]
    if (!/\.[cm]?[jt]sx?$/.test(pathname)) return null
  }
  const output = transformActions(source)
  return output === source ? null : `/* @vune-macro-transformed */\n${output}`
}

export function vuneMacro(): VuneMacroPlugin {
  return {
    name: 'vune-macro',
    enforce: 'pre',
    transform(code, id) {
      const transformed = transformVuneMacros(code, id)
      return transformed === null ? null : { code: transformed, map: null }
    },
  }
}
