import * as ts from "typescript"
import { parseVuneBuilder, parseVuneStructs, lowerVuneBuilderAst, type VuneBuilderNode, type VuneBuilderProgram, type VuneCallExpression } from "./ast.js"
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
import * as Core from "@vune-ui/core"
import { resolveSemanticCall, type SemanticArgument, type SemanticCallResolution, type SemanticInitializerSymbol, type SemanticViewTypeSymbol } from "@vune-ui/core"
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

function symbolsForCall(call: VuneCallExpression, registry: InitializerSymbolRegistry = canonicalInitializerSymbols): readonly SemanticInitializerSymbol[] | undefined {
  return registry.get(call.callee)
}

class VuneInitializerSyntaxError extends SyntaxError {
  readonly code = "VUNE_INITIALIZER" as const
  readonly offset: number

  constructor(message: string, offset: number) {
    super(message)
    this.name = "VuneInitializerSyntaxError"
    this.offset = offset
  }
}

function buttonInitializerMessage(call: VuneCallExpression): string {
  const labels = call.arguments.flatMap(argument => argument.label ? [argument.label] : [])
  if (labels.includes("label") && labels.includes("action") && labels.indexOf("label") < labels.indexOf("action")) {
    return "Button arguments must follow declaration order: action:, label:."
  }
  if (call.trailing && call.arguments[0]?.label === "action") {
    return "Button's custom-label initializer requires:\nButton(action: { ... }, label: { ... })"
  }
  return "Button requires a text label before its trailing action.\nUse:\nButton(\"Save\") { ... }"
}

