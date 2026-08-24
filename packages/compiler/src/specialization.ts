import * as ts from "typescript"
import * as Core from "@vune-ui/core"
import { initializersOf, swiftUIStaticModifierNames, type InitializerParameter } from "@vune-ui/core"

function compilerRootFileName(fileName: string): string {
  const resolvePath = (ts.sys as typeof ts.sys & { resolvePath?: (value: string) => string }).resolvePath
  if (resolvePath) return resolvePath(fileName)
  return /^(?:[A-Za-z]:[\\/]|\/)/.test(fileName)
    ? fileName
    : `${ts.sys.getCurrentDirectory().replace(/[\\/]$/, "")}/${fileName}`
}
interface VuneTypeScriptProgram {
  readonly sourceFile: ts.SourceFile
  readonly checker: ts.TypeChecker
}

interface CachedSourceFile {
  readonly text: string
  readonly languageVersionKey: string
  readonly sourceFile: ts.SourceFile
}

const externalSourceFiles = new Map<string, CachedSourceFile>()
const previousPrograms = new Map<string, ts.Program>()
const maximumProgramCacheSize = 32

function rememberProgram(root: string, program: ts.Program): void {
  previousPrograms.delete(root)
  previousPrograms.set(root, program)
  while (previousPrograms.size > maximumProgramCacheSize) {
    const oldest = previousPrograms.keys().next().value as string | undefined
    if (!oldest) break
    previousPrograms.delete(oldest)
  }
}

function createVuneTypeScriptProgram(source: string, fileName: string): VuneTypeScriptProgram | undefined {
  const rootFileName = compilerRootFileName(fileName)
  const options: ts.CompilerOptions = {
    allowJs: false,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
  }
  const host = ts.createCompilerHost(options, true)
  const normalize = (value: string): string => value.replaceAll("\\", "/")
  const root = normalize(rootFileName)
  const originalReadFile = host.readFile.bind(host)
  const originalFileExists = host.fileExists.bind(host)
  host.fileExists = requested => normalize(requested) === root || originalFileExists(requested)
  host.readFile = requested => normalize(requested) === root ? source : originalReadFile(requested)
  host.getSourceFile = (requested, languageVersion, onError) => {
    if (normalize(requested) === root) return ts.createSourceFile(requested, source, languageVersion, true, ts.ScriptKind.TS)
    const text = originalReadFile(requested)
    if (text === undefined) {
      onError?.(`Unable to read ${requested}`)
      return undefined
    }
    const cacheKey = normalize(requested)
    const languageVersionKey = typeof languageVersion === "number" ? String(languageVersion) : JSON.stringify(languageVersion)
    const cached = externalSourceFiles.get(cacheKey)
    if (cached && cached.text === text && cached.languageVersionKey === languageVersionKey) return cached.sourceFile
    const extension = requested.toLowerCase().split(".").pop()
    const scriptKind = extension === "tsx" ? ts.ScriptKind.TSX
      : extension === "jsx" ? ts.ScriptKind.JSX
        : extension === "js" || extension === "mjs" || extension === "cjs" ? ts.ScriptKind.JS
          : extension === "json" ? ts.ScriptKind.JSON
            : ts.ScriptKind.TS
    const sourceFile = ts.createSourceFile(requested, text, languageVersion, true, scriptKind)
    externalSourceFiles.set(cacheKey, { text, languageVersionKey, sourceFile })
    return sourceFile
  }

  let program: ts.Program
  try {
    program = ts.createProgram([rootFileName], options, host, previousPrograms.get(root))
    rememberProgram(root, program)
  } catch {
    previousPrograms.delete(root)
    return undefined
  }
  const sourceFile = program.getSourceFile(rootFileName)
  return sourceFile ? { sourceFile, checker: program.getTypeChecker() } : undefined
}

export const staticModifierNames = new Set(swiftUIStaticModifierNames)

function isVuneViewType(checker: ts.TypeChecker, type: ts.Type): boolean {
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) return false
  const alias = type.aliasSymbol?.escapedName
  if (alias === "View" || alias === "ModifiableViewNode") return true
  if (type.isUnion()) return type.types.length > 0 && type.types.every(item => isVuneViewType(checker, item))
  const rendered = checker.typeToString(type)
  return rendered === "View" || rendered === "ModifiableViewNode"
}

interface StaticModifierCall {
  readonly name: string
  readonly node: ts.CallExpression
}

function staticModifierChain(node: ts.CallExpression): { readonly base: ts.Expression; readonly calls: readonly StaticModifierCall[] } | undefined {
  const calls: StaticModifierCall[] = []
  let current: ts.Expression = node
  while (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
    const name = current.expression.name.text
    if (!staticModifierNames.has(name) || current.expression.questionDotToken) break
    calls.unshift({ name, node: current })
    current = current.expression.expression
  }
  return calls.length > 0 ? { base: current, calls } : undefined
}

