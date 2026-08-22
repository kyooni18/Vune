import * as ts from "typescript"
import {
  parseMuseBuilder,
  parseMuseStructs,
  type MuseBuilderNode,
  type MuseBuilderProgram,
  type MuseStructDeclaration,
  type MuseSourceRange,
} from "./ast.js"
import { createMuseSourceMap, mapGeneratedPosition, type MuseSourcePosition } from "./source-map.js"

export interface MuseSemanticInitializer {
  readonly signature: string
  readonly parametersSource: string
  readonly range: MuseSourceRange
}

export interface MuseSemanticField {
  readonly name: string
  readonly kind: MuseStructDeclaration["fields"][number]["kind"]
  readonly type?: string
  readonly initializer?: string
  readonly range: MuseSourceRange
}

export interface MuseSemanticView {
  readonly name: string
  readonly qualifiedName: string
  readonly genericParameters?: string
  readonly fields: readonly MuseSemanticField[]
  readonly initializers: readonly MuseSemanticInitializer[]
  readonly bodyRange: MuseSourceRange
  readonly range: MuseSourceRange
}

export interface MuseSemanticCall {
  readonly callee: string
  readonly arguments: readonly {
    readonly label?: string
    readonly kind: "expression" | "closure"
    readonly range: MuseSourceRange
  }[]
  readonly trailingClosure: boolean
  readonly range: MuseSourceRange
}

export interface MuseSemanticImport {
  readonly module: string
  readonly range: MuseSourceRange
}

export interface MuseSemanticHtmlElement {
  readonly tag: string
  readonly attributes: readonly string[]
  /** Range mapped back to the original Muse source. */
  readonly range: MuseSourceRange
  /** Range in the lowered TypeScript snapshot. */
  readonly generatedRange: MuseSourceRange
}

export interface MuseSemanticForeignComponent {
  readonly localName: string
  readonly module: string
  /** Range mapped back to the original Muse source. */
  readonly range: MuseSourceRange
  readonly generatedRange: MuseSourceRange
}

/**
 * Shared compiler/editor view of a Muse file.
 *
 * Muse-only declarations and builder blocks stay in the Muse AST. Normal
 * imports, expressions, types, and diagnostics are represented by the
 * TypeScript SourceFile produced from the lowered snapshot.
 */
export interface MuseSemanticModel {
  readonly kind: "MuseSemanticModel"
  readonly fileName: string
  readonly source: string
  readonly generatedSource: string
  readonly typescript: ts.SourceFile
  readonly typescriptDiagnostics: readonly ts.Diagnostic[]
  readonly structs: readonly MuseStructDeclaration[]
  readonly views: readonly MuseSemanticView[]
  readonly builderPrograms: readonly MuseBuilderProgram[]
  readonly calls: readonly MuseSemanticCall[]
  readonly imports: readonly MuseSemanticImport[]
  readonly htmlElements: readonly MuseSemanticHtmlElement[]
  readonly foreignComponents: readonly MuseSemanticForeignComponent[]
  view(name: string): MuseSemanticView | undefined
}

function flattenStructs(structs: readonly MuseStructDeclaration[], prefix = ""): MuseSemanticView[] {
  const result: MuseSemanticView[] = []
  for (const declaration of structs) {
    const qualifiedName = prefix ? `${prefix}.${declaration.name}` : declaration.name
    result.push({
      name: declaration.name,
      qualifiedName,
      genericParameters: declaration.genericParameters,
      fields: declaration.fields.map(field => ({
        name: field.name,
        kind: field.kind,
        type: field.type,
        initializer: field.initializer,
        range: field.range,
      })),
      initializers: declaration.initializers.map(initializer => ({
        signature: `${declaration.name}(${initializer.parametersSource.trim()})`,
        parametersSource: initializer.parametersSource,
        range: initializer.range,
      })),
      bodyRange: declaration.bodyExpressionRange,
      range: declaration.range,
    })
    result.push(...flattenStructs(declaration.nested ?? [], qualifiedName))
  }
  return result
}

