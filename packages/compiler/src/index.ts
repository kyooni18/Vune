import { createMuseSourceMap, mapGeneratedPosition } from "./source-map.js"
import { lowerMuseBuilderAst, parseMuseBuilder, parseMuseStructs } from "./ast.js"
import { createSemanticModel, type MuseSemanticModel } from "./semantic.js"
import { resolveSemanticInitializer, type SemanticArgument, type SemanticInitializerSymbol } from "@muse/core"
import * as ts from "typescript"

export { lowerMuseBuilderAst, parseMuseBuilder, parseMuseStructs } from "./ast.js"
export type {
  MuseArgument,
  MuseAstLowering,
  MuseBuilderNode,
  MuseBuilderProgram,
  MuseCallExpression,
  MuseClosureExpression,
  MuseConditionalExpression,
  MuseRawExpression,
  MuseSourceRange,
  MuseStructDeclaration,
  MuseStructField,
  MuseStructInitializer,
} from "./ast.js"
export type {
  MuseSemanticCall,
  MuseSemanticField,
  MuseSemanticForeignComponent,
  MuseSemanticHtmlDiagnostic,
  MuseSemanticHtmlElement,
  MuseSemanticImport,
  MuseSemanticInitializer,
  MuseSemanticModel,
  MuseSemanticView,
} from "./semantic.js"
export type {
  SemanticArgument,
  SemanticArgumentKind,
  SemanticBindingSymbol,
  SemanticBuilderTypeSymbol,
  SemanticFieldSymbol,
  SemanticForeignComponentTypeSymbol,
  SemanticHtmlAttributeSpec,
  SemanticHtmlAttributeSymbol,
  SemanticHtmlElementSymbol,
  SemanticHtmlTagSpec,
  SemanticHtmlAttributeCategory,
  SemanticHtmlAttributeValueType,
  SemanticInitializerParameter,
  SemanticInitializerParameterKind,
  SemanticInitializerResolution,
  SemanticInitializerResolutionFailure,
  SemanticInitializerResolutionResult,
  SemanticInitializerSymbol,
  SemanticStateSymbol,
  SemanticStructSymbol,
  SemanticSymbol,
  SemanticViewTypeSymbol,
} from "@muse/core"
export { resolveSemanticInitializer, SemanticModel, semanticHtmlAttributeNames, semanticHtmlAttributeSpec, semanticHtmlTagNames, semanticHtmlTagSpec } from "@muse/core"
export { mapGeneratedPosition, mapOriginalPosition } from "./source-map.js"
export type { MuseSourceMapAnchor, MuseSourcePosition } from "./source-map.js"

export interface MuseSourceMap {
  readonly version: 3
  readonly file?: string
  readonly sources: readonly string[]
  readonly sourcesContent: readonly string[]
  readonly names: readonly string[]
  readonly mappings: string
  readonly x_muse?: {
    readonly lineMappings: readonly { readonly line: number; readonly column: number; readonly generatedColumn: number }[]
    readonly segments: readonly (readonly { readonly line: number; readonly column: number; readonly generatedColumn: number }[])[]
  }
}

export interface MuseTransformResult {
  readonly code: string
  readonly map: MuseSourceMap
}

export interface MuseDiagnostic {
  readonly severity: "error"
  readonly code: "MUSE_SYNTAX" | "MUSE_TYPESCRIPT" | "MUSE_HTML_ATTRIBUTE" | "MUSE_HTML_VALUE"
  readonly message: string
  readonly line: number
  readonly column: number
}

interface BuilderCall {
  readonly start: number
  readonly open: number
  readonly close: number
  readonly brace: number
  readonly end: number
  readonly name: string
  readonly argumentSource: string
  readonly bodySource: string
}

interface RawHtmlCall {
  readonly start: number
  readonly end: number
  readonly code: string
}

function syntaxError(message: string, offset: number): SyntaxError & { readonly offset: number } {
  const error = new SyntaxError(message) as SyntaxError & { offset: number }
  error.offset = offset
  return error
}

function skipQuoted(source: string, index: number): number {
  const quote = source[index]
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === "\\") { cursor += 1; continue }
    if (source[cursor] === quote) return cursor + 1
  }
  throw syntaxError(`Unclosed ${quote} string in Muse source`, index)
}

