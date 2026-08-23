import * as ts from "typescript"

function compilerRootFileName(fileName: string): string {
  const resolvePath = (ts.sys as typeof ts.sys & { resolvePath?: (value: string) => string }).resolvePath
  if (resolvePath) return resolvePath(fileName)
  return /^(?:[A-Za-z]:[\\/]|\/)/.test(fileName)
    ? fileName
    : `${ts.sys.getCurrentDirectory().replace(/[\\/]$/, "")}/${fileName}`
}

interface MuseTypeScriptProgram {
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

function createMuseTypeScriptProgram(source: string, fileName: string): MuseTypeScriptProgram | undefined {
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

export const staticModifierNames = new Set([
  "padding", "margin", "gap", "frame", "font", "fontSize", "bold", "foreground", "background",
  "style", "className", "withProps", "keyed", "elementRef",
])

function isMuseViewType(checker: ts.TypeChecker, type: ts.Type): boolean {
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) return false
  const alias = type.aliasSymbol?.escapedName
  if (alias === "View" || alias === "ModifiableViewNode") return true
  if (type.isUnion()) return type.types.length > 0 && type.types.every(item => isMuseViewType(checker, item))
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

  let result = source
  for (let pass = 0; pass < 8; pass += 1) {
    const program = createMuseTypeScriptProgram(result, fileName)
    if (!program) return result
    const candidates: Array<{ node: ts.CallExpression; chain: { readonly base: ts.Expression; readonly calls: readonly StaticModifierCall[] } }> = []
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const chain = staticModifierChain(node)
        const parent = node.parent
        const isNestedChain = ts.isCallExpression(parent)
          && ts.isPropertyAccessExpression(parent.expression)
          && parent.expression.expression === node
          && staticModifierNames.has(parent.expression.name.text)
        if (chain && !isNestedChain && isMuseViewType(program.checker, program.checker.getTypeAtLocation(chain.base))) {
          candidates.push({ node, chain })
          return
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(program.sourceFile)
    if (candidates.length === 0) return result

    const edits = candidates.map(({ node, chain }) => {
      const base = result.slice(chain.base.getStart(program.sourceFile), chain.base.end)
      const modifiers = chain.calls.map(({ name, node: call }) => {
        const argumentsSource = call.arguments.length === 0 && (name === "padding" || name === "margin")
          ? "0"
          : call.arguments.map(argument => result.slice(argument.getStart(program.sourceFile), argument.end)).join(", ")
        return `{ name: ${JSON.stringify(name)}, arguments: [${argumentsSource}] }`
      }).join(", ")
      return {
        start: node.getStart(program.sourceFile),
        end: node.end,
        replacement: `modifiedContent(${base}, [${modifiers}])`,
      }
    }).sort((left, right) => right.start - left.start)

    for (const edit of edits) result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end)
    if (result === source) return result
    source = result
  }
  return result
}

export function lowerStaticImportedCalls(source: string, fileName: string): string {
  const syntax = ts.createSourceFile("muse-imports.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const importedNames = new Set<string>()
  for (const statement of syntax.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue
    if (statement.importClause.name) importedNames.add(statement.importClause.name.text)
    const bindings = statement.importClause.namedBindings
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) importedNames.add(element.name.text)
    }
  }
  if (!Array.from(importedNames).some(name => new RegExp(`\\b${name}\\s*\\(`).test(source))) return source

  const program = createMuseTypeScriptProgram(source, fileName)
  if (!program) return source
  const { sourceFile, checker } = program
  const hasRestParameter = (signature: ts.Signature): boolean => signature.parameters.some(parameter => (
    parameter.declarations?.some(declaration => ts.isParameter(declaration) && declaration.dotDotDotToken) ?? false
  ))
  const candidates = new Map<ts.CallExpression, number>()
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
        candidates.set(node, initializerIndex)
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
    const argumentsSource = candidate.arguments.map(argument => {
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
    }).join(", ")
    const replacement = `${candidate.expression.getText(sourceFile)}.viewType.createNodeSpecialized(${candidates.get(candidate)}, [${argumentsSource}])`
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
