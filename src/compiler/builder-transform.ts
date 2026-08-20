/**
 * Transforms Rui's optional block-builder syntax into ordinary JavaScript.
 *
 *     VStack() {
 *       Text('A')
 *       Text('B')
 *     }
 *
 * becomes:
 *
 *     VStack(() => [Text('A'), Text('B')])
 *
 * This is a small lexical parser rather than a regular-expression replacement:
 * strings, comments, templates, regular expressions, nested calls and nested
 * builder blocks are all kept out of the syntax scan.
 */

export const DEFAULT_BUILDER_COMPONENTS = ['VStack', 'HStack', 'ZStack', 'Group', 'Grid'] as const

type Delimiter = '(' | '{' | '['

const closeFor: Record<Delimiter, ')' | '}' | ']'> = {
  '(': ')',
  '{': '}',
  '[': ']',
}

function isIdentifierStart(char: string | undefined): boolean {
  return !!char && /[A-Za-z_$]/.test(char)
}

function isIdentifierPart(char: string | undefined): boolean {
  return !!char && /[A-Za-z0-9_$]/.test(char)
}

function skipQuoted(source: string, index: number, quote: "'" | '"'): number {
  let i = index + 1
  while (i < source.length) {
    if (source[i] === '\\') {
      i += 2
      continue
    }
    if (source[i] === quote) return i + 1
    i += 1
  }
  throw new SyntaxError(`Unclosed ${quote} string in Rui builder source`)
}

function skipLineComment(source: string, index: number): number {
  const newline = source.indexOf('\n', index + 2)
  return newline === -1 ? source.length : newline
}

function skipBlockComment(source: string, index: number): number {
  const close = source.indexOf('*/', index + 2)
  if (close === -1) throw new SyntaxError('Unclosed block comment in Rui builder source')
  return close + 2
}

function skipTemplate(source: string, index: number): number {
  let i = index + 1
  while (i < source.length) {
    if (source[i] === '\\') {
      i += 2
      continue
    }
    if (source[i] === '`') return i + 1
    if (source[i] === '$' && source[i + 1] === '{') {
      i = findMatching(source, i + 1, '{') + 1
      continue
    }
    i += 1
  }
  throw new SyntaxError('Unclosed template literal in Rui builder source')
}

function skipRegex(source: string, index: number): number {
  let i = index + 1
  let inClass = false
  while (i < source.length) {
    const char = source[i]
    if (char === '\\') {
      i += 2
      continue
    }
    if (char === '[') inClass = true
    if (char === ']') inClass = false
    if (char === '/' && !inClass) {
      i += 1
      while (/[A-Za-z]/.test(source[i] ?? '')) i += 1
      return i
    }
    if (char === '\n' || char === '\r') break
    i += 1
  }
  return index + 1
}

function previousSignificant(source: string, index: number): string | undefined {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (!/\s/.test(source[i])) return source[i]
  }
  return undefined
}

function regexCanStartAfter(source: string, index: number): boolean {
  const previous = previousSignificant(source, index)
  if (previous === undefined || '([{=,:;!?&|+-*%^~<>'.includes(previous)) return true
  let end = index
  while (end > 0 && /\s/.test(source[end - 1])) end -= 1
  let start = end
  while (start > 0 && isIdentifierPart(source[start - 1])) start -= 1
  return ['case', 'delete', 'do', 'else', 'in', 'instanceof', 'of', 'return', 'throw', 'typeof', 'void', 'yield']
    .includes(source.slice(start, end))
}

function skipTrivia(source: string, index: number): number {
  let i = index
  while (i < source.length && /\s/.test(source[i])) i += 1
  return i
}

function findMatching(source: string, openIndex: number, open: Delimiter): number {
  const close = closeFor[open]
  let depth = 0

  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i]
    const next = source[i + 1]
    if (char === "'" || char === '"') {
      i = skipQuoted(source, i, char) - 1
      continue
    }
    if (char === '`') {
      i = skipTemplate(source, i) - 1
      continue
    }
    if (char === '/' && next === '/') {
      i = skipLineComment(source, i) - 1
      continue
    }
    if (char === '/' && next === '*') {
      i = skipBlockComment(source, i) - 1
      continue
    }
    if (char === '/' && regexCanStartAfter(source, i)) {
      i = skipRegex(source, i) - 1
      continue
    }
    if (char === open) depth += 1
    if (char === close) {
      depth -= 1
      if (depth === 0) return i
    }
  }

  throw new SyntaxError(`Unclosed ${open} block in Rui builder source`)
}

function isLineBreakDelimiter(source: string, index: number): boolean {
  const previous = previousSignificant(source, index)
  const nextIndex = skipTrivia(source, index + 1)
  const next = source[nextIndex]
  if (previous === undefined || next === undefined) return true
  if (',([{.=:+-*/%!&|?<>'.includes(previous)) return false
  if ('.),]}:;'.includes(next)) return false
  return true
}