function skipTemplate(source: string, index: number): number {
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === "\\") { cursor += 1; continue }
    if (source[cursor] === "`") return cursor + 1
    if (source[cursor] !== "$" || source[cursor + 1] !== "{") continue
    cursor = matching(source, cursor + 1, "{", "}")
  }
  throw syntaxError("Unclosed template literal in Muse source", index)
}

function skipString(source: string, index: number): number {
  return source[index] === "`" ? skipTemplate(source, index) : skipQuoted(source, index)
}

function skipComment(source: string, index: number): number {
  if (source.startsWith("//", index)) {
    const end = source.indexOf("\n", index + 2)
    return end < 0 ? source.length : end
  }
  const end = source.indexOf("*/", index + 2)
  if (end < 0) throw syntaxError("Unclosed block comment in Muse source", index)
  return end + 2
}

function regexCanStart(source: string, index: number): boolean {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (/\s/.test(source[cursor])) continue
    return "([{=,:;!?&|+-*%^~<>".includes(source[cursor])
  }
  return true
}

function skipRegex(source: string, index: number): number {
  let inClass = false
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === "\\") { cursor += 1; continue }
    if (source[cursor] === "[") inClass = true
    if (source[cursor] === "]") inClass = false
    if (source[cursor] === "/" && !inClass) {
      cursor += 1
      while (/[A-Za-z]/.test(source[cursor] ?? "")) cursor += 1
      return cursor
    }
    if (source[cursor] === "\n") return index + 1
  }
  return index + 1
}

function skipTrivia(source: string, index: number): number {
  let cursor = index
  while (cursor < source.length) {
    if (/\s/.test(source[cursor])) { cursor += 1; continue }
    if (source.startsWith("//", cursor) || source.startsWith("/*", cursor)) {
      cursor = skipComment(source, cursor)
      continue
    }
    break
  }
  return cursor
}

function matching(source: string, open: number, left: string, right: string): number {
  let depth = 0
  let steps = 0
  for (let cursor = open; cursor < source.length; cursor += 1) {
    if (++steps > source.length + 1) throw syntaxError(`Unable to scan ${left} block in Muse source`, open)
    const character = source[cursor]
    if (character === "\"" || character === "'" || character === "`") { cursor = skipString(source, cursor) - 1; continue }
    if (character === "/" && (source[cursor + 1] === "/" || source[cursor + 1] === "*")) { cursor = skipComment(source, cursor) - 1; continue }
    if (character === "/" && regexCanStart(source, cursor)) { cursor = skipRegex(source, cursor) - 1; continue }
    if (character === left) depth += 1
    if (character === right) {
      depth -= 1
      if (depth === 0) return cursor
    }
  }
  throw syntaxError(`Unclosed ${left} block in Muse source`, open)
}

function identifierAt(source: string, start: number): { name: string; end: number } | undefined {
  const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(source.slice(start))
  return match ? { name: match[0], end: start + match[0].length } : undefined
}

function findBuilder(source: string, from = 0, uppercaseOnly = false): BuilderCall | undefined {
  const excluded = new Set(["if", "for", "while", "switch", "catch", "function"])
  let steps = 0
  for (let cursor = from; cursor < source.length; cursor += 1) {
    if (++steps > source.length + 1) throw syntaxError("Unable to scan builder expressions in Muse source", from)
    const character = source[cursor]
    if (character === "\"" || character === "'" || character === "`") { cursor = skipString(source, cursor) - 1; continue }
    if (character === "/" && (source[cursor + 1] === "/" || source[cursor + 1] === "*")) { cursor = skipComment(source, cursor) - 1; continue }
    if (character === "/" && regexCanStart(source, cursor)) { cursor = skipRegex(source, cursor) - 1; continue }
    const identifier = identifierAt(source, cursor)
    if (!identifier) continue
    cursor = identifier.end - 1
    if (excluded.has(identifier.name)) continue
    if (uppercaseOnly && !/^[A-Z]/.test(identifier.name)) continue
    const preceding = source.slice(0, identifier.end - identifier.name.length).trimEnd()
    if (/\bfunction$/.test(preceding)) continue
    const open = skipTrivia(source, identifier.end)
    if (source[open] !== "(") continue
    const close = matching(source, open, "(", ")")
    const brace = skipTrivia(source, close + 1)
    if (source[brace] !== "{") continue
    const braceClose = matching(source, brace, "{", "}")
    return {
      start: cursor - identifier.name.length + 1,
      open,
      close,
      brace,
      end: braceClose + 1,
      name: identifier.name,
      argumentSource: source.slice(open + 1, close),
      bodySource: source.slice(brace + 1, braceClose),
    }
  }
  return undefined
}