export function lowerStaticModifierChains(source: string, fileName: string): string {
  if (!Array.from(staticModifierNames).some(name => new RegExp(`\\.${name}\\s*\\(`).test(source))) return source

  // A maximal modifier chain is lowered in one edit, so reparsing the complete
  // module up to eight times only repeated TypeScript program construction.
  // One semantic pass is sufficient: every disjoint maximal chain is collected
  // before any source edit is applied.
  const program = createVuneTypeScriptProgram(source, fileName)
  if (!program) return source
  const candidates: Array<{ node: ts.CallExpression; chain: { readonly base: ts.Expression; readonly calls: readonly StaticModifierCall[] } }> = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const chain = staticModifierChain(node)
      const parent = node.parent
      const isNestedChain = ts.isCallExpression(parent)
        && ts.isPropertyAccessExpression(parent.expression)
        && parent.expression.expression === node
        && staticModifierNames.has(parent.expression.name.text)
      if (chain && !isNestedChain && isVuneViewType(program.checker, program.checker.getTypeAtLocation(chain.base))) {
        candidates.push({ node, chain })
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(program.sourceFile)
  if (candidates.length === 0) return source

  const edits = candidates.map(({ node, chain }) => {
    const base = source.slice(chain.base.getStart(program.sourceFile), chain.base.end)
    const modifiers = chain.calls.map(({ name, node: call }) => {
      const argumentsSource = call.arguments.length === 0 && (name === "padding" || name === "margin")
        ? "0"
        : call.arguments.map(argument => source.slice(argument.getStart(program.sourceFile), argument.end)).join(", ")
      return `[${JSON.stringify(name)}, [${argumentsSource}]]`
    }).join(", ")
    return {
      start: node.getStart(program.sourceFile),
      end: node.end,
      replacement: `modifiedContentCompiled(${base}, [${modifiers}])`,
    }
  }).sort((left, right) => right.start - left.start)

  let result = source
  for (const edit of edits) result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end)
  return result
}

function isNamedArgumentsCarrier(node: ts.Expression): node is ts.CallExpression {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "namedArguments"
}

function containsUnsafeCompiledType(type: ts.Type, checker: ts.TypeChecker, seen = new Set<ts.Type>()): boolean {
  if (seen.has(type)) return false
  seen.add(type)
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) return true
  if (type.isUnionOrIntersection()) return type.types.some(item => containsUnsafeCompiledType(item, checker, seen))

  // A callable value can look safe at the outer object level while returning
  // `any`/`unknown`. That is particularly dangerous for @ViewBuilder inputs:
  // the trusted compiled path deliberately skips the runtime generic-builder
  // validation performed by createNodeSpecialized(). Keep those calls on the
  // guarded path unless the callable's input/output types are also known.
  for (const signature of checker.getSignaturesOfType(type, ts.SignatureKind.Call)) {
    if (containsUnsafeCompiledType(checker.getReturnTypeOfSignature(signature), checker, seen)) return true
    for (const parameter of signature.parameters) {
      const declaration = parameter.valueDeclaration ?? parameter.declarations?.[0]
      if (!declaration) continue
      try {
        if (containsUnsafeCompiledType(checker.getTypeOfSymbolAtLocation(parameter, declaration), checker, seen)) return true
      } catch {
        return true
      }
    }
  }

  if (type.flags & ts.TypeFlags.Object) {
    const object = type as ts.ObjectType
    if (object.objectFlags & ts.ObjectFlags.Reference) {
      try {
        if (checker.getTypeArguments(object as ts.TypeReference).some(item => containsUnsafeCompiledType(item, checker, seen))) return true
      } catch {
        return true
      }
    }
  }
  return false
}

function parameterType(checker: ts.TypeChecker, signature: ts.Signature, index: number, location: ts.Node): ts.Type | undefined {
  const parameter = signature.parameters[index]
  if (!parameter) return undefined
  const declaration = parameter.valueDeclaration ?? parameter.declarations?.[0] ?? location
  try {
    return checker.getTypeOfSymbolAtLocation(parameter, declaration)
  } catch {
    return undefined
  }
}

function isViewBuilderParameter(checker: ts.TypeChecker, signature: ts.Signature, index: number, location: ts.Node): boolean {
  const type = parameterType(checker, signature, index, location)
  if (!type) return false
  const rendered = checker.typeToString(type)
  return /\bViewBuilder(?:Closure|Content)\b/.test(rendered)
}

function stripSimpleViewBuilder(rendered: string): string | undefined {
  const expression = /^\s*\(\s*\)\s*=>\s*(\[[\s\S]*\])\s*$/.exec(rendered)
  if (expression) return expression[1]
  const block = /^\s*\(\s*\)\s*=>\s*\{\s*return\s+(\[[\s\S]*\])\s*;?\s*\}\s*$/.exec(rendered)
  return block?.[1]
}

interface ImportedCallCandidate {
  readonly initializerIndex: number
  readonly signature: ts.Signature
  readonly compiled: boolean
  readonly runtimeParameters?: readonly InitializerParameter[]
}

const canonicalRuntimeModules = new Set(["vune-ui", "@vune-ui/core", "@vune-ui/react"])

function runtimeViewImports(sourceFile: ts.SourceFile): ReadonlyMap<string, string> {
  const result = new Map<string, string>()
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    if (!canonicalRuntimeModules.has(statement.moduleSpecifier.text)) continue
    const named = statement.importClause.namedBindings
    if (!named || !ts.isNamedImports(named)) continue
    for (const element of named.elements) {
      const exported = element.propertyName?.text ?? element.name.text
      const value = (Core as Record<string, unknown>)[exported]
      if (typeof value === "function" && initializersOf(value).length > 0) result.set(element.name.text, exported)
    }
  }
  return result
}

