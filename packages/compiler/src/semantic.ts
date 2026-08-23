import * as ts from "typescript"
import * as Core from "@vune-ui/core"
import {
  SemanticModel,
  resolveSemanticCall,
  semanticHtmlAttributeSpec,
  semanticHtmlTagSpec,
  type SemanticBuilderTypeSymbol,
  type SemanticForeignComponentTypeSymbol,
  type SemanticHtmlAttributeSymbol,
  type SemanticHtmlElementSymbol,
  type SemanticInitializerParameter,
  type SemanticInitializerSymbol,
  type SemanticArgument,
  type SemanticCallResolution,
  type SemanticStateSymbol,
  type SemanticSymbol,
  type SemanticViewTypeSymbol,
} from "@vune-ui/core"
import {
  parseVuneBuilder,
  parseVuneStructs,
  type VuneBuilderNode,
  type VuneBuilderProgram,
  type VuneStructDeclaration,
  type VuneSourceRange,
} from "./ast.js"
import { createVuneSourceMap, mapGeneratedPosition, type VuneSourcePosition } from "./source-map.js"

export interface VuneSemanticInitializer {
  readonly index: number
  readonly signature: string
  readonly parametersSource: string
  readonly parameters: readonly SemanticInitializerParameter[]
  readonly symbol: SemanticInitializerSymbol
  readonly range: VuneSourceRange
}

export interface VuneSemanticField {
  readonly name: string
  readonly kind: VuneStructDeclaration["fields"][number]["kind"]
  readonly type?: string
  readonly initializer?: string
  readonly range: VuneSourceRange
}

export interface VuneSemanticView {
  readonly name: string
  readonly qualifiedName: string
  readonly genericParameters?: string
  readonly fields: readonly VuneSemanticField[]
  readonly initializers: readonly VuneSemanticInitializer[]
  readonly symbol: SemanticViewTypeSymbol
  readonly bodyRange: VuneSourceRange
  readonly range: VuneSourceRange
}

export interface VuneSemanticCall {
  readonly callee: string
  readonly arguments: readonly {
    readonly label?: string
    readonly kind: "expression" | "closure"
    readonly source: string
    readonly range: VuneSourceRange
  }[]
  readonly trailingClosure: boolean
  readonly range: VuneSourceRange
  /** The shared semantic answer consumed by compiler and IDE clients. */
  readonly resolution: SemanticCallResolution
}

export interface VuneSemanticImport {
  readonly module: string
  readonly range: VuneSourceRange
}

export interface VuneSemanticHtmlElement {
  readonly tag: string
  readonly attributes: readonly string[]
  readonly attributeSymbols: readonly SemanticHtmlAttributeSymbol[]
  readonly symbol: SemanticHtmlElementSymbol
  /** Range mapped back to the original Vune source. */
  readonly range: VuneSourceRange
  /** Range in the lowered TypeScript snapshot. */
  readonly generatedRange: VuneSourceRange
}

export interface VuneSemanticHtmlDiagnostic {
  readonly code: "VUNE_HTML_ATTRIBUTE" | "VUNE_HTML_VALUE"
  readonly message: string
  readonly range: VuneSourceRange
  readonly generatedRange: VuneSourceRange
}

export interface VuneSemanticForeignComponent {
  readonly localName: string
  readonly module: string
  /** Range mapped back to the original Vune source. */
  readonly range: VuneSourceRange
  readonly generatedRange: VuneSourceRange
  readonly symbol: SemanticForeignComponentTypeSymbol
}

/**
 * Shared compiler/editor view of a Vune file.
 *
 * Vune-only declarations and builder blocks stay in the Vune AST. Normal
 * imports, expressions, types, and diagnostics are represented by the
 * TypeScript SourceFile produced from the lowered snapshot.
 */