function skipHtmlTrivia(source: string, index: number): number {
  let cursor = index
  while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1
  return cursor
}

function htmlNameAt(source: string, start: number): { name: string; end: number } | undefined {
  const match = /^[A-Za-z][A-Za-z0-9:._-]*/.exec(source.slice(start))
  return match ? { name: match[0], end: start + match[0].length } : undefined
}

function htmlAttributeNameAt(source: string, start: number): { name: string; end: number } | undefined {
  const match = /^[^\s=/>]+/.exec(source.slice(start))
  return match ? { name: match[0], end: start + match[0].length } : undefined
}

function htmlAttributes(source: string, baseOffset = 0): string {
  const attributes: string[] = []
  let cursor = 0
  while (cursor < source.length) {
    cursor = skipHtmlTrivia(source, cursor)
    if (cursor >= source.length) break
    if (source[cursor] === "{") {
      const end = matching(source, cursor, "{", "}")
      const expression = source.slice(cursor + 1, end).trim()
      if (!expression.startsWith("...") || expression.slice(3).trim().length === 0) {
        throw syntaxError("Raw HTML attribute expressions must use {...value}", baseOffset + cursor)
      }
      attributes.push(`...(${lowerRange(expression.slice(3).trim())})`)
      cursor = end + 1
      continue
    }
    const name = htmlAttributeNameAt(source, cursor)
    if (!name) throw syntaxError("Invalid raw HTML attribute", baseOffset + cursor)
    cursor = skipHtmlTrivia(source, name.end)
    let value = "true"
    if (source[cursor] === "=") {
      cursor = skipHtmlTrivia(source, cursor + 1)
      if (source[cursor] === "\"" || source[cursor] === "'") {
        const end = skipQuoted(source, cursor)
        value = JSON.stringify(source.slice(cursor + 1, end - 1))
        cursor = end
      } else if (source[cursor] === "{") {
        const end = matching(source, cursor, "{", "}")
        value = lowerRange(source.slice(cursor + 1, end))
        cursor = end + 1
      } else {
        const match = /^[^\s/>]+/.exec(source.slice(cursor))
        if (!match) throw syntaxError(`Invalid value for raw HTML attribute ${name.name}`, baseOffset + cursor)
        value = JSON.stringify(match[0])
        cursor += match[0].length
      }
    }
    attributes.push(`${JSON.stringify(name.name)}: ${value}`)
  }
  return attributes.length === 0 ? "null" : `{ ${attributes.join(", ")} }`
}

const voidHtmlElements = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"])