interface NamedCarrierProperty {
  readonly key: string
  readonly value: ts.Expression
}

function namedCarrierProperties(node: ts.Expression): readonly NamedCarrierProperty[] | undefined {
  if (!isNamedArgumentsCarrier(node) || node.arguments.length !== 1 || !ts.isObjectLiteralExpression(node.arguments[0])) return undefined
  const result: NamedCarrierProperty[] = []
  for (const property of node.arguments[0].properties) {
    if (ts.isPropertyAssignment(property)) {
      const key = ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) || ts.isNumericLiteral(property.name)
        ? property.name.text
        : undefined
      if (key === undefined) return undefined
      result.push({ key, value: property.initializer })
      continue
    }
    if (ts.isShorthandPropertyAssignment(property)) {
      result.push({ key: property.name.text, value: property.name })
      continue
    }
    return undefined
  }
  return result
}

function canNormalizeCompiledArguments(
  args: readonly ts.Expression[],
  parameters: readonly InitializerParameter[] | undefined,
  checker: ts.TypeChecker,
): boolean {
  const carriers = args.flatMap((argument, index) => isNamedArgumentsCarrier(argument) ? [{ argument, index }] : [])
  if (carriers.length === 0) return true
  if (carriers.length !== 1 || !parameters || parameters.some(parameter => parameter.variadic)) return false
  const properties = namedCarrierProperties(carriers[0].argument)
  if (!properties || properties.length === 0) return false
  if (properties.some(property => containsUnsafeCompiledType(checker.getTypeAtLocation(property.value), checker))) return false

  const keys = new Set(properties.map(property => property.key))
  const filled = new Set<number>()
  const optionIndex = parameters.findIndex(parameter => {
    const allowed = parameter.properties
    return !!allowed && keys.size > 0 && [...keys].every(key => allowed.includes(key))
  })
  if (optionIndex >= 0) {
    filled.add(optionIndex)
  } else {
    for (const property of properties) {
      const index = parameters.findIndex(parameter => parameter.label === property.key)
      if (index < 0 || filled.has(index)) return false
      filled.add(index)
    }
  }

  let positional = args.length - 1
  for (let index = 0; index < parameters.length && positional > 0; index += 1) {
    if (filled.has(index)) continue
    filled.add(index)
    positional -= 1
  }
  if (positional !== 0) return false
  return parameters.every((parameter, index) => filled.has(index) || parameter.required === false)
}

/**
 * Resolve imported Vune constructor overloads with the TypeChecker. Calls with
 * fully-known positional types use the trusted AOT initializer path; calls
 * involving named carriers, any/unknown values, or variadics keep the guarded
 * specialization path. Simple zero-argument ViewBuilder closures are lowered
 * to their produced child arrays so runtime closure allocation/execution is
 * avoided entirely.
 */
