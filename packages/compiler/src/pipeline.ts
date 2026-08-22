import * as ts from "typescript"
import { parseMuseBuilder, parseMuseStructs, lowerMuseBuilderAst, type MuseBuilderNode, type MuseBuilderProgram, type MuseCallExpression } from "./ast.js"
import {
  findBuilder,
  findRawHtml,
  identifierAt,
  matching,
  regexCanStart,
  skipComment,
  skipRegex,
  skipString,
  skipTrivia,
  splitStatements,
  splitTopLevel,
  syntaxError,
  topLevelColon,
  type BuilderCall,
} from "./scanner.js"
import * as Core from "@muse/core"
import { resolveSemanticCall, type SemanticArgument, type SemanticCallResolution, type SemanticInitializerSymbol, type SemanticViewTypeSymbol } from "@muse/core"
import { lowerStaticImportedCalls, lowerStaticModifierChains, staticModifierNames } from "./specialization.js"

const nonBindingDollarNames = new Set([
  "attrs", "data", "emit", "el", "forceUpdate", "nextTick", "options", "parent", "props", "refs", "root", "slots", "watch",
])

/** Compiler-facing view metadata is read from the same ViewType as runtime. */
const canonicalInitializerSymbols = new Map<string, readonly SemanticInitializerSymbol[]>()
for (const [name, value] of Object.entries(Core)) {
  if (typeof value !== "function") continue
  const viewType = (value as { readonly viewType?: { readonly name?: string; readonly semanticSymbol?: { readonly initializers: readonly SemanticInitializerSymbol[] } } }).viewType
  if (viewType?.name && viewType.semanticSymbol) canonicalInitializerSymbols.set(name, viewType.semanticSymbol.initializers)
}

type InitializerSymbolRegistry = ReadonlyMap<string, readonly SemanticInitializerSymbol[]>

function symbolsForCall(call: MuseCallExpression, registry: InitializerSymbolRegistry = canonicalInitializerSymbols): readonly SemanticInitializerSymbol[] | undefined {
  return registry.get(call.callee)
}

class MuseInitializerSyntaxError extends SyntaxError {
  readonly code = "MUSE_INITIALIZER" as const
  readonly offset: number

  constructor(message: string, offset: number) {
    super(message)
    this.name = "MuseInitializerSyntaxError"
    this.offset = offset
  }
}

function buttonInitializerMessage(call: MuseCallExpression): string {
  const labels = call.arguments.flatMap(argument => argument.label ? [argument.label] : [])
  if (labels.includes("label") && labels.includes("action") && labels.indexOf("label") < labels.indexOf("action")) {
    return "Button arguments must follow declaration order: action:, label:."
  }
  if (call.trailing && call.arguments[0]?.label === "action") {
    return "Button's custom-label initializer requires:\nButton(action: { ... }, label: { ... })"
  }
  return "Button requires a text label before its trailing action.\nUse:\nButton(\"Save\") { ... }"
}