function rawHtmlAt(source: string, start: number): RawHtmlCall | undefined {
  if (source[start] !== "<" || source[start + 1] === "/" || source[start + 1] === "!") return undefined
  const openingName = htmlNameAt(source, start + 1)
  if (!openingName) return undefined
  let cursor = openingName.end
  let braceDepth = 0
  let quote: string | undefined
  let close = -1
  for (; cursor < source.length; cursor += 1) {
    const character = source[cursor]
    if (quote) {
      if (character === "\\") { cursor += 1; continue }
      if (character === quote) quote = undefined
      continue
    }
    if (character === "\"" || character === "'") { quote = character; continue }
    if (character === "{") { braceDepth += 1; continue }
    if (character === "}") { braceDepth -= 1; continue }
    if (character === ">" && braceDepth === 0) { close = cursor; break }
  }
  if (close < 0 || quote || braceDepth !== 0) return undefined
  const opening = source.slice(openingName.end, close)
  const trimmedOpening = opening.trimEnd()
  const selfClosing = trimmedOpening.endsWith("/")
  const attributeSource = selfClosing ? trimmedOpening.slice(0, -1) : opening
  const attributes = htmlAttributes(attributeSource, openingName.end)
  if (selfClosing || voidHtmlElements.has(openingName.name.toLowerCase())) return { start, end: close + 1, code: `Element(${JSON.stringify(openingName.name)}, ${attributes})` }

  const children: string[] = []
  cursor = close + 1
  while (cursor < source.length) {
    if (source.startsWith("<!--", cursor)) {
      const commentEnd = source.indexOf("-->", cursor + 4)
      if (commentEnd < 0) throw syntaxError("Unclosed raw HTML comment in Muse source", cursor)
      cursor = commentEnd + 3
      continue
    }
    if (source[cursor] === "<" && source[cursor + 1] === "/") {
      const closing = /^<\/([A-Za-z][A-Za-z0-9:._-]*)([^>]*)>/.exec(source.slice(cursor))
      if (!closing) throw syntaxError("Unclosed raw HTML closing tag in Muse source", cursor)
      if (closing[1] !== openingName.name) throw syntaxError(`Mismatched raw HTML closing tag </${closing[1]}>; expected </${openingName.name}>`, cursor)
      if (closing[2].trim().length > 0) throw syntaxError("Raw HTML closing tags cannot have attributes", cursor)
      const end = cursor + closing[0].length - 1
      return {
        start,
        end: end + 1,
        code: `Element(${JSON.stringify(openingName.name)}, ${attributes}${children.length ? `, ${children.join(", ")}` : ""})`,
      }
    }
    if (source[cursor] === "<") {
      const nested = rawHtmlAt(source, cursor)
      if (!nested) return undefined
      children.push(nested.code)
      cursor = nested.end
      continue
    }
    if (source[cursor] === "{") {
      const end = matching(source, cursor, "{", "}")
      const expression = source.slice(cursor + 1, end).trim()
      if (expression) children.push(lowerRange(expression))
      cursor = end + 1
      continue
    }
    const nextTag = source.indexOf("<", cursor)
    const nextExpression = source.indexOf("{", cursor)
    const end = [nextTag, nextExpression].filter(value => value >= 0).sort((left, right) => left - right)[0] ?? source.length
    const text = source.slice(cursor, end).trim()
    if (text) children.push(JSON.stringify(text))
    cursor = end
  }
  return undefined
}

function findRawHtml(source: string, from = 0): RawHtmlCall | undefined {
  for (let cursor = from; cursor < source.length; cursor += 1) {
    if (source[cursor] === "\"" || source[cursor] === "'" || source[cursor] === "`") { cursor = skipString(source, cursor) - 1; continue }
    if (source[cursor] !== "<") continue
    const call = rawHtmlAt(source, cursor)
    if (call) return call
  }
  return undefined
}

function validateRawHtmlSyntax(source: string): void {
  for (let cursor = 0; cursor < source.length; cursor += 1) {
    if (source[cursor] === "\"" || source[cursor] === "'" || source[cursor] === "`") {
      cursor = skipString(source, cursor) - 1
      continue
    }
    if (source[cursor] !== "<" || !/[A-Za-z]/.test(source[cursor + 1] ?? "")) continue
    const html = rawHtmlAt(source, cursor)
    if (html) {
      cursor = html.end - 1
      continue
    }
    throw syntaxError("Unclosed raw HTML element in Muse source", cursor)
  }
}

function splitTopLevel(source: string, separator = ","): string[] {
  const parts: string[] = []
  let start = 0
  let parens = 0
  let brackets = 0
  let braces = 0
  for (let cursor = 0; cursor < source.length; cursor += 1) {
    const character = source[cursor]
    if (character === "\"" || character === "'" || character === "`") { cursor = skipString(source, cursor) - 1; continue }
    if (character === "/" && (source[cursor + 1] === "/" || source[cursor + 1] === "*")) { cursor = skipComment(source, cursor) - 1; continue }
    if (character === "/" && regexCanStart(source, cursor)) { cursor = skipRegex(source, cursor) - 1; continue }
    if (character === "<") {
      const html = rawHtmlAt(source, cursor)
      if (html) { cursor = html.end - 1; continue }
    }
    if (character === "(") parens += 1
    else if (character === ")") parens -= 1
    else if (character === "[") brackets += 1
    else if (character === "]") brackets -= 1
    else if (character === "{") braces += 1
    else if (character === "}") braces -= 1
    else if (character === separator && parens === 0 && brackets === 0 && braces === 0) {
      parts.push(source.slice(start, cursor).trim())
      start = cursor + 1
    }
  }
  const tail = source.slice(start).trim()
  if (tail) parts.push(tail)
  return parts
}