function knownCallArguments(call: VuneCallExpression): readonly SemanticArgument[] {
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

function canDeferDynamicButton(call: VuneCallExpression, arguments_: readonly SemanticArgument[]): boolean {
  if (!arguments_.some(argument => argument.type === "unknown")) return false
  if (call.trailing) return call.arguments.length === 1 && !call.arguments[0]?.label
  const labels = call.arguments.map(argument => argument.label)
  return labels.length === 2 && labels[0] === "action" && labels[1] === "label"
}

function resolveKnownCall(call: VuneCallExpression, registry: InitializerSymbolRegistry = canonicalInitializerSymbols): {
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
  const arguments_ = knownCallArguments(call)
  const result = resolveSemanticCall(viewType, arguments_)
  if (!result.resolvedInitializer) {
    if (call.callee === "Button" && canDeferDynamicButton(call, arguments_)) return undefined
    if (call.callee === "Button") throw new VuneInitializerSyntaxError(buttonInitializerMessage(call), call.range.start)
    if (call.trailing && canonicalInitializerSymbols.get(call.callee) !== symbols) {
      throw new VuneInitializerSyntaxError(
        result.diagnostics[0]?.message ?? `No matching initializer for ${call.callee}.`,
        call.range.start,
      )
    }
    return undefined
  }
  return { symbols, initializerIndex: result.resolvedInitializer.index, resolution: result }
}

function validateKnownCalls(program: VuneBuilderProgram, registry: InitializerSymbolRegistry = canonicalInitializerSymbols): void {
  const visit = (node: VuneBuilderNode): void => {
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
  const file = ts.createSourceFile("vune-call-validation.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && registry.has(node.expression.text)) {
      // The Vune scanner owns trailing closures. TypeScript sees the call
      // prefix as a complete call, so leave that shape to validateKnownCalls.
      const callText = source.slice(node.expression.end, node.end)
      const hasVuneLabels = /(?:^|,)\s*[A-Za-z_$][A-Za-z0-9_$]*\s*:/.test(callText)
      if (!hasVuneLabels && source[skipTrivia(source, node.end)] !== "{" && node.expression.text === "Button") {
        const callSource = `${node.expression.text}(${node.arguments.map(argument => argument.getText(file)).join(", ")})`
        const parsed = parseVuneBuilder(callSource, node.expression.getStart(file)).statements[0]
        if (parsed?.kind === "call") resolveKnownCall(parsed, registry)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
}

function closureRoleForKnownCall(
  call: VuneCallExpression,
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
 * span so the rest of Vune's syntax lowering keeps its original formatting.
 * This prevents member properties, declarations, strings, comments, regexes,
 * and identifiers containing `$` from being mistaken for projections.
 */
function lowerShorthand(source: string): string {
  const file = ts.createSourceFile("vune-shorthand.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
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

function isViewBuilderExpression(expression: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(expression)
    || ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression)
    || ts.isNonNullExpression(expression)
    || ts.isSatisfiesExpression(expression)
    || ts.isAwaitExpression(expression)) {
    return isViewBuilderExpression(expression.expression)
  }
  if (ts.isConditionalExpression(expression)) {
    return isViewBuilderExpression(expression.whenTrue) || isViewBuilderExpression(expression.whenFalse)
  }
  if (ts.isBinaryExpression(expression)) {
    const operator = expression.operatorToken.kind
    if (operator === ts.SyntaxKind.AmpersandAmpersandToken
      || operator === ts.SyntaxKind.BarBarToken
      || operator === ts.SyntaxKind.QuestionQuestionToken) {
      return isViewBuilderExpression(expression.left) || isViewBuilderExpression(expression.right)
    }
    return false
  }
  if (ts.isArrayLiteralExpression(expression)) return expression.elements.some(item => ts.isExpression(item) && isViewBuilderExpression(item))
  if (ts.isCallExpression(expression) || ts.isNewExpression(expression)) return true
  if (ts.isIdentifier(expression) || ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) return true
  return false
}

function lowerViewBuilderAstStatements(source: string, registry: InitializerSymbolRegistry, childrenName: string): string {
  // First lower nested Vune-only expressions (trailing closures, raw HTML,
  // binding shorthand) so the statement tree is valid TypeScript. Then let
  // TypeScript own control-flow parsing instead of maintaining a second,
  // incomplete statement grammar in Vune.
  const lowered = lowerRange(source, registry)
  const wrapper = `function __vune_builder__() {\n${lowered}\n}`
  const file = ts.createSourceFile("vune-view-builder.ts", wrapper, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const fn = file.statements.find(ts.isFunctionDeclaration)
  if (!fn?.body) return lowered

  const factory = ts.factory
  const pushExpression = (expression: ts.Expression): ts.Statement => factory.createExpressionStatement(
    factory.createCallExpression(
      factory.createPropertyAccessExpression(factory.createIdentifier(childrenName), "push"),
      undefined,
      [expression],
    ),
  )

  const transformStatement = (statement: ts.Statement): ts.Statement => {
    if (ts.isExpressionStatement(statement)) {
      return isViewBuilderExpression(statement.expression) ? pushExpression(statement.expression) : statement
    }
    if (ts.isBlock(statement)) return factory.updateBlock(statement, statement.statements.map(transformStatement))
    if (ts.isIfStatement(statement)) {
      return factory.updateIfStatement(
        statement,
        statement.expression,
        transformStatement(statement.thenStatement),
        statement.elseStatement ? transformStatement(statement.elseStatement) : undefined,
      )
    }
    if (ts.isForStatement(statement)) {
      return factory.updateForStatement(statement, statement.initializer, statement.condition, statement.incrementor, transformStatement(statement.statement))
    }
    if (ts.isForInStatement(statement)) {
      return factory.updateForInStatement(statement, statement.initializer, statement.expression, transformStatement(statement.statement))
    }
    if (ts.isForOfStatement(statement)) {
      return factory.updateForOfStatement(statement, statement.awaitModifier, statement.initializer, statement.expression, transformStatement(statement.statement))
    }
    if (ts.isWhileStatement(statement)) return factory.updateWhileStatement(statement, statement.expression, transformStatement(statement.statement))
    if (ts.isDoStatement(statement)) return factory.updateDoStatement(statement, transformStatement(statement.statement), statement.expression)
    if (ts.isSwitchStatement(statement)) {
      const clauses = statement.caseBlock.clauses.map(clause => ts.isCaseClause(clause)
        ? factory.updateCaseClause(clause, clause.expression, clause.statements.map(transformStatement))
        : factory.updateDefaultClause(clause, clause.statements.map(transformStatement)))
      return factory.updateSwitchStatement(statement, statement.expression, factory.updateCaseBlock(statement.caseBlock, clauses))
    }
    if (ts.isTryStatement(statement)) {
      const tryBlock = factory.updateBlock(statement.tryBlock, statement.tryBlock.statements.map(transformStatement))
      const catchClause = statement.catchClause
        ? factory.updateCatchClause(
            statement.catchClause,
            statement.catchClause.variableDeclaration,
            factory.updateBlock(statement.catchClause.block, statement.catchClause.block.statements.map(transformStatement)),
          )
        : undefined
      const finallyBlock = statement.finallyBlock
        ? factory.updateBlock(statement.finallyBlock, statement.finallyBlock.statements.map(transformStatement))
        : undefined
      return factory.updateTryStatement(statement, tryBlock, catchClause, finallyBlock)
    }
    if (ts.isLabeledStatement(statement)) return factory.updateLabeledStatement(statement, statement.label, transformStatement(statement.statement))
    if (ts.isWithStatement(statement)) return factory.updateWithStatement(statement, statement.expression, transformStatement(statement.statement))
    // Function/class declarations intentionally remain opaque. A Text() call
    // inside a helper function is not a child of the surrounding ViewBuilder.
    return statement
  }

  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: false })
  return fn.body.statements
    .map(transformStatement)
    .map(statement => printer.printNode(ts.EmitHint.Unspecified, statement, file))
    .join("\n")
}

function needsStatementAwareViewBody(source: string): boolean {
  return /\b(?:const|let|var|return|throw|if|else|switch|case|for|while|do|try|catch|finally|break|continue|debugger)\b/.test(source)
}

function lowerViewBuilderClosure(body: string, parameter: string | undefined, registry: InitializerSymbolRegistry): string {
  if (!needsStatementAwareViewBody(body)) {
    const lowered = lowerVuneBuilderAst(parseVuneBuilder(body), {
      transformRaw: value => lowerRange(value, registry),
      transformArgument: (value, call, argumentIndex) => lowerForEachIdentityOptions(value, call, argumentIndex, registry),
      closure: (nestedBody, nestedParameter, nestedRole) => lowerAstClosure(nestedBody, nestedParameter, nestedRole, registry),
      closureRole: (nestedCall, context) => closureRoleForKnownCall(nestedCall, context, registry),
    }).join(", ")
    return `${parameter ? `(${parameter})` : "()"} => [${lowered}]`
  }
  const prefix = parameter ? `(${parameter})` : "()"
  let childrenName = "__vuneChildren"
  let suffix = 0
  while (new RegExp(`\\b${childrenName}\\b`).test(body)) childrenName = `__vuneChildren${++suffix}`
  const statements = lowerViewBuilderAstStatements(body, registry, childrenName)
  return `${prefix} => { const ${childrenName} = []; ${statements} return ${childrenName}; }`
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
  const parsed = calleeName ? parseVuneBuilder(`${calleeName}(${source})`).statements[0] : undefined
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

function lowerForEachIdentityOptions(source: string, call: VuneCallExpression, argumentIndex: number, registry: InitializerSymbolRegistry): string {
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
  const parsed = parseVuneBuilder(body)
  const lowered = lowerVuneBuilderAst(parsed, {
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
  const parsed = parseVuneBuilder(source.slice(call.start, call.end), call.start)
  const lowered = lowerVuneBuilderAst(parsed, {
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
    if (++iterations > source.length + 1) throw syntaxError("Vune lowering did not advance past a builder expression", cursor)
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

type VuneStruct = ReturnType<typeof parseVuneStructs>[number]

function structInitializerPlans(declaration: VuneStruct): readonly StructInitializerPlan[] {
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

function staticInitializerIndex(declaration: VuneStruct, argumentSource: string, offset = 0): number | undefined {
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
  if (result.diagnostics[0]?.code === "VUNE_INITIALIZER" && arguments_.some(argument => argument.type === "unknown")) return undefined
  throw new VuneInitializerSyntaxError(
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

function lowerStructDefinition(declaration: ReturnType<typeof parseVuneStructs>[number], registry: InitializerSymbolRegistry = canonicalInitializerSymbols): string {
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
  const declarations = parseVuneStructs(source)
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

function lowerStaticStructCalls(source: string, declarations: readonly VuneStruct[]): string {
  if (declarations.length === 0) return source
  const known = new Map<string, VuneStruct>()
  const add = (declaration: VuneStruct): void => {
    known.set(declaration.name, declaration)
    for (const nested of declaration.nested ?? []) add(nested)
  }
  for (const declaration of declarations) add(declaration)

  const file = ts.createSourceFile("vune-specialization.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
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

interface TopLevelStateDeclaration {
  readonly name?: string
  readonly statement: ts.VariableStatement
  readonly declaration: ts.VariableDeclaration
  readonly initializer: ts.Expression
  readonly eligible: boolean
}

interface VuneApiBindings {
  readonly state: ReadonlySet<string>
  readonly view: ReadonlySet<string>
  readonly namespaces: ReadonlySet<string>
  readonly blockedState: boolean
  readonly blockedView: boolean
}

function isVunePackage(moduleName: string): boolean {
  return moduleName === "vune-ui" || moduleName.startsWith("@vune-ui/")
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text]
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    return name.elements.flatMap(element => ts.isOmittedExpression(element) ? [] : bindingNames(element.name))
  }
  return []
}

function vuneApiBindings(file: ts.SourceFile): VuneApiBindings {
  const state = new Set<string>()
  const view = new Set<string>()
  const namespaces = new Set<string>()
  let blockedState = false
  let blockedView = false

  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const vune = isVunePackage(statement.moduleSpecifier.text)
      const clause = statement.importClause
      if (clause?.name) {
        if (!vune && clause.name.text === "State") blockedState = true
        if (!vune && clause.name.text === "view") blockedView = true
      }
      const bindings = clause?.namedBindings
      if (bindings && ts.isNamespaceImport(bindings)) {
        if (vune) namespaces.add(bindings.name.text)
        continue
      }
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const imported = element.propertyName?.text ?? element.name.text
          const local = element.name.text
          if (vune && imported === "State") state.add(local)
          else if (!vune && local === "State") blockedState = true
          if (vune && imported === "view") view.add(local)
          else if (!vune && local === "view") blockedView = true
        }
      }
      continue
    }
    const names: string[] = []
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) names.push(statement.name.text)
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) names.push(...bindingNames(declaration.name))
    }
    if (names.includes("State")) blockedState = true
    if (names.includes("view")) blockedView = true
  }
  return { state, view, namespaces, blockedState, blockedView }
}

function unwrapTsExpression(expression: ts.Expression): ts.Expression {
  let current = expression
  while (ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current)) {
    current = current.expression
  }
  return current
}

function isVuneApiCall(call: ts.CallExpression, api: "State" | "view", bindings: VuneApiBindings): boolean {
  const expression = unwrapTsExpression(call.expression)
  const named = api === "State" ? bindings.state : bindings.view
  const blocked = api === "State" ? bindings.blockedState : bindings.blockedView
  if (ts.isIdentifier(expression)) {
    if (named.has(expression.text)) return true
    // `.vune.ts` supports the canonical names without an explicit import; do
    // not claim them when the file has provided an unrelated binding.
    return expression.text === api && !blocked && named.size === 0
  }
  if (ts.isPropertyAccessExpression(expression)
    && expression.name.text === api
    && ts.isIdentifier(expression.expression)
    && bindings.namespaces.has(expression.expression.text)) return true
  return false
}

function collectTopLevelStates(file: ts.SourceFile, bindings: VuneApiBindings): TopLevelStateDeclaration[] {
  const states: TopLevelStateDeclaration[] = []
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue
    const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0
    const exported = statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
    for (const declaration of statement.declarationList.declarations) {
      if (!declaration.initializer) continue
      const initializer = unwrapTsExpression(declaration.initializer)
      if (!ts.isCallExpression(initializer) || !isVuneApiCall(initializer, "State", bindings)) continue
      states.push({
        name: ts.isIdentifier(declaration.name) ? declaration.name.text : undefined,
        statement,
        declaration,
        initializer: declaration.initializer,
        eligible: isConst && !exported && ts.isIdentifier(declaration.name),
      })
    }
  }
  return states
}

function isNonReferenceIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true
  if (ts.isMethodDeclaration(parent) && parent.name === node) return true
  if (ts.isPropertyDeclaration(parent) && parent.name === node) return true
  if (ts.isMethodSignature(parent) && parent.name === node) return true
  if (ts.isPropertySignature(parent) && parent.name === node) return true
  if (ts.isVariableDeclaration(parent) && parent.name === node) return true
  if (ts.isParameter(parent) && parent.name === node) return true
  if (ts.isBindingElement(parent) && parent.name === node) return true
  if (ts.isFunctionDeclaration(parent) && parent.name === node) return true
  if (ts.isClassDeclaration(parent) && parent.name === node) return true
  if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return true
  return false
}

function directBlockBindings(node: ts.SourceFile | ts.Block): Set<string> {
  const bindings = new Set<string>()
  for (const statement of node.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const name of bindingNames(declaration.name)) bindings.add(name)
      }
    } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
      bindings.add(statement.name.text)
    }
  }
  return bindings
}

