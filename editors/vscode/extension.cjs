const vscode = require('vscode')
const path = require('path')

function loadSemanticCompiler() {
  for (const request of ['@vune-ui/compiler', path.resolve(__dirname, '../../packages/compiler/dist/index.js')]) {
    try {
      const compiler = require(request)
      if (typeof compiler.diagnoseVuneSource === 'function') return compiler
    } catch { /* The standalone extension can still use its lexical fallback. */ }
  }
  return undefined
}

const semanticCompiler = loadSemanticCompiler()

const VIEW_SIGNATURES = Object.freeze({
  Text: ['Text(value: string | number)'],
  VStack: ['VStack(@ViewBuilder content)', 'VStack(options, @ViewBuilder content)', 'VStack(...children)'],
  HStack: ['HStack(@ViewBuilder content)', 'HStack(options, @ViewBuilder content)', 'HStack(...children)'],
  ZStack: ['ZStack(@ViewBuilder content)', 'ZStack(options, @ViewBuilder content)', 'ZStack(...children)'],
  ScrollView: ['ScrollView(@ViewBuilder content)', 'ScrollView(axis, @ViewBuilder content)'],
  SafeArea: ['SafeArea(@ViewBuilder content)', 'SafeArea(edges, @ViewBuilder content)'],
  GeometryReader: ['GeometryReader(@ViewBuilder content)'],
  Spacer: ['Spacer(minLength?)'],
  Button: ['Button(_ title: string | number, @Action action)', 'Button(@Action action, @ViewBuilder label)'],
  ForEach: ['ForEach(items, content)'],
  Element: ['Element(tag, props?, ...children)'],
})

const FALLBACK_HTML_TAGS = Object.freeze(['a', 'article', 'button', 'div', 'form', 'h1', 'h2', 'h3', 'header', 'img', 'input', 'label', 'main', 'nav', 'p', 'section', 'select', 'span', 'textarea', 'ul', 'li'])
const FALLBACK_HTML_ATTRIBUTES = Object.freeze(['class', 'for', 'id', 'style', 'title', 'role', 'onclick', 'onchange', 'oninput', 'onkeydown', 'disabled', 'name', 'placeholder', 'aria-label', 'aria-hidden', 'data-testid'])
const SEMANTIC_TOKEN_TYPES = Object.freeze(['class', 'function', 'parameter', 'property', 'keyword', 'decorator'])
const SEMANTIC_LEGEND = new vscode.SemanticTokensLegend(SEMANTIC_TOKEN_TYPES)

function tokenAt(document, position) {
  const line = document.lineAt(position.line).text
  let start = position.character
  let end = position.character
  while (start > 0 && /[A-Za-z0-9_$-]/.test(line[start - 1])) start -= 1
  while (end < line.length && /[A-Za-z0-9_$-]/.test(line[end])) end += 1
  return { name: line.slice(start, end), range: new vscode.Range(new vscode.Position(position.line, start), new vscode.Position(position.line, end)) }
}

function completionItem(label, detail, kind) {
  const item = new vscode.CompletionItem(label, kind)
  item.detail = detail
  return item
}

function openVuneDocuments(document) {
  const documents = [document, ...(vscode.workspace.textDocuments ?? [])]
  return [...new Map(documents
    .filter(candidate => candidate && (candidate.languageId === 'vune-ui' || candidate.languageId === 'vue'))
    .map(candidate => [String(candidate.uri), candidate])).values()]
}

function semanticSource(document) {
  const source = document.getText()
  if (document.languageId !== 'vue') return { source, offset: 0 }
  const script = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/i.exec(source)
  if (!script) return undefined
  return { source: script[1], offset: script.index + script[0].indexOf(script[1]) }
}

function semanticModel(document) {
  if (typeof semanticCompiler?.createVuneSemanticModel !== 'function') return undefined
  const region = semanticSource(document)
  if (!region) return undefined
  try {
    return { ...region, model: semanticCompiler.createVuneSemanticModel(region.source, String(document.uri)) }
  } catch { return undefined }
}

function htmlTagNames() {
  return semanticCompiler?.semanticHtmlTagNames ?? FALLBACK_HTML_TAGS
}

