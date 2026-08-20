import * as ts from 'typescript'

export interface RuiSourceMap {
  version: 3
  file?: string
  sources: string[]
  sourcesContent?: string[]
  names: string[]
  mappings: string
}

export interface RuiMacroPlugin {
  name: string
  enforce: 'pre'
  transform(code: string, id: string): { code: string; map: RuiSourceMap | null } | null
}

type Edit = { start: number; end: number; replacement: string }

interface StateDeclaration {
  name: string
  call: ts.CallExpression
  statement: ts.VariableStatement
}

function scriptKindFor(id: string): ts.ScriptKind {
  const pathname = id.split('?', 1)[0].toLowerCase()
  if (pathname.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (pathname.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (pathname.endsWith('.js') || pathname.endsWith('.mjs') || pathname.endsWith('.cjs')) {
    return ts.ScriptKind.JS
  }
  return ts.ScriptKind.TS
}

function isNamedCall(node: ts.Node, name: string): node is ts.CallExpression {
  return ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === name
}

function unwrapParentheses<T extends ts.Expression>(node: T): ts.Expression {
  let current: ts.Expression = node
  while (ts.isParenthesizedExpression(current)) current = current.expression
  return current
}

function isFunctionArgument(node: ts.Expression): boolean {
  const unwrapped = unwrapParentheses(node)
  return ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)
}

function collectTopLevelStates(sourceFile: ts.SourceFile, before: number): StateDeclaration[] {
  const states: StateDeclaration[] = []

  for (const statement of sourceFile.statements) {
    if (statement.getStart(sourceFile) >= before) break
    if (!ts.isVariableStatement(statement)) continue
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue
    if (statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue

    const candidates = statement.declarationList.declarations.filter(declaration =>
      ts.isIdentifier(declaration.name)
      && declaration.initializer
      && isNamedCall(declaration.initializer, 'State'),
    ) as Array<ts.VariableDeclaration & { name: ts.Identifier; initializer: ts.CallExpression }>

    // Do not partially remove a mixed declaration such as
    // `const count = State(0), label = 'Count'`.
    if (candidates.length !== statement.declarationList.declarations.length) continue
    for (const declaration of candidates) {
      states.push({ name: declaration.name.text, call: declaration.initializer, statement })
    }
  }

  return states
}

function findDefaultView(sourceFile: ts.SourceFile): ts.CallExpression | null {
  for (const statement of sourceFile.statements) {
    if (!ts.isExportAssignment(statement) || statement.isExportEquals) continue
    if (isNamedCall(statement.expression, 'view')) return statement.expression
  }
  return null
}

function collectActionEdits(sourceFile: ts.SourceFile, root: ts.Node): Edit[] {
  const edits: Edit[] = []

  function visit(node: ts.Node): void {
    if (isNamedCall(node, 'Action') && node.arguments.length === 1) {
      const argument = node.arguments[0]
      if (!isFunctionArgument(argument)) {
        edits.push({
          start: node.getStart(sourceFile),
          end: node.end,
          replacement: `(() => (${sourceFile.text.slice(argument.getStart(sourceFile), argument.end).trim()}))`,
        })
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(root)
  return edits
}

function applyEdits(source: string, edits: Edit[]): string {
  let output = source
  for (const edit of [...edits].sort((left, right) => right.start - left.start)) {
    output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end)
  }
  return output
}

function lineStarts(source: string): number[] {
  const starts = [0]
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') starts.push(index + 1)
  }
  return starts
}

function sourceLocation(source: string, offset: number): { line: number; column: number } {
  const starts = lineStarts(source)
  let low = 0
  let high = starts.length
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2)
    if (starts[middle] <= offset) low = middle
    else high = middle
  }
  return { line: low, column: Math.max(0, offset - starts[low]) }
}

const base64Digits = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function encodeVLQ(value: number): string {
  let encoded = value < 0 ? ((-value << 1) | 1) : value << 1
  let result = ''
  do {
    let digit = encoded & 31
    encoded >>>= 5
    if (encoded > 0) digit |= 32
    result += base64Digits[digit]
  } while (encoded > 0)
  return result
}

function buildSourceMap(source: string, anchors: number[], id: string): RuiSourceMap {
  let previousOriginalLine = 0
  let previousOriginalColumn = 0
  const mappings = anchors.map(anchor => {
    const location = sourceLocation(source, anchor)
    const segment = `${encodeVLQ(0)}${encodeVLQ(0)}${encodeVLQ(location.line - previousOriginalLine)}${encodeVLQ(location.column - previousOriginalColumn)}`
    previousOriginalLine = location.line
    previousOriginalColumn = location.column
    return segment
  }).join(';')

  return {
    version: 3,
    file: id.split('?', 1)[0] || undefined,
    sources: [id.split('?', 1)[0] || 'rui-macro.ts'],
    sourcesContent: [source],
    names: [],
    mappings,
  }
}

function applyEditsWithMap(source: string, edits: Edit[], id: string): { code: string; map: RuiSourceMap } {
  const sorted = [...edits].sort((left, right) => left.start - right.start)
  let cursor = 0
  let code = ''
  const anchors: number[] = []

  const append = (value: string, anchor: (index: number) => number) => {
    for (let index = 0; index < value.length; index += 1) {
      if (code.length === 0 || code.endsWith('\n')) anchors.push(anchor(index))
      code += value[index]
    }
  }

  append('/* @rui-macro-transformed */\n', () => 0)
  for (const edit of sorted) {
    if (edit.start < cursor) continue
    append(source.slice(cursor, edit.start), index => cursor + index)
    append(edit.replacement, () => edit.start)
    cursor = edit.end
  }
  append(source.slice(cursor), index => cursor + index)

  return { code, map: buildSourceMap(source, anchors, id) }
}

function viewArgumentText(sourceFile: ts.SourceFile, view: ts.CallExpression): string {
  const argument = view.arguments[0]
  if (!argument) return 'undefined'
  const argumentStart = argument.pos
  const edits = collectActionEdits(sourceFile, argument)
    .map(edit => ({ ...edit, start: edit.start - argumentStart, end: edit.end - argumentStart }))
  return applyEdits(sourceFile.text.slice(argumentStart, argument.end), edits).trim()
}

function viewArgumentIsFunction(view: ts.CallExpression): boolean {
  const argument = view.arguments[0]
  return !!argument && isFunctionArgument(argument)
}

function viewArgumentHasParameters(view: ts.CallExpression): boolean {
  const argument = view.arguments[0]
  if (!argument) return false
  const unwrapped = unwrapParentheses(argument)
  return (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) && unwrapped.parameters.length > 0
}

function transformRuiMacrosWithMap(source: string, id = ''): { code: string; map: RuiSourceMap } | null {
  if (source.includes('/* @rui-macro-transformed */')) return null
  if (id) {
    const pathname = id.split('?', 1)[0]
    if (!/\.[cm]?[jt]sx?$/.test(pathname)) return null
  }

  const sourceFile = ts.createSourceFile(
    id.split('?', 1)[0] || 'rui-macro.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(id),
  )
  const view = findDefaultView(sourceFile)
  if (!view) return null

  const states = collectTopLevelStates(sourceFile, view.getStart(sourceFile))
  const body = viewArgumentText(sourceFile, view)
  const functionBody = viewArgumentIsFunction(view)

  let replacement: string
  if (states.length > 0) {
    const declarations = states
      .map(state => `    const ${state.name} = ${sourceFile.text.slice(state.call.getStart(sourceFile), state.call.end)}`)
      .join('\n')
    const names = states.map(state => state.name).join(', ')
    const hasProps = viewArgumentHasParameters(view)
    const bodyParameters = hasProps ? `({ ${names} }, props)` : `({ ${names} })`
    const renderedBody = functionBody
      ? `((${body})(${hasProps ? 'props' : ''}))`
      : `(${body})`
    replacement = `view({\n  state: () => {\n${declarations}\n    return { ${names} }\n  },\n  body: ${bodyParameters} => ${renderedBody},\n})`
  } else {
    replacement = functionBody ? `view(${body})` : `view(() => (${body}))`
  }

  const edits: Edit[] = []
  const statements = new Set(states.map(state => state.statement))
  for (const statement of statements) {
    edits.push({ start: statement.getStart(sourceFile), end: statement.end, replacement: '' })
  }
  edits.push({ start: view.getStart(sourceFile), end: view.end, replacement })

  return applyEditsWithMap(source, edits, id)
}

export function ruiMacro(): RuiMacroPlugin {
  return {
    name: 'rui-macro',
    enforce: 'pre',
    transform(code, id) {
      return transformRuiMacrosWithMap(code, id)
    },
  }
}

/**
 * Transform helper kept as a string API for callers that do not need Vite's
 * source-map object. The Vite plugin uses the richer internal result above.
 */
export function transformRuiMacros(source: string, id = ''): string | null {
  return transformRuiMacrosWithMap(source, id)?.code ?? null
}