export function lowerStaticImportedCalls(source: string, fileName: string): string {
  const syntax = ts.createSourceFile("vune-imports.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const importedNames = new Set<string>()
  const runtimeImports = runtimeViewImports(syntax)
  for (const statement of syntax.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue
    if (statement.importClause.name) importedNames.add(statement.importClause.name.text)
    const bindings = statement.importClause.namedBindings
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) importedNames.add(element.name.text)
    }
  }
  if (!Array.from(importedNames).some(name => new RegExp(`\\b${name}\\s*\\(`).test(source))) return source

  const program = createVuneTypeScriptProgram(source, fileName)
  if (!program) return source
  const { sourceFile, checker } = program
  const hasRestParameter = (signature: ts.Signature): boolean => signature.parameters.some(parameter => (
    parameter.declarations?.some(declaration => ts.isParameter(declaration) && declaration.dotDotDotToken) ?? false
  ))
  const candidates = new Map<ts.CallExpression, ImportedCallCandidate>()
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const type = checker.getTypeAtLocation(node.expression)
      const viewType = checker.getPropertyOfType(type, "viewType")
      const signatures = checker.getSignaturesOfType(type, ts.SignatureKind.Call)
      const resolved = checker.getResolvedSignature(node)
      const initializerIndex = resolved
        ? signatures.findIndex(signature => signature === resolved || signature.declaration === resolved.declaration)
        : -1
      const selected = initializerIndex < 0 ? undefined : signatures[initializerIndex]
      if (viewType && selected && !hasRestParameter(selected)) {
        const runtimeName = runtimeImports.get(node.expression.text)
        const runtimeInitializers = runtimeName ? initializersOf((Core as Record<string, unknown>)[runtimeName]) : []
        let runtimeIndex = initializerIndex
        let runtimeParameters = runtimeInitializers[runtimeIndex]?.parameters
        if (node.arguments.some(isNamedArgumentsCarrier) && runtimeInitializers.length > 0) {
          const matches = runtimeInitializers.flatMap((initializer, index) => initializer.parameters
            && canNormalizeCompiledArguments(node.arguments, initializer.parameters, checker)
            ? [{ index, parameters: initializer.parameters }]
            : [])
          if (matches.length === 1) {
            runtimeIndex = matches[0].index
            runtimeParameters = matches[0].parameters
          }
        }
        const normalized = canNormalizeCompiledArguments(node.arguments, runtimeParameters, checker)
        // `namedArguments(...)` is a compiler carrier and can resolve to `any`
        // in partially-built workspaces. Its individual property expressions
        // were already checked by canNormalizeCompiledArguments(), so do not
        // let the synthetic wrapper alone disable an otherwise trusted call.
        const safeTypes = node.arguments.every((argument, argumentIndex) => {
          if (isNamedArgumentsCarrier(argument)) return normalized
          // A compiler-lowered ViewBuilder is a structural array factory. Once
          // its simple closure shape is recognized, the closure's broad TS
          // return type (often `any` in generated/custom View boundaries) does
          // not make the initializer unsafe: the builder contents remain graph
          // values and are validated/materialized independently. This is what
          // lets an intrinsic container become a compiled template even when a
          // custom View child must stay as a dynamic slot.
          if (isViewBuilderParameter(checker, selected, argumentIndex, argument)) {
            const text = source.slice(argument.getStart(sourceFile), argument.end)
            if (stripSimpleViewBuilder(text) !== undefined) return true
          }
          return !containsUnsafeCompiledType(checker.getTypeAtLocation(argument), checker)
        })
        candidates.set(node, { initializerIndex: runtimeIndex, signature: selected, compiled: normalized && safeTypes, runtimeParameters })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  if (candidates.size === 0) return source

  const ordered = [...candidates.keys()].sort((left, right) => left.getStart(sourceFile) - right.getStart(sourceFile) || right.end - left.end)
  const children = new Map<ts.CallExpression | undefined, ts.CallExpression[]>()
  const stack: ts.CallExpression[] = []
  for (const candidate of ordered) {
    while (stack.length > 0 && candidate.getStart(sourceFile) >= stack[stack.length - 1].end) stack.pop()
    const parent = stack[stack.length - 1]
    const siblings = children.get(parent) ?? []
    siblings.push(candidate)
    children.set(parent, siblings)
    stack.push(candidate)
  }

  const replacements = new Map<ts.CallExpression, string>()
  const renderCandidate = (candidate: ts.CallExpression): string => {
    const cached = replacements.get(candidate)
    if (cached) return cached
    const plan = candidates.get(candidate)!
    const renderNode = (argument: ts.Expression): string => {
      let rendered = source.slice(argument.getStart(sourceFile), argument.end)
      const nested = (children.get(candidate) ?? [])
        .filter(child => child.getStart(sourceFile) >= argument.getStart(sourceFile) && child.end <= argument.end)
        .sort((left, right) => right.getStart(sourceFile) - left.getStart(sourceFile))
      for (const child of nested) {
        const replacement = renderCandidate(child)
        const start = child.getStart(sourceFile) - argument.getStart(sourceFile)
        const end = child.end - argument.getStart(sourceFile)
        rendered = rendered.slice(0, start) + replacement + rendered.slice(end)
      }
      return rendered
    }

    const renderedArguments = candidate.arguments.map(renderNode)
    let compiledArguments: string[] | undefined
    if (plan.compiled && plan.runtimeParameters) {
      const carrierIndex = candidate.arguments.findIndex(isNamedArgumentsCarrier)
      if (carrierIndex >= 0) {
        const carrierProperties = namedCarrierProperties(candidate.arguments[carrierIndex])
        if (carrierProperties) {
          const values = Array<string | undefined>(plan.runtimeParameters.length).fill(undefined)
          const keys = new Set(carrierProperties.map(property => property.key))
          const optionIndex = plan.runtimeParameters.findIndex(parameter => {
            const allowed = parameter.properties
            return !!allowed && keys.size > 0 && [...keys].every(key => allowed.includes(key))
          })
          if (optionIndex >= 0) {
            values[optionIndex] = `{ ${carrierProperties.map(property => `${JSON.stringify(property.key)}: ${renderNode(property.value)}`).join(", ")} }`
          } else {
            for (const property of carrierProperties) {
              const parameterIndex = plan.runtimeParameters.findIndex(parameter => parameter.label === property.key)
              if (parameterIndex >= 0) values[parameterIndex] = renderNode(property.value)
            }
          }

          let positionalIndex = 0
          for (let index = 0; index < plan.runtimeParameters.length; index += 1) {
            if (values[index] !== undefined) continue
            while (positionalIndex < candidate.arguments.length && positionalIndex === carrierIndex) positionalIndex += 1
            if (positionalIndex < candidate.arguments.length) {
              values[index] = renderedArguments[positionalIndex]
              positionalIndex += 1
              while (positionalIndex < candidate.arguments.length && positionalIndex === carrierIndex) positionalIndex += 1
            } else if (plan.runtimeParameters[index].required === false) {
              values[index] = "undefined"
            }
          }
          // Structural validity was proven by canNormalizeCompiledArguments().
          // At this stage we only need to ensure every runtime slot received a
          // concrete source expression (including explicit `undefined` for an
          // omitted optional parameter).
          if (values.every(value => value !== undefined)) compiledArguments = values as string[]
        }
      }
    }

    if (!compiledArguments) {
      compiledArguments = renderedArguments.map((rendered, argumentIndex) => {
        const argument = candidate.arguments[argumentIndex]
        if (plan.compiled && isViewBuilderParameter(checker, plan.signature, argumentIndex, argument)) {
          return stripSimpleViewBuilder(rendered) ?? rendered
        }
        return rendered
      })
    } else {
      compiledArguments = compiledArguments.map((rendered, argumentIndex) => {
        const parameter = plan.runtimeParameters?.[argumentIndex]
        return parameter?.kind === "viewBuilder" ? stripSimpleViewBuilder(rendered) ?? rendered : rendered
      })
    }

    const argumentsSource = compiledArguments.join(", ")
    const method = plan.compiled ? "createNodeCompiled" : "createNodeSpecialized"
    const replacement = `${candidate.expression.getText(sourceFile)}.viewType.${method}(${plan.initializerIndex}, [${argumentsSource}])`
    replacements.set(candidate, replacement)
    return replacement
  }

  let result = source
  for (const candidate of (children.get(undefined) ?? []).sort((left, right) => right.getStart(sourceFile) - left.getStart(sourceFile))) {
    const start = candidate.getStart(sourceFile)
    result = result.slice(0, start) + renderCandidate(candidate) + result.slice(candidate.end)
  }
  return result
}

