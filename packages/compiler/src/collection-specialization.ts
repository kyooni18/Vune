import * as ts from "typescript"

interface RowAnalysis {
  readonly pure: boolean
  readonly indexDependent: boolean
}

interface CollectionRowPlan {
  readonly typeSource: string
  readonly propsSource: string
  readonly textSource: string
  readonly itemName: string
  readonly indexName?: string
  readonly indexIndependent: boolean
}

interface ImportedBindings {
  readonly names: Set<string>
  readonly namespaces: Set<string>
}

interface CompiledForEachCall {
  readonly initializerIndex: number
  readonly content: ts.Expression
  readonly items: ts.Expression
  readonly key?: ts.Expression
  readonly directCall?: ts.CallExpression
}

const unsafeCompiledCollectionTags = new Set([
  "script", "style", "title", "textarea", "xmp", "iframe", "noembed", "noframes", "plaintext",
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
  "table", "caption", "colgroup", "thead", "tbody", "tfoot", "tr", "td", "th",
  "select", "option", "optgroup", "template", "svg", "math",
])

const unsafeCompiledCollectionProps = new Set([
  "children",
  "key",
  "ref",
  "innerHTML",
  "outerHTML",
  "textContent",
  "innerText",
  "dangerouslySetInnerHTML",
  "__proto__",
])

function unwrapExpression(expression: ts.Expression): ts.Expression {
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

function mergeAnalysis(...values: readonly RowAnalysis[]): RowAnalysis {
  return {
    pure: values.every(value => value.pure),
    indexDependent: values.some(value => value.indexDependent),
  }
}

function staticPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text
  return undefined
}

/**
 * A compiled collection slot may only read inert data rooted in the row (or
 * the compiler-provided index). Calls, new expressions, object/array literals,
 * assignments, closures and ambient identifiers stay on the generic path.
 */
function analyzeScalarRowExpression(
  expression: ts.Expression,
  itemName: string,
  indexName: string | undefined,
): RowAnalysis {
  const value = unwrapExpression(expression)
  if (ts.isStringLiteralLike(value) || ts.isNumericLiteral(value) || ts.isBigIntLiteral(value)
    || value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword
    || value.kind === ts.SyntaxKind.NullKeyword) return { pure: true, indexDependent: false }
  if (ts.isIdentifier(value)) {
    if (value.text === itemName || value.text === "undefined") return { pure: true, indexDependent: false }
    if (indexName && value.text === indexName) return { pure: true, indexDependent: true }
    return { pure: false, indexDependent: false }
  }
  if (ts.isPropertyAccessExpression(value)) return analyzeScalarRowExpression(value.expression, itemName, indexName)
  if (ts.isElementAccessExpression(value)) {
    if (!value.argumentExpression) return { pure: false, indexDependent: false }
    return mergeAnalysis(
      analyzeScalarRowExpression(value.expression, itemName, indexName),
      analyzeScalarRowExpression(value.argumentExpression, itemName, indexName),
    )
  }
  if (ts.isPrefixUnaryExpression(value)) {
    if (value.operator !== ts.SyntaxKind.PlusToken
      && value.operator !== ts.SyntaxKind.MinusToken
      && value.operator !== ts.SyntaxKind.ExclamationToken
      && value.operator !== ts.SyntaxKind.TildeToken) return { pure: false, indexDependent: false }
    return analyzeScalarRowExpression(value.operand, itemName, indexName)
  }
  if (ts.isBinaryExpression(value)) {
    const operator = value.operatorToken.kind
    if (operator >= ts.SyntaxKind.FirstAssignment && operator <= ts.SyntaxKind.LastAssignment) return { pure: false, indexDependent: false }
    if (operator === ts.SyntaxKind.CommaToken) return { pure: false, indexDependent: false }
    return mergeAnalysis(
      analyzeScalarRowExpression(value.left, itemName, indexName),
      analyzeScalarRowExpression(value.right, itemName, indexName),
    )
  }
  if (ts.isConditionalExpression(value)) {
    return mergeAnalysis(
      analyzeScalarRowExpression(value.condition, itemName, indexName),
      analyzeScalarRowExpression(value.whenTrue, itemName, indexName),
      analyzeScalarRowExpression(value.whenFalse, itemName, indexName),
    )
  }
  if (ts.isTemplateExpression(value)) {
    return mergeAnalysis(...value.templateSpans.map(span => analyzeScalarRowExpression(span.expression, itemName, indexName)))
  }
  return { pure: false, indexDependent: false }
}