function splitStatements(source: string): string[] {
  const parts: string[] = []
  let start = 0
  let parens = 0
  let brackets = 0
  let braces = 0
  for (let cursor = 0; cursor < source.length; cursor += 1) {
    const character = source[cursor]
    if (character === "\"" || character === "'" || character === "`") { cursor = skipString(source, cursor) - 1; continue }
    if (character === "/" && (source[cursor + 1] === "/" || source[cursor + 1] === "*")) { cursor = skipComment(source, cursor) - 1; continue }
    if (character === "/" && regexCanStart(source, cursor)) { cursor = skipRegex(source, cursor) - 1; continue }
    if (character === "<") {
      const html = rawHtmlAt(source, cursor)
      if (html) { cursor = html.end - 1; continue }
    }
    if (character === "(") parens += 1
    else if (character === ")") parens -= 1
    else if (character === "[") brackets += 1
    else if (character === "]") brackets -= 1
    else if (character === "{") braces += 1
    else if (character === "}") braces -= 1
    const boundary = character === ";" || (character === "\n" && parens === 0 && brackets === 0 && braces === 0)
    if (boundary && parens === 0 && brackets === 0 && braces === 0) {
      const part = source.slice(start, cursor).trim()
      if (part) parts.push(part)
      start = cursor + 1
    }
  }
  const tail = source.slice(start).trim()
  if (tail) parts.push(tail)
  return parts
}

function topLevelColon(source: string): number {
  let parens = 0
  let brackets = 0
  let braces = 0
  let ternary = 0
  for (let cursor = 0; cursor < source.length; cursor += 1) {
    const character = source[cursor]
    if (character === "\"" || character === "'" || character === "`") { cursor = skipString(source, cursor) - 1; continue }
    if (character === "/" && (source[cursor + 1] === "/" || source[cursor + 1] === "*")) { cursor = skipComment(source, cursor) - 1; continue }
    if (character === "/" && regexCanStart(source, cursor)) { cursor = skipRegex(source, cursor) - 1; continue }
    if (character === "(") parens += 1
    else if (character === ")") parens -= 1
    else if (character === "[") brackets += 1
    else if (character === "]") brackets -= 1
    else if (character === "{") braces += 1
    else if (character === "}") braces -= 1
    else if (parens === 0 && brackets === 0 && braces === 0 && character === "?" && source[cursor + 1] !== ".") ternary += 1
    else if (character === ":" && parens === 0 && brackets === 0 && braces === 0) {
      if (ternary > 0) ternary -= 1
      else return cursor
    }
  }
  return -1
}

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
    const html = findRawHtml(source, cursor)
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
  const originalGetSourceFile = host.getSourceFile.bind(host)
  const originalReadFile = host.readFile.bind(host)
  const originalFileExists = host.fileExists.bind(host)
  host.fileExists = requested => normalize(requested) === root || originalFileExists(requested)
  host.readFile = requested => normalize(requested) === root ? source : originalReadFile(requested)
  host.getSourceFile = (requested, languageVersion, onError, shouldCreateNewSourceFile) => normalize(requested) === root
    ? ts.createSourceFile(requested, source, languageVersion, true, ts.ScriptKind.TS)
    : originalGetSourceFile(requested, languageVersion, onError, shouldCreateNewSourceFile)

  let program: ts.Program
  try {
    program = ts.createProgram([rootFileName], options, host)
  } catch {
    return undefined
  }
  const sourceFile = program.getSourceFile(rootFileName)
  return sourceFile ? { sourceFile, checker: program.getTypeChecker() } : undefined
}

