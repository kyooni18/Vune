import * as ts from "typescript"

interface ImportedBindings {
  readonly names: Set<string>
  readonly namespaces: Set<string>
}

interface ScopedStateBinding {
  readonly body: ts.ArrowFunction | ts.FunctionExpression
  readonly localName: string
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression
  while (ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current)) current = current.expression
  return current
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

function importedApiCall(call: ts.CallExpression, apiName: string, bindings: ImportedBindings): boolean {
  const callee = unwrapExpression(call.expression)
  if (ts.isIdentifier(callee)) return bindings.names.has(callee.text)
  return ts.isPropertyAccessExpression(callee)
    && callee.name.text === apiName
    && ts.isIdentifier(callee.expression)
    && bindings.namespaces.has(callee.expression.text)
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
  return (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === target
}

function scopeShadowsIdentifier(identifier: ts.Identifier, sourceFile: ts.SourceFile): boolean {
  const target = identifier.text
  let current: ts.Node | undefined = identifier.parent
  while (current && current !== sourceFile) {
    if (ts.isFunctionLike(current)) {
      if (current.parameters.some(parameter => bindingContains(parameter.name, target))) return true
      if ("name" in current && current.name && ts.isIdentifier(current.name) && current.name.text === target) return true
    }
    if (ts.isBlock(current) && current.statements.some(statement => statementDeclaresName(statement, target))) return true
    if (ts.isCatchClause(current) && current.variableDeclaration && bindingContains(current.variableDeclaration.name, target)) return true
    current = current.parent
  }
  return false
}

function topLevelStateBindings(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const api = importedBindings(sourceFile, "State")
  const result = new Set<string>()
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || (statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
      const initializer = unwrapExpression(declaration.initializer)
      if (ts.isCallExpression(initializer) && importedApiCall(initializer, "State", api)) result.add(declaration.name.text)
    }
  }
  return result
}

function staticName(name: ts.PropertyName | ts.BindingName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name) ? name.text : undefined
}