function analyzeCollectionStyle(
  expression: ts.Expression,
  itemName: string,
  indexName: string | undefined,
): RowAnalysis {
  const value = unwrapExpression(expression)
  if (value.kind === ts.SyntaxKind.NullKeyword || ts.isStringLiteralLike(value)) return { pure: true, indexDependent: false }
  if (!ts.isObjectLiteralExpression(value)) return { pure: false, indexDependent: false }
  const analyses: RowAnalysis[] = []
  for (const property of value.properties) {
    const name = ts.isPropertyAssignment(property) ? staticPropertyName(property.name) : undefined
    if (!ts.isPropertyAssignment(property) || name === undefined || name === "__proto__") {
      return { pure: false, indexDependent: false }
    }
    analyses.push(analyzeScalarRowExpression(property.initializer, itemName, indexName))
  }
  return mergeAnalysis(...analyses)
}

function analyzeCollectionProps(
  expression: ts.ObjectLiteralExpression,
  itemName: string,
  indexName: string | undefined,
): RowAnalysis {
  const analyses: RowAnalysis[] = []
  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property)) return { pure: false, indexDependent: false }
    const name = staticPropertyName(property.name)
    if (name === undefined || unsafeCompiledCollectionProps.has(name)
      || name.startsWith("data-vune-") || /^on/i.test(name)) return { pure: false, indexDependent: false }
    analyses.push(name === "style"
      ? analyzeCollectionStyle(property.initializer, itemName, indexName)
      : analyzeScalarRowExpression(property.initializer, itemName, indexName))
  }
  return mergeAnalysis(...analyses)
}

function closureResult(closure: ts.ArrowFunction | ts.FunctionExpression): ts.Expression | undefined {
  if (!ts.isBlock(closure.body)) return unwrapExpression(closure.body)
  if (closure.body.statements.length !== 1) return undefined
  const statement = closure.body.statements[0]
  return ts.isReturnStatement(statement) && statement.expression ? unwrapExpression(statement.expression) : undefined
}

function singleBuilderResult(expression: ts.Expression): ts.Expression {
  const value = unwrapExpression(expression)
  if (ts.isArrayLiteralExpression(value) && value.elements.length === 1) {
    const element = value.elements[0]
    if (!ts.isSpreadElement(element) && !ts.isOmittedExpression(element)) return unwrapExpression(element)
  }
  return value
}

function importedBindings(sourceFile: ts.SourceFile, importedName: string): ImportedBindings {
  const names = new Set<string>()
  const namespaces = new Set<string>()
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const moduleName = statement.moduleSpecifier.text
    if (moduleName !== "vune-ui" && !moduleName.startsWith("@vune-ui/")) continue
    const bindings = statement.importClause?.namedBindings
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text)
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if ((element.propertyName?.text ?? element.name.text) === importedName) names.add(element.name.text)
      }
    }
  }
  return { names, namespaces }
}

function importedApiCall(
  call: ts.CallExpression,
  apiName: string,
  bindings: ImportedBindings,
  sourceFile?: ts.SourceFile,
): boolean {
  const callee = unwrapExpression(call.expression)
  if (ts.isIdentifier(callee)) {
    return bindings.names.has(callee.text) && (!sourceFile || !scopeShadowsIdentifier(callee, sourceFile))
  }
  return ts.isPropertyAccessExpression(callee)
    && callee.name.text === apiName
    && ts.isIdentifier(callee.expression)
    && bindings.namespaces.has(callee.expression.text)
    && (!sourceFile || !scopeShadowsIdentifier(callee.expression, sourceFile))
}

