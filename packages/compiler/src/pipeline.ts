import * as ts from "typescript"
import { parseMuseBuilder, parseMuseStructs, lowerMuseBuilderAst } from "./ast.js"
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
import { resolveSemanticInitializer, type SemanticArgument, type SemanticInitializerSymbol } from "@muse/core"
import { lowerStaticImportedCalls, lowerStaticModifierChains, staticModifierNames } from "./specialization.js"

const nonBindingDollarNames = new Set([
  "attrs", "data", "emit", "el", "forceUpdate", "nextTick", "options", "parent", "props", "refs", "root", "slots", "watch",
])

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

function lowerClosure(value: string): string {
  const source = value.trim()
  if (!source.startsWith("{") || matching(source, 0, "{", "}") !== source.length - 1) return lowerRange(source)
  const body = source.slice(1, -1).trim()
  const lowered = lowerStatements(body)
  const asynchronous = containsAwaitKeyword(body)
  const action = asynchronous || /\b(const|let|var|return|throw)\b/.test(body)
  const builder = action ? "() => []" : `() => [${lowered}]`
  return `overloadClosure(${builder}, ${asynchronous ? "async " : ""}() => {${lowerRange(body)}})`
}

function lowerArguments(source: string): string {
  const positional: string[] = []
  const named: string[] = []
  for (const argument of splitTopLevel(source)) {
    const colon = topLevelColon(argument)
    if (colon >= 0 && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(argument.slice(0, colon).trim())) {
      const label = argument.slice(0, colon).trim()
      named.push(`${label}: ${lowerClosureOrExpression(argument.slice(colon + 1))}`)
    } else {
      positional.push(lowerClosureOrExpression(argument))
    }
  }
  if (named.length === 0) return positional.join(", ")
  return [...positional, `namedArguments({ ${named.join(", ")} })`].join(", ")
}

function lowerClosureOrExpression(source: string): string {
  const value = source.trim()
  if (value.startsWith("{") && matching(value, 0, "{", "}") === value.length - 1) return lowerClosure(value)
  return lowerShorthand(lowerRange(value))
}