function importedBindingsOf(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const bindings = new Set<string>()
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue
    if (statement.importClause.name) bindings.add(statement.importClause.name.text)
    const named = statement.importClause.namedBindings
    if (named && ts.isNamedImports(named)) for (const element of named.elements) bindings.add(element.name.text)
    if (named && ts.isNamespaceImport(named)) bindings.add(named.name.text)
  }
  return bindings
}

function isStaticLiteralExpression(node: ts.Expression, imported: ReadonlySet<string>): boolean {
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return true
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword) return true
  if (ts.isIdentifier(node)) return node.text === "undefined"
  if (ts.isParenthesizedExpression(node)) return isStaticLiteralExpression(node.expression, imported)
  if (ts.isPrefixUnaryExpression(node)) return (node.operator === ts.SyntaxKind.PlusToken || node.operator === ts.SyntaxKind.MinusToken) && isStaticLiteralExpression(node.operand, imported)
  if (ts.isArrayLiteralExpression(node)) return node.elements.every(element => ts.isExpression(element) && isStaticLiteralExpression(element, imported))
  if (ts.isObjectLiteralExpression(node)) return node.properties.every(property => {
    if (!ts.isPropertyAssignment(property)) return false
    if (property.name && ts.isComputedPropertyName(property.name)) return false
    return isStaticLiteralExpression(property.initializer, imported)
  })
  return isStaticGraphExpression(node, imported)
}

function compiledViewReceiver(node: ts.Expression, imported: ReadonlySet<string>): boolean {
  if (!ts.isPropertyAccessExpression(node) || node.name.text !== "createNodeCompiled") return false
  const viewType = node.expression
  return ts.isPropertyAccessExpression(viewType)
    && viewType.name.text === "viewType"
    && ts.isIdentifier(viewType.expression)
    && imported.has(viewType.expression.text)
}

function isStaticGraphExpression(node: ts.Expression, imported: ReadonlySet<string>): boolean {
  if (!ts.isCallExpression(node)) return false
  if (compiledViewReceiver(node.expression, imported)) {
    return node.arguments.length === 2
      && ts.isNumericLiteral(node.arguments[0])
      && ts.isArrayLiteralExpression(node.arguments[1])
      && isStaticLiteralExpression(node.arguments[1], imported)
  }
  if (ts.isIdentifier(node.expression) && node.expression.text === "modifiedContentCompiled" && imported.has(node.expression.text)) {
    return node.arguments.length === 2
      && isStaticGraphExpression(node.arguments[0], imported)
      && isStaticLiteralExpression(node.arguments[1], imported)
  }
  return false
}

function isTopLevelInitializer(node: ts.Expression): boolean {
  let current: ts.Expression = node
  while (
    ts.isParenthesizedExpression(current.parent)
    || ts.isAsExpression(current.parent)
    || ts.isTypeAssertionExpression(current.parent)
    || ts.isSatisfiesExpression(current.parent)
    || ts.isNonNullExpression(current.parent)
  ) current = current.parent

  const declaration = current.parent
  if (!ts.isVariableDeclaration(declaration) || declaration.initializer !== current) return false
  const declarationList = declaration.parent
  const statement = declarationList.parent
  return ts.isVariableDeclarationList(declarationList)
    && ts.isVariableStatement(statement)
    && ts.isSourceFile(statement.parent)
}

/**
 * Hoist immutable, import-only compiled graph subtrees out of render functions.
 * The analysis is deliberately conservative: local variables, functions,
 * getters, refs, State reads, property accesses, and opaque calls all block a
 * hoist. Dynamic parents can still reuse any fully-static child subtrees.
 */

interface CompiledViewCallShape {
  readonly node: ts.CallExpression
  readonly localName: string
  readonly runtimeName: string
  readonly initializerIndex: number
  readonly args: readonly ts.Expression[]
}

