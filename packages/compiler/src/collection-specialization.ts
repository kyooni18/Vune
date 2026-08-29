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

function analyzeRowExpression(
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
  if (ts.isPropertyAccessExpression(value)) return analyzeRowExpression(value.expression, itemName, indexName)
  if (ts.isElementAccessExpression(value)) {
    if (!value.argumentExpression) return { pure: false, indexDependent: false }
    return mergeAnalysis(
      analyzeRowExpression(value.expression, itemName, indexName),
      analyzeRowExpression(value.argumentExpression, itemName, indexName),
    )
  }
  if (ts.isPrefixUnaryExpression(value)) {
    if (value.operator !== ts.SyntaxKind.PlusToken
      && value.operator !== ts.SyntaxKind.MinusToken
      && value.operator !== ts.SyntaxKind.ExclamationToken
      && value.operator !== ts.SyntaxKind.TildeToken) return { pure: false, indexDependent: false }
    return analyzeRowExpression(value.operand, itemName, indexName)
  }
  if (ts.isBinaryExpression(value)) {
    const operator = value.operatorToken.kind
    if (operator >= ts.SyntaxKind.FirstAssignment && operator <= ts.SyntaxKind.LastAssignment) return { pure: false, indexDependent: false }
    if (operator === ts.SyntaxKind.CommaToken) return { pure: false, indexDependent: false }
    return mergeAnalysis(
      analyzeRowExpression(value.left, itemName, indexName),
      analyzeRowExpression(value.right, itemName, indexName),
    )
  }
  if (ts.isConditionalExpression(value)) {
    return mergeAnalysis(
      analyzeRowExpression(value.condition, itemName, indexName),
      analyzeRowExpression(value.whenTrue, itemName, indexName),
      analyzeRowExpression(value.whenFalse, itemName, indexName),
    )
  }
  if (ts.isTemplateExpression(value)) {
    return mergeAnalysis(...value.templateSpans.map(span => analyzeRowExpression(span.expression, itemName, indexName)))
  }
  if (ts.isArrayLiteralExpression(value)) {
    const analyses: RowAnalysis[] = []
    for (const element of value.elements) {
      if (ts.isSpreadElement(element) || ts.isOmittedExpression(element)) return { pure: false, indexDependent: false }
      analyses.push(analyzeRowExpression(element, itemName, indexName))
    }
    return mergeAnalysis(...analyses)
  }
  if (ts.isObjectLiteralExpression(value)) {
    const analyses: RowAnalysis[] = []
    for (const property of value.properties) {
      if (!ts.isPropertyAssignment(property) || ts.isComputedPropertyName(property.name)) return { pure: false, indexDependent: false }
      analyses.push(analyzeRowExpression(property.initializer, itemName, indexName))
    }
    return mergeAnalysis(...analyses)
  }
  return { pure: false, indexDependent: false }
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

function isImportedElementCall(call: ts.CallExpression, elements: ImportedBindings): boolean {
  const callee = unwrapExpression(call.expression)
  if (ts.isIdentifier(callee)) return elements.names.has(callee.text)
  return ts.isPropertyAccessExpression(callee)
    && callee.name.text === "Element"
    && ts.isIdentifier(callee.expression)
    && elements.namespaces.has(callee.expression.text)
}

function collectionRowPlan(
  closure: ts.Expression,
  sourceFile: ts.SourceFile,
  elements: ImportedBindings,
): CollectionRowPlan | undefined {
  const value = unwrapExpression(closure)
  if (!ts.isArrowFunction(value) && !ts.isFunctionExpression(value)) return undefined
  if (value.parameters.length < 1 || value.parameters.length > 2) return undefined
  const item = value.parameters[0]
  const index = value.parameters[1]
  if (!ts.isIdentifier(item.name) || item.dotDotDotToken || item.initializer) return undefined
  if (index && (!ts.isIdentifier(index.name) || index.dotDotDotToken || index.initializer)) return undefined
  const result = closureResult(value)
  if (!result) return undefined
  const row = singleBuilderResult(result)
  if (!ts.isCallExpression(row) || !isImportedElementCall(row, elements) || row.arguments.length !== 3) return undefined
  const [type, props, text] = row.arguments
  if (!ts.isStringLiteral(type) || type.text.includes("-")) return undefined
  const itemName = item.name.text
  const indexName = index && ts.isIdentifier(index.name) ? index.name.text : undefined
  const propsValue = unwrapExpression(props)
  if (propsValue.kind !== ts.SyntaxKind.NullKeyword && !ts.isObjectLiteralExpression(propsValue)) return undefined
  const propsAnalysis = propsValue.kind === ts.SyntaxKind.NullKeyword
    ? { pure: true, indexDependent: false }
    : analyzeRowExpression(propsValue, itemName, indexName)
  const textAnalysis = analyzeRowExpression(text, itemName, indexName)
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

function compiledForEachContent(call: ts.CallExpression, foreachNames: ReadonlySet<string>): ts.Expression | undefined {
  const callee = unwrapExpression(call.expression)
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "createNodeCompiled") return undefined
  const viewType = unwrapExpression(callee.expression)
  if (!ts.isPropertyAccessExpression(viewType) || viewType.name.text !== "viewType") return undefined
  const owner = unwrapExpression(viewType.expression)
  if (!ts.isIdentifier(owner) || !foreachNames.has(owner.text)) return undefined
  if (call.arguments.length !== 2 || !ts.isArrayLiteralExpression(call.arguments[1])) return undefined
  const content = call.arguments[1].elements.at(-1)
  return content && !ts.isSpreadElement(content) && !ts.isOmittedExpression(content) ? content : undefined
}

export function lowerCompiledCollections(source: string): string {
  if (!source.includes("createNodeCompiled") || !source.includes("ForEach")) return source
  const sourceFile = ts.createSourceFile("vune-compiled-collections.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const foreach = importedBindings(sourceFile, "ForEach")
  if (foreach.names.size === 0) return source
  const elements = importedBindings(sourceFile, "Element")
  if (elements.names.size === 0 && elements.namespaces.size === 0) return source
  const edits: Array<{ start: number; end: number; replacement: string }> = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const content = compiledForEachContent(node, foreach.names)
      if (content) {
        const plan = collectionRowPlan(content, sourceFile, elements)
        if (plan) {
          const parameters = plan.indexName ? `${plan.itemName}, ${plan.indexName}` : plan.itemName
          edits.push({
            start: content.getStart(sourceFile),
            end: content.end,
            replacement: `compiledCollectionContent(${content.getText(sourceFile)}, { kind: "flat-text-host", indexIndependent: ${plan.indexIndependent}, evaluate: (${parameters}) => ({ type: ${plan.typeSource}, props: ${plan.propsSource}, text: ${plan.textSource} }) })`,
          })
          return
        }
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