export interface VuneSemanticModel {
  readonly kind: "VuneSemanticModel"
  readonly fileName: string
  readonly source: string
  readonly generatedSource: string
  readonly typescript: ts.SourceFile
  readonly typeChecker: ts.TypeChecker
  readonly typescriptDiagnostics: readonly ts.Diagnostic[]
  readonly htmlDiagnostics: readonly VuneSemanticHtmlDiagnostic[]
  readonly structs: readonly VuneStructDeclaration[]
  readonly views: readonly VuneSemanticView[]
  readonly builderPrograms: readonly VuneBuilderProgram[]
  readonly calls: readonly VuneSemanticCall[]
  readonly imports: readonly VuneSemanticImport[]
  readonly htmlElements: readonly VuneSemanticHtmlElement[]
  readonly foreignComponents: readonly VuneSemanticForeignComponent[]
  /** Canonical symbol table shared with runtime ViewType metadata. */
  readonly symbolTable: SemanticModel
  readonly symbols: readonly SemanticSymbol[]
  view(name: string): VuneSemanticView | undefined
  symbol(name: string): SemanticSymbol | undefined
}

function splitParameterSource(source: string): readonly string[] {
  const parts: string[] = []
  let start = 0
  let angle = 0
  let square = 0
  let parens = 0
  let braces = 0
  let quote: string | undefined
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (quote) {
      if (character === "\\") { index += 1; continue }
      if (character === quote) quote = undefined
      continue
    }
    if (character === "\"" || character === "'" || character === "`") { quote = character; continue }
    if (character === "<") angle += 1
    else if (character === ">") angle = Math.max(0, angle - 1)
    else if (character === "[") square += 1
    else if (character === "]") square = Math.max(0, square - 1)
    else if (character === "(") parens += 1
    else if (character === ")") parens = Math.max(0, parens - 1)
    else if (character === "{") braces += 1
    else if (character === "}") braces = Math.max(0, braces - 1)
    else if (character === "," && angle === 0 && square === 0 && parens === 0 && braces === 0) {
      parts.push(source.slice(start, index).trim())
      start = index + 1
    }
  }
  parts.push(source.slice(start).trim())
  return parts.filter(Boolean)
}

function topLevelCharacter(source: string, expected: string): number {
  let angle = 0
  let square = 0
  let parens = 0
  let braces = 0
  let quote: string | undefined
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (quote) {
      if (character === "\\") { index += 1; continue }
      if (character === quote) quote = undefined
      continue
    }
    if (character === "\"" || character === "'" || character === "`") { quote = character; continue }
    if (character === "<") angle += 1
    else if (character === ">") angle = Math.max(0, angle - 1)
    else if (character === "[") square += 1
    else if (character === "]") square = Math.max(0, square - 1)
    else if (character === "(") parens += 1
    else if (character === ")") parens = Math.max(0, parens - 1)
    else if (character === "{") braces += 1
    else if (character === "}") braces = Math.max(0, braces - 1)
    else if (character === expected && angle === 0 && square === 0 && parens === 0 && braces === 0) return index
  }
  return -1
}

function semanticInitializerParameters(source: string): readonly SemanticInitializerParameter[] {
  const parsed = splitParameterSource(source).map(parameterSource => {
    const kind = parameterSource.includes("@ViewBuilder")
      ? "viewBuilder" as const
      : parameterSource.includes("@Action")
        ? "action" as const
        : parameterSource.includes("@Binding")
          ? "binding" as const
          : "value" as const
    const clean = parameterSource.replace(/@(?:ViewBuilder|Action|Binding)\s*/g, "").trim()
    const equals = topLevelCharacter(clean, "=")
    const declaration = equals < 0 ? clean : clean.slice(0, equals).trim()
    const defaultValue = equals < 0 ? undefined : clean.slice(equals + 1).trim()
    const colon = topLevelCharacter(declaration, ":")
    const head = (colon < 0 ? declaration : declaration.slice(0, colon)).trim()
    const words = head.split(/\s+/).filter(Boolean)
    const name = (words.at(-1) ?? "value").replace(/^_+/, "")
    return {
      name,
      label: words[0] === "_" ? undefined : words[0],
      kind,
      required: defaultValue === undefined,
      type: colon < 0 ? undefined : declaration.slice(colon + 1).trim(),
    }
  })
  return parsed.map((parameter, index) => {
    const trailing = index === parsed.length - 1 && (parameter.kind === "viewBuilder" || parameter.kind === "action")
    return {
      ...parameter,
      trailing,
      labelRequired: parameter.label !== undefined && !trailing,
    }
  })
}