function objectProperty(object: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | undefined {
  return object.properties.find((property): property is ts.PropertyAssignment =>
    ts.isPropertyAssignment(property) && staticName(property.name) === name)
}

function functionResultObject(expression: ts.Expression): ts.ObjectLiteralExpression | undefined {
  const value = unwrapExpression(expression)
  if (!ts.isArrowFunction(value) && !ts.isFunctionExpression(value)) return undefined
  const result = closureResult(value)
  return result && ts.isObjectLiteralExpression(result) ? result : undefined
}

function generatedStructStateBindings(sourceFile: ts.SourceFile): readonly ScopedStateBinding[] {
  const result: ScopedStateBinding[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.arguments.length >= 2) {
      const callee = unwrapExpression(node.expression)
      const options = unwrapExpression(node.arguments[1])
      if (ts.isIdentifier(callee) && callee.text === "defineView" && ts.isObjectLiteralExpression(options)) {
        const stateProperty = objectProperty(options, "state")
        const bodyProperty = objectProperty(options, "body")
        const stateObject = stateProperty ? functionResultObject(stateProperty.initializer) : undefined
        const body = bodyProperty && unwrapExpression(bodyProperty.initializer)
        if (stateObject && body && (ts.isArrowFunction(body) || ts.isFunctionExpression(body))
          && body.parameters.length >= 1 && ts.isIdentifier(body.parameters[0].name) && ts.isBlock(body.body)) {
          const stateFields = new Set<string>()
          for (const property of stateObject.properties) {
            if (!ts.isPropertyAssignment(property)) continue
            const field = staticName(property.name)
            const initializer = unwrapExpression(property.initializer)
            if (!field || !ts.isCallExpression(initializer)) continue
            const stateCallee = unwrapExpression(initializer.expression)
            if (ts.isIdentifier(stateCallee) && stateCallee.text === "State") stateFields.add(field)
          }
          const propsName = body.parameters[0].name.text
          for (const statement of body.body.statements) {
            if (!ts.isVariableStatement(statement)) continue
            for (const declaration of statement.declarationList.declarations) {
              if (!declaration.initializer || !ts.isIdentifier(unwrapExpression(declaration.initializer))
                || (unwrapExpression(declaration.initializer) as ts.Identifier).text !== propsName
                || !ts.isObjectBindingPattern(declaration.name)) continue
              for (const element of declaration.name.elements) {
                if (element.dotDotDotToken || !ts.isIdentifier(element.name)) continue
                const field = element.propertyName ? staticName(element.propertyName) : element.name.text
                if (field && stateFields.has(field)) result.push({ body, localName: element.name.text })
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return result
}

function nestedScopeShadowsIdentifier(identifier: ts.Identifier, boundary: ts.ArrowFunction | ts.FunctionExpression): boolean {
  const target = identifier.text
  let current: ts.Node | undefined = identifier.parent
  while (current && current !== boundary.body && current !== boundary) {
    if (ts.isFunctionLike(current) && current.parameters.some(parameter => bindingContains(parameter.name, target))) return true
    if (ts.isBlock(current) && current.statements.some(statement => statementDeclaresName(statement, target))) return true
    if (ts.isCatchClause(current) && current.variableDeclaration && bindingContains(current.variableDeclaration.name, target)) return true
    current = current.parent
  }
  return false
}

function closureResult(closure: ts.ArrowFunction | ts.FunctionExpression): ts.Expression | undefined {
  if (!ts.isBlock(closure.body)) return unwrapExpression(closure.body)
  if (closure.body.statements.length !== 1) return undefined
  const statement = closure.body.statements[0]
  return ts.isReturnStatement(statement) && statement.expression ? unwrapExpression(statement.expression) : undefined
}

function safeScalarExpression(expression: ts.Expression, itemName: string, indexName: string | undefined): boolean {
  const value = unwrapExpression(expression)
  if (ts.isStringLiteralLike(value) || ts.isNumericLiteral(value) || ts.isBigIntLiteral(value)
    || value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword
    || value.kind === ts.SyntaxKind.NullKeyword) return true
  // Captured scalar bindings keep ordinary closure semantics; only the row
  // parameter itself is substituted with the descriptor-validated raw row.
  // Calls and ambient property access stay rejected below because they may be
  // effectful or accessor-backed.
  if (ts.isIdentifier(value)) return value.text !== itemName
  if (ts.isPropertyAccessExpression(value)) {
    const owner = unwrapExpression(value.expression)
    return ts.isIdentifier(owner) && owner.text === itemName
  }
  if (ts.isElementAccessExpression(value)) {
    const owner = unwrapExpression(value.expression)
    const key = value.argumentExpression && unwrapExpression(value.argumentExpression)
    return ts.isIdentifier(owner) && owner.text === itemName
      && Boolean(key && (ts.isStringLiteralLike(key) || ts.isNumericLiteral(key)))
  }
  if (ts.isPrefixUnaryExpression(value)) {
    return (value.operator === ts.SyntaxKind.PlusToken || value.operator === ts.SyntaxKind.MinusToken
      || value.operator === ts.SyntaxKind.ExclamationToken || value.operator === ts.SyntaxKind.TildeToken)
      && safeScalarExpression(value.operand, itemName, indexName)
  }
  if (ts.isBinaryExpression(value)) {
    const operator = value.operatorToken.kind
    if (operator >= ts.SyntaxKind.FirstAssignment && operator <= ts.SyntaxKind.LastAssignment) return false
    return operator !== ts.SyntaxKind.CommaToken
      && safeScalarExpression(value.left, itemName, indexName)
      && safeScalarExpression(value.right, itemName, indexName)
  }
  if (ts.isConditionalExpression(value)) {
    return safeScalarExpression(value.condition, itemName, indexName)
      && safeScalarExpression(value.whenTrue, itemName, indexName)
      && safeScalarExpression(value.whenFalse, itemName, indexName)
  }
  if (ts.isTemplateExpression(value)) {
    return value.templateSpans.every(span => safeScalarExpression(span.expression, itemName, indexName))
  }
  return false
}

function safeMappedObject(expression: ts.Expression, itemName: string, indexName: string | undefined): boolean {
  const value = unwrapExpression(expression)
  if (!ts.isObjectLiteralExpression(value)) return false
  for (const property of value.properties) {
    if (ts.isSpreadAssignment(property)) {
      const spread = unwrapExpression(property.expression)
      if (!ts.isIdentifier(spread) || spread.text !== itemName) return false
      continue
    }
    if (!ts.isPropertyAssignment(property)
      || (!ts.isIdentifier(property.name) && !ts.isStringLiteralLike(property.name) && !ts.isNumericLiteral(property.name))
      || !safeScalarExpression(property.initializer, itemName, indexName)) return false
  }
  return true
}

function safeMappedResult(expression: ts.Expression, itemName: string, indexName: string | undefined): boolean {
  const value = unwrapExpression(expression)
  if (ts.isIdentifier(value) && value.text === itemName) return true
  if (safeMappedObject(value, itemName, indexName)) return true
  if (ts.isConditionalExpression(value)) {
    return safeScalarExpression(value.condition, itemName, indexName)
      && safeMappedResult(value.whenTrue, itemName, indexName)
      && safeMappedResult(value.whenFalse, itemName, indexName)
  }
  return false
}

function safeMapper(expression: ts.Expression): boolean {
  const value = unwrapExpression(expression)
  if (!ts.isArrowFunction(value) && !ts.isFunctionExpression(value)) return false
  if (value.asteriskToken || value.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)) return false
  if (value.parameters.length < 1 || value.parameters.length > 2) return false
  const item = value.parameters[0]
  const index = value.parameters[1]
  if (!ts.isIdentifier(item.name) || item.dotDotDotToken || item.initializer) return false
  if (index && (!ts.isIdentifier(index.name) || index.dotDotDotToken || index.initializer)) return false
  const result = closureResult(value)
  return Boolean(result && safeMappedResult(result, item.name.text, index && ts.isIdentifier(index.name) ? index.name.text : undefined))
}

function stateValueOwner(
  expression: ts.Expression,
  states: ReadonlySet<string>,
  scopedStates: readonly ScopedStateBinding[],
  sourceFile: ts.SourceFile,
): ts.Identifier | undefined {
  const value = unwrapExpression(expression)
  if (!ts.isPropertyAccessExpression(value) || value.name.text !== "value") return undefined
  const owner = unwrapExpression(value.expression)
  if (!ts.isIdentifier(owner)) return undefined
  if (states.has(owner.text) && !scopeShadowsIdentifier(owner, sourceFile)) return owner
  for (const scoped of scopedStates) {
    if (scoped.localName !== owner.text || nestedScopeShadowsIdentifier(owner, scoped.body)) continue
    let current: ts.Node | undefined = owner
    while (current && current !== scoped.body) current = current.parent
    if (current === scoped.body) return owner
  }
  return undefined
}

/** Lower proven-pure immutable State array maps to the compiler/runtime ABI. */
export function lowerStateArrayMaps(source: string): string {
  if (!source.includes(".map") || !source.includes(".value")) return source
  const sourceFile = ts.createSourceFile("vune-state-array-specialization.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const states = topLevelStateBindings(sourceFile)
  const scopedStates = generatedStructStateBindings(sourceFile)
  if (states.size === 0 && scopedStates.length === 0) return source
  const edits: Array<{ start: number; end: number; replacement: string }> = []
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const target = stateValueOwner(node.left, states, scopedStates, sourceFile)
      const right = unwrapExpression(node.right)
      if (target && ts.isCallExpression(right) && right.arguments.length === 1 && safeMapper(right.arguments[0])) {
        const callee = unwrapExpression(right.expression)
        if (ts.isPropertyAccessExpression(callee) && callee.name.text === "map") {
          const sourceState = stateValueOwner(callee.expression, states, scopedStates, sourceFile)
          if (sourceState && sourceState.text === target.text) {
            edits.push({
              start: node.getStart(sourceFile),
              end: node.end,
              replacement: `mapStateArrayData(${target.text}, ${right.arguments[0].getText(sourceFile)})`,
            })
            return
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  let result = source
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end)
  }
  return result
}