type CompilerTemplateIR =
  | string | number | bigint | boolean | null | undefined
  | { readonly kind: "slot"; readonly index: number; readonly identity: readonly (string | number)[] }
  | { readonly kind: "element"; readonly type: string; readonly props: Record<string, unknown> | null; readonly children: readonly CompilerTemplateIR[] }
  | { readonly kind: "fragment"; readonly children: readonly CompilerTemplateIR[] }

interface CompilerTemplatePlan {
  readonly root: CompilerTemplateIR
  readonly slots: readonly string[]
}

interface StaticExpressionResult {
  readonly ok: boolean
  readonly value?: unknown
}

function staticExpressionValue(node: ts.Expression): StaticExpressionResult {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) {
    return staticExpressionValue(node.expression)
  }
  if (ts.isStringLiteralLike(node)) return { ok: true, value: node.text }
  if (ts.isNumericLiteral(node)) return { ok: true, value: Number(node.text) }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { ok: true, value: true }
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { ok: true, value: false }
  if (node.kind === ts.SyntaxKind.NullKeyword) return { ok: true, value: null }
  if (ts.isIdentifier(node) && node.text === "undefined") return { ok: true, value: undefined }
  if (ts.isPrefixUnaryExpression(node)) {
    const operand = staticExpressionValue(node.operand)
    if (!operand.ok || typeof operand.value !== "number") return { ok: false }
    if (node.operator === ts.SyntaxKind.MinusToken) return { ok: true, value: -operand.value }
    if (node.operator === ts.SyntaxKind.PlusToken) return { ok: true, value: operand.value }
    return { ok: false }
  }
  if (ts.isArrayLiteralExpression(node)) {
    const values: unknown[] = []
    for (const element of node.elements) {
      if (ts.isSpreadElement(element) || ts.isOmittedExpression(element)) return { ok: false }
      const item = staticExpressionValue(element)
      if (!item.ok) return { ok: false }
      values.push(item.value)
    }
    return { ok: true, value: values }
  }
  if (ts.isObjectLiteralExpression(node)) {
    const value: Record<string, unknown> = {}
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) return { ok: false }
      const key = ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) || ts.isNumericLiteral(property.name)
        ? property.name.text
        : undefined
      if (key === undefined) return { ok: false }
      const item = staticExpressionValue(property.initializer)
      if (!item.ok) return { ok: false }
      value[key] = item.value
    }
    return { ok: true, value }
  }
  return { ok: false }
}

function compiledViewCallShape(
  node: ts.Node,
  runtimeImports: ReadonlyMap<string, string>,
): CompiledViewCallShape | undefined {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== "createNodeCompiled") return undefined
  const viewType = node.expression.expression
  if (!ts.isPropertyAccessExpression(viewType) || viewType.name.text !== "viewType" || !ts.isIdentifier(viewType.expression)) return undefined
  if (node.arguments.length !== 2 || !ts.isNumericLiteral(node.arguments[0]) || !ts.isArrayLiteralExpression(node.arguments[1])) return undefined
  const runtimeName = runtimeImports.get(viewType.expression.text)
  if (!runtimeName) return undefined
  return {
    node,
    localName: viewType.expression.text,
    runtimeName,
    initializerIndex: Number(node.arguments[0].text),
    args: [...node.arguments[1].elements].filter(ts.isExpression),
  }
}

function staticTemplateDataSource(value: unknown, seen = new Set<object>()): string | undefined {
  if (value === undefined) return "undefined"
  if (value === null) return "null"
  if (typeof value === "string") return JSON.stringify(value)
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : undefined
  if (typeof value === "bigint") return `${String(value)}n`
  if (typeof value !== "object") return undefined
  if (seen.has(value)) return undefined
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      const items = value.map(item => staticTemplateDataSource(item, seen))
      return items.some(item => item === undefined) ? undefined : `[${items.join(", ")}]`
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return undefined
    const entries: string[] = []
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") return undefined
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !("value" in descriptor)) return undefined
      const item = staticTemplateDataSource(descriptor.value, seen)
      if (item === undefined) return undefined
      entries.push(`${JSON.stringify(key)}: ${item}`)
    }
    return `{ ${entries.join(", ")} }`
  } catch {
    return undefined
  } finally {
    seen.delete(value)
  }
}

function offsetTemplateSlots(value: CompilerTemplateIR, offset: number): CompilerTemplateIR {
  if (value !== null && typeof value === "object") {
    if (value.kind === "slot") return { kind: "slot", index: value.index + offset, identity: value.identity }
    if (value.kind === "fragment") return { kind: "fragment", children: value.children.map(child => offsetTemplateSlots(child, offset)) }
    return { ...value, children: value.children.map(child => offsetTemplateSlots(child, offset)) }
  }
  return value
}

function prefixTemplateIdentity(value: CompilerTemplateIR, prefix: readonly (string | number)[]): CompilerTemplateIR {
  if (value !== null && typeof value === "object") {
    if (value.kind === "slot") return { ...value, identity: [...prefix, ...value.identity] }
    if (value.kind === "fragment") return { kind: "fragment", children: value.children.map(child => prefixTemplateIdentity(child, prefix)) }
    return { ...value, children: value.children.map(child => prefixTemplateIdentity(child, prefix)) }
  }
  return value
}