function protectTopLevelLineComment(source: string): string {
  let parens = 0
  let brackets = 0
  let braces = 0
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    const next = source[i + 1]
    if (char === "'" || char === '"') {
      i = skipQuoted(source, i, char) - 1
      continue
    }
    if (char === '`') {
      i = skipTemplate(source, i) - 1
      continue
    }
    if (char === '/' && next === '/' && parens === 0 && brackets === 0 && braces === 0) {
      if (!source.slice(0, i).trim()) return ''
      return `${source.slice(0, i)}/*${source.slice(i + 2)}*/`
    }
    if (char === '/' && next === '*') {
      i = skipBlockComment(source, i) - 1
      continue
    }
    if (char === '/' && regexCanStartAfter(source, i)) {
      i = skipRegex(source, i) - 1
      continue
    }
    if (char === '(') parens += 1
    else if (char === ')') parens -= 1
    else if (char === '[') brackets += 1
    else if (char === ']') brackets -= 1
    else if (char === '{') braces += 1
    else if (char === '}') braces -= 1
  }
  return source
}

function splitBuilderChildren(source: string): string[] {
  const parts: string[] = []
  let start = 0
  let parens = 0
  let brackets = 0
  let braces = 0
  let breakAfterLineComment = false

  const push = (end: number) => {
    const part = protectTopLevelLineComment(source.slice(start, end)).trim()
    if (part) parts.push(part)
    start = end + 1
  }

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    const next = source[i + 1]
    if (char === "'" || char === '"') {
      i = skipQuoted(source, i, char) - 1
      continue
    }
    if (char === '`') {
      i = skipTemplate(source, i) - 1
      continue
    }
    if (char === '/' && next === '/') {
      const end = skipLineComment(source, i)
      breakAfterLineComment = end < source.length && parens === 0 && brackets === 0 && braces === 0
      i = end - 1
      continue
    }
    if (char === '/' && next === '*') {
      i = skipBlockComment(source, i) - 1
      continue
    }
    if (char === '/' && regexCanStartAfter(source, i)) {
      i = skipRegex(source, i) - 1
      continue
    }
    if (char === '(') parens += 1
    else if (char === ')') parens -= 1
    else if (char === '[') brackets += 1
    else if (char === ']') brackets -= 1
    else if (char === '{') braces += 1
    else if (char === '}') braces -= 1

    if (parens === 0 && brackets === 0 && braces === 0) {
      if (char === ',' || char === ';' || (char === '\n' && (breakAfterLineComment || isLineBreakDelimiter(source, i)))) {
        push(i)
      }
      if (char === '\n') breakAfterLineComment = false
    }
  }

  const final = source.slice(start).trim()
  if (final) parts.push(final)
  return parts
}

function transformRange(source: string, components: Set<string>): string {
  let output = ''

  for (let i = 0; i < source.length;) {
    const char = source[i]
    const next = source[i + 1]
    if (char === "'" || char === '"') {
      const end = skipQuoted(source, i, char)
      output += source.slice(i, end)
      i = end
      continue
    }
    if (char === '`') {
      const end = skipTemplate(source, i)
      output += source.slice(i, end)
      i = end
      continue
    }
    if (char === '/' && next === '/') {
      const end = skipLineComment(source, i)
      output += source.slice(i, end)
      i = end
      continue
    }
    if (char === '/' && next === '*') {
      const end = skipBlockComment(source, i)
      output += source.slice(i, end)
      i = end
      continue
    }
    if (char === '/' && regexCanStartAfter(source, i)) {
      const end = skipRegex(source, i)
      output += source.slice(i, end)
      i = end
      continue
    }

    if (isIdentifierStart(char)) {
      const start = i
      i += 1
      while (isIdentifierPart(source[i])) i += 1
      const name = source.slice(start, i)
      const previous = source[start - 1]
      if (!components.has(name) || previous === '.' || isIdentifierPart(previous)) {
        output += source.slice(start, i)
        continue
      }

      const open = skipTrivia(source, i)
      if (source[open] !== '(') {
        output += source.slice(start, i)
        continue
      }
      const close = findMatching(source, open, '(')
      const blockOpen = skipTrivia(source, close + 1)
      if (source[blockOpen] !== '{') {
        output += source.slice(start, close + 1)
        i = close + 1
        continue
      }

      const blockClose = findMatching(source, blockOpen, '{')
      const args = transformRange(source.slice(open + 1, close), components).trim()
      const body = splitBuilderChildren(transformRange(source.slice(blockOpen + 1, blockClose), components))
      const callback = `() => [${body.join(', ')}]`
      output += `${name}(${args ? `${args}, ` : ''}${callback})`
      i = blockClose + 1
      continue
    }

    output += char
    i += 1
  }

  return output
}

export function transformRuiBuilderSyntax(
  source: string,
  componentNames: readonly string[] = DEFAULT_BUILDER_COMPONENTS,
): string {
  return transformRange(source, new Set(componentNames))
}