function flattenStructs(structs: readonly VuneStructDeclaration[], prefix = ""): VuneSemanticView[] {
  const result: VuneSemanticView[] = []
  for (const declaration of structs) {
    const qualifiedName = prefix ? `${prefix}.${declaration.name}` : declaration.name
    const initializers = declaration.initializers.map((initializer, index) => {
      const parameters = semanticInitializerParameters(initializer.parametersSource)
      const symbol: SemanticInitializerSymbol = {
        kind: "initializer",
        index,
        signature: `${declaration.name}(${initializer.parametersSource.trim()})`,
        parameters,
      }
      return {
        index,
        signature: symbol.signature,
        parametersSource: initializer.parametersSource,
        parameters,
        symbol,
        range: initializer.range,
      }
    })
    const fields = declaration.fields.map(field => ({
      name: field.name,
      kind: field.kind,
      type: field.type,
      initializer: field.initializer,
      range: field.range,
    }))
    const symbol: SemanticViewTypeSymbol = {
      kind: "view",
      name: declaration.name,
      qualifiedName,
      genericParameters: declaration.genericParameters,
      fields: fields.map(field => ({ name: field.name, kind: field.kind, type: field.type, defaultValue: field.initializer })),
      initializers: initializers.map(initializer => initializer.symbol),
    }
    result.push({
      name: declaration.name,
      qualifiedName,
      genericParameters: declaration.genericParameters,
      fields,
      initializers,
      symbol,
      bodyRange: declaration.bodyExpressionRange,
      range: declaration.range,
    })
    result.push(...flattenStructs(declaration.nested ?? [], qualifiedName))
  }
  return result
}