function compilerTemplateSource(value: CompilerTemplateIR): string | undefined {
  if (value !== null && typeof value === "object") {
    if (value.kind === "slot") return `{ kind: "slot", index: ${value.index}, identity: [${value.identity.map(item => typeof item === "number" ? String(item) : JSON.stringify(item)).join(", ")}] }`
    if (value.kind === "fragment") {
      const children = value.children.map(compilerTemplateSource)
      return children.some(item => item === undefined) ? undefined : `{ kind: "fragment", children: [${children.join(", ")}] }`
    }
    const props = value.props === null ? "null" : staticTemplateDataSource(value.props)
    if (props === undefined) return undefined
    const children = value.children.map(compilerTemplateSource)
    return children.some(item => item === undefined) ? undefined : `{ kind: "element", type: ${JSON.stringify(value.type)}, props: ${props}, children: [${children.join(", ")}] }`
  }
  return staticTemplateDataSource(value)
}

/**
 * Turn compiled intrinsic View construction into an immutable host template plus
 * runtime graph/value slots. The pass evaluates only the already-proven builtin
 * initializer with static non-builder arguments, so host props/styles come from
 * core's real View body instead of a second compiler-side semantic table.
 *
 * Dynamic Text content and builder children become slots. Any opaque argument,
 * function-valued prop, non-host graph node, spread builder, or unsupported
 * builtin simply keeps the existing createNodeCompiled graph path.
 */