function lowerConditional(source: string): string | undefined {
  const match = /^if\s*\(/.exec(source)
  if (!match) return undefined
  const open = source.indexOf("(", match.index + match[0].length - 1)
  const close = matching(source, open, "(", ")")
  const thenOpen = skipTrivia(source, close + 1)
  if (source[thenOpen] !== "{") return undefined
  const thenClose = matching(source, thenOpen, "{", "}")
  const afterThen = skipTrivia(source, thenClose + 1)
  const condition = source.slice(open + 1, close).trim()
  const thenValue = `[${lowerStatements(source.slice(thenOpen + 1, thenClose))}]`
  if (source.slice(afterThen, afterThen + 4) !== "else") return `(${lowerShorthand(condition)} ? ${thenValue} : [])`
  const elseOpen = skipTrivia(source, afterThen + 4)
  if (source[elseOpen] !== "{") return undefined
  const elseClose = matching(source, elseOpen, "{", "}")
  return `(${lowerShorthand(condition)} ? ${thenValue} : [${lowerStatements(source.slice(elseOpen + 1, elseClose))}])`
}

function lowerStatements(source: string): string {
  const values: string[] = []
  for (const statement of splitStatements(source)) {
    const conditional = lowerConditional(statement)
    if (conditional) values.push(conditional)
    else if (/^\s*(const|let|var|return|throw)\b/.test(statement)) continue
    else values.push(lowerRange(statement))
  }
  return values.join(", ")
}

function lowerAstClosure(body: string, parameter?: string): string {
  const parsed = parseMuseBuilder(body)
  const lowered = lowerMuseBuilderAst(parsed, {
    transformRaw: value => lowerRange(value),
    closure: (nestedBody, nestedParameter) => lowerAstClosure(nestedBody, nestedParameter),
  }).join(", ")
  if (parameter) return `(${parameter}) => [${lowered}]`
  const asynchronous = containsAwaitKeyword(body)
  const action = asynchronous || /\b(const|let|var|return|throw)\b/.test(body)
  const builder = action ? "() => []" : `() => [${lowered}]`
  return `overloadClosure(${builder}, ${asynchronous ? "async " : ""}() => {${lowerRange(body)}})`
}

function lowerBuilder(call: BuilderCall, source: string): string {
  const parsed = parseMuseBuilder(source.slice(call.start, call.end), call.start)
  const lowered = lowerMuseBuilderAst(parsed, {
    transformRaw: value => lowerRange(value),
    closure: (body, parameter) => lowerAstClosure(body, parameter),
  })
  if (lowered.length === 1) return lowered[0]
  return `${call.name}(${lowerArguments(call.argumentSource)})`
}

function lowerRange(source: string): string {
  let output = ""
  let cursor = 0
  let iterations = 0
  while (cursor < source.length) {
    if (++iterations > source.length + 1) throw syntaxError("Muse lowering did not advance past a builder expression", cursor)
    const call = findBuilder(source, cursor)
    const html = findRawHtml(source, cursor, lowerRange)
    if (!call && !html) break
    if (html && (!call || html.start < call.start)) {
      output += lowerShorthand(source.slice(cursor, html.start))
      output += html.code
      cursor = html.end
      continue
    }
    output += lowerShorthand(source.slice(cursor, call!.start))
    output += lowerBuilder(call!, source)
    cursor = call!.end
  }
  output += lowerShorthand(source.slice(cursor))
  return output
}

interface StructParameter {
  readonly name: string
  readonly label?: string
  readonly kind: "value" | "binding" | "viewBuilder" | "action"
  readonly required: boolean
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
  const parameters = splitTopLevel(parameterSource).filter(Boolean).map(structParameter)
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

function staticInitializerIndex(declaration: MuseStruct, argumentSource: string): number | undefined {
  const plans = structInitializerPlans(declaration)
  const arguments_ = compilerInitializerArguments(argumentSource).map(compilerSemanticArgument)
  const result = resolveSemanticInitializer(
    plans.map((plan, index) => semanticInitializerSymbol(declaration.name, plan, index)),
    arguments_,
    declaration.genericParameters,
  )
  return result.ok ? result.resolution.initializerIndex : undefined
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
  const metadata = `[${parameters.map(parameter => `{ name: ${JSON.stringify(parameter.name)}, kind: ${JSON.stringify(parameter.kind)}, label: ${parameter.label ? JSON.stringify(parameter.label) : "undefined"}, required: ${parameter.required}, type: ${parameter.type ? JSON.stringify(parameter.type) : "undefined"} }`).join(", ")}]`
  const required = parameters.filter(parameter => parameter.required).length
  const maximum = parameters.length
  return `initializer(${JSON.stringify(signature)}, args => args.length >= ${required} && args.length <= ${maximum}${checks.length ? ` && ${checks.join(" && ")}` : ""}, args => { ${parameters.map((parameter, parameterIndex) => `const ${parameter.name} = args[${parameterIndex}]${parameter.defaultValue ? ` === undefined ? (${parameter.defaultValue}) : args[${parameterIndex}]` : ""}` ).join("; ")}; return { ${values.join(", ")} } }, ${metadata})`
}

function lowerStructDefinition(declaration: ReturnType<typeof parseMuseStructs>[number]): string {
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
    return `defineView(${JSON.stringify(declaration.name)}, { ${definitionMetadata}, initializers: [${initializers.join(", ")}]${state}, body: (props: any) => { const { ${fields.map(field => field.name).join(", ")} } = props; return ${lowerRange(bodySource)} } })`
}

function lowerStructs(source: string): string {
  const declarations = parseMuseStructs(source)
  if (declarations.length === 0) return source
  let output = source
  for (const declaration of [...declarations].sort((left, right) => right.range.start - left.range.start)) {
    const definition = lowerStructDefinition(declaration)
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
      const initializerIndex = declaration && staticInitializerIndex(declaration, node.arguments.map(argument => argument.getText(file)).join(", "))
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
  const declarations: Array<{ name: string; statement: string; start: number; end: number }> = []
  const pattern = /^const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*State(?:<[^()\n]*>)?\(([^\n;]*)\)\s*;?\s*$/gm
  for (const match of source.matchAll(pattern)) {
    const start = match.index ?? 0
    declarations.push({ name: match[1], statement: `const ${match[1]} = State(${match[2].trim()});`, start, end: start + match[0].length })
  }
  if (declarations.length === 0) return source
  let stripped = source
  for (const declaration of [...declarations].sort((left, right) => right.start - left.start)) {
    stripped = stripped.slice(0, declaration.start) + stripped.slice(declaration.end)
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
    .filter(name => source.includes(`${name}(`) || (name === "defineView" && /const\s+[A-Z]\w*\s*=\s*defineView/.test(source)))
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

function lowerNamedMuseCalls(source: string): string {
  let output = source
  while (true) {
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
      replacement = { start, end: close + 1, value: `${name}(${lowerArguments(argumentSource)})` }
      break
    }
    if (!replacement) return output
    output = output.slice(0, replacement.start) + replacement.value + output.slice(replacement.end)
  }
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
  const lowered = lowerRange(lowerNamedMuseCalls(lowerStructs(lowerTopLevelState(withVueImports))))
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