function htmlAttributeNames(tag) {
  return typeof semanticCompiler?.semanticHtmlAttributeNames === 'function'
    ? semanticCompiler.semanticHtmlAttributeNames(tag)
    : FALLBACK_HTML_ATTRIBUTES
}

function htmlAttributeSpec(tag, name) {
  return typeof semanticCompiler?.semanticHtmlAttributeSpec === 'function'
    ? semanticCompiler.semanticHtmlAttributeSpec(tag, name)
    : undefined
}

function htmlTagAtPosition(document, position) {
  const line = document.lineAt(position.line).text.slice(0, position.character)
  const match = /<([A-Za-z][A-Za-z0-9:._-]*)[^>]*$/.exec(line)
  return match?.[1]
}

function signatureMap(document) {
  const signatures = {}
  let usedSemanticModel = false
  for (const candidate of openVuneDocuments(document)) {
    const source = candidate.getText()
    const semantic = semanticModel(candidate)
    if (semantic) {
      usedSemanticModel = true
      for (const symbol of semantic.model.symbols ?? []) {
        if (symbol.kind !== 'view' || !symbol.initializers?.length) continue
        signatures[symbol.name] = symbol.initializers.map(initializer => initializer.signature.startsWith(`${symbol.name}(`)
          ? initializer.signature
          : `${symbol.name}(${initializer.signature})`)
      }
      continue
    }
    const structs = /\bstruct\s+([A-Za-z_$][A-Za-z0-9_$]*)[^{}]*\{([\s\S]*?)\}/g
    let match
    while ((match = structs.exec(source))) {
      const initializers = []
      const pattern = /\binit\s*\(([^)]*)\)/g
      let initializer
      while ((initializer = pattern.exec(match[2]))) initializers.push(`${match[1]}(${initializer[1].trim()})`)
      if (initializers.length > 0) signatures[match[1]] = initializers
    }
  }
  // Keep a minimal degraded-mode catalog only when the compiler package is
  // unavailable. Normal VS Code sessions consume the canonical symbol table.
  if (!usedSemanticModel) Object.assign(signatures, VIEW_SIGNATURES)
  return signatures
}

function completions(document, position) {
  const line = document.lineAt(position.line).text.slice(0, position.character)
  if (/<[A-Za-z0-9-]*$/.test(line)) return htmlTagNames().map(tag => completionItem(tag, 'Raw HTML element', vscode.CompletionItemKind.Property))
  const attributeContext = /<([A-Za-z0-9-]+)\s+[A-Za-z0-9:-]*$/.exec(line)
  if (attributeContext) {
    return htmlAttributeNames(attributeContext[1]).map(attribute => {
      const spec = htmlAttributeSpec(attributeContext[1], attribute)
      return completionItem(attribute, `HTML attribute${spec ? ` (${spec.type})` : ''}`, vscode.CompletionItemKind.Value)
    })
  }
  const items = []
  for (const [name, signatures] of Object.entries(signatureMap(document))) {
    items.push(completionItem(name, signatures.join(' | '), vscode.CompletionItemKind.Function))
  }
  items.push(completionItem('@ViewBuilder', 'Initializer closure role', vscode.CompletionItemKind.Keyword))
  items.push(completionItem('@Action', 'Initializer closure role', vscode.CompletionItemKind.Keyword))
  return items
}

function hover(document, position) {
  const token = tokenAt(document, position)
  const signatures = signatureMap(document)[token.name]
  if (signatures) {
    const markdown = new vscode.MarkdownString()
    markdown.appendCodeblock(signatures.join('\n'), 'vune-ui')
    markdown.isTrusted = false
    return new vscode.Hover(markdown, token.range)
  }
  if (htmlTagNames().includes(token.name)) return new vscode.Hover(new vscode.MarkdownString(`Raw HTML element \`<${token.name}>\``), token.range)
  const htmlTag = htmlTagAtPosition(document, position)
  const attribute = htmlTag ? htmlAttributeSpec(htmlTag, token.name) : undefined
  if (attribute || /^aria-|^data-/.test(token.name)) {
    const detail = attribute ? ` — ${attribute.type}` : ''
    return new vscode.Hover(new vscode.MarkdownString(`HTML attribute \`${token.name}\`${detail}`), token.range)
  }
  return undefined
}

