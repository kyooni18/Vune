/**
 * Low-level transform for Muse's small struct/View surface.
 *
 * It intentionally handles the declarative subset rather than pretending that
 * a JavaScript parser can understand Swift syntax. For example:
 *
 *   struct Card<Content: View>: View {
 *     let content: Content
 *     init(@ViewBuilder content: () => Content) { self.content = content() }
 *     var body: some View { VStack() { content } }
 *   }
 *
 * becomes a normal `defineView` declaration. TypeScript/JS remains the host
 * language for expressions inside the initializer and body.
 */

import { transformMuseBuilderSyntax } from './builder-transform.js'

type Open = '(' | '{'

const closeFor: Record<Open, ')' | '}'> = { '(': ')', '{': '}' }

function skipQuoted(source: string, index: number, quote: "'" | '"'): number {
  for (let i = index + 1; i < source.length; i += 1) {
    if (source[i] === '\\') { i += 1; continue }
    if (source[i] === quote) return i + 1
  }
  throw new SyntaxError(`Unclosed ${quote} string in Muse struct source`)
}

function skipTemplate(source: string, index: number): number {
  for (let i = index + 1; i < source.length; i += 1) {
    if (source[i] === '\\') { i += 1; continue }
    if (source[i] === '`') return i + 1
  }
  throw new SyntaxError('Unclosed template literal in Muse struct source')
}

function findMatching(source: string, openIndex: number, open: Open): number {
  const close = closeFor[open]
  let depth = 0
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i]
    const next = source[i + 1]
    if (char === "'" || char === '"') { i = skipQuoted(source, i, char) - 1; continue }
    if (char === '`') { i = skipTemplate(source, i) - 1; continue }
    if (char === '/' && next === '/') {
      const newline = source.indexOf('\n', i + 2)
      i = (newline < 0 ? source.length : newline) - 1
      continue
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      if (end < 0) throw new SyntaxError('Unclosed block comment in Muse struct source')
      i = end + 1
      continue
    }
    if (char === open) depth += 1
    if (char === close && --depth === 0) return i
  }
  throw new SyntaxError(`Unclosed ${open} block in Muse struct source`)
}

function trivia(source: string, index: number): number {
  let i = index
  while (/\s/.test(source[i] ?? '')) i += 1
  return i
}

function identifierAt(source: string, index: number): { name: string; end: number } | null {
  const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(source.slice(index))
  return match ? { name: match[0], end: index + match[0].length } : null
}

function splitArguments(source: string): string[] {
  const values: string[] = []
  let start = 0
  let parens = 0
  let braces = 0
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    if (char === "'" || char === '"') { i = skipQuoted(source, i, char) - 1; continue }
    if (char === '`') { i = skipTemplate(source, i) - 1; continue }
    if (char === '(') parens += 1
    else if (char === ')') parens -= 1
    else if (char === '{') braces += 1
    else if (char === '}') braces -= 1
    else if (char === ',' && parens === 0 && braces === 0) {
      values.push(source.slice(start, i).trim())
      start = i + 1
    }
  }
  const last = source.slice(start).trim()
  if (last) values.push(last)
  return values
}

interface InitParameter {
  name: string
  kind: 'value' | 'viewBuilder' | 'action'
  label?: string
}

function parseParameter(source: string): InitParameter {
  const kind = source.includes('@ViewBuilder') ? 'viewBuilder' : source.includes('@Action') ? 'action' : 'value'
  const withoutAnnotation = source.replace(/@(?:ViewBuilder|Action)\s*/g, '').trim()
  const colon = withoutAnnotation.indexOf(':')
  const head = (colon < 0 ? withoutAnnotation : withoutAnnotation.slice(0, colon)).trim()
  const names = head.split(/\s+/).filter(Boolean)
  const name = names[names.length - 1]?.replace(/^_+/, '')
  if (!name) throw new SyntaxError(`Invalid initializer parameter: ${source}`)
  return { name, kind, label: names[0] === '_' ? undefined : names[0] }
}

function parameterMetadata(parameters: InitParameter[]): string {
  return `[${parameters.map(parameter => `{ kind: '${parameter.kind}', label: ${parameter.label ? `'${parameter.label}'` : 'undefined'}, required: true }`).join(', ')}]`
}

function initializerAccepts(parameters: InitParameter[]): string {
  const checks = parameters.map((parameter, index) => {
    if (parameter.kind === 'viewBuilder' || parameter.kind === 'action') return `typeof args[${index}] === 'function'`
    return 'true'
  })
  return `args.length === ${parameters.length}${checks.length ? ` && ${checks.join(' && ')}` : ''}`
}

function buildBody(parameters: InitParameter[], fields: string[], assignments: Map<string, string>, stateFields: Set<string>): string {
  const locals = parameters.map((parameter, index) => `const ${parameter.name} = args[${index}] as any`).join('; ')
  const values = fields.filter(field => !stateFields.has(field)).map(field => {
    const assignment = assignments.get(field)
    if (assignment) {
      const parameter = parameters.find(item => item.name === assignment.replace(/\(\)$/, '').trim())
      if (parameter?.kind === 'viewBuilder' && assignment === `${parameter.name}()`) {
        return `${field}: resolveBuilderClosure(${parameter.name})`
      }
      return `${field}: ${assignment}`
    }
    const parameter = parameters.find(item => item.name === field)
    if (parameter?.kind === 'viewBuilder') return `${field}: resolveBuilderClosure(${field})`
    return parameter ? `${field}: ${field}` : `${field}: undefined`
  })
  return `args => { ${locals}; return { ${values.join(', ')} } }`
}

