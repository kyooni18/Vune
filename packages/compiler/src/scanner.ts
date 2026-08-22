export interface BuilderCall {
  readonly start: number
  readonly open: number
  readonly close: number
  readonly brace: number
  readonly end: number
  readonly name: string
  readonly argumentSource: string
  readonly bodySource: string
}

export interface RawHtmlCall {
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

type ExpressionLowerer = (source: string) => string
const identityExpression: ExpressionLowerer = source => source

function htmlAttributes(source: string, baseOffset = 0, lower: ExpressionLowerer = identityExpression): string {
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
      attributes.push(`...(${lower(expression.slice(3).trim())})`)
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
        value = lower(source.slice(cursor + 1, end))
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

function rawHtmlAt(source: string, start: number, lower: ExpressionLowerer = identityExpression): RawHtmlCall | undefined {
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
  const attributes = htmlAttributes(attributeSource, openingName.end, lower)
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
      const nested = rawHtmlAt(source, cursor, lower)
      if (!nested) return undefined
      children.push(nested.code)
      cursor = nested.end
      continue
    }
    if (source[cursor] === "{") {
      const end = matching(source, cursor, "{", "}")
      const expression = source.slice(cursor + 1, end).trim()
      if (expression) children.push(lower(expression))
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

function findRawHtml(source: string, from = 0, lower: ExpressionLowerer = identityExpression): RawHtmlCall | undefined {
  for (let cursor = from; cursor < source.length; cursor += 1) {
    if (source[cursor] === "\"" || source[cursor] === "'" || source[cursor] === "`") { cursor = skipString(source, cursor) - 1; continue }
    if (source[cursor] !== "<") continue
    const call = rawHtmlAt(source, cursor, lower)
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


export {
  syntaxError,
  skipString,
  skipComment,
  regexCanStart,
  skipRegex,
  skipTrivia,
  matching,
  identifierAt,
  findBuilder,
  skipHtmlTrivia,
  htmlNameAt,
  htmlAttributeNameAt,
  htmlAttributes,
  rawHtmlAt,
  findRawHtml,
  validateRawHtmlSyntax,
  splitTopLevel,
  splitStatements,
  topLevelColon,
}