function signatureHelp(document, position) {
  const source = document.getText()
  const offset = document.offsetAt
    ? document.offsetAt(position)
    : source.split(/\r?\n/).slice(0, position.line).reduce((total, line) => total + line.length + 1, 0) + position.character
  const prefix = source.slice(0, offset)
  const linePrefix = document.lineAt(position.line).text.slice(0, position.character)
  const match = /(?:^|[^A-Za-z0-9_$])([A-Z][A-Za-z0-9_$]*)\s*\([^()]*$/.exec(linePrefix)
    ?? /(?:^|[^A-Za-z0-9_$])([A-Z][A-Za-z0-9_$]*)\s*\([^()]*$/.exec(prefix)
  const signatures = match ? signatureMap(document)[match[1]] : undefined
  if (!signatures) return undefined
  const result = new vscode.SignatureHelp()
  result.signatures = signatures.map(signature => new vscode.SignatureInformation(signature))
  result.activeSignature = 0
  result.activeParameter = 0
  return result
}

function declarations(document) {
  const source = document.getText()
  const result = new Map()
  const semantic = semanticModel(document)
  if (semantic) {
      for (const view of semantic.model.views ?? []) {
        const startOffset = semantic.source.indexOf(view.name, view.range.start)
        if (startOffset >= 0 && startOffset <= view.range.end) {
          const start = document.positionAt(semantic.offset + startOffset)
          result.set(view.name, new vscode.Location(document.uri, new vscode.Range(start, start.translate(0, view.name.length))))
        }
      }
  }
  const pattern = /(?:struct|class|interface|const|function)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g
  let match
  while ((match = pattern.exec(source))) {
    const start = document.positionAt(match.index + match[0].lastIndexOf(match[1]))
    const end = start.translate(0, match[1].length)
    if (!result.has(match[1])) result.set(match[1], new vscode.Location(document.uri, new vscode.Range(start, end)))
  }
  return result
}

async function workspaceVuneDocuments(document) {
  const documents = openVuneDocuments(document)
  if (typeof vscode.workspace.findFiles !== 'function' || typeof vscode.workspace.openTextDocument !== 'function') return documents
  const uris = await vscode.workspace.findFiles('**/*.{vune,vune.ts,vue}', '**/{node_modules,dist,.git}/**', 200)
  for (const uri of uris) {
    if (documents.some(candidate => String(candidate.uri) === String(uri))) continue
    try { documents.push(await vscode.workspace.openTextDocument(uri)) } catch { /* Ignore unreadable workspace files. */ }
  }
  return documents
}

async function definition(document, position) {
  const token = tokenAt(document, position)
  for (const candidate of await workspaceVuneDocuments(document)) {
    const location = declarations(candidate).get(token.name)
    if (location) return location
  }
  return undefined
}

function codeIdentifierRanges(document, expectedName) {
  const source = document.getText()
  const ranges = []
  let state = 'code'
  let quote = null
  for (let index = 0; index < source.length;) {
    const character = source[index]
    const next = source[index + 1]
    if (state === 'lineComment') {
      if (character === '\n') state = 'code'
      index += 1
      continue
    }
    if (state === 'blockComment') {
      if (character === '*' && next === '/') { state = 'code'; index += 2 } else index += 1
      continue
    }
    if (state === 'string') {
      if (character === '\\') index += 2
      else if (character === quote) { state = 'code'; quote = null; index += 1 }
      else index += 1
      continue
    }
    if (character === '/' && next === '/') { state = 'lineComment'; index += 2; continue }
    if (character === '/' && next === '*') { state = 'blockComment'; index += 2; continue }
    if (character === '"' || character === "'" || character === '`') { state = 'string'; quote = character; index += 1; continue }
    if (/[A-Za-z_$]/.test(character)) {
      const start = index
      index += 1
      while (index < source.length && /[A-Za-z0-9_$]/.test(source[index])) index += 1
      const name = source.slice(start, index)
      if (name === expectedName) ranges.push(new vscode.Range(document.positionAt(start), document.positionAt(index)))
      continue
    }
    index += 1
  }
  return ranges
}

async function renameEdits(document, position, newName) {
  const token = tokenAt(document, position)
  if (!token.name || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(newName)) return undefined
  const edit = new vscode.WorkspaceEdit()
  const documents = await workspaceVuneDocuments(document)
  if (!documents.some(candidate => declarations(candidate).has(token.name))) return undefined
  const semanticTarget = documents.some(candidate => semanticModel(candidate)?.model.views?.some(view => view.name === token.name))
  if (semanticTarget) {
    for (const candidate of documents) {
      const semantic = semanticModel(candidate)
      if (semantic) {
        for (const view of semantic.model.views ?? []) {
          if (view.name !== token.name) continue
          const startOffset = semantic.source.indexOf(token.name, view.range.start)
          if (startOffset >= 0 && startOffset <= view.range.end) {
            const start = document === candidate ? document.positionAt(semantic.offset + startOffset) : candidate.positionAt(semantic.offset + startOffset)
            edit.replace(candidate.uri, new vscode.Range(start, start.translate(0, token.name.length)), newName)
          }
        }
        for (const call of semantic.model.calls ?? []) {
          if (call.callee !== token.name) continue
          const startOffset = semantic.source.indexOf(token.name, call.range.start)
          if (startOffset < 0) continue
          const start = candidate.positionAt(semantic.offset + startOffset)
          edit.replace(candidate.uri, new vscode.Range(start, start.translate(0, token.name.length)), newName)
        }
        continue
      }
      if (candidate.languageId === 'vue') {
        for (const range of codeIdentifierRanges(candidate, token.name)) edit.replace(candidate.uri, range, newName)
      }
    }
    return edit
  }
  for (const candidate of documents) {
    for (const range of codeIdentifierRanges(candidate, token.name)) edit.replace(candidate.uri, range, newName)
  }
  return edit
}

function semanticTokens(document) {
  const builder = new vscode.SemanticTokensBuilder(SEMANTIC_LEGEND)
  const source = document.getText()
  const semantic = semanticModel(document)
  if (semantic) {
    try {
      const model = semantic.model
      const pushName = (name, startOffset, type) => {
        const offset = semantic.source.indexOf(name, Math.max(0, startOffset))
        if (offset < 0) return
        const start = document.positionAt(semantic.offset + offset)
        builder.push(start.line, start.character, name.length, type, [])
      }
      for (const view of model.views ?? []) pushName(view.name, view.range.start, 'class')
      for (const call of model.calls ?? []) pushName(call.callee, call.range.start, 'function')
      for (const element of model.htmlElements ?? []) {
        pushName(element.tag, element.range.start + 1, 'class')
        for (const attribute of element.attributes ?? []) pushName(attribute, element.range.start, 'property')
      }
      for (const field of (model.views ?? []).flatMap(view => view.fields ?? [])) {
        if (field.kind === 'state' || field.kind === 'binding') pushName(field.name, field.range.start, 'property')
      }
      const syntaxPatterns = [
        { expression: /\binit\b/g, group: 0, type: 'keyword' },
        { expression: /@(State|Binding|ViewBuilder|Action)\b/g, group: 0, type: 'decorator' },
      ]
      for (const { expression, group, type } of syntaxPatterns) {
        let match
        while ((match = expression.exec(source))) {
          const value = match[group]
          const startOffset = match.index + match[0].indexOf(value)
          const start = document.positionAt(startOffset)
          builder.push(start.line, start.character, value.length, type, [])
        }
      }
      return builder.build()
    } catch { /* Fall through for a partially typed document. */ }
  }
  const patterns = [
    { expression: /\bstruct\s+([A-Za-z_$][A-Za-z0-9_$]*)/g, group: 1, type: 'class' },
    { expression: /\binit\b/g, group: 0, type: 'keyword' },
    { expression: /@(State|Binding|ViewBuilder|Action)\b/g, group: 0, type: 'decorator' },
    { expression: /\b([A-Z][A-Za-z0-9_$]*)\s*(?=\()/g, group: 1, type: 'function' },
    { expression: /<\/?([A-Za-z][A-Za-z0-9:._-]*)/g, group: 1, type: 'class' },
    { expression: /\b((?:aria|data)-[A-Za-z0-9_-]+|on[A-Za-z]+|class|for|style|role)\s*(?==|\s|>)/g, group: 1, type: 'property' },
  ]
  for (const { expression, group, type } of patterns) {
    let match
    while ((match = expression.exec(source))) {
      const value = match[group]
      const startOffset = match.index + match[0].indexOf(value)
      const start = document.positionAt(startOffset)
      builder.push(start.line, start.character, value.length, type, [])
    }
  }
  return builder.build()
}

function diagnosticsInSource(document, source, offset) {
  const diagnostics = []
  const stack = []
  const templates = []
  let mode = 'code'
  let modeStart = 0
  let regexClass = false
  const report = (index, message) => {
    const position = document.positionAt(offset + index)
    diagnostics.push(new vscode.Diagnostic(new vscode.Range(position, position.translate(0, 1)), message, vscode.DiagnosticSeverity.Error))
  }
  const regexCanStart = index => {
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (/\s/.test(source[cursor])) continue
      return '([{=,:;!?&|+-*%^~<>'.includes(source[cursor])
    }
    return true
  }
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    const next = source[index + 1]
    if (mode === 'lineComment') {
      if (character === '\n') mode = 'code'
      continue
    }
    if (mode === 'blockComment') {
      if (character === '*' && next === '/') { mode = 'code'; index += 1 }
      continue
    }
    if (mode === 'single' || mode === 'double') {
      if (character === '\\') index += 1
      else if ((mode === 'single' && character === "'") || (mode === 'double' && character === '"')) mode = 'code'
      continue
    }
    if (mode === 'regex') {
      if (character === '\\') index += 1
      else if (character === '[') regexClass = true
      else if (character === ']') regexClass = false
      else if (character === '/' && !regexClass) {
        mode = 'code'
        while (/[a-z]/i.test(source[index + 1] ?? '')) index += 1
      }
      continue
    }
    if (mode === 'template') {
      if (character === '\\') { index += 1; continue }
      if (character === '`') { templates.pop(); mode = 'code'; continue }
      if (character === '$' && next === '{') {
        stack.push({ character: '{', index: index + 1, template: true })
        mode = 'code'
        index += 1
      }
      continue
    }
    if (character === '/' && next === '/') { mode = 'lineComment'; modeStart = index; index += 1; continue }
    if (character === '/' && next === '*') { mode = 'blockComment'; modeStart = index; index += 1; continue }
    if (character === '/' && regexCanStart(index)) { mode = 'regex'; modeStart = index; regexClass = false; continue }
    if (character === '"') { mode = 'double'; modeStart = index; continue }
    if (character === "'") { mode = 'single'; modeStart = index; continue }
    if (character === '`') { templates.push(index); mode = 'template'; continue }
    if ('({['.includes(character)) stack.push({ character, index })
    if (')}]'.includes(character)) {
      const expected = { ')': '(', ']': '[', '}': '{' }[character]
      const opening = stack.pop()
      if (!opening || opening.character !== expected) {
        report(index, `Unexpected '${character}' in Vune source.`)
      } else if (opening.template) mode = 'template'
    }
  }
  if (mode === 'single' || mode === 'double') report(modeStart, `Unclosed ${mode === 'single' ? "'" : '"'} string in Vune source.`)
  else if (mode === 'template' || templates.length > 0) report(templates.at(-1) ?? modeStart, 'Unclosed template literal in Vune source.')
  else if (mode === 'blockComment') report(modeStart, 'Unclosed block comment in Vune source.')
  else if (mode === 'regex') report(modeStart, 'Unclosed regular expression in Vune source.')
  for (const opening of stack) {
    report(opening.index, `Unclosed '${opening.character}' in Vune source.`)
  }
  return diagnostics
}

function offsetsForLines(source) {
  const offsets = [0]
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') offsets.push(index + 1)
  }
  return offsets
}