function knownCallArguments(call: MuseCallExpression): readonly SemanticArgument[] {
  const arguments_ = call.arguments.flatMap((argument, argumentIndex) => {
    if (argument.value.kind === "closure") return [{ label: argument.label, type: "function" }]
    if (call.callee === "ForEach" && argumentIndex === 1 && /^\{\s*(?:id|key)\s*:/.test(argument.value.source) && /=>/.test(argument.value.source)) {
      return [{ label: "key", type: "function" }]
    }
    const named = /^namedArguments\s*\(\s*\{([\s\S]*)\}\s*\)$/.exec(argument.value.source.trim())
    if (named) return splitTopLevel(named[1]).map(value => compilerSemanticArgument(value))
    return [compilerSemanticArgument(argument.label ? `${argument.label}: ${argument.value.source}` : argument.value.source)]
  })
  return call.trailing ? [...arguments_, { type: "function", trailing: true }] : arguments_
}

function resolveKnownCall(call: MuseCallExpression, registry: InitializerSymbolRegistry = canonicalInitializerSymbols): {
  readonly symbols: readonly SemanticInitializerSymbol[]
  readonly initializerIndex: number
  readonly resolution: SemanticCallResolution
} | undefined {
  const symbols = symbolsForCall(call, registry)
  if (!symbols) return undefined
  const viewType: SemanticViewTypeSymbol = {
    kind: "view",
    name: call.callee,
    qualifiedName: call.callee,
    initializers: symbols,
    fields: [],
  }
  const result = resolveSemanticCall(viewType, knownCallArguments(call))
  if (!result.resolvedInitializer) {
    if (call.callee === "Button") throw new MuseInitializerSyntaxError(buttonInitializerMessage(call), call.range.start)
    if (call.trailing && canonicalInitializerSymbols.get(call.callee) !== symbols) {
      throw new MuseInitializerSyntaxError(
        result.diagnostics[0]?.message ?? `No matching initializer for ${call.callee}.`,
        call.range.start,
      )
    }
    return undefined
  }
  return { symbols, initializerIndex: result.resolvedInitializer.index, resolution: result }
}

function validateKnownCalls(program: MuseBuilderProgram, registry: InitializerSymbolRegistry = canonicalInitializerSymbols): void {
  const visit = (node: MuseBuilderNode): void => {
    if (node.kind === "call") {
      if (node.callee === "Button" || node.trailing) resolveKnownCall(node, registry)
      for (const argument of node.arguments) if (argument.value.kind === "closure") validateKnownCalls(argument.value.body, registry)
      if (node.trailing) validateKnownCalls(node.trailing.body, registry)
      return
    }
    if (node.kind === "conditional") {
      validateKnownCalls(node.then, registry)
      if (node.otherwise) {
        if (node.otherwise.kind === "conditional") validateKnownCalls({ ...node.then, statements: [node.otherwise] }, registry)
        else validateKnownCalls(node.otherwise, registry)
      }
    }
  }
  for (const node of program.statements) visit(node)
}

function validateKnownTypeScriptCalls(source: string, registry: InitializerSymbolRegistry = canonicalInitializerSymbols): void {
  const file = ts.createSourceFile("muse-call-validation.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && registry.has(node.expression.text)) {
      // The Muse scanner owns trailing closures. TypeScript sees the call
      // prefix as a complete call, so leave that shape to validateKnownCalls.
      const callText = source.slice(node.expression.end, node.end)
      const hasMuseLabels = /(?:^|,)\s*[A-Za-z_$][A-Za-z0-9_$]*\s*:/.test(callText)
      if (!hasMuseLabels && source[skipTrivia(source, node.end)] !== "{" && node.expression.text === "Button") {
        const callSource = `${node.expression.text}(${node.arguments.map(argument => argument.getText(file)).join(", ")})`
        const parsed = parseMuseBuilder(callSource, node.expression.getStart(file)).statements[0]
        if (parsed?.kind === "call") resolveKnownCall(parsed, registry)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
}

function closureRoleForKnownCall(
  call: MuseCallExpression,
  context: { readonly position: "argument" | "trailing"; readonly argumentIndex?: number; readonly label?: string },
  registry: InitializerSymbolRegistry = canonicalInitializerSymbols,
): "value" | "viewBuilder" | "action" | undefined {
  const resolved = resolveKnownCall(call, registry)
  const resolvedArgumentIndex = context.position === "trailing"
    ? call.arguments.length
    : context.label
      ? call.arguments.findIndex(argument => argument.label === context.label)
      : context.argumentIndex ?? 0
  const sharedRole = resolved?.resolution.closureRoles[resolvedArgumentIndex]
  if (sharedRole) return sharedRole === "binding" ? undefined : sharedRole
  const symbols = resolved?.symbols ?? symbolsForCall(call, registry) ?? []
  const parameters = resolved?.symbols[resolved.initializerIndex]?.parameters
    ?? (context.position === "trailing"
      ? symbols.find(symbol => symbol.parameters.at(-1)?.trailing)?.parameters
      : context.label
        ? symbols.find(symbol => symbol.parameters.some(parameter => parameter.label === context.label))?.parameters
        : undefined)
    ?? []
  const role = (kind: SemanticInitializerSymbol["parameters"][number]["kind"] | undefined): "value" | "viewBuilder" | "action" | undefined => kind === "binding" ? undefined : kind
  if (context.position === "trailing") return role(parameters.at(-1)?.kind)
  if (context.label) return role(parameters.find(parameter => parameter.label === context.label)?.kind)
  const index = context.argumentIndex ?? 0
  let positional = 0
  for (const argument of call.arguments.slice(0, index)) if (!argument.label) positional += 1
  return role(parameters[positional]?.kind)
}

function isIdentifierDeclaration(node: ts.Identifier): boolean {
  const parent = node.parent
  if (ts.isVariableDeclaration(parent) && parent.name === node) return true
  if (ts.isParameter(parent) && parent.name === node) return true
  if (ts.isBindingElement(parent) && parent.name === node) return true
  if (ts.isFunctionDeclaration(parent) && parent.name === node) return true
  if (ts.isClassDeclaration(parent) && parent.name === node) return true
  if (ts.isImportClause(parent) && parent.name === node) return true
  if (ts.isImportSpecifier(parent) && parent.name === node) return true
  if (ts.isNamespaceImport(parent) && parent.name === node) return true
  if (ts.isExportSpecifier(parent) && parent.name === node) return true
  return false
}

function isBindingShorthandIdentifier(node: ts.Identifier): boolean {
  if (!node.text.startsWith("$") || node.text.length === 1) return false
  if (nonBindingDollarNames.has(node.text.slice(1)) || isIdentifierDeclaration(node)) return false
  const parent = node.parent
  if (ts.isPropertyAccessExpression(parent) && (parent.expression === node || parent.name === node)) return false
  if (ts.isElementAccessExpression(parent) && parent.expression === node) return false
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false
  if (ts.isMethodDeclaration(parent) && parent.name === node) return false
  if (ts.isPropertyDeclaration(parent) && parent.name === node) return false
  if (ts.isMethodSignature(parent) && parent.name === node) return false
  if (ts.isPropertySignature(parent) && parent.name === node) return false
  if (ts.isShorthandPropertyAssignment(parent)) return false
  return true
}

/**
 * Lower only actual identifier nodes. The source is intentionally edited by
 * span so the rest of Muse's syntax lowering keeps its original formatting.
 * This prevents member properties, declarations, strings, comments, regexes,
 * and identifiers containing `$` from being mistaken for projections.
 */
function lowerShorthand(source: string): string {
  const file = ts.createSourceFile("muse-shorthand.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const edits: Array<{ start: number; end: number; replacement: string }> = []
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && isBindingShorthandIdentifier(node)) {
      edits.push({ start: node.getStart(file), end: node.end, replacement: `Binding(${node.text.slice(1)})` })
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  let result = source
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end)
  }
  return result
}

function containsAwaitKeyword(source: string): boolean {
  for (let cursor = 0; cursor < source.length; cursor += 1) {
    const character = source[cursor]
    if (character === "\"" || character === "'" || character === "`") { cursor = skipString(source, cursor) - 1; continue }
    if (character === "/" && (source[cursor + 1] === "/" || source[cursor + 1] === "*")) { cursor = skipComment(source, cursor) - 1; continue }
    if (character === "/" && regexCanStart(source, cursor)) { cursor = skipRegex(source, cursor) - 1; continue }
    const identifier = identifierAt(source, cursor)
    if (!identifier) continue
    if (identifier.name === "await") return true
    cursor = identifier.end - 1
  }
  return false
}

interface ConditionalStatementParts {
  readonly condition: string
  readonly thenSource: string
  readonly elseSource?: string
  readonly elseIf?: string
}

interface SwitchClause {
  readonly label: "case" | "default"
  readonly expression?: string
  readonly body: string
}

function conditionalStatementParts(source: string): ConditionalStatementParts | undefined {
  const value = source.trim()
  if (!/^if\s*\(/.test(value)) return undefined
  const open = value.indexOf("(")
  const close = matching(value, open, "(", ")")
  const thenOpen = skipTrivia(value, close + 1)
  if (value[thenOpen] !== "{") return undefined
  const thenClose = matching(value, thenOpen, "{", "}")
  const afterThen = skipTrivia(value, thenClose + 1)
  if (afterThen === value.length) return { condition: value.slice(open + 1, close), thenSource: value.slice(thenOpen + 1, thenClose) }
  if (value.slice(afterThen, afterThen + 4) !== "else") return undefined
  const elseStart = skipTrivia(value, afterThen + 4)
  const rest = value.slice(elseStart)
  if (/^if\s*\(/.test(rest)) return { condition: value.slice(open + 1, close), thenSource: value.slice(thenOpen + 1, thenClose), elseIf: rest }
  if (rest[0] !== "{") return undefined
  const elseClose = matching(rest, 0, "{", "}")
  if (skipTrivia(rest, elseClose + 1) !== rest.length) return undefined
  return { condition: value.slice(open + 1, close), thenSource: value.slice(thenOpen + 1, thenClose), elseSource: rest.slice(1, elseClose) }
}

function switchClauses(source: string): readonly SwitchClause[] {
  const starts: Array<{ label: "case" | "default"; start: number; colon: number; expression?: string }> = []
  let parens = 0
  let brackets = 0
  let braces = 0
  for (let cursor = 0; cursor < source.length; cursor += 1) {
    const character = source[cursor]
    if (character === "\"" || character === "'" || character === "`") { cursor = skipString(source, cursor) - 1; continue }
    if (character === "/" && (source[cursor + 1] === "/" || source[cursor + 1] === "*")) { cursor = skipComment(source, cursor) - 1; continue }
    if (character === "/" && regexCanStart(source, cursor)) { cursor = skipRegex(source, cursor) - 1; continue }
    if (character === "(" ) { parens += 1; continue }
    if (character === ")") { parens -= 1; continue }
    if (character === "[") { brackets += 1; continue }
    if (character === "]") { brackets -= 1; continue }
    if (character === "{") { braces += 1; continue }
    if (character === "}") { braces -= 1; continue }
    if (parens !== 0 || brackets !== 0 || braces !== 0) continue
    const label = /^(case|default)\b/.exec(source.slice(cursor))
    if (!label || (cursor > 0 && /[A-Za-z0-9_$]/.test(source[cursor - 1]))) continue
    const labelName = label[1] as "case" | "default"
    const labelEnd = cursor + label[0].length
    const relativeColon = labelName === "default" ? source.slice(labelEnd).search(/:/) : topLevelColon(source.slice(labelEnd))
    if (relativeColon < 0) continue
    const colon = labelEnd + relativeColon
    starts.push({ label: labelName, start: cursor, colon, expression: labelName === "case" ? source.slice(labelEnd, colon).trim() : undefined })
    cursor = colon
  }
  return starts.map((start, index) => ({
    label: start.label,
    expression: start.expression,
    body: source.slice(start.colon + 1, starts[index + 1]?.start ?? source.length),
  }))
}

function switchStatement(source: string, registry: InitializerSymbolRegistry, childrenName: string): string | undefined {
  const value = source.trim()
  if (!/^switch\s*\(/.test(value)) return undefined
  const open = value.indexOf("(")
  const close = matching(value, open, "(", ")")
  const bodyOpen = skipTrivia(value, close + 1)
  if (value[bodyOpen] !== "{") return undefined
  const bodyClose = matching(value, bodyOpen, "{", "}")
  if (skipTrivia(value, bodyClose + 1) !== value.length) return undefined
  const clauses = switchClauses(value.slice(bodyOpen + 1, bodyClose))
  if (clauses.length === 0) return undefined
  const lowered = clauses.map(clause => `${clause.label}${clause.expression === undefined ? "" : ` ${lowerRange(clause.expression, registry)}`}: ${lowerViewBuilderStatements(clause.body, registry, childrenName)}`).join(" ")
  return `switch (${lowerRange(value.slice(open + 1, close), registry)}) { ${lowered} }`
}

function isMuseChildExpression(source: string, registry: InitializerSymbolRegistry): boolean {
  const value = source.trim()
  if (!value) return false
  if (value.startsWith("<")) return true
  const parsed = parseMuseBuilder(value).statements[0]
  if (parsed?.kind === "call") return /^[A-Z]/.test(parsed.callee) || registry.has(parsed.callee)
  if (/^\[[\s\S]*\]$/.test(value) && /\b[A-Z][A-Za-z0-9_$]*\s*\(/.test(value)) return true
  if (/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(value)) return true
  return false
}

function lowerViewBuilderStatements(source: string, registry: InitializerSymbolRegistry = canonicalInitializerSymbols, childrenName = "__museChildren"): string {
  const statements: string[] = []
  for (const statement of splitStatements(source)) {
    const value = statement.trim()
    if (!value) continue
    const conditional = conditionalStatementParts(value)
    if (conditional) {
      const condition = lowerRange(conditional.condition, registry)
      const thenBody = lowerViewBuilderStatements(conditional.thenSource, registry, childrenName)
      if (conditional.elseIf) {
        statements.push(`if (${condition}) { ${thenBody} } else ${lowerViewBuilderControlFlow(conditional.elseIf, registry, childrenName)}`)
      } else if (conditional.elseSource !== undefined) {
        statements.push(`if (${condition}) { ${thenBody} } else { ${lowerViewBuilderStatements(conditional.elseSource, registry, childrenName)} }`)
      } else {
        statements.push(`if (${condition}) { ${thenBody} }`)
      }
      continue
    }
    const switchBody = switchStatement(value, registry, childrenName)
    if (switchBody) {
      statements.push(switchBody)
      continue
    }
    if (/^(?:const|let|var)\b/.test(value)) {
      statements.push(`${lowerRange(value, registry)};`)
      continue
    }
    if (/^return\b/.test(value)) {
      const expression = value.slice("return".length).trim()
      statements.push(expression ? `return ${lowerRange(expression, registry)};` : `return ${childrenName};`)
      continue
    }
    if (/^(?:throw|break|continue|debugger)\b/.test(value)) {
      statements.push(`${lowerRange(value, registry)};`)
      continue
    }
    const lowered = lowerRange(value, registry)
    statements.push(isMuseChildExpression(value, registry) ? `${childrenName}.push(${lowered});` : `${lowered};`)
  }
  return statements.join(" ")
}

function lowerViewBuilderControlFlow(source: string, registry: InitializerSymbolRegistry = canonicalInitializerSymbols, childrenName = "__museChildren"): string {
  const conditional = conditionalStatementParts(source)
  if (!conditional) return `{ ${lowerViewBuilderStatements(source, registry, childrenName)} }`
  const condition = lowerRange(conditional.condition, registry)
  const thenBody = lowerViewBuilderStatements(conditional.thenSource, registry, childrenName)
  if (conditional.elseIf) return `if (${condition}) { ${thenBody} } else ${lowerViewBuilderControlFlow(conditional.elseIf, registry, childrenName)}`
  if (conditional.elseSource !== undefined) return `if (${condition}) { ${thenBody} } else { ${lowerViewBuilderStatements(conditional.elseSource, registry, childrenName)} }`
  return `if (${condition}) { ${thenBody} }`
}

function needsStatementAwareViewBody(source: string): boolean {
  return /\b(?:const|let|var|return|throw|switch|for|while|try)\b/.test(source)
}

function lowerViewBuilderClosure(body: string, parameter: string | undefined, registry: InitializerSymbolRegistry): string {
  if (!needsStatementAwareViewBody(body)) {
    const lowered = lowerMuseBuilderAst(parseMuseBuilder(body), {
      transformRaw: value => lowerRange(value, registry),
      transformArgument: (value, call, argumentIndex) => lowerForEachIdentityOptions(value, call, argumentIndex, registry),
      closure: (nestedBody, nestedParameter, nestedRole) => lowerAstClosure(nestedBody, nestedParameter, nestedRole, registry),
      closureRole: (nestedCall, context) => closureRoleForKnownCall(nestedCall, context, registry),
    }).join(", ")
    return `${parameter ? `(${parameter})` : "()"} => [${lowered}]`
  }
  const prefix = parameter ? `(${parameter})` : "()"
  let childrenName = "__museChildren"
  let suffix = 0
  while (new RegExp(`\\b${childrenName}\\b`).test(body)) childrenName = `__museChildren${++suffix}`
  return `${prefix} => { const ${childrenName} = []; ${lowerViewBuilderStatements(body, registry, childrenName)} return ${childrenName}; }`
}

function lowerClosure(value: string, role?: "value" | "viewBuilder" | "action", registry: InitializerSymbolRegistry = canonicalInitializerSymbols): string {
  const source = value.trim()
  if (!source.startsWith("{") || matching(source, 0, "{", "}") !== source.length - 1) return lowerRange(source, registry)
  const body = source.slice(1, -1).trim()
  if (role === "viewBuilder") return lowerViewBuilderClosure(body, undefined, registry)
  const lowered = lowerStatements(body, registry)
  const asynchronous = containsAwaitKeyword(body)
  if (role === "action") return `${asynchronous ? "async " : ""}() => {${lowerRange(body, registry)}}`
  const action = asynchronous || /\b(const|let|var|return|throw)\b/.test(body)
  const builder = action ? "() => []" : `() => [${lowered}]`
  return `overloadClosure(${builder}, ${asynchronous ? "async " : ""}() => {${lowerRange(body, registry)}})`
}

function lowerArguments(source: string, calleeName?: string, registry: InitializerSymbolRegistry = canonicalInitializerSymbols): string {
  const parsed = calleeName ? parseMuseBuilder(`${calleeName}(${source})`).statements[0] : undefined
  const call = parsed?.kind === "call" ? parsed : undefined
  if (call && (call.callee === "Button" || call.trailing)) resolveKnownCall(call, registry)
  const positional: string[] = []
  const named: string[] = []
  for (const [argumentIndex, argument] of splitTopLevel(source).entries()) {
    const colon = topLevelColon(argument)
    const labelStart = skipTrivia(argument, 0)
    if (colon >= 0 && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(argument.slice(labelStart, colon).trim())) {
      const label = argument.slice(labelStart, colon).trim()
      const role = call ? closureRoleForKnownCall(call, { position: "argument", argumentIndex, label }, registry) : undefined
      named.push(`${label}: ${lowerClosureOrExpression(argument.slice(colon + 1), role, registry)}`)
    } else {
      const role = call ? closureRoleForKnownCall(call, { position: "argument", argumentIndex }, registry) : undefined
      positional.push(lowerClosureOrExpression(argument, role, registry))
    }
  }
  if (named.length === 0) return positional.join(", ")
  return [...positional, `namedArguments({ ${named.join(", ")} })`].join(", ")
}

function lowerClosureOrExpression(source: string, role?: "value" | "viewBuilder" | "action", registry: InitializerSymbolRegistry = canonicalInitializerSymbols): string {
  const value = source.trim()
  if (value.startsWith("{") && matching(value, 0, "{", "}") === value.length - 1 && !/^(?:\s*(?:[A-Za-z_$][A-Za-z0-9_$]*|["'][^"']*["']|-?\d+(?:\.\d+)?)\s*:)/.test(value.slice(1, -1))) return lowerClosure(value, role, registry)
  return lowerShorthand(lowerRange(value, registry))
}

function lowerForEachIdentityOptions(source: string, call: MuseCallExpression, argumentIndex: number, registry: InitializerSymbolRegistry): string {
  const value = source.trim()
  if (call.callee !== "ForEach" || argumentIndex !== 1 || !value.startsWith("{") || matching(value, 0, "{", "}") !== value.length - 1) {
    return lowerRange(source, registry)
  }
  const entries = splitTopLevel(value.slice(1, -1)).map(entry => {
    const colon = topLevelColon(entry)
    return colon < 0 ? undefined : { name: entry.slice(0, colon).trim(), value: entry.slice(colon + 1).trim() }
  }).filter((entry): entry is { name: string; value: string } => entry !== undefined)
  const identity = entries.find(entry => entry.name === "id" || entry.name === "key")
  if (!identity) return lowerRange(source, registry)
  return `namedArguments({ key: ${lowerRange(identity.value, registry)} })`
}

function lowerConditional(source: string, registry: InitializerSymbolRegistry = canonicalInitializerSymbols): string | undefined {
  const match = /^if\s*\(/.exec(source)
  if (!match) return undefined
  const open = source.indexOf("(", match.index + match[0].length - 1)
  const close = matching(source, open, "(", ")")
  const thenOpen = skipTrivia(source, close + 1)
  if (source[thenOpen] !== "{") return undefined
  const thenClose = matching(source, thenOpen, "{", "}")
  const afterThen = skipTrivia(source, thenClose + 1)
  const condition = source.slice(open + 1, close).trim()
  const thenValue = `[${lowerStatements(source.slice(thenOpen + 1, thenClose), registry)}]`
  if (source.slice(afterThen, afterThen + 4) !== "else") return `(${lowerShorthand(condition)} ? ${thenValue} : [])`
  const elseOpen = skipTrivia(source, afterThen + 4)
  if (source[elseOpen] !== "{") return undefined
  const elseClose = matching(source, elseOpen, "{", "}")
  return `(${lowerShorthand(condition)} ? ${thenValue} : [${lowerStatements(source.slice(elseOpen + 1, elseClose), registry)}])`
}

function lowerStatements(source: string, registry: InitializerSymbolRegistry = canonicalInitializerSymbols): string {
  const values: string[] = []
  for (const statement of splitStatements(source)) {
    const conditional = lowerConditional(statement, registry)
    if (conditional) values.push(conditional)
    else if (/^\s*(const|let|var|return|throw)\b/.test(statement)) continue
    else values.push(lowerRange(statement, registry))
  }
  return values.join(", ")
}

function lowerAstClosure(body: string, parameter?: string, role?: "value" | "viewBuilder" | "action", registry: InitializerSymbolRegistry = canonicalInitializerSymbols): string {
  if (role === "viewBuilder") return lowerViewBuilderClosure(body, parameter, registry)
  const parsed = parseMuseBuilder(body)
  const lowered = lowerMuseBuilderAst(parsed, {
    transformRaw: value => lowerRange(value, registry),
    transformArgument: (value, call, argumentIndex) => lowerForEachIdentityOptions(value, call, argumentIndex, registry),
    closure: (nestedBody, nestedParameter, nestedRole) => lowerAstClosure(nestedBody, nestedParameter, nestedRole, registry),
    closureRole: (nestedCall, context) => closureRoleForKnownCall(nestedCall, context, registry),
  }).join(", ")
  if (parameter) return `(${parameter}) => [${lowered}]`
  const asynchronous = containsAwaitKeyword(body)
  if (role === "action") return `${asynchronous ? "async " : ""}() => {${lowerRange(body, registry)}}`
  const action = asynchronous || /\b(const|let|var|return|throw)\b/.test(body)
  const builder = action ? "() => []" : `() => [${lowered}]`
  return `overloadClosure(${builder}, ${asynchronous ? "async " : ""}() => {${lowerRange(body, registry)}})`
}

function lowerBuilder(call: BuilderCall, source: string, registry: InitializerSymbolRegistry = canonicalInitializerSymbols): string {
  const parsed = parseMuseBuilder(source.slice(call.start, call.end), call.start)
  const lowered = lowerMuseBuilderAst(parsed, {
    transformRaw: value => lowerRange(value, registry),
    transformArgument: (value, call, argumentIndex) => lowerForEachIdentityOptions(value, call, argumentIndex, registry),
    closure: (body, parameter, role) => lowerAstClosure(body, parameter, role, registry),
    closureRole: (nestedCall, context) => closureRoleForKnownCall(nestedCall, context, registry),
  })
  if (lowered.length === 1) return lowered[0]
  return `${call.name}(${lowerArguments(call.argumentSource, call.name, registry)})`
}

function lowerRange(source: string, registry: InitializerSymbolRegistry = canonicalInitializerSymbols): string {
  let output = ""
  let cursor = 0
  let iterations = 0
  while (cursor < source.length) {
    if (++iterations > source.length + 1) throw syntaxError("Muse lowering did not advance past a builder expression", cursor)
    const call = findBuilder(source, cursor)
    const html = findRawHtml(source, cursor, value => lowerRange(value, registry))
    if (!call && !html) break
    if (html && (!call || html.start < call.start)) {
      output += lowerShorthand(source.slice(cursor, html.start))
      output += html.code
      cursor = html.end
      continue
    }
    output += lowerShorthand(source.slice(cursor, call!.start))
    output += lowerBuilder(call!, source, registry)
    cursor = call!.end
  }
  output += lowerShorthand(source.slice(cursor))
  return output
}

interface StructParameter {
  readonly name: string
  readonly label?: string
  readonly labelRequired?: boolean
  readonly kind: "value" | "binding" | "viewBuilder" | "action"
  readonly required: boolean
  readonly trailing?: boolean
  readonly defaultValue?: string
  readonly type?: string
}

interface StructField {
  readonly name: string
  readonly kind: "value" | "state" | "binding"
  readonly type?: string
  readonly defaultValue?: string
}

function structParameter(source: string): StructParameter {
  const kind = source.includes("@ViewBuilder") ? "viewBuilder" : source.includes("@Action") ? "action" : source.includes("@Binding") ? "binding" : "value"
  const clean = source.replace(/@(?:ViewBuilder|Action|Binding)\s*/g, "").trim()
  const defaultIndex = topLevelEquals(clean)
  const declaration = defaultIndex < 0 ? clean : clean.slice(0, defaultIndex).trim()
  const defaultValue = defaultIndex < 0 ? undefined : clean.slice(defaultIndex + 1).trim()
  const colon = topLevelColon(declaration)
  const head = (colon < 0 ? declaration : declaration.slice(0, colon)).trim()
  const words = head.split(/\s+/).filter(Boolean)
  const name = words[words.length - 1]?.replace(/^_+/, "")
  if (!name) throw new SyntaxError(`Invalid struct initializer parameter: ${source}`)
  return {
    name,
    label: words[0] === "_" ? undefined : words[0],
    kind,
    required: defaultIndex < 0,
    defaultValue,
    type: colon < 0 ? undefined : declaration.slice(colon + 1).trim(),
  }
}

function topLevelEquals(source: string): number {
  let parens = 0
  let brackets = 0
  let braces = 0
  for (let cursor = 0; cursor < source.length; cursor += 1) {
    const character = source[cursor]
    if (character === "\"" || character === "'" || character === "`") { cursor = skipString(source, cursor) - 1; continue }
    if (character === "(") parens += 1
    else if (character === ")") parens -= 1
    else if (character === "[") brackets += 1
    else if (character === "]") brackets -= 1
    else if (character === "{") braces += 1
    else if (character === "}") braces -= 1
    else if (character === "=" && parens === 0 && brackets === 0 && braces === 0 && source[cursor + 1] !== ">") return cursor
  }
  return -1
}

interface StructInitializerPlan {
  readonly parameters: readonly StructParameter[]
  readonly assignments: ReadonlyMap<string, string>
  readonly delegation?: readonly string[]
}

type MuseStruct = ReturnType<typeof parseMuseStructs>[number]

function structInitializerPlans(declaration: MuseStruct): readonly StructInitializerPlan[] {
  const fields = declaration.fields.map(field => ({
    name: field.name,
    kind: field.kind === "state" ? "state" : field.kind === "binding" ? "binding" : "value",
    type: field.type,
    defaultValue: field.initializer,
  }))
  return declaration.initializers.length > 0
    ? declaration.initializers.map(item => structInitializerPlan(item.parametersSource, item.bodySource))
    : [structInitializerPlan(fields.filter(field => field.kind !== "state").map(field => `${field.name}: unknown${field.defaultValue === undefined ? "" : ` = ${field.defaultValue}`}`).join(", "), "")]
}

function structInitializerPlan(parameterSource: string, bodySource: string): StructInitializerPlan {
  const parsedParameters = splitTopLevel(parameterSource).filter(Boolean).map(structParameter)
  const parameters = parsedParameters.map((parameter, index) => ({
    ...parameter,
    trailing: index === parsedParameters.length - 1 && (parameter.kind === "viewBuilder" || parameter.kind === "action"),
    labelRequired: parameter.label !== undefined && !(index === parsedParameters.length - 1 && (parameter.kind === "viewBuilder" || parameter.kind === "action")),
  }))
  const assignments = new Map<string, string>()
  for (const match of bodySource.matchAll(/self\.([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([^;\n]+)/g)) assignments.set(match[1], match[2].trim())
  const delegationMatch = /\bself\.init\s*\(/.exec(bodySource)
  if (!delegationMatch) return { parameters, assignments }
  const open = bodySource.indexOf("(", delegationMatch.index)
  const close = matching(bodySource, open, "(", ")")
  return { parameters, assignments, delegation: splitTopLevel(bodySource.slice(open + 1, close)).filter(Boolean) }
}

function structArgument(source: string): { readonly label?: string; readonly value: string } {
  const colon = topLevelColon(source)
  if (colon < 0) return { value: source.trim() }
  return { label: source.slice(0, colon).trim(), value: source.slice(colon + 1).trim() }
}

function delegatedParameterValues(parameters: readonly StructParameter[], arguments_: readonly string[]): Map<string, string> | undefined {
  const values = new Map<string, string>()
  const used = new Set<number>()
  let nextPositional = 0
  for (const source of arguments_) {
    const argument = structArgument(source)
    let index = argument.label === undefined
      ? (() => {
          while (used.has(nextPositional)) nextPositional += 1
          return nextPositional
        })()
      : parameters.findIndex(parameter => parameter.label === argument.label || parameter.name === argument.label)
    if (index < 0 || index >= parameters.length || used.has(index)) return undefined
    used.add(index)
    if (argument.label === undefined) nextPositional = index + 1
    values.set(parameters[index].name, argument.value)
  }
  for (let index = 0; index < parameters.length; index += 1) {
    const parameter = parameters[index]
    if (!values.has(parameter.name)) {
      if (parameter.required) return undefined
      values.set(parameter.name, parameter.defaultValue ?? "undefined")
    }
  }
  return values
}

function compilerInitializerArguments(source: string): readonly string[] {
  return splitTopLevel(source).flatMap(argument => {
    const named = /^namedArguments\s*\(\s*\{([\s\S]*)\}\s*\)$/.exec(argument.trim())
    return named ? splitTopLevel(named[1]) : [argument]
  })
}

function compilerSemanticArgument(source: string): SemanticArgument {
  const argument = structArgument(source)
  const value = argument.value.trim()
  if (/^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)$/.test(value)) return { label: argument.label, type: "string" }
  if (/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return { label: argument.label, type: "number" }
  if (/^(?:true|false)$/.test(value)) return { label: argument.label, type: "boolean" }
  if (/^(?:overloadClosure|function)\s*\(/.test(value) || /=>/.test(value)) return { label: argument.label, type: "function" }
  if (/^Binding\s*\(/.test(value)) return { label: argument.label, kind: "binding", type: "binding" }
  if (/^State\s*\(/.test(value)) return { label: argument.label, type: "state" }
  return { label: argument.label, type: "unknown" }
}

function semanticInitializerSymbol(name: string, plan: StructInitializerPlan, index: number): SemanticInitializerSymbol {
  return {
    kind: "initializer",
    index,
    signature: `${name}(${plan.parameters.map(parameter => `${parameter.kind === "viewBuilder" ? "@ViewBuilder " : parameter.kind === "action" ? "@Action " : parameter.kind === "binding" ? "@Binding " : ""}${parameter.label ?? parameter.name}`).join(", ")})`,
    parameters: plan.parameters,
  }
}

function staticInitializerIndex(declaration: MuseStruct, argumentSource: string, offset = 0): number | undefined {
  const plans = structInitializerPlans(declaration)
  const arguments_ = compilerInitializerArguments(argumentSource).map(compilerSemanticArgument)
  const initializers = plans.map((plan, index) => semanticInitializerSymbol(declaration.name, plan, index))
  const viewType: SemanticViewTypeSymbol = {
    kind: "view",
    name: declaration.name,
    qualifiedName: declaration.name,
    genericParameters: declaration.genericParameters,
    fields: [],
    initializers,
  }
  const result = resolveSemanticCall(viewType, arguments_)
  if (result.resolvedInitializer) return result.resolvedInitializer.index
  if (result.diagnostics[0]?.code === "MUSE_INITIALIZER" && arguments_.some(argument => argument.type === "unknown")) return undefined
  throw new MuseInitializerSyntaxError(
    result.diagnostics[0]?.message ?? `No matching initializer for ${declaration.name}.`,
    offset,
  )
}

function findDelegatedInitializer(plans: readonly StructInitializerPlan[], arguments_: readonly string[], excludedIndex: number): { plan: StructInitializerPlan; values: Map<string, string> } | undefined {
  for (let index = 0; index < plans.length; index += 1) {
    if (index === excludedIndex) continue
    const plan = plans[index]
    const values = delegatedParameterValues(plan.parameters, arguments_)
    if (values) return { plan, values }
  }
  return undefined
}

function substituteStructParameters(expression: string, values: ReadonlyMap<string, string>): string {
  let result = expression
  for (const [name, value] of values) result = result.replace(new RegExp(`\\b${name}\\b`, "g"), `(${value})`)
  return result
}

function resolvedStructFields(
  index: number,
  plans: readonly StructInitializerPlan[],
  fields: readonly StructField[],
  stack = new Set<number>(),
): Map<string, string> {
  if (stack.has(index)) return new Map()
  const nextStack = new Set(stack).add(index)
  const plan = plans[index]
  const values = new Map<string, string>()
  if (plan.delegation) {
    const delegated = findDelegatedInitializer(plans, plan.delegation, index)
    if (delegated) {
      const targetIndex = plans.indexOf(delegated.plan)
      const targetFields = resolvedStructFields(targetIndex, plans, fields, nextStack)
      for (const [field, expression] of targetFields) values.set(field, substituteStructParameters(expression, delegated.values))
    }
  }
  for (const [field, expression] of plan.assignments) values.set(field, expression)
  for (const field of fields) {
    if (values.has(field.name)) continue
    const parameter = plan.parameters.find(item => item.name === field.name)
    if (parameter) values.set(field.name, parameter.name)
    else if (field.defaultValue !== undefined && field.kind !== "state") values.set(field.name, `(${field.defaultValue})`)
    else values.set(field.name, "undefined")
  }
  return values
}

function delegatedStructInitializer(
  name: string,
  plan: StructInitializerPlan,
  fields: readonly StructField[],
  plans: readonly StructInitializerPlan[],
  index: number,
): string {
  const parameters = plan.parameters
  const assignments = resolvedStructFields(index, plans, fields)
  const checks = parameters.map((parameter, parameterIndex) => parameter.kind === "value"
    ? "true"
    : parameter.kind === "binding"
      ? `(args[${parameterIndex}] && typeof args[${parameterIndex}] === "object" && (Object.getOwnPropertyDescriptor(args[${parameterIndex}], "value")?.get || Object.getOwnPropertyDescriptor(args[${parameterIndex}], "value")?.set))`
      : parameter.required
        ? `typeof args[${parameterIndex}] === "function"`
        : `(args[${parameterIndex}] === undefined || typeof args[${parameterIndex}] === "function")`)
  const values = fields.map(field => {
    const expression = assignments.get(field.name) ?? "undefined"
    const parameter = parameters.find(item => item.name === field.name)
    const resolved = parameter?.kind === "viewBuilder" && (expression === `${parameter.name}()` || expression === `(${parameter.name})()`)
      ? `resolveBuilderClosure(${parameter.name})`
      : expression
    return `${field.name}: ${resolved}`
  })
  const signature = `${name}(${parameters.map(parameter => `${parameter.kind === "viewBuilder" ? "@ViewBuilder " : parameter.kind === "action" ? "@Action " : parameter.kind === "binding" ? "@Binding " : ""}${parameter.label ?? parameter.name}${parameter.defaultValue === undefined ? "" : ` = ${parameter.defaultValue}`}`).join(", ")})`
  const metadata = `[${parameters.map(parameter => `{ name: ${JSON.stringify(parameter.name)}, kind: ${JSON.stringify(parameter.kind)}, label: ${parameter.label ? JSON.stringify(parameter.label) : "undefined"}, labelRequired: ${parameter.labelRequired === true}, required: ${parameter.required}, trailing: ${parameter.trailing === true}, type: ${parameter.type ? JSON.stringify(parameter.type) : "undefined"} }`).join(", ")}]`
  const required = parameters.filter(parameter => parameter.required).length
  const maximum = parameters.length
  return `initializer(${JSON.stringify(signature)}, args => args.length >= ${required} && args.length <= ${maximum}${checks.length ? ` && ${checks.join(" && ")}` : ""}, args => { ${parameters.map((parameter, parameterIndex) => `const ${parameter.name} = args[${parameterIndex}]${parameter.defaultValue ? ` === undefined ? (${parameter.defaultValue}) : args[${parameterIndex}]` : ""}` ).join("; ")}; return { ${values.join(", ")} } }, ${metadata})`
}

function lowerStructDefinition(declaration: ReturnType<typeof parseMuseStructs>[number], registry: InitializerSymbolRegistry = canonicalInitializerSymbols): string {
    const fields: StructField[] = declaration.fields.map(field => ({
      name: field.name,
      kind: field.kind === "state" ? "state" : field.kind === "binding" ? "binding" : "value",
      type: field.type,
      defaultValue: field.initializer,
    }))
    const plans = structInitializerPlans(declaration)
    const initializers = plans.map((plan, index) => delegatedStructInitializer(declaration.name, plan, fields, plans, index))
    const stateFields = fields.filter(field => field.kind === "state")
    const state = stateFields.length === 0
      ? ""
      : `, state: () => ({ ${stateFields.map(field => `${field.name}: ${field.defaultValue !== undefined && /^State\s*\(/.test(field.defaultValue) ? field.defaultValue : `State(${field.defaultValue ?? "undefined"})`}`).join(", ")} })`
    const bodySource = declaration.bodyExpressionSource.trim().replace(/^return\s+/, "").replace(/;\s*$/, "")
    const fieldMetadata = `fields: [${declaration.fields.map(field => `{ name: ${JSON.stringify(field.name)}, kind: ${JSON.stringify(field.kind)}, type: ${field.type === undefined ? "undefined" : JSON.stringify(field.type)}, defaultValue: ${field.initializer === undefined ? "undefined" : JSON.stringify(field.initializer)} }`).join(", ")}]`
    const definitionMetadata = [
      declaration.genericParameters === undefined ? undefined : `genericParameters: ${JSON.stringify(declaration.genericParameters)}`,
      fieldMetadata,
    ].filter((item): item is string => item !== undefined).join(", ")
    return `defineView(${JSON.stringify(declaration.name)}, { ${definitionMetadata}, initializers: [${initializers.join(", ")}]${state}, body: (props: any) => { const { ${fields.map(field => field.name).join(", ")} } = props; return ${lowerRange(bodySource, registry)} } })`
}

function lowerStructs(source: string, registry: InitializerSymbolRegistry = canonicalInitializerSymbols): string {
  const declarations = parseMuseStructs(source)
  if (declarations.length === 0) return source
  let output = source
  for (const declaration of [...declarations].sort((left, right) => right.range.start - left.range.start)) {
    const definition = lowerStructDefinition(declaration, registry)
    const nested = declaration.nested ?? []
    const replacement = nested.length === 0
      ? `const ${declaration.name} = ${definition}`
      : `const ${declaration.name} = (() => { ${nested.map(item => `const ${item.name} = ${lowerStructDefinition(item)}`).join("; ")}; return Object.assign(${definition}, { ${nested.map(item => item.name).join(", ")} }); })()`
    output = output.slice(0, declaration.range.start) + replacement + output.slice(declaration.range.end)
  }
  return output
}

function lowerStaticStructCalls(source: string, declarations: readonly MuseStruct[]): string {
  if (declarations.length === 0) return source
  const known = new Map<string, MuseStruct>()
  const add = (declaration: MuseStruct): void => {
    known.set(declaration.name, declaration)
    for (const nested of declaration.nested ?? []) add(nested)
  }
  for (const declaration of declarations) add(declaration)

  const file = ts.createSourceFile("muse-specialization.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const edits: Array<{ start: number; end: number; replacement: string }> = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const declaration = known.get(node.expression.text)
      const initializerIndex = declaration && staticInitializerIndex(declaration, node.arguments.map(argument => argument.getText(file)).join(", "), node.expression.getStart(file))
      if (initializerIndex !== undefined) {
        const argumentsSource = node.arguments.map(argument => argument.getText(file)).join(", ")
        edits.push({
          start: node.expression.getStart(file),
          end: node.end,
          replacement: `${node.expression.text}.viewType.createNodeSpecialized(${initializerIndex}, [${argumentsSource}])`,
        })
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  let result = source
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end)
  }
  return result
}

function lowerTopLevelState(source: string): string {
  const file = ts.createSourceFile("muse-state.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declarations: Array<{ name: string; statement: string }> = []
  const edits: Array<{ start: number; end: number; replacement: string }> = []
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue
    const stateDeclarations = statement.declarationList.declarations.filter(declaration => {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer || !ts.isCallExpression(declaration.initializer)) return false
      return ts.isIdentifier(declaration.initializer.expression) && declaration.initializer.expression.text === "State"
    })
    if (stateDeclarations.length === 0) continue
    const keyword = (statement.declarationList.flags & ts.NodeFlags.Let) !== 0 ? "let" : (statement.declarationList.flags & ts.NodeFlags.Const) !== 0 ? "const" : "var"
    for (const declaration of stateDeclarations) {
      declarations.push({
        name: (declaration.name as ts.Identifier).text,
        statement: `${keyword} ${(declaration.name as ts.Identifier).text} = ${declaration.initializer!.getText(file)};`,
      })
    }
    const preserved = statement.declarationList.declarations.filter(declaration => !stateDeclarations.includes(declaration))
    const prefix = source.slice(statement.getStart(file), statement.declarationList.getStart(file))
    const semicolon = source.slice(statement.getStart(file), statement.end).trimEnd().endsWith(";") ? ";" : ""
    const replacement = preserved.length === 0
      ? ""
      : `${prefix}${keyword} ${preserved.map(declaration => declaration.getText(file)).join(", ")}${semicolon}`
    edits.push({ start: statement.getStart(file), end: statement.end, replacement })
  }
  if (declarations.length === 0) return source
  let stripped = source
  for (const edit of [...edits].sort((left, right) => right.start - left.start)) {
    stripped = stripped.slice(0, edit.start) + edit.replacement + stripped.slice(edit.end)
  }
  const viewIndex = stripped.search(/\bview\s*\(/)
  if (viewIndex < 0) return source
  const open = stripped.indexOf("(", viewIndex)
  const close = matching(stripped, open, "(", ")")
  const argument = stripped.slice(open + 1, close).trim()
  const arrow = /^\(\s*\)\s*=>\s*([\s\S]*)$/.exec(argument)
  if (!arrow) return source
  const stateSource = declarations.map(declaration => declaration.statement).join(" ")
  const names = declarations.map(declaration => declaration.name)
  const replacement = `view({ state: () => { ${stateSource} return { ${names.join(", ")} } }, body: ({ ${names.join(", ")} }) => ${arrow[1]} })`
  return stripped.slice(0, viewIndex) + replacement + stripped.slice(close + 1)
}

function ensureImports(source: string): string {
  const required = ["defineView", "initializer", "resolveBuilderClosure", "namedArguments", "overloadClosure", "Binding", "State", "Element", "modifiedContent"]
    .filter(name => new RegExp(`\\b${name}(?:<[^()\\n]*>)?\\s*\\(`).test(source) || (name === "defineView" && /const\s+[A-Z]\w*\s*=\s*defineView/.test(source)))
  let result = source
  if (required.length === 0) return result
  const imports = [...result.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*(["'])(muse|@muse\/core)\2[\t ]*;?/g)]
  const imported = new Set(imports.flatMap(match => match[1].split(",").map(value => value.trim()).filter(Boolean)))
  const missing = required.filter(name => !imported.has(name))
  if (missing.length === 0) return result
  const existingCore = imports.find(match => match[3] === "@muse/core")
  if (!existingCore) return `import { ${missing.join(", ")} } from "@muse/core"\n${result}`
  const names = existingCore[1].split(",").map(value => value.trim()).filter(Boolean)
  for (const name of missing) if (!names.includes(name)) names.push(name)
  const replacement = `import { ${names.join(", ")} } from ${existingCore[2]}@muse/core${existingCore[2]}`
  result = result.slice(0, existingCore.index) + replacement + result.slice(existingCore.index + existingCore[0].length)
  return result
}

function lowerNamedMuseCalls(source: string, registry: InitializerSymbolRegistry = canonicalInitializerSymbols): string {
  let output = source
  let iterations = 0
  while (true) {
    if (++iterations > output.length + 1) throw syntaxError("Muse named-argument lowering did not advance", output.length)
    const calls = [...output.matchAll(/\b[A-Z][A-Za-z0-9_$]*\s*\(/g)]
    let replacement: { start: number; end: number; value: string } | undefined
    for (const match of calls.reverse()) {
      const start = match.index ?? 0
      const name = /^[A-Z][A-Za-z0-9_$]*/.exec(match[0])?.[0]
      if (!name) continue
      const preceding = output.slice(0, start).trimEnd()
      if (/\b(?:function|class|interface|type|new)$/.test(preceding) || preceding.endsWith(".")) continue
      const open = output.indexOf("(", start + name.length)
      const close = matching(output, open, "(", ")")
      const argumentSource = output.slice(open + 1, close)
      if (!splitTopLevel(argumentSource).some(argument => topLevelColon(argument) >= 0)) continue
      replacement = { start, end: close + 1, value: `${name}(${lowerArguments(argumentSource, name, registry)})` }
      break
    }
    if (!replacement) return output
    output = output.slice(0, replacement.start) + replacement.value + output.slice(replacement.end)
  }
}

function initializerRegistryFor(declarations: readonly MuseStruct[]): Map<string, readonly SemanticInitializerSymbol[]> {
  const registry = new Map(canonicalInitializerSymbols)
  const add = (declaration: MuseStruct): void => {
    registry.set(
      declaration.name,
      structInitializerPlans(declaration).map((plan, index) => semanticInitializerSymbol(declaration.name, plan, index)),
    )
    for (const nested of declaration.nested ?? []) add(nested)
  }
  for (const declaration of declarations) add(declaration)
  return registry
}

function lowerVueComponentImports(source: string): string {
  const file = ts.createSourceFile("muse-vue-imports.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const existingNames = new Set<string>()
  const collectNames = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) existingNames.add(node.text)
    ts.forEachChild(node, collectNames)
  }
  collectNames(file)
  const replacements: Array<{ start: number; end: number; value: string }> = []
  let index = 0
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    if (!/\.vue$/i.test(statement.moduleSpecifier.text) || statement.importClause?.isTypeOnly) continue
    const importedName = statement.importClause?.name?.text
      ?? (statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)
        ? statement.importClause.namedBindings.elements.find(element => element.propertyName?.text === "default")?.name.text
        : undefined)
    if (!importedName) continue
    let adapterName = `__museForeignComponent${index++}`
    while (existingNames.has(adapterName)) adapterName = `__museForeignComponent${index++}`
    existingNames.add(adapterName)
    const quote = source[statement.moduleSpecifier.getStart(file)]
    const module = statement.moduleSpecifier.text
    const lineStart = source.lastIndexOf("\n", statement.getStart(file) - 1) + 1
    const indent = source.slice(lineStart, statement.getStart(file)).match(/^[ \t]*/)?.[0] ?? ""
    replacements.push({
      start: statement.getStart(file),
      end: statement.end,
      value: `${indent}import ${adapterName} from ${quote}${module}${quote}\n${indent}const ${importedName} = __museForeignComponent(${adapterName})`,
    })
  }
  if (replacements.length === 0) return source
  let result = source
  for (const replacement of replacements.reverse()) result = result.slice(0, replacement.start) + replacement.value + result.slice(replacement.end)
  return `import { foreignComponent as __museForeignComponent } from "@muse/vue"\n${result}`
}

export function transformMuseSource(source: string, fileName = "muse-source.ts"): string {
  const withVueImports = lowerVueComponentImports(source)
  const declarations = parseMuseStructs(withVueImports)
  const registry = initializerRegistryFor(declarations)
  validateKnownCalls(parseMuseBuilder(withVueImports), registry)
  validateKnownTypeScriptCalls(withVueImports, registry)
  for (const declaration of declarations) {
    validateKnownCalls(parseMuseBuilder(declaration.bodyExpressionSource, declaration.bodyExpressionRange.start), registry)
  }
  const lowered = lowerRange(lowerNamedMuseCalls(lowerStructs(lowerTopLevelState(withVueImports), registry), registry), registry)
  const withStaticStructCalls = lowerStaticStructCalls(lowered, declarations)
  const withStaticModifiers = lowerStaticModifierChains(withStaticStructCalls, fileName)
  return ensureImports(lowerStaticImportedCalls(withStaticModifiers, fileName))
}

function hasNamedMuseArguments(source: string): boolean {
  const calls = /\b[A-Z][A-Za-z0-9_$]*\s*\(/g
  let match: RegExpExecArray | null
  while ((match = calls.exec(source))) {
    const open = source.indexOf("(", match.index)
    const close = matching(source, open, "(", ")")
    if (/\bfunction$/.test(source.slice(0, match.index).trimEnd())) {
      calls.lastIndex = close + 1
      continue
    }
    if (splitTopLevel(source.slice(open + 1, close)).some(argument => topLevelColon(argument) >= 0)) return true
    calls.lastIndex = close + 1
  }
  return false
}

function hasBindingShorthand(source: string): boolean {
  return lowerShorthand(source) !== source
}

function hasStaticModifierSyntax(source: string): boolean {
  return Array.from(staticModifierNames).some(name => new RegExp(`\\.${name}\\s*\\(`).test(source))
}

export function hasMuseSyntax(source: string, allowRawHtml = true): boolean {
  return /\bstruct\s+[A-Z][A-Za-z0-9_$]*(?:\s*<[^>{}]*>)?\s*:\s*View/.test(source)
    || (allowRawHtml && findRawHtml(source) !== undefined)
    || findBuilder(source, 0, true) !== undefined
    || hasBindingShorthand(source)
    || hasNamedMuseArguments(source)
    || hasStaticModifierSyntax(source)
}
