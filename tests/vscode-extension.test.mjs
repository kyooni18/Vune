import assert from "node:assert/strict"
import Module, { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import test from "node:test"

const root = new URL("../editors/vscode/", import.meta.url)

test("VS Code extension declares Muse language, grammar, and formatter entry points", () => {
  const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8"))
  assert.equal(manifest.main, "./extension.cjs")
  assert.deepEqual(manifest.contributes.languages[0].extensions, [".muse.ts"])
  assert.equal(manifest.contributes.grammars[0].scopeName, "source.muse")
  assert.equal(manifest.contributes.commands[0].command, "muse.formatDocument")
  const extension = readFileSync(new URL("extension.cjs", root), "utf8")
  assert.match(extension, /createDiagnosticCollection\('muse'\)/)
  assert.match(extension, /registerDocumentFormattingEditProvider\(languages/)
  assert.match(extension, /registerCompletionItemProvider/)
  assert.match(extension, /registerHoverProvider/)
  assert.match(extension, /registerSignatureHelpProvider/)
  assert.match(extension, /registerDefinitionProvider/)
  assert.match(extension, /registerRenameProvider/)
  assert.match(extension, /enableVue/)
  const grammar = JSON.parse(readFileSync(new URL("syntaxes/muse.tmLanguage.json", root), "utf8"))
  assert.ok(grammar.patterns.some(pattern => pattern.include === "#html"))
})

test("VS Code providers return Muse and HTML tooling results", () => {
  const registrations = { formatting: [], completion: [], hover: [], signature: [], definition: [], rename: [] }
  let openDocument
  let diagnosticRuns = []
  class Position {
    constructor(line, character) { this.line = line; this.character = character }
    translate(lineDelta = 0, characterDelta = 0) { return new Position(this.line + lineDelta, this.character + characterDelta) }
  }
  class Range { constructor(start, end) { this.start = start; this.end = end } }
  class CompletionItem { constructor(label, kind) { this.label = label; this.kind = kind } }
  class MarkdownString {
    constructor(value = "") { this.value = value }
    appendCodeblock(value, language) { this.value += "\\n```" + language + "\\n" + value + "\\n```"; return this }
  }
  class Hover { constructor(contents, range) { this.contents = contents; this.range = range } }
  class SignatureInformation { constructor(label) { this.label = label } }
  class SignatureHelp { constructor() { this.signatures = []; this.activeSignature = 0; this.activeParameter = 0 } }
  class Location { constructor(uri, range) { this.uri = uri; this.range = range } }
  class WorkspaceEdit {
    constructor() { this.edits = [] }
    replace(uri, range, newText) { this.edits.push({ uri, range, newText }) }
  }
  const vscode = {
    Position,
    Range,
    CompletionItem,
    CompletionItemKind: { Property: 1, Value: 2, Function: 3, Keyword: 4 },
    MarkdownString,
    Hover,
    SignatureInformation,
    SignatureHelp,
    Location,
    WorkspaceEdit,
    TextEdit: { replace: (range, newText) => ({ range, newText }) },
    Diagnostic: class Diagnostic { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity } },
    DiagnosticSeverity: { Error: 0 },
    languages: {
      createDiagnosticCollection: () => ({ set(uri, diagnostics) { diagnosticRuns.push({ uri, diagnostics }) }, dispose() {} }),
      registerDocumentFormattingEditProvider: (_language, provider) => { registrations.formatting.push(provider); return { dispose() {} } },
      registerCompletionItemProvider: (_language, provider) => { registrations.completion.push(provider); return { dispose() {} } },
      registerHoverProvider: (_language, provider) => { registrations.hover.push(provider); return { dispose() {} } },
      registerSignatureHelpProvider: (_language, provider) => { registrations.signature.push(provider); return { dispose() {} } },
      registerDefinitionProvider: (_language, provider) => { registrations.definition.push(provider); return { dispose() {} } },
      registerRenameProvider: (_language, provider) => { registrations.rename.push(provider); return { dispose() {} } },
    },
    workspace: {
      textDocuments: [],
      onDidOpenTextDocument: handler => { openDocument = handler; return { dispose() {} } },
      onDidChangeTextDocument: () => ({ dispose() {} }),
      getConfiguration: () => ({ get: (_key, fallback) => fallback }),
    },
    commands: { registerCommand: () => ({ dispose() {} }), executeCommand: () => undefined },
  }
  const require = createRequire(import.meta.url)
  const extensionPath = require.resolve("../editors/vscode/extension.cjs")
  const originalLoad = Module._load
  try {
    Module._load = function load(request, parent, isMain) {
      if (request === "vscode") return vscode
      return originalLoad.call(this, request, parent, isMain)
    }
    delete require.cache[extensionPath]
    const extension = require(extensionPath)
    const context = { subscriptions: [] }
    extension.activate(context)
    const lines = ["struct Card: View { init(title: string) { self.title = title } }", "VStack()", "<div class=\"card\" />", "Card()"]
    const source = lines.join("\\n")
    const document = {
      uri: "file:///Card.muse.ts",
      languageId: "muse",
      lineCount: lines.length,
      lineAt: line => ({ text: lines[line] }),
      getText: () => source,
      offsetAt(position) {
        return source.split("\\n").slice(0, position.line).reduce((total, line) => total + line.length + 2, 0) + position.character
      },
      positionAt(offset) {
        const before = source.slice(0, offset)
        const split = before.split("\\n")
        return new Position(split.length - 1, split.at(-1).length)
      },
    }
    const musePosition = new Position(1, 3)
    const htmlPosition = new Position(2, 4)
    const completionProvider = registrations.completion[0]
    const viewCompletions = completionProvider.provideCompletionItems(document, musePosition)
    const htmlCompletions = completionProvider.provideCompletionItems(document, htmlPosition)
    assert.ok(viewCompletions.some(item => item.label === "VStack"))
    assert.match(viewCompletions.find(item => item.label === "Card")?.detail ?? "", /Card\(title: string\)/)
    assert.ok(htmlCompletions.some(item => item.label === "div"))
    assert.match(completionProvider.provideCompletionItems(document, new Position(2, 10)).find(item => item.label === "class")?.detail ?? "", /HTML attribute/)
    const hoverResult = registrations.hover[0].provideHover(document, musePosition)
    assert.match(hoverResult.contents.value, /VStack/)
    const signatureResult = registrations.signature[0].provideSignatureHelp(document, new Position(1, 7))
    assert.ok(signatureResult.signatures.some(item => /ViewBuilder/.test(item.label)))
    const customSignature = registrations.signature[0].provideSignatureHelp(document, new Position(3, 5))
    assert.equal(customSignature.signatures[0].label, "Card(title: string)")
    const definitionResult = registrations.definition[0].provideDefinition(document, new Position(3, 2))
    assert.equal(definitionResult.uri, document.uri)
    assert.equal(definitionResult.range.start.line, 0)
    const renameResult = registrations.rename[0].provideRenameEdits(document, new Position(3, 2), "Panel")
    assert.equal(renameResult.edits.length, 2)

    const vueSource = `<template><div :class="{ active: enabled"></div></template>\n<script setup>\nconst count=State(0)\nif(count.value){\nText('ready')\n}\n</script>`
    const vueDocument = {
      uri: "file:///Counter.vue",
      languageId: "vue",
      lineCount: vueSource.split("\\n").length,
      lineAt: line => ({ text: vueSource.split("\\n")[line] }),
      getText: () => vueSource,
      positionAt(offset) {
        const before = vueSource.slice(0, offset)
        const split = before.split("\\n")
        return new Position(split.length - 1, split.at(-1).length)
      },
    }
    const vueEdits = registrations.formatting[0].provideDocumentFormattingEdits(vueDocument)
    assert.equal(vueEdits.length, 1)
    assert.match(vueEdits[0].newText, /const count=State\(0\)/)
    assert.doesNotMatch(vueEdits[0].newText, /template/)
    openDocument(vueDocument)
    assert.equal(diagnosticRuns.at(-1).uri, vueDocument.uri)
    assert.equal(diagnosticRuns.at(-1).diagnostics.length, 0)
  } finally {
    Module._load = originalLoad
    delete require.cache[extensionPath]
  }
})