function referencedStateNames(
  root: ts.Node,
  stateNames: ReadonlySet<string>,
  skipped: ReadonlySet<ts.Node> = new Set(),
): Set<string> {
  const result = new Set<string>()
  const visit = (node: ts.Node, shadowed: ReadonlySet<string>): void => {
    if (skipped.has(node)) return
    if (ts.isIdentifier(node) && stateNames.has(node.text) && !shadowed.has(node.text) && !isNonReferenceIdentifier(node)) result.add(node.text)

    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
      const local = new Set(shadowed)
      for (const parameter of node.parameters) for (const name of bindingNames(parameter.name)) local.add(name)
      if (ts.isFunctionDeclaration(node) && node.name) local.add(node.name.text)
      if (node.body) visit(node.body, local)
      return
    }
    if (ts.isBlock(node)) {
      const local = new Set(shadowed)
      for (const name of directBlockBindings(node)) local.add(name)
      ts.forEachChild(node, child => visit(child, local))
      return
    }
    if (ts.isCatchClause(node)) {
      const local = new Set(shadowed)
      if (node.variableDeclaration) for (const name of bindingNames(node.variableDeclaration.name)) local.add(name)
      visit(node.block, local)
      return
    }
    ts.forEachChild(node, child => visit(child, shadowed))
  }
  visit(root, new Set())
  return result
}