function collectCalls(program: MuseBuilderProgram, output: MuseSemanticCall[]): void {
  const visit = (node: MuseBuilderNode): void => {
    if (node.kind === "call") {
      output.push({
        callee: node.callee,
        arguments: node.arguments.map(argument => ({
          label: argument.label,
          kind: argument.value.kind === "closure" ? "closure" as const : "expression" as const,
          range: argument.range,
        })),
        trailingClosure: node.trailing !== undefined,
        range: node.range,
      })
      for (const argument of node.arguments) {
        if (argument.value.kind === "closure") collectCalls(argument.value.body, output)
      }
      if (node.trailing) collectCalls(node.trailing.body, output)
      return
    }
    if (node.kind === "conditional") {
      for (const child of node.then.statements) visit(child)
      if (node.otherwise) {
        if (node.otherwise.kind === "conditional") visit(node.otherwise)
        else for (const child of node.otherwise.statements) visit(child)
      }
    }
  }
  for (const node of program.statements) visit(node)
}

function builderProgramsFor(source: string, structs: readonly MuseStructDeclaration[]): MuseBuilderProgram[] {
  const programs: MuseBuilderProgram[] = []
  const seen = new Set<string>()
  const add = (value: MuseBuilderProgram): void => {
    const key = `${value.range.start}:${value.range.end}`
    if (seen.has(key)) return
    seen.add(key)
    programs.push(value)
  }
  const visit = (declarations: readonly MuseStructDeclaration[]): void => {
    for (const declaration of declarations) {
      add(parseMuseBuilder(declaration.bodyExpressionSource, declaration.bodyExpressionRange.start))
      visit(declaration.nested ?? [])
    }
  }
  visit(structs)
  if (programs.length === 0 && /\b[A-Z][A-Za-z0-9_$]*\s*\(/.test(source)) add(parseMuseBuilder(source))
  return programs
}

function importsOf(source: string, generatedSource: string, sourceFile: ts.SourceFile, sourceMap: ReturnType<typeof createMuseSourceMap>): MuseSemanticImport[] {
  return sourceFile.statements.flatMap(statement => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return []
    const generatedRange = { start: statement.getStart(sourceFile), end: statement.end }
    return [{
      module: statement.moduleSpecifier.text,
      range: mapRange(source, generatedSource, sourceMap, generatedRange),
    }]
  })
}

function propertyName(property: ts.PropertyName | undefined): string | undefined {
  if (!property) return undefined
  if (ts.isIdentifier(property) || ts.isStringLiteral(property) || ts.isNumericLiteral(property)) return property.text
  return undefined
}

function positionAt(source: string, offset: number): MuseSourcePosition {
  const bounded = Math.max(0, Math.min(source.length, offset))
  const prefix = source.slice(0, bounded)
  const line = prefix.split("\n")
  return { line: line.length, column: (line[line.length - 1]?.length ?? 0) + 1 }
}

function offsetAt(source: string, position: MuseSourcePosition): number {
  const lines = source.split("\n")
  const line = Math.max(1, Math.min(lines.length, position.line))
  const offset = lines.slice(0, line - 1).reduce((sum, value) => sum + value.length + 1, 0)
  return Math.min(source.length, offset + Math.max(0, position.column - 1))
}

function mapRange(source: string, generatedSource: string, map: ReturnType<typeof createMuseSourceMap>, generatedRange: MuseSourceRange): MuseSourceRange {
  const start = mapGeneratedPosition(map, positionAt(generatedSource, generatedRange.start))
  const end = mapGeneratedPosition(map, positionAt(generatedSource, generatedRange.end))
  return { start: offsetAt(source, start), end: Math.max(offsetAt(source, start), offsetAt(source, end)) }
}

function matchingDelimiter(source: string, open: number, opener: string, closer: string): number {
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "\"" || source[index] === "'" || source[index] === "`") {
      const quote = source[index]
      index += 1
      while (index < source.length) {
        if (source[index] === "\\") { index += 2; continue }
        if (source[index] === quote) break
        index += 1
      }
      continue
    }
    if (source[index] === opener) depth += 1
    else if (source[index] === closer && --depth === 0) return index
  }
  return source.length - 1
}