function semanticDiagnostics(document, source, offset) {
  if (!semanticCompiler) return undefined
  const offsets = offsetsForLines(source)
  return semanticCompiler.diagnoseVuneSource(source).map(diagnostic => {
    const line = Math.max(1, diagnostic.line)
    const column = Math.max(1, diagnostic.column)
    const sourceOffset = (offsets[line - 1] ?? source.length) + column - 1
    const start = document.positionAt(offset + sourceOffset)
    return new vscode.Diagnostic(new vscode.Range(start, start.translate(0, 1)), diagnostic.message, diagnostic.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error)
  })
}

function diagnostics(document) {
  const source = document.getText()
  if (document.languageId !== 'vue') return semanticDiagnostics(document, source, 0) ?? diagnosticsInSource(document, source, 0)
  const result = []
  const script = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi
  let match
  while ((match = script.exec(source))) {
    const body = match[1]
    const offset = match.index + match[0].indexOf(body)
    result.push(...(semanticDiagnostics(document, body, offset) ?? diagnosticsInSource(document, body, offset)))
  }
  return result
}

function formatSource(source) {
  const lines = source.split(/\r?\n/)
  let depth = 0
  const formatted = lines.map(line => {
    const trimmed = line.trim()
    if (!trimmed) return ''
    if (/^[}\])]/.test(trimmed)) depth = Math.max(0, depth - 1)
    const output = `${'  '.repeat(depth)}${trimmed}`
    if (/[{\[(]\s*$/.test(trimmed) || /\{\s*$/.test(trimmed)) depth += 1
    return output
  }).join('\n')
  return formatted
}

function format(document) {
  const formatted = formatSource(document.getText())
  return [vscode.TextEdit.replace(new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), formatted)]
}

