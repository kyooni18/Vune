export interface VuneMacroPlugin {
  name: string
  enforce: 'pre'
  transform(code: string, id: string): { code: string; map: null } | null
}

type Range = { start: number; end: number }
type CallRange = Range & { open: number; close: number }
type StateDeclaration = Range & { name: string; initializer: string }

function isIdentifierStart(char: string | undefined): boolean {
  return !!char && /[A-Za-z_$]/.test(char)
}

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

function skipTemplate(source: string, index: number): number {
  let i = index + 1
  while (i < source.length) {
    if (source[i] === '\\') { i += 2; continue }
    if (source[i] === '`') return i + 1
    if (source[i] === '$' && source[i + 1] === '{') {
      i = findMatching(source, i + 1, '{', '}') + 1
      continue
    }
    i += 1
  }
  return source.length
}

function findMatching(
  source: string,
  openIndex: number,
  openChar: '(' | '{' | '[',
  closeChar: ')' | '}' | ']',
): number {
  let depth = 0
  let i = openIndex
  while (i < source.length) {
    const char = source[i]
    const next = source[i + 1]
    if (char === "'" || char === '"') { i = skipQuoted(source, i, char); continue }
    if (char === '`') { i = skipTemplate(source, i); continue }
    if (char === '/' && next === '/') { i = skipLineComment(source, i); continue }
    if (char === '/' && next === '*') { i = skipBlockComment(source, i); continue }
    if (char === openChar) depth += 1
    if (char === closeChar) {
      depth -= 1
      if (depth === 0) return i
    }
    i += 1
  }
  throw new Error(`Unclosed ${openChar} in Vune macro source`)
}

function skipWhitespace(source: string, index: number): number {
  let i = index
  while (i < source.length && /\s/.test(source[i])) i += 1
  return i
}

function findCalls(source: string, name: string): CallRange[] {
  const calls: CallRange[] = []
  let i = 0
  while (i < source.length) {
    const char = source[i]
    const next = source[i + 1]
    if (char === "'" || char === '"') { i = skipQuoted(source, i, char); continue }
    if (char === '`') { i = skipTemplate(source, i); continue }
    if (char === '/' && next === '/') { i = skipLineComment(source, i); continue }
    if (char === '/' && next === '*') { i = skipBlockComment(source, i); continue }

    if (isIdentifierStart(char)) {
      const start = i
      const previous = source[start - 1]
      i += 1
      while (isIdentifierPart(source[i])) i += 1
      if (previous === '.' || isIdentifierPart(previous)) continue
      if (source.slice(start, i) !== name) continue
      const open = skipWhitespace(source, i)
      if (source[open] !== '(') continue
      const close = findMatching(source, open, '(', ')')
      calls.push({ start, open, close, end: close + 1 })
      i = close + 1
      continue
    }
    i += 1
  }
  return calls
}

function findStateDeclarations(source: string): StateDeclaration[] {
  const declarations: StateDeclaration[] = []
  for (const call of findCalls(source, 'State')) {
    const prefixStart = Math.max(0, call.start - 240)
    const prefix = source.slice(prefixStart, call.start)
    const match = /\bconst\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*$/.exec(prefix)
    if (!match) continue
    const start = prefixStart + match.index
    let end = skipWhitespace(source, call.end)
    if (source[end] === ';') end += 1
    if (source[end] === '\r') end += 1
    if (source[end] === '\n') end += 1
    declarations.push({
      name: match[1],
      initializer: source.slice(call.open + 1, call.close).trim(),
      start,
      end,
    })
  }
  return declarations
}

function findDefaultViewCall(source: string): CallRange | null {
  for (const call of findCalls(source, 'view')) {
    const prefix = source.slice(Math.max(0, call.start - 100), call.start)
    if (/export\s+default\s*$/.test(prefix)) return call
  }
  return null
}

function transformActionCalls(source: string): string {
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

function looksLikeFunction(source: string): boolean {
  const value = source.trim()
  return /^(?:async\s+)?(?:[A-Za-z_$][A-Za-z0-9_$]*|\([^)]*\))\s*=>/.test(value)
    || /^(?:async\s+)?function\b/.test(value)
}

export function transformVuneMacros(source: string, id = ''): string | null {
  if (source.includes('/* @vune-macro-transformed */')) return null
  if (!source.includes('view(') && !source.includes('view (')) return null
  if (id) {
    const pathname = id.split('?', 1)[0]
    if (!/\.[cm]?[jt]sx?$/.test(pathname)) return null
  }

  const viewCall = findDefaultViewCall(source)
  if (!viewCall) return null
  const states = findStateDeclarations(source).filter(state => state.start < viewCall.start)
  const originalBody = source.slice(viewCall.open + 1, viewCall.close).trim()
  const body = transformActionCalls(originalBody)

  let replacement: string
  if (states.length > 0) {
    const renderedBody = looksLikeFunction(body) ? `(${body})()` : `(${body})`
    const declarations = states
      .map(state => `    const ${state.name} = State(${state.initializer})`)
      .join('\n')
    const names = states.map(state => state.name).join(', ')
    replacement = `view({\n  state: () => {\n${declarations}\n    return { ${names} }\n  },\n  body: ({ ${names} }) => ${renderedBody},\n})`
  } else {
    replacement = looksLikeFunction(body) ? `view(${body})` : `view(() => (${body}))`
  }

  const edits = [
    ...states.map(state => ({ start: state.start, end: state.end, replacement: '' })),
    { start: viewCall.start, end: viewCall.end, replacement },
  ]

  let output = source
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end)
  }
  return `/* @vune-macro-transformed */\n${output}`
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