function bindingContains(name: ts.BindingName, target: string): boolean {
  if (ts.isIdentifier(name)) return name.text === target
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    return name.elements.some(element => !ts.isOmittedExpression(element) && bindingContains(element.name, target))
  }
  return false
}

function statementDeclaresName(statement: ts.Statement, target: string): boolean {
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.some(declaration => bindingContains(declaration.name, target))
  }
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) return statement.name.text === target
  return false
}

function scopeShadowsIdentifier(identifier: ts.Identifier, sourceFile: ts.SourceFile): boolean {
  const target = identifier.text
  let current: ts.Node | undefined = identifier.parent
  while (current && current !== sourceFile) {
    if (ts.isFunctionLike(current)) {
      if (current.parameters.some(parameter => bindingContains(parameter.name, target))) return true
      if ("name" in current && current.name && ts.isIdentifier(current.name) && current.name.text === target) return true
    }
    if (ts.isBlock(current)) {
      if (current.statements.some(statement => statementDeclaresName(statement, target))) return true
    }
    if (ts.isCatchClause(current) && current.variableDeclaration && bindingContains(current.variableDeclaration.name, target)) return true
    if ((ts.isForStatement(current) || ts.isForInStatement(current) || ts.isForOfStatement(current))
      && current.initializer && ts.isVariableDeclarationList(current.initializer)
      && current.initializer.declarations.some(declaration => bindingContains(declaration.name, target))) return true
    current = current.parent
  }
  return false
}

function topLevelStateBindings(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const stateApi = importedBindings(sourceFile, "State")
  if (stateApi.names.size === 0 && stateApi.namespaces.size === 0) return new Set()
  const states = new Set<string>()
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
      const initializer = unwrapExpression(declaration.initializer)
      if (ts.isCallExpression(initializer) && importedApiCall(initializer, "State", stateApi)) states.add(declaration.name.text)
    }
  }
  return states
}

function provenStateRefSource(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  stateBindings: ReadonlySet<string>,
): ts.Identifier | undefined {
  const value = unwrapExpression(expression)
  if (!ts.isPropertyAccessExpression(value) || value.name.text !== "value") return undefined
  const owner = unwrapExpression(value.expression)
  if (!ts.isIdentifier(owner) || !stateBindings.has(owner.text) || scopeShadowsIdentifier(owner, sourceFile)) return undefined
  return owner
}

function isImportedElementCall(
  call: ts.CallExpression,
  elements: ImportedBindings,
  sourceFile: ts.SourceFile,
): boolean {
  return importedApiCall(call, "Element", elements, sourceFile)
}

function plainCollectionClosure(value: ts.ArrowFunction | ts.FunctionExpression): boolean {
  return !value.asteriskToken
    && !value.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)
}

function collectionRowPlan(
  closure: ts.Expression,
  sourceFile: ts.SourceFile,
  elements: ImportedBindings,
): CollectionRowPlan | undefined {
  const value = unwrapExpression(closure)
  if (!ts.isArrowFunction(value) && !ts.isFunctionExpression(value)) return undefined
  if (!plainCollectionClosure(value) || value.parameters.length < 1 || value.parameters.length > 2) return undefined
  const item = value.parameters[0]
  const index = value.parameters[1]
  if (!ts.isIdentifier(item.name) || item.dotDotDotToken || item.initializer) return undefined
  if (index && (!ts.isIdentifier(index.name) || index.dotDotDotToken || index.initializer)) return undefined
  const result = closureResult(value)
  if (!result) return undefined
  const row = singleBuilderResult(result)
  if (!ts.isCallExpression(row) || !isImportedElementCall(row, elements, sourceFile) || row.arguments.length !== 3) return undefined
  const [type, props, text] = row.arguments
  if (!ts.isStringLiteral(type) || type.text.includes("-") || unsafeCompiledCollectionTags.has(type.text.toLowerCase())) return undefined
  const itemName = item.name.text
  const indexName = index && ts.isIdentifier(index.name) ? index.name.text : undefined
  const propsValue = unwrapExpression(props)
  if (propsValue.kind !== ts.SyntaxKind.NullKeyword && !ts.isObjectLiteralExpression(propsValue)) return undefined
  const propsAnalysis = propsValue.kind === ts.SyntaxKind.NullKeyword
    ? { pure: true, indexDependent: false }
    : analyzeCollectionProps(propsValue as ts.ObjectLiteralExpression, itemName, indexName)
  const textAnalysis = analyzeScalarRowExpression(text, itemName, indexName)
  if (!propsAnalysis.pure || !textAnalysis.pure) return undefined
  return {
    typeSource: type.getText(sourceFile),
    propsSource: props.getText(sourceFile),
    textSource: text.getText(sourceFile),
    itemName,
    ...(indexName ? { indexName } : {}),
    indexIndependent: !propsAnalysis.indexDependent && !textAnalysis.indexDependent,
  }
}