function formatVue(document) {
  const source = document.getText()
  const script = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/i.exec(source)
  if (!script) return []
  const body = script[1]
  const bodyStart = script.index + script[0].indexOf(body)
  const formatted = formatSource(body.trim())
  const replacement = formatted ? `\n${formatted}\n` : '\n'
  return [vscode.TextEdit.replace(
    new vscode.Range(document.positionAt(bodyStart), document.positionAt(bodyStart + body.length)),
    replacement,
  )]
}

function activate(context) {
  const collection = vscode.languages.createDiagnosticCollection('vune-ui')
  const refresh = document => { if (document.languageId === 'vune-ui' || document.languageId === 'vue') collection.set(document.uri, diagnostics(document)) }
  const languages = ['vune-ui']
  if (vscode.workspace.getConfiguration('vune.languageTools').get('enableVue', true)) languages.push('vue')
  context.subscriptions.push(collection)
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(refresh))
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => refresh(event.document)))
  context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(languages, {
    provideDocumentFormattingEdits(document) { return document.languageId === 'vue' ? formatVue(document) : format(document) },
  }))
  context.subscriptions.push(vscode.languages.registerCompletionItemProvider(languages, { provideCompletionItems: completions }, '<', ':', '.'))
  context.subscriptions.push(vscode.languages.registerHoverProvider(languages, { provideHover: hover }))
  context.subscriptions.push(vscode.languages.registerSignatureHelpProvider(languages, { provideSignatureHelp: signatureHelp }, '(', ','))
  context.subscriptions.push(vscode.languages.registerDefinitionProvider(languages, { provideDefinition: definition }))
  context.subscriptions.push(vscode.languages.registerRenameProvider(languages, {
    async prepareRename(document, position) {
      const token = tokenAt(document, position)
      return await definition(document, position) ? token.range : undefined
    },
    provideRenameEdits: renameEdits,
  }))
  context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider(languages, { provideDocumentSemanticTokens: semanticTokens }, SEMANTIC_LEGEND))
  context.subscriptions.push(vscode.commands.registerCommand('vune.formatDocument', () => vscode.commands.executeCommand('editor.action.formatDocument')))
  vscode.workspace.textDocuments.forEach(refresh)
}

function deactivate() {}

module.exports = { activate, deactivate }