function originalElementRange(source: string, tag: string, from: number): { readonly range: MuseSourceRange; readonly next: number } | undefined {
  const rawStart = source.indexOf("<" + tag, from)
  const rawBoundary = rawStart < 0 ? undefined : source[rawStart + tag.length + 1]
  const validRawStart = rawStart >= 0 && rawBoundary !== undefined && (rawBoundary === " " || rawBoundary === "\t" || rawBoundary === "/" || rawBoundary === ">") ? rawStart : -1
  const callStart = source.indexOf("Element(", from)
  if (validRawStart >= 0 && (callStart < 0 || validRawStart < callStart)) {
    const openingEnd = source.indexOf(">", validRawStart)
    if (openingEnd < 0) return { range: { start: validRawStart, end: source.length }, next: source.length }
    const closingStart = source.indexOf("</" + tag, openingEnd + 1)
    const closingEnd = closingStart >= 0 ? source.indexOf(">", closingStart) : -1
    const end = closingEnd >= 0 ? closingEnd + 1 : openingEnd + 1
    return { range: { start: validRawStart, end: Math.max(openingEnd + 1, end) }, next: Math.max(openingEnd + 1, end) }
  }
  if (callStart >= 0) {
    const close = matchingDelimiter(source, callStart + "Element".length, "(", ")")
    return { range: { start: callStart, end: Math.min(source.length, close + 1) }, next: Math.min(source.length, close + 1) }
  }
  return undefined
}

function typescriptGraphSymbols(
  source: string,
  generatedSource: string,
  sourceFile: ts.SourceFile,
  sourceMap: ReturnType<typeof createMuseSourceMap>,
): {
  readonly htmlElements: MuseSemanticHtmlElement[]
  readonly foreignComponents: MuseSemanticForeignComponent[]
} {
  const htmlElements: MuseSemanticHtmlElement[] = []
  const foreignComponents: MuseSemanticForeignComponent[] = []
  const vueImports = new Map<string, string>()
  let elementCursor = 0
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const module = statement.moduleSpecifier.text
    if (!/\.vue$/i.test(module) || !statement.importClause?.name) continue
    vueImports.set(statement.importClause.name.text, module)
  }

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
      const expression = node.initializer.expression
      const argument = node.initializer.arguments[0]
      if (ts.isIdentifier(expression) && /^(?:__museForeignComponent|__museVueComponent)/.test(expression.text) && ts.isIdentifier(argument)) {
        const module = vueImports.get(argument.text)
        if (module) {
          const generatedRange = { start: node.getStart(sourceFile), end: node.end }
          foreignComponents.push({
            localName: node.name.text,
            module,
            range: mapRange(source, generatedSource, sourceMap, generatedRange),
            generatedRange,
          })
        }
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Element") {
      const tag = node.arguments[0]
      if (tag && ts.isStringLiteral(tag)) {
        const props = node.arguments[1]
        const attributes = props && ts.isObjectLiteralExpression(props)
          ? props.properties.flatMap(property => {
              if (ts.isSpreadAssignment(property)) return ["..."]
              return propertyName(ts.isPropertyAssignment(property) ? property.name : undefined) ?? []
            })
          : []
        const generatedRange = { start: node.getStart(sourceFile), end: node.end }
        const original = originalElementRange(source, tag.text, elementCursor)
        htmlElements.push({
          tag: tag.text,
          attributes,
          range: original?.range ?? mapRange(source, generatedSource, sourceMap, generatedRange),
          generatedRange,
        })
        if (original) elementCursor = original.next
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return { htmlElements, foreignComponents }
}

export function createSemanticModel(source: string, fileName: string, generatedSource: string): MuseSemanticModel {
  const scriptKind = /\.(?:tsx|jsx)$/i.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const typescript = ts.createSourceFile(fileName, generatedSource, ts.ScriptTarget.Latest, true, scriptKind)
  const structs = parseMuseStructs(source)
  const builderPrograms = builderProgramsFor(source, structs)
  const calls: MuseSemanticCall[] = []
  for (const program of builderPrograms) collectCalls(program, calls)
  const views = flattenStructs(structs)
  const sourceMap = createMuseSourceMap(source, generatedSource, fileName)
  const graphSymbols = typescriptGraphSymbols(source, generatedSource, typescript, sourceMap)
  return {
    kind: "MuseSemanticModel",
    fileName,
    source,
    generatedSource,
    typescript,
    typescriptDiagnostics: (typescript as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [],
    structs,
    views,
    builderPrograms,
    calls,
    imports: importsOf(source, generatedSource, typescript, sourceMap),
    htmlElements: graphSymbols.htmlElements,
    foreignComponents: graphSymbols.foreignComponents,
    view(name) {
      return views.find(view => view.name === name || view.qualifiedName === name)
    },
  }
}