function collectCalls(program: VuneBuilderProgram, output: VuneSemanticCall[]): void {
  const visit = (node: VuneBuilderNode): void => {
    if (node.kind === "call") {
      output.push({
        callee: node.callee,
        arguments: node.arguments.map(argument => ({
          label: argument.label,
          kind: argument.value.kind === "closure" ? "closure" as const : "expression" as const,
          source: argument.value.kind === "closure" ? "" : argument.value.source,
          range: argument.range,
        })),
        trailingClosure: node.trailing !== undefined,
        range: node.range,
        resolution: resolveSemanticCall(undefined, []),
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

function canonicalViewSymbols(): Map<string, SemanticViewTypeSymbol> {
  const result = new Map<string, SemanticViewTypeSymbol>()
  for (const [name, value] of Object.entries(Core)) {
    if (typeof value !== "function") continue
    const symbol = (value as { readonly viewType?: { readonly semanticSymbol?: SemanticViewTypeSymbol } }).viewType?.semanticSymbol
    if (symbol) result.set(name, symbol)
  }
  return result
}

function checkerTypeForExpression(source: string, checker: ts.TypeChecker, sourceFile: ts.SourceFile): string | undefined {
  const wanted = source.trim()
  if (!wanted) return undefined
  let candidate: ts.Expression | undefined
  const visit = (node: ts.Node): void => {
    if (candidate || !ts.isExpression(node)) {
      if (!candidate) ts.forEachChild(node, visit)
      return
    }
    if (node.getText(sourceFile).trim() === wanted) candidate = node
    if (!candidate) ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  if (!candidate) return undefined
  const type = checker.getTypeAtLocation(candidate)
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) return undefined
  // `const label = "x"` has the literal type `"x"`, but a normal Vune
  // initializer accepting `string` must still accept it. Preserve literal
  // precision in TypeScript itself while normalizing the compiler-facing
  // semantic category used for overload matching.
  const primitiveCategory = (value: ts.Type): "string" | "number" | "boolean" | undefined => {
    if (value.flags & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral)) return "string"
    if (value.flags & (ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral)) return "number"
    if (value.flags & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) return "boolean"
    if (value.isUnion()) {
      const categories = new Set(value.types.map(primitiveCategory))
      if (categories.size === 1 && !categories.has(undefined)) return [...categories][0]
    }
    return undefined
  }
  return primitiveCategory(type) ?? checker.typeToString(type)
}

function compilerSemanticArgument(
  source: string,
  label: string | undefined,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  declaredTypes: ReadonlyMap<string, string> = new Map(),
): SemanticArgument {
  const value = source.trim()
  if (/^(?:\$[A-Za-z_$][A-Za-z0-9_$]*|Binding\s*\()/.test(value)) return { label, kind: "binding", type: "binding" }
  if (/^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)$/.test(value)) {
    const literalFile = ts.createSourceFile("literal.ts", `(${value})`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const statement = literalFile.statements[0]
    const expression = statement && ts.isExpressionStatement(statement) ? statement.expression : undefined
    const unwrapped = expression && ts.isParenthesizedExpression(expression) ? expression.expression : expression
    return unwrapped && ts.isStringLiteralLike(unwrapped)
      ? { label, type: "string", value: unwrapped.text }
      : { label, type: "string" }
  }
  if (/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return { label, type: "number" }
  if (/^(?:true|false)$/.test(value)) return { label, type: "boolean" }
  if (/^null$/.test(value)) return { label, type: "null" }
  if (/^undefined$/.test(value)) return { label, type: "undefined" }
  if (/^(?:\[|Array\s*\()/.test(value)) return { label, type: "array" }
  if (/=>|^function\b/.test(value)) return { label, type: "function" }
  const declared = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) ? declaredTypes.get(value) : undefined
  return { label, type: checkerTypeForExpression(value, checker, sourceFile) ?? declared ?? "unknown" }
}

function resolvedCalls(
  calls: readonly VuneSemanticCall[],
  views: readonly VuneSemanticView[],
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): VuneSemanticCall[] {
  const symbols = canonicalViewSymbols()
  for (const view of views) symbols.set(view.name, view.symbol)
  const declaredTypes = new Map<string, string>()
  for (const view of views) for (const field of view.fields) if (field.type) declaredTypes.set(field.name, field.type)
  return calls.map(call => {
    const arguments_: SemanticArgument[] = call.arguments.map((argument, argumentIndex) => argument.kind === "closure"
      ? { label: argument.label, type: "function" }
      : call.callee === "ForEach" && argumentIndex === 1 && /^\{\s*(?:id|key)\s*:/.test(argument.source) && /=>/.test(argument.source)
        ? { label: "key", type: "function" }
        : compilerSemanticArgument(argument.source, argument.label, checker, sourceFile, declaredTypes))
    if (call.trailingClosure) arguments_.push({ type: "function", trailing: true })
    return {
      ...call,
      resolution: resolveSemanticCall(symbols.get(call.callee), arguments_),
    }
  })
}

function builderProgramsFor(source: string, structs: readonly VuneStructDeclaration[]): VuneBuilderProgram[] {
  const programs: VuneBuilderProgram[] = []
  const seen = new Set<string>()
  const add = (value: VuneBuilderProgram): void => {
    const key = `${value.range.start}:${value.range.end}`
    if (seen.has(key)) return
    seen.add(key)
    programs.push(value)
  }
  const visit = (declarations: readonly VuneStructDeclaration[]): void => {
    for (const declaration of declarations) {
      add(parseVuneBuilder(declaration.bodyExpressionSource, declaration.bodyExpressionRange.start))
      visit(declaration.nested ?? [])
    }
  }
  if (structs.length > 0) {
    // Struct bodies are indexed separately above. Mask declarations while
    // preserving offsets so top-level builder calls are not lost when a file
    // also contains custom Views.
    let masked = source
    for (const declaration of [...structs].sort((left, right) => right.range.start - left.range.start)) {
      masked = masked.slice(0, declaration.range.start) + " ".repeat(declaration.range.end - declaration.range.start) + masked.slice(declaration.range.end)
    }
    add(parseVuneBuilder(masked))
  }
  visit(structs)
  if (programs.length === 0 && /\b[A-Z][A-Za-z0-9_$]*\s*\(/.test(source)) add(parseVuneBuilder(source))
  return programs
}

function importsOf(source: string, generatedSource: string, sourceFile: ts.SourceFile, sourceMap: ReturnType<typeof createVuneSourceMap>): VuneSemanticImport[] {
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

function objectPropertyName(property: ts.ObjectLiteralElementLike): string | undefined {
  if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property) || ts.isMethodDeclaration(property)) {
    return propertyName(property.name)
  }
  return undefined
}

function expressionValueType(expression: ts.Expression, checker: ts.TypeChecker): string | undefined {
  if (ts.isStringLiteralLike(expression)) return "string"
  if (ts.isNumericLiteral(expression)) return "number"
  if (expression.kind === ts.SyntaxKind.TrueKeyword || expression.kind === ts.SyntaxKind.FalseKeyword) return "boolean"
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return "event"
  const type = checker.getTypeAtLocation(expression)
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) return undefined
  if (type.flags & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral)) return "string"
  if (type.flags & (ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral)) return "number"
  if (type.flags & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) return "boolean"
  if (type.getCallSignatures().length > 0) return "event"
  return undefined
}

function acceptsHtmlValue(
  spec: ReturnType<typeof semanticHtmlAttributeSpec>,
  valueType: string | undefined,
  expression: ts.Expression | undefined,
): boolean {
  if (!spec || !valueType || spec.type === "unknown") return true
  if (spec.type === "event") return valueType === "event"
  if (spec.type === "string | number") return valueType === "string" || valueType === "number"
  if (spec.type === "string | number | boolean") return ["string", "number", "boolean"].includes(valueType)
  if (spec.values && expression && ts.isStringLiteralLike(expression)) return spec.values.includes(expression.text)
  if (spec.type === valueType) return true
  return false
}

function positionAt(source: string, offset: number): VuneSourcePosition {
  const bounded = Math.max(0, Math.min(source.length, offset))
  const prefix = source.slice(0, bounded)
  const line = prefix.split("\n")
  return { line: line.length, column: (line[line.length - 1]?.length ?? 0) + 1 }
}

function offsetAt(source: string, position: VuneSourcePosition): number {
  const lines = source.split("\n")
  const line = Math.max(1, Math.min(lines.length, position.line))
  const offset = lines.slice(0, line - 1).reduce((sum, value) => sum + value.length + 1, 0)
  return Math.min(source.length, offset + Math.max(0, position.column - 1))
}

function mapRange(source: string, generatedSource: string, map: ReturnType<typeof createVuneSourceMap>, generatedRange: VuneSourceRange): VuneSourceRange {
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

function originalCallRange(source: string, name: string): VuneSourceRange | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const expression = new RegExp(`\\b${escaped}\\s*\\(`, "g")
  const match = expression.exec(source)
  if (!match) return undefined
  const open = source.indexOf("(", match.index + name.length)
  if (open < 0) return undefined
  const close = matchingDelimiter(source, open, "(", ")")
  return { start: match.index, end: Math.min(source.length, close + 1) }
}

function originalElementRange(source: string, tag: string, from: number): { readonly range: VuneSourceRange; readonly next: number } | undefined {
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
  checker: ts.TypeChecker,
  sourceMap: ReturnType<typeof createVuneSourceMap>,
): {
  readonly htmlElements: VuneSemanticHtmlElement[]
  readonly htmlDiagnostics: VuneSemanticHtmlDiagnostic[]
  readonly foreignComponents: VuneSemanticForeignComponent[]
} {
  const htmlElements: VuneSemanticHtmlElement[] = []
  const htmlDiagnostics: VuneSemanticHtmlDiagnostic[] = []
  const foreignComponents: VuneSemanticForeignComponent[] = []
  const vueImports = new Map<string, string>()
  const reactImports = new Map<string, string>()
  let elementCursor = 0
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const module = statement.moduleSpecifier.text
    if (!/\.vue$/i.test(module) || !statement.importClause?.name) continue
    vueImports.set(statement.importClause.name.text, module)
  }
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const module = statement.moduleSpecifier.text
    if (!/\.(?:tsx|jsx)$/i.test(module) || !statement.importClause?.name) continue
    reactImports.set(statement.importClause.name.text, module)
  }

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
      const expression = node.initializer.expression
      const argument = node.initializer.arguments[0]
      if (ts.isIdentifier(expression) && /^(?:__vuneForeignComponent|__vuneVueComponent|__vuneReactComponent)/.test(expression.text) && ts.isIdentifier(argument)) {
        const isReact = expression.text === "__vuneReactComponent"
        const module = (isReact ? reactImports : vueImports).get(argument.text)
        if (module) {
          const generatedRange = { start: node.getStart(sourceFile), end: node.end }
          foreignComponents.push({
            localName: node.name.text,
            module,
            range: originalCallRange(source, node.name.text) ?? mapRange(source, generatedSource, sourceMap, generatedRange),
            generatedRange,
            symbol: {
              kind: "foreign-component",
              localName: node.name.text,
              module,
              rendererAdapter: isReact ? "@vune-ui/react" : "@vune-ui/vue",
            },
          })
        }
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Element") {
      const tag = node.arguments[0]
      if (tag && ts.isStringLiteral(tag)) {
        const props = node.arguments[1]
        const generatedRange = { start: node.getStart(sourceFile), end: node.end }
        const original = originalElementRange(source, tag.text, elementCursor)
        const attributes = props && ts.isObjectLiteralExpression(props)
          ? props.properties.flatMap(property => {
              if (ts.isSpreadAssignment(property)) return ["..."]
              return objectPropertyName(property) ?? []
            })
          : []
        const attributeSymbols: SemanticHtmlAttributeSymbol[] = []
        if (props && ts.isObjectLiteralExpression(props)) {
          for (const property of props.properties) {
            if (ts.isSpreadAssignment(property)) {
              attributeSymbols.push({ name: "...", category: "custom", type: "unknown" })
              continue
            }
            const name = objectPropertyName(property)
            if (!name) continue
            const expression = ts.isPropertyAssignment(property)
              ? property.initializer
              : ts.isShorthandPropertyAssignment(property)
                ? property.objectAssignmentInitializer
                : undefined
            const spec = semanticHtmlAttributeSpec(tag.text, name)
            const valueType = ts.isMethodDeclaration(property)
              ? "event"
              : expression
                ? expressionValueType(expression, checker)
                : undefined
            attributeSymbols.push({ name, category: spec?.category ?? "custom", type: spec?.type ?? "unknown", valueType })
            const generatedAttributeRange = { start: property.getStart(sourceFile), end: property.end }
            const diagnosticRange = mapRange(source, generatedSource, sourceMap, generatedAttributeRange)
            if (!spec) {
              htmlDiagnostics.push({
                code: "VUNE_HTML_ATTRIBUTE",
                message: `Unknown attribute \"${name}\" on <${tag.text}>.`,
                range: diagnosticRange,
                generatedRange: generatedAttributeRange,
              })
              continue
            }
            if (!acceptsHtmlValue(spec, valueType, expression)) {
              const expected = spec.values?.length ? spec.values.map(value => `\"${value}\"`).join(" | ") : spec.type
              htmlDiagnostics.push({
                code: "VUNE_HTML_VALUE",
                message: `Attribute \"${name}\" on <${tag.text}> expects ${expected}.`,
                range: diagnosticRange,
                generatedRange: generatedAttributeRange,
              })
            }
          }
        }
        const tagSpec = semanticHtmlTagSpec(tag.text)
        const symbol: SemanticHtmlElementSymbol = {
          kind: "html-element",
          name: `Element#${generatedRange.start}`,
          tag: tag.text,
          custom: tagSpec.custom,
          attributes: attributeSymbols,
        }
        htmlElements.push({
          tag: tag.text,
          attributes,
          attributeSymbols,
          symbol,
          range: original?.range ?? mapRange(source, generatedSource, sourceMap, generatedRange),
          generatedRange,
        })
        if (original) elementCursor = original.next
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return { htmlElements, htmlDiagnostics, foreignComponents }
}

function typescriptSnapshot(fileName: string, source: string): {
  readonly sourceFile: ts.SourceFile
  readonly checker: ts.TypeChecker
  readonly diagnostics: readonly ts.Diagnostic[]
} {
  const options: ts.CompilerOptions = {
    allowJs: false,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    noResolve: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
  }
  const host = ts.createCompilerHost(options, true)
  const normalize = (value: string): string => value.replaceAll("\\", "/")
  const requestedRoot = normalize(fileName)
  const originalGetSourceFile = host.getSourceFile.bind(host)
  const originalReadFile = host.readFile.bind(host)
  const originalFileExists = host.fileExists.bind(host)
  host.fileExists = requested => normalize(requested) === requestedRoot || originalFileExists(requested)
  host.readFile = requested => normalize(requested) === requestedRoot ? source : originalReadFile(requested)
  host.getSourceFile = (requested, languageVersion, onError, shouldCreateNewSourceFile) => normalize(requested) === requestedRoot
    ? ts.createSourceFile(requested, source, languageVersion, true, /\.tsx?$/i.test(fileName) ? ts.ScriptKind.TS : ts.ScriptKind.TS)
    : originalGetSourceFile(requested, languageVersion, onError, shouldCreateNewSourceFile)
  const program = ts.createProgram([fileName], options, host)
  const sourceFile = program.getSourceFile(fileName) ?? ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  return {
    sourceFile,
    checker: program.getTypeChecker(),
    diagnostics: program.getSyntacticDiagnostics(sourceFile),
  }
}

export function createSemanticModel(source: string, fileName: string, generatedSource: string): VuneSemanticModel {
  const snapshot = typescriptSnapshot(fileName, generatedSource)
  const typescript = snapshot.sourceFile
  const structs = parseVuneStructs(source)
  const builderPrograms = builderProgramsFor(source, structs)
  const collectedCalls: VuneSemanticCall[] = []
  for (const program of builderPrograms) collectCalls(program, collectedCalls)
  const views = flattenStructs(structs)
  const calls = resolvedCalls(collectedCalls, views, snapshot.checker, typescript)
  const sourceMap = createVuneSourceMap(source, generatedSource, fileName)
  const graphSymbols = typescriptGraphSymbols(source, generatedSource, typescript, snapshot.checker, sourceMap)
  const symbolTable = new SemanticModel()
  for (const view of canonicalViewSymbols().values()) {
    symbolTable.register(view)
    for (const initializer of view.initializers) symbolTable.register(initializer)
  }
  for (const view of views) {
    symbolTable.register(view.symbol)
    for (const initializer of view.symbol.initializers) symbolTable.register(initializer)
    for (const field of view.symbol.fields) {
      if (field.kind === "state") symbolTable.register({ kind: "state", name: `${view.qualifiedName}.${field.name}`, type: field.type } satisfies SemanticStateSymbol)
      if (field.kind === "binding") symbolTable.register({ kind: "binding", name: `${view.qualifiedName}.${field.name}`, type: field.type })
    }
  }
  symbolTable.register({
    kind: "builder",
    name: "ViewBuilder",
    contentType: "View",
    operations: ["buildBlock", "buildOptional", "buildEither", "buildArray"],
  } satisfies SemanticBuilderTypeSymbol)
  for (const foreign of graphSymbols.foreignComponents) symbolTable.register(foreign.symbol)
  for (const element of graphSymbols.htmlElements) symbolTable.register(element.symbol)
  return {
    kind: "VuneSemanticModel",
    fileName,
    source,
    generatedSource,
    typescript,
    typeChecker: snapshot.checker,
    typescriptDiagnostics: snapshot.diagnostics,
    htmlDiagnostics: graphSymbols.htmlDiagnostics,
    structs,
    views,
    builderPrograms,
    calls,
    imports: importsOf(source, generatedSource, typescript, sourceMap),
    htmlElements: graphSymbols.htmlElements,
    foreignComponents: graphSymbols.foreignComponents,
    symbolTable,
    symbols: symbolTable.values(),
    view(name) {
      return views.find(view => view.name === name || view.qualifiedName === name)
    },
    symbol(name) {
      return symbolTable.get(name)
    },
  }
}