function collectionKeyPlan(closure: ts.Expression): { readonly source: string; readonly indexIndependent: boolean } | undefined {
  const value = unwrapExpression(closure)
  if (!ts.isArrowFunction(value) && !ts.isFunctionExpression(value)) return undefined
  if (!plainCollectionClosure(value) || value.parameters.length < 1 || value.parameters.length > 2) return undefined
  const item = value.parameters[0]
  const index = value.parameters[1]
  if (!ts.isIdentifier(item.name) || item.dotDotDotToken || item.initializer) return undefined
  if (index && (!ts.isIdentifier(index.name) || index.dotDotDotToken || index.initializer)) return undefined
  const result = closureResult(value)
  if (!result) return undefined
  const indexName = index && ts.isIdentifier(index.name) ? index.name.text : undefined
  const analysis = analyzeScalarRowExpression(result, item.name.text, indexName)
  if (!analysis.pure) return undefined
  return { source: closure.getText(), indexIndependent: !analysis.indexDependent }
}

function compiledForEachCall(
  call: ts.CallExpression,
  foreach: ImportedBindings,
  sourceFile: ts.SourceFile,
): CompiledForEachCall | undefined {
  const callee = unwrapExpression(call.expression)
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "createNodeCompiled") return undefined
  const viewType = unwrapExpression(callee.expression)
  if (!ts.isPropertyAccessExpression(viewType) || viewType.name.text !== "viewType") return undefined
  const owner = unwrapExpression(viewType.expression)
  const importedOwner = ts.isIdentifier(owner)
    ? foreach.names.has(owner.text) && !scopeShadowsIdentifier(owner, sourceFile)
    : ts.isPropertyAccessExpression(owner)
      && owner.name.text === "ForEach"
      && ts.isIdentifier(owner.expression)
      && foreach.namespaces.has(owner.expression.text)
      && !scopeShadowsIdentifier(owner.expression, sourceFile)
  if (!importedOwner) return undefined
  if (call.arguments.length !== 2 || !ts.isNumericLiteral(call.arguments[0]) || !ts.isArrayLiteralExpression(call.arguments[1])) return undefined
  const initializerIndex = Number(call.arguments[0].text)
  if (initializerIndex !== 0 && initializerIndex !== 1) return undefined
  const values = call.arguments[1].elements
  const items = values[0]
  const key = initializerIndex === 1 ? values[1] : undefined
  const content = values.at(-1)
  if (!items || !content || ts.isSpreadElement(items) || ts.isOmittedExpression(items)
    || (key && (ts.isSpreadElement(key) || ts.isOmittedExpression(key)))
    || ts.isSpreadElement(content) || ts.isOmittedExpression(content)) return undefined
  return { initializerIndex, items, ...(key ? { key } : {}), content }
}