export function lowerCompiledViewTemplates(source: string): string {
  if (!source.includes("createNodeCompiled")) return source
  const sourceFile = ts.createSourceFile("vune-template-specialization.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const runtimeImports = runtimeViewImports(sourceFile)
  if (runtimeImports.size === 0) return source

  type Marker = { readonly token: object; readonly slot?: string; readonly nested?: CompilerTemplatePlan }
  const memo = new Map<ts.CallExpression, CompilerTemplatePlan | null>()
  const building = new Set<ts.CallExpression>()

  const build = (node: ts.CallExpression): CompilerTemplatePlan | undefined => {
    if (memo.has(node)) return memo.get(node) ?? undefined
    if (building.has(node)) return undefined
    const shape = compiledViewCallShape(node, runtimeImports)
    if (!shape) { memo.set(node, null); return undefined }
    const target = (Core as Record<string, any>)[shape.runtimeName]
    const runtimeInitializers = initializersOf(target)
    const initializer = runtimeInitializers[shape.initializerIndex]
    const parameters = initializer?.parameters
    if (typeof target !== "function" || !initializer || !parameters || parameters.length !== shape.args.length) {
      memo.set(node, null)
      return undefined
    }
    building.add(node)
    try {
      const markers = new Map<object, Marker>()
      const runtimeArgs: unknown[] = []
      const slotMarker = (slot: string): object => {
        const token = Object.freeze({ __vuneCompilerTemplateSlot: markers.size })
        markers.set(token, { token, slot })
        return token
      }
      const viewMarker = (marker: Omit<Marker, "token">): object => {
        // A real fragment-shaped node safely passes through ViewBuilder content
        // and is retained by reference by intrinsic host bodies.
        const token = Core.viewFragment([]) as object
        markers.set(token, { token, ...marker })
        return token
      }

      for (let index = 0; index < shape.args.length; index += 1) {
        const argument = shape.args[index]
        const parameter = parameters[index]
        if (parameter.kind === "viewBuilder") {
          if (!ts.isArrayLiteralExpression(argument)) { memo.set(node, null); return undefined }
          const children: unknown[] = []
          for (const child of argument.elements) {
            if (!ts.isExpression(child) || ts.isSpreadElement(child)) { memo.set(node, null); return undefined }
            if (ts.isCallExpression(child)) {
              const nested = build(child)
              if (nested) {
                children.push(viewMarker({ nested }))
                continue
              }
            }
            const literal = staticExpressionValue(child)
            if (literal.ok && (literal.value === null || literal.value === undefined || ["string", "number", "bigint", "boolean"].includes(typeof literal.value))) {
              children.push(literal.value)
              continue
            }
            children.push(viewMarker({ slot: source.slice(child.getStart(sourceFile), child.end) }))
          }
          runtimeArgs.push(children)
          continue
        }
        if (shape.runtimeName === "Text" && shape.initializerIndex === 0 && index === 0) {
          const literal = staticExpressionValue(argument)
          if (literal.ok && (typeof literal.value === "string" || typeof literal.value === "number")) runtimeArgs.push(literal.value)
          else runtimeArgs.push(slotMarker(source.slice(argument.getStart(sourceFile), argument.end)))
          continue
        }
        const literal = staticExpressionValue(argument)
        if (!literal.ok) { memo.set(node, null); return undefined }
        runtimeArgs.push(literal.value)
      }

      let graph: any
      try {
        graph = target.viewType.createNodeCompiled(shape.initializerIndex, runtimeArgs)
      } catch {
        memo.set(node, null)
        return undefined
      }
      const slots: string[] = []
      const serialize = (value: unknown, identity: readonly (string | number)[] = []): CompilerTemplateIR | undefined => {
        if (typeof value === "object" && value !== null) {
          const marker = markers.get(value)
          if (marker) {
            if (marker.nested) {
              const offset = slots.length
              slots.push(...marker.nested.slots)
              return prefixTemplateIdentity(offsetTemplateSlots(marker.nested.root, offset), identity)
            }
            if (marker.slot !== undefined) {
              const index = slots.length
              slots.push(marker.slot)
              return { kind: "slot", index, identity }
            }
          }
        }
        if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return value
        if (typeof value !== "object") return undefined
        const item = value as { readonly kind?: unknown; readonly type?: unknown; readonly props?: unknown; readonly children?: unknown }
        if (item.kind === "fragment" && Array.isArray(item.children)) {
          const children = item.children.map((child, index) => serialize(child, [...identity, "fragment", index]))
          return children.some(child => child === undefined) ? undefined : { kind: "fragment", children: children as CompilerTemplateIR[] }
        }
        if (item.kind === "element" && typeof item.type === "string" && Array.isArray(item.children)) {
          if (item.props !== null && item.props !== undefined && staticTemplateDataSource(item.props) === undefined) return undefined
          const children = item.children.map((child, index) => serialize(child, [...identity, "element", index]))
          return children.some(child => child === undefined) ? undefined : {
            kind: "element",
            type: item.type,
            props: item.props === null || item.props === undefined ? null : item.props as Record<string, unknown>,
            children: children as CompilerTemplateIR[],
          }
        }
        return undefined
      }
      const root = serialize(graph)
      if (root === undefined) { memo.set(node, null); return undefined }
      const plan = { root, slots } satisfies CompilerTemplatePlan
      memo.set(node, plan)
      return plan
    } finally {
      building.delete(node)
    }
  }

  const roots: Array<{ readonly node: ts.CallExpression; readonly plan: CompilerTemplatePlan }> = []
  const visit = (node: ts.Node, templatedAncestor = false): void => {
    if (ts.isCallExpression(node)) {
      const plan = build(node)
      if (plan && plan.slots.length > 0 && !templatedAncestor) {
        roots.push({ node, plan })
        return
      }
    }
    ts.forEachChild(node, child => visit(child, templatedAncestor))
  }
  visit(sourceFile)
  if (roots.length === 0) return source

  const names = new Set<string>()
  const collectNames = (node: ts.Node): void => { if (ts.isIdentifier(node)) names.add(node.text); ts.forEachChild(node, collectNames) }
  collectNames(sourceFile)
  let counter = 0
  const nextName = (): string => {
    let name = `__vuneTemplate${counter++}`
    while (names.has(name)) name = `__vuneTemplate${counter++}`
    names.add(name)
    return name
  }

  const declarations: string[] = []
  const edits = roots.map(({ node, plan }) => {
    const rootSource = compilerTemplateSource(plan.root)
    if (rootSource === undefined) return undefined
    const name = nextName()
    declarations.push(`const ${name} = defineCompiledTemplate(${rootSource}, ${plan.slots.length})`)
    return {
      start: node.getStart(sourceFile),
      end: node.end,
      replacement: `compiledTemplate(${name}, [${plan.slots.join(", ")}])`,
    }
  }).filter((value): value is { start: number; end: number; replacement: string } => value !== undefined)
  if (edits.length === 0) return source

  let result = source
  for (const edit of edits.sort((left, right) => right.start - left.start)) result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end)
  const reparsed = ts.createSourceFile("vune-template-output.ts", result, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const importEnd = reparsed.statements.filter(ts.isImportDeclaration).at(-1)?.end ?? 0
  const prefix = `${importEnd > 0 ? "\n" : ""}${declarations.join("\n")}\n`
  return result.slice(0, importEnd) + prefix + result.slice(importEnd)
}

export function hoistStaticViewSubtrees(source: string): string {
  const sourceFile = ts.createSourceFile("vune-static-hoist.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const imported = importedBindingsOf(sourceFile)
  if (imported.size === 0) return source
  const candidates: ts.Expression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isExpression(node) && isStaticGraphExpression(node, imported)) {
      if (!isTopLevelInitializer(node)) candidates.push(node)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  if (candidates.length === 0) return source

  let suffix = 0
  const nextName = (): string => {
    let name: string
    do name = `__vuneStatic${suffix++}`
    while (new RegExp(`\\b${name}\\b`).test(source))
    return name
  }
  const hoists = candidates.map(node => ({ node, name: nextName(), expression: source.slice(node.getStart(sourceFile), node.end) }))
  let result = source
  for (const { node, name } of [...hoists].sort((left, right) => right.node.getStart(sourceFile) - left.node.getStart(sourceFile))) {
    result = result.slice(0, node.getStart(sourceFile)) + name + result.slice(node.end)
  }

  let insertion = 0
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) break
    insertion = statement.end
  }
  // Edits before the insertion point are impossible: candidates are expressions
  // and imports contain none. The original insertion offset therefore remains
  // valid after right-to-left replacements.
  const declarations = hoists.map(({ name, expression }) => `\nconst ${name} = ${expression}`).join("") + "\n"
  return result.slice(0, insertion) + declarations + result.slice(insertion)
}