function collectVuneViewCalls(file: ts.SourceFile, bindings: VuneApiBindings): ts.CallExpression[] {
  const calls: ts.CallExpression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isVuneApiCall(node, "view", bindings)) {
      calls.push(node)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return calls.sort((left, right) => left.getStart(file) - right.getStart(file))
}

function stateDependencies(state: TopLevelStateDeclaration, stateNames: ReadonlySet<string>): Set<string> {
  return referencedStateNames(state.initializer, stateNames)
}

function transitiveStateClosure(
  initial: Iterable<string>,
  eligible: ReadonlySet<string>,
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
  const result = new Set<string>()
  const queue = [...initial]
  while (queue.length > 0) {
    const name = queue.pop()!
    if (!eligible.has(name) || result.has(name)) continue
    result.add(name)
    for (const dependency of dependencies.get(name) ?? []) queue.push(dependency)
  }
  return result
}

function lowerTopLevelState(source: string): string {
  const file = ts.createSourceFile("vune-state.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const bindings = vuneApiBindings(file)
  const states = collectTopLevelStates(file, bindings)
  const eligibleStates = states.filter((state): state is TopLevelStateDeclaration & { readonly name: string } => state.eligible && state.name !== undefined)
  if (eligibleStates.length === 0) return source
  const byName = new Map(eligibleStates.map(state => [state.name, state] as const))
  const eligibleNames = new Set(byName.keys())
  const allNames = new Set(states.flatMap(state => state.name ? [state.name] : []))
  const dependencies = new Map<string, ReadonlySet<string>>()
  for (const state of eligibleStates) dependencies.set(state.name, stateDependencies(state, allNames))

  const views = collectVuneViewCalls(file, bindings)
  if (views.length === 0) return source
  const viewSet = new Set<ts.Node>(views)

  // Any reference outside a Vune view keeps that State module-scoped. This
  // includes helper functions and ineligible/exported/mutable State factories.
  const directOutside = new Set<string>()
  const stateDeclarations = new Set(states.map(state => state.declaration))
  for (const statement of file.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (stateDeclarations.has(declaration)) {
          const state = states.find(item => item.declaration === declaration)
          if (state && !state.eligible) {
            for (const dependency of referencedStateNames(state.initializer, allNames)) directOutside.add(dependency)
          }
          continue
        }
        if (declaration.initializer) for (const name of referencedStateNames(declaration.initializer, allNames, viewSet)) directOutside.add(name)
      }
      continue
    }
    for (const name of referencedStateNames(statement, allNames, viewSet)) directOutside.add(name)
  }
  const outside = transitiveStateClosure(directOutside, eligibleNames, dependencies)

  const owners = new Map<string, Set<number>>()
  const statesByView = new Map<number, TopLevelStateDeclaration[]>()
  views.forEach((view, index) => {
    const direct = referencedStateNames(view.arguments[0] ?? view, allNames)
    const closure = transitiveStateClosure(direct, eligibleNames, dependencies)
    for (const name of closure) {
      const set = owners.get(name) ?? new Set<number>()
      set.add(index)
      owners.set(name, set)
    }
  })

  for (const state of eligibleStates) {
    const stateOwners = owners.get(state.name)
    if (outside.has(state.name) || stateOwners?.size !== 1) continue
    const owner = [...stateOwners][0]
    const list = statesByView.get(owner) ?? []
    list.push(state)
    statesByView.set(owner, list)
  }
  if (statesByView.size === 0) return source

  const hoisted = new Set([...statesByView.values()].flat().map(state => state.declaration))
  const edits: Array<{ start: number; end: number; replacement: string }> = []

  // Remove only declarations that were actually assigned to one View. Mixed
  // declarations retain their non-State siblings.
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue
    const removed = statement.declarationList.declarations.filter(declaration => hoisted.has(declaration))
    if (removed.length === 0) continue
    const preserved = statement.declarationList.declarations.filter(declaration => !hoisted.has(declaration))
    if (preserved.length === 0) {
      edits.push({ start: statement.getStart(file), end: statement.end, replacement: "" })
      continue
    }
    const keyword = (statement.declarationList.flags & ts.NodeFlags.Let) !== 0 ? "let" : (statement.declarationList.flags & ts.NodeFlags.Const) !== 0 ? "const" : "var"
    const prefix = source.slice(statement.getStart(file), statement.declarationList.getStart(file))
    const semicolon = source.slice(statement.getStart(file), statement.end).trimEnd().endsWith(";") ? ";" : ""
    edits.push({
      start: statement.getStart(file),
      end: statement.end,
      replacement: `${prefix}${keyword} ${preserved.map(declaration => declaration.getText(file)).join(", ")}${semicolon}`,
    })
  }

  for (const [viewIndex, ownedStates] of statesByView) {
    const call = views[viewIndex]
    const argument = call.arguments[0]
    if (!argument || call.arguments.length !== 1) continue
    const callee = call.expression.getText(file)
    const body = argument.getText(file)
    const unwrapped = unwrapTsExpression(argument)
    const functionBody = ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)
    const hasProps = functionBody && unwrapped.parameters.length > 0
    const names = ownedStates.map(state => state.name!)
    const declarations = ownedStates
      .sort((left, right) => left.declaration.getStart(file) - right.declaration.getStart(file))
      .map(state => `const ${state.name} = ${state.initializer.getText(file)};`)
      .join(" ")
    const renderedBody = functionBody ? `((${body})(${hasProps ? "props" : ""}))` : `(${body})`
    const bodyParameters = hasProps ? `({ ${names.join(", ")} }, props)` : `({ ${names.join(", ")} })`
    const replacement = `${callee}({ state: () => { ${declarations} return { ${names.join(", ")} } }, body: ${bodyParameters} => ${renderedBody} })`
    edits.push({ start: call.getStart(file), end: call.end, replacement })
  }

  let result = source
  for (const edit of edits.sort((left, right) => right.start - left.start)) result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end)
  return result
}