function directForEachCall(
  call: ts.CallExpression,
  foreach: ImportedBindings,
  sourceFile: ts.SourceFile,
): CompiledForEachCall | undefined {
  const callee = unwrapExpression(call.expression)
  const imported = ts.isIdentifier(callee)
    ? foreach.names.has(callee.text) && !scopeShadowsIdentifier(callee, sourceFile)
    : ts.isPropertyAccessExpression(callee)
      && callee.name.text === "ForEach"
      && ts.isIdentifier(callee.expression)
      && foreach.namespaces.has(callee.expression.text)
      && !scopeShadowsIdentifier(callee.expression, sourceFile)
  if (!imported || (call.arguments.length !== 2 && call.arguments.length !== 3)) return undefined
  const initializerIndex = call.arguments.length === 3 ? 1 : 0
  const items = call.arguments[0]
  const key = initializerIndex === 1 ? call.arguments[1] : undefined
  const content = call.arguments.at(-1)
  if (!items || !content || (key && !ts.isArrowFunction(unwrapExpression(key)) && !ts.isFunctionExpression(unwrapExpression(key)))) return undefined
  return { initializerIndex, items, ...(key ? { key } : {}), content, directCall: call }
}

function compiledContentSource(
  compiled: CompiledForEachCall,
  rowPlan: CollectionRowPlan,
  keyPlan: { readonly source: string; readonly indexIndependent: boolean } | undefined,
  sourceFile: ts.SourceFile,
): string {
  const parameters = rowPlan.indexName ? `${rowPlan.itemName}, ${rowPlan.indexName}` : rowPlan.itemName
  const compiledKey = keyPlan ? `, evaluateKey: ${keyPlan.source}` : ""
  const indexIndependent = rowPlan.indexIndependent
    && (compiled.key ? keyPlan?.indexIndependent === true : true)
  return `compiledCollectionContent(${compiled.content.getText(sourceFile)}, { kind: "flat-text-host", indexIndependent: ${indexIndependent}${compiledKey}, evaluate: (${parameters}) => ({ type: ${rowPlan.typeSource}, props: ${rowPlan.propsSource}, text: ${rowPlan.textSource} }) })`
}

export function lowerCompiledCollections(source: string): string {
  if (!source.includes("ForEach")) return source
  const sourceFile = ts.createSourceFile("vune-compiled-collections.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const foreach = importedBindings(sourceFile, "ForEach")
  if (foreach.names.size === 0 && foreach.namespaces.size === 0) return source
  const elements = importedBindings(sourceFile, "Element")
  const states = topLevelStateBindings(sourceFile)
  const edits: Array<{ start: number; end: number; replacement: string }> = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const compiled = compiledForEachCall(node, foreach, sourceFile) ?? directForEachCall(node, foreach, sourceFile)
      if (compiled) {
        const rowPlan = elements.names.size > 0 || elements.namespaces.size > 0
          ? collectionRowPlan(compiled.content, sourceFile, elements)
          : undefined
        const keyPlan = compiled.key ? collectionKeyPlan(compiled.key) : undefined
        const stateRef = rowPlan && keyPlan?.indexIndependent
          ? provenStateRefSource(compiled.items, sourceFile, states)
          : undefined
        if (rowPlan) {
          const contentSource = compiledContentSource(compiled, rowPlan, keyPlan, sourceFile)
          if (compiled.directCall) {
            const argumentsSource = compiled.initializerIndex === 1
              ? `${stateRef?.getText(sourceFile) ?? compiled.items.getText(sourceFile)}, ${compiled.key!.getText(sourceFile)}, ${contentSource}`
              : `${compiled.items.getText(sourceFile)}, ${contentSource}`
            edits.push({
              start: compiled.directCall.getStart(sourceFile),
              end: compiled.directCall.end,
              replacement: `${compiled.directCall.expression.getText(sourceFile)}.viewType.createNodeCompiled(${compiled.initializerIndex}, [${argumentsSource}])`,
            })
          } else {
            if (stateRef) edits.push({ start: compiled.items.getStart(sourceFile), end: compiled.items.end, replacement: stateRef.getText(sourceFile) })
            edits.push({ start: compiled.content.getStart(sourceFile), end: compiled.content.end, replacement: contentSource })
          }
        }
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  if (edits.length === 0) return source
  let result = source
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end)
  }
  return result
}
