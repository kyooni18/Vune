import * as ts from "typescript"
import { createMuseSourceMap, mapGeneratedPosition } from "./source-map.js"
import { createSemanticModel } from "./semantic.js"
import { transformMuseSource } from "./pipeline.js"
import { matching, regexCanStart, skipComment, skipRegex, skipString, validateRawHtmlSyntax } from "./scanner.js"
import type { MuseDiagnostic } from "./types.js"

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

function sourcePositionAt(source: string, offset: number): { line: number; column: number } {
  const bounded = Math.max(0, Math.min(source.length, offset))
  const lines = source.slice(0, bounded).split("\n")
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 }
}