function ensureImports(source: string): string {
  const required = ["defineView", "initializer", "resolveBuilderClosure", "namedArguments", "overloadClosure", "Binding", "State", "Element", "modifiedContent"]
    .filter(name => new RegExp(`\\b${name}(?:<[^()\\n]*>)?\\s*\\(`).test(source) || (name === "defineView" && /const\s+[A-Z]\w*\s*=\s*defineView/.test(source)))
  let result = source
  if (required.length === 0) return result
  const imports = [...result.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*(["'])(vune-ui|@vune-ui\/core)\2[\t ]*;?/g)]
  const imported = new Set(imports.flatMap(match => match[1].split(",").map(value => value.trim()).filter(Boolean)))
  const missing = required.filter(name => !imported.has(name))
  if (missing.length === 0) return result
  const existingCore = imports.find(match => match[3] === "@vune-ui/core")
  if (!existingCore) return `import { ${missing.join(", ")} } from "@vune-ui/core"\n${result}`
  const names = existingCore[1].split(",").map(value => value.trim()).filter(Boolean)
  for (const name of missing) if (!names.includes(name)) names.push(name)
  const replacement = `import { ${names.join(", ")} } from ${existingCore[2]}@vune-ui/core${existingCore[2]}`
  result = result.slice(0, existingCore.index) + replacement + result.slice(existingCore.index + existingCore[0].length)
  return result
}

function lowerNamedVuneCalls(source: string, registry: InitializerSymbolRegistry = canonicalInitializerSymbols): string {
  let output = source
  let iterations = 0
  while (true) {
    if (++iterations > output.length + 1) throw syntaxError("Vune named-argument lowering did not advance", output.length)
    const calls = [...output.matchAll(/\b(?:[A-Z][A-Za-z0-9_$]*\.)*[A-Z][A-Za-z0-9_$]*\s*\(/g)]
    let replacement: { start: number; end: number; value: string } | undefined
    for (const match of calls.reverse()) {
      const start = match.index ?? 0
      const callee = /^(?:[A-Z][A-Za-z0-9_$]*\.)*[A-Z][A-Za-z0-9_$]*/.exec(match[0])?.[0]
      if (!callee) continue
      const name = callee.split(".").at(-1)!
      const preceding = output.slice(0, start).trimEnd()
      if (/\b(?:function|class|interface|type|new)$/.test(preceding) || preceding.endsWith(".")) continue
      const open = output.indexOf("(", start + callee.length)
      const close = matching(output, open, "(", ")")
      const argumentSource = output.slice(open + 1, close)
      if (!splitTopLevel(argumentSource).some(argument => topLevelColon(argument) >= 0)) continue
      replacement = { start, end: close + 1, value: `${callee}(${lowerArguments(argumentSource, name, registry)})` }
      break
    }
    if (!replacement) return output
    output = output.slice(0, replacement.start) + replacement.value + output.slice(replacement.end)
  }
}

function initializerRegistryFor(declarations: readonly VuneStruct[]): Map<string, readonly SemanticInitializerSymbol[]> {
  const registry = new Map(canonicalInitializerSymbols)
  const add = (declaration: VuneStruct): void => {
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
  const file = ts.createSourceFile("vune-vue-imports.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
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
    let adapterName = `__vuneForeignComponent${index++}`
    while (existingNames.has(adapterName)) adapterName = `__vuneForeignComponent${index++}`
    existingNames.add(adapterName)
    const quote = source[statement.moduleSpecifier.getStart(file)]
    const module = statement.moduleSpecifier.text
    const lineStart = source.lastIndexOf("\n", statement.getStart(file) - 1) + 1
    const indent = source.slice(lineStart, statement.getStart(file)).match(/^[ \t]*/)?.[0] ?? ""
    replacements.push({
      start: statement.getStart(file),
      end: statement.end,
      value: `${indent}import ${adapterName} from ${quote}${module}${quote}\n${indent}const ${importedName} = __vuneForeignComponent(${adapterName})`,
    })
  }
  if (replacements.length === 0) return source
  let result = source
  for (const replacement of replacements.reverse()) result = result.slice(0, replacement.start) + replacement.value + result.slice(replacement.end)
  return `import { foreignComponent as __vuneForeignComponent } from "@vune-ui/vue"\n${result}`
}

function lowerReactComponentImports(source: string): string {
  const file = ts.createSourceFile("vune-react-imports.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
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
    if (!/\.(?:tsx|jsx)$/i.test(statement.moduleSpecifier.text) || statement.importClause?.isTypeOnly) continue
    const importedName = statement.importClause?.name?.text
    if (!importedName) continue
    let adapterName = `__vuneReactComponent${index++}`
    while (existingNames.has(adapterName)) adapterName = `__vuneReactComponent${index++}`
    existingNames.add(adapterName)
    const quote = source[statement.moduleSpecifier.getStart(file)]
    const module = statement.moduleSpecifier.text
    const lineStart = source.lastIndexOf("\n", statement.getStart(file) - 1) + 1
    const indent = source.slice(lineStart, statement.getStart(file)).match(/^[ \t]*/)?.[0] ?? ""
    replacements.push({
      start: statement.getStart(file),
      end: statement.end,
      value: `${indent}import ${adapterName} from ${quote}${module}${quote}\n${indent}const ${importedName} = __vuneReactComponent(${adapterName})`,
    })
  }
  if (replacements.length === 0) return source
  let result = source
  for (const replacement of replacements.reverse()) result = result.slice(0, replacement.start) + replacement.value + result.slice(replacement.end)
  return `import { reactComponent as __vuneReactComponent } from "@vune-ui/react"\n${result}`
}

export function transformVuneSource(source: string, fileName = "vune-source.ts"): string {
  const withVueImports = lowerVueComponentImports(source)
  const withForeignImports = lowerReactComponentImports(withVueImports)
  const declarations = parseVuneStructs(withForeignImports)
  const registry = initializerRegistryFor(declarations)
  validateKnownCalls(parseVuneBuilder(withForeignImports), registry)
  validateKnownTypeScriptCalls(withForeignImports, registry)
  for (const declaration of declarations) {
    validateKnownCalls(parseVuneBuilder(declaration.bodyExpressionSource, declaration.bodyExpressionRange.start), registry)
  }
  const withStructs = lowerStructs(withForeignImports, registry)
  const withNamedArguments = lowerNamedVuneCalls(withStructs, registry)
  const withBuilderSyntax = lowerRange(withNamedArguments, registry)
  // State ownership is resolved only after Vune-only syntax has become valid
  // TypeScript. This lets the TypeScript AST see complete view() arguments
  // instead of truncating them at trailing builder blocks.
  const lowered = lowerTopLevelState(withBuilderSyntax)
  const withStaticStructCalls = lowerStaticStructCalls(lowered, declarations)
  const withStaticModifiers = lowerStaticModifierChains(withStaticStructCalls, fileName)
  return ensureImports(lowerStaticImportedCalls(withStaticModifiers, fileName))
}

function hasNamedVuneArguments(source: string): boolean {
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

export function hasVuneSyntax(source: string, allowRawHtml = true): boolean {
  return /\bstruct\s+[A-Z][A-Za-z0-9_$]*(?:\s*<[^>{}]*>)?\s*:\s*View/.test(source)
    || (allowRawHtml && findRawHtml(source) !== undefined)
    || findBuilder(source, 0, true) !== undefined
    || hasBindingShorthand(source)
    || hasNamedVuneArguments(source)
    || hasStaticModifierSyntax(source)
}