const staticModifierNames = new Set([
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

function lowerStaticModifierChains(source: string, fileName: string): string {
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

function lowerStaticImportedCalls(source: string, fileName: string): string {
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

function hasMuseSyntax(source: string, allowRawHtml = true): boolean {
  return /\bstruct\s+[A-Z][A-Za-z0-9_$]*(?:\s*<[^>{}]*>)?\s*:\s*View/.test(source)
    || (allowRawHtml && findRawHtml(source) !== undefined)
    || findBuilder(source, 0, true) !== undefined
    || hasBindingShorthand(source)
    || hasNamedMuseArguments(source)
    || hasStaticModifierSyntax(source)
}

export function compileMuseFile(source: string, fileName = "muse-source.muse.ts"): MuseTransformResult {
  const code = transformMuseSource(source, fileName)
  return { code, map: createMuseSourceMap(source, code, fileName) }
}

/** Build the shared Muse + TypeScript semantic model used by compiler clients and IDE tooling. */
export function createMuseSemanticModel(source: string, fileName = "muse-source.muse.ts"): MuseSemanticModel {
  return createSemanticModel(source, fileName, transformMuseSource(source, fileName))
}

export function formatMuseSource(source: string): string {
  return transformMuseSource(source)
}

export function diagnoseMuseSource(source: string): readonly MuseDiagnostic[] {
  try {
    validateRawHtmlSyntax(source)
    for (let cursor = 0; cursor < source.length; cursor += 1) {
      if (source[cursor] === "\"" || source[cursor] === "'" || source[cursor] === "`") cursor = skipString(source, cursor) - 1
      else if (source[cursor] === "/" && (source[cursor + 1] === "/" || source[cursor + 1] === "*")) cursor = skipComment(source, cursor) - 1
      else if (source[cursor] === "/" && regexCanStart(source, cursor)) cursor = skipRegex(source, cursor) - 1
      else if (source[cursor] === "(") matching(source, cursor, "(", ")")
      else if (source[cursor] === "{") matching(source, cursor, "{", "}")
    }
    const fileName = "muse-source.muse.ts"
    const generatedSource = transformMuseSource(source, fileName)
    const model = createSemanticModel(source, fileName, generatedSource)
    const map = createMuseSourceMap(source, generatedSource, fileName)
    const typescriptDiagnostics = model.typescriptDiagnostics.map(diagnostic => {
      const start = diagnostic.start ?? 0
      const position = model.typescript.getLineAndCharacterOfPosition(start)
      const mapped = mapGeneratedPosition(map, { line: position.line + 1, column: position.character + 1 })
      return {
        severity: "error" as const,
        code: "MUSE_TYPESCRIPT" as const,
        message: tsDiagnosticMessage(diagnostic),
        line: mapped.line,
        column: mapped.column,
      }
    })
    const htmlDiagnostics = model.htmlDiagnostics.map(diagnostic => {
      const position = sourcePositionAt(source, diagnostic.range.start)
      return {
        severity: "error" as const,
        code: diagnostic.code,
        message: diagnostic.message,
        line: position.line,
        column: position.column,
      }
    })
    return [...typescriptDiagnostics, ...htmlDiagnostics]
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const offset = typeof error === "object" && error !== null && "offset" in error && typeof error.offset === "number" ? error.offset : 0
    const before = source.slice(0, offset)
    return [{ severity: "error", code: "MUSE_SYNTAX", message, line: before.split("\n").length, column: offset - before.lastIndexOf("\n") }]
  }
}

function tsDiagnosticMessage(diagnostic: { readonly messageText: unknown }): string {
  if (typeof diagnostic.messageText === "string") return diagnostic.messageText
  if (!diagnostic.messageText || typeof diagnostic.messageText !== "object") return String(diagnostic.messageText)
  const chain = diagnostic.messageText as { readonly messageText?: unknown; readonly next?: readonly { readonly messageText?: unknown }[] }
  return [chain.messageText, ...(chain.next ?? []).map(item => item.messageText)].filter(Boolean).join(" ")
}

function sourcePositionAt(source: string, offset: number): { readonly line: number; readonly column: number } {
  const bounded = Math.max(0, Math.min(source.length, offset))
  const lines = source.slice(0, bounded).split("\n")
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 }
}

export interface MuseLanguageService {
  readonly format: (source: string) => string
  readonly diagnose: (source: string) => readonly MuseDiagnostic[]
  readonly transform: (source: string, id?: string) => MuseTransformResult
  readonly positionAt: (source: string, offset: number) => { line: number; column: number }
  readonly offsetAt: (source: string, position: { line: number; column: number }) => number
  readonly semantic: (source: string, fileName?: string) => MuseSemanticModel
}

export function createMuseLanguageService(): MuseLanguageService {
  return {
    format: formatMuseSource,
    diagnose: diagnoseMuseSource,
    transform: compileMuseFile,
    positionAt(source, offset) {
      const bounded = Math.max(0, Math.min(source.length, offset))
      const before = source.slice(0, bounded)
      return { line: before.split("\n").length, column: bounded - before.lastIndexOf("\n") }
    },
    offsetAt(source, position) {
      const lines = source.split("\n")
      const line = Math.max(1, Math.min(lines.length, position.line))
      return lines.slice(0, line - 1).reduce((offset, item) => offset + item.length + 1, 0) + Math.max(0, position.column - 1)
    },
    semantic: createMuseSemanticModel,
  }
}

export interface MuseVitePluginOptions {
  readonly include?: RegExp
}

function isMuseVueScript(attributes: string): boolean {
  const language = /\blang\s*=\s*(["'])([^"']+)\1/i.exec(attributes)?.[2]
  return !language || /^(?:muse|js|jsx|ts|tsx|mts|cts)$/i.test(language)
}

function transformVueSfcSource(source: string, fileName: string): string {
  const script = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi
  let output = source
  let changed = false
  let match: RegExpExecArray | null
  while ((match = script.exec(source))) {
    if (!isMuseVueScript(match[1])) continue
    const language = /\blang\s*=\s*(["'])([^"']+)\1/i.exec(match[1])?.[2] ?? "ts"
    if (!hasMuseSyntax(match[2], !/^(?:tsx|jsx)$/i.test(language))) continue
    const transformed = transformMuseSource(match[2], `${fileName}#script`)
    if (transformed === match[2]) continue
    const bodyStart = match.index + match[0].indexOf(match[2])
    const outputStart = bodyStart + (output.length - source.length)
    output = output.slice(0, outputStart) + transformed + output.slice(outputStart + match[2].length)
    changed = true
  }
  return changed ? output : source
}

export function createMuseVitePlugin(options: MuseVitePluginOptions = {}) {
  const cache = new Map<string, { source: string; result: MuseTransformResult | null }>()
  const transform = (source: string, id: string): MuseTransformResult | null => {
    const fileName = id.split("?", 1)[0]
    const query = id.slice(fileName.length + (id.includes("?") ? 1 : 0))
    if (/[\\/]node_modules[\\/]/.test(fileName)) return null
    const isVue = /\.vue$/i.test(fileName)
    const isVueTemplate = isVue && /(?:^|&)type=template(?:&|$)/.test(query)
    const isVueStyle = isVue && /(?:^|&)type=style(?:&|$)/.test(query)
    const isVueScript = isVue && (
      /(?:^|&)type=script(?:&|$)/.test(query)
      || (!isVueTemplate && !isVueStyle && !/<(?:script|template)\b/i.test(source))
    )
    if (!isVue && !/\.muse\.tsx?$/.test(fileName) && !/\.[cm]?[jt]sx?$/.test(fileName)) return null
    if (options.include) {
      options.include.lastIndex = 0
      if (!options.include.test(fileName)) return null
    }
    if (isVue && (isVueTemplate || isVueStyle)) return null
    const vueSource = isVue && !isVueScript
      ? transformVueSfcSource(source, fileName)
      : source
    if (!isVue && !/\.muse\.tsx?$/.test(fileName) && !hasMuseSyntax(source, false)) return null
    if (isVue && vueSource === source && !isVueScript) return null
    if (isVueScript && !hasMuseSyntax(source, !/(?:^|&)lang\.(?:tsx|jsx)(?:&|$)/.test(query))) return null
    const cacheKey = isVue ? id : fileName
    const cached = cache.get(cacheKey)
    if (cached?.source === source) return cached.result
    const code = isVue && !isVueScript ? vueSource : transformMuseSource(source, fileName)
    const transformed = code === source ? null : { code, map: createMuseSourceMap(source, code, fileName) }
    cache.set(cacheKey, { source, result: transformed })
    return transformed
  }
  const dependencyScanPlugin = {
    name: "muse-compiler:dependency-scan",
    transform,
  }
  return {
    name: "muse-compiler",
    enforce: "pre" as const,
    config() {
      return {
        optimizeDeps: {
          rolldownOptions: {
            plugins: [dependencyScanPlugin],
          },
        },
      }
    },
    transform,
  }
}