function findAssignments(initBody: string): Map<string, string> {
  const assignments = new Map<string, string>()
  const expression = /self\.([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([\s\S]*?)(?=;|\n|$)/g
  for (const match of initBody.matchAll(expression)) assignments.set(match[1], match[2].trim())
  return assignments
}

function transformOne(name: string, body: string, bodyExpression: string): string {
  const fields = [...body.matchAll(/(?:^|\n)\s*(?:@(?:State|Binding)\s+)?(?:let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::[^\n;]+)?/g)]
    .map(match => match[1])
    .filter(field => field !== 'body')
  const stateValues = new Map([...body.matchAll(/@State\s+var\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:=[ \t]*([^\n;]+))?/g)]
    .map(match => [match[1], match[2]?.trim() ?? 'undefined'] as const))
  const stateFields = new Set(stateValues.keys())
  const initializers: string[] = []
  const assignments = new Map<string, string>()
  const initPattern = /\binit\s*(?=\()/g
  for (const match of body.matchAll(initPattern)) {
    const open = body.indexOf('(', match.index! + match[0].length - 1)
    const close = findMatching(body, open, '(')
    const blockOpen = trivia(body, close + 1)
    if (body[blockOpen] !== '{') continue
    const blockClose = findMatching(body, blockOpen, '{')
    const parameters = splitArguments(body.slice(open + 1, close)).map(parseParameter)
    const initializerBody = body.slice(blockOpen + 1, blockClose)
    for (const [field, value] of findAssignments(initializerBody)) assignments.set(field, value)
    const signature = `${name}(${parameters.map(parameter => `${parameter.kind === 'viewBuilder' ? '@ViewBuilder ' : parameter.kind === 'action' ? '@Action ' : ''}${parameter.label ?? parameter.name}`).join(', ')})`
    initializers.push(`initializer(${JSON.stringify(signature)}, args => ${initializerAccepts(parameters)}, ${buildBody(parameters, fields, assignments, stateFields)}, ${parameterMetadata(parameters)})`)
  }

  if (initializers.length === 0) {
    const parameters = fields.filter(field => !stateFields.has(field)).map(field => ({ name: field, kind: 'value' as const, label: field }))
    initializers.push(`initializer(${JSON.stringify(`${name}(${parameters.map(parameter => parameter.name).join(', ')})`)}, args => args.length === ${parameters.length}, ${buildBody(parameters, fields, assignments, stateFields)}, ${parameterMetadata(parameters)})`)
  }

  const destructure = fields.length > 0 ? `const { ${fields.join(', ')} } = props; ` : ''
  const sourceBody = bodyExpression.trim()
  const result = /^return\b([\s\S]*)/.exec(sourceBody)
  const bodyCode = result ? result[1].replace(/;\s*$/, '') : sourceBody
  const state = stateValues.size > 0
    ? `, state: (_props: any) => ({ ${[...stateValues.entries()].map(([field, value]) => `${field}: State(${value})`).join(', ')} })`
    : ''
  return `defineView(${JSON.stringify(name)}, { name: ${JSON.stringify(name)}, initializers: [${initializers.join(', ')}]${state}, body: (props: any) => { ${destructure} return ${bodyCode}; } })`
}

/** Transform `struct Name: View { ... }` declarations into defineView calls. */
export function transformMuseStructSyntax(source: string): string {
  let output = ''
  let cursor = 0
  let changed = false

  while (cursor < source.length) {
    const index = source.indexOf('struct', cursor)
    if (index < 0) { output += source.slice(cursor); break }
    const before = source[index - 1]
    const after = source[index + 6]
    if ((before && /[A-Za-z0-9_$]/.test(before)) || (after && /[A-Za-z0-9_$]/.test(after))) {
      output += source.slice(cursor, index + 6)
      cursor = index + 6
      continue
    }
    const nameStart = trivia(source, index + 6)
    const identifier = identifierAt(source, nameStart)
    if (!identifier) { output += source.slice(cursor, index + 6); cursor = index + 6; continue }
    let headerEnd = trivia(source, identifier.end)
    if (source[headerEnd] === '<') {
      const genericEnd = source.indexOf('>', headerEnd + 1)
      if (genericEnd < 0) throw new SyntaxError(`Unclosed generic parameter list for ${identifier.name}`)
      headerEnd = trivia(source, genericEnd + 1)
    }
    const brace = source.indexOf('{', headerEnd)
    if (brace < 0) throw new SyntaxError(`Missing body for struct ${identifier.name}`)
    const close = findMatching(source, brace, '{')
    const structBody = source.slice(brace + 1, close)
    const bodyMatch = /\bvar\s+body\s*:[^{]+\{/.exec(structBody)
    if (!bodyMatch) throw new SyntaxError(`struct ${identifier.name} must declare var body`)
    const bodyOpen = structBody.indexOf('{', bodyMatch.index! + bodyMatch[0].length - 1)
    const bodyClose = findMatching(structBody, bodyOpen, '{')
    const bodyExpression = structBody.slice(bodyOpen + 1, bodyClose)
    const transformedBody = transformOne(identifier.name, structBody, transformMuseBuilderSyntax(bodyExpression))
    let prefix = source.slice(cursor, index)
    const exported = /export\s*$/.test(prefix)
    if (exported) prefix = prefix.replace(/export\s*$/, '') + 'export '
    output += prefix + `const ${identifier.name} = ${transformedBody}`
    cursor = close + 1
    changed = true
  }

  if (!changed) return source
  const runtimeImports = stateValuesInSource(output)
    ? 'State, defineView, initializer, resolveBuilderClosure'
    : 'defineView, initializer, resolveBuilderClosure'
  return `import { ${runtimeImports} } from 'react-muse-ui'\n${output}`
}

function stateValuesInSource(source: string): boolean {
  return /\bstate:\s*\(/.test(source)
}
