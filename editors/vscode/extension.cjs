const vscode = require('vscode')

const VIEW_SIGNATURES = Object.freeze({
  Text: ['Text(value: string | number)'],
  VStack: ['VStack(@ViewBuilder content)', 'VStack(options, @ViewBuilder content)', 'VStack(...children)'],
  HStack: ['HStack(@ViewBuilder content)', 'HStack(options, @ViewBuilder content)', 'HStack(...children)'],
  ZStack: ['ZStack(@ViewBuilder content)', 'ZStack(options, @ViewBuilder content)', 'ZStack(...children)'],
  ScrollView: ['ScrollView(@ViewBuilder content)', 'ScrollView(axis, @ViewBuilder content)'],
  SafeArea: ['SafeArea(@ViewBuilder content)', 'SafeArea(edges, @ViewBuilder content)'],
  GeometryReader: ['GeometryReader(@ViewBuilder content)'],
  Spacer: ['Spacer(minLength?)'],
  Button: ['Button(@Action action)', 'Button(value, @Action action)', 'Button(@Action action, @ViewBuilder label)', 'Button(@ViewBuilder label, @Action action)'],
  ForEach: ['ForEach(items, content)'],
  Element: ['Element(tag, props?, ...children)'],
})

const HTML_TAGS = Object.freeze(['a', 'article', 'button', 'div', 'form', 'h1', 'h2', 'h3', 'header', 'img', 'input', 'label', 'main', 'nav', 'p', 'section', 'select', 'span', 'textarea', 'ul', 'li'])
const HTML_ATTRIBUTES = Object.freeze(['class', 'for', 'id', 'style', 'title', 'role', 'onclick', 'onchange', 'oninput', 'onkeydown', 'disabled', 'name', 'placeholder', 'aria-label', 'aria-hidden', 'data-testid'])

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

function signatureMap(document) {
  const signatures = Object.fromEntries(Object.entries(VIEW_SIGNATURES))
  const source = document.getText()
  const structs = /\bstruct\s+([A-Za-z_$][A-Za-z0-9_$]*)[^{}]*\{([\s\S]*?)\}/g
  let match
  while ((match = structs.exec(source))) {
    const initializers = []
    const pattern = /\binit\s*\(([^)]*)\)/g
    let initializer
    while ((initializer = pattern.exec(match[2]))) initializers.push(`${match[1]}(${initializer[1].trim()})`)
    if (initializers.length > 0) signatures[match[1]] = initializers
  }
  return signatures
}

function completions(document, position) {
  const line = document.lineAt(position.line).text.slice(0, position.character)
  if (/<[A-Za-z0-9-]*$/.test(line)) return HTML_TAGS.map(tag => completionItem(tag, 'Raw HTML element', vscode.CompletionItemKind.Property))
  if (/<[A-Za-z0-9-]+\s+[A-Za-z0-9:-]*$/.test(line)) return HTML_ATTRIBUTES.map(attribute => completionItem(attribute, 'HTML attribute', vscode.CompletionItemKind.Value))
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
    markdown.appendCodeblock(signatures.join('\n'), 'muse')
    markdown.isTrusted = false
    return new vscode.Hover(markdown, token.range)
  }
  if (HTML_TAGS.includes(token.name)) return new vscode.Hover(new vscode.MarkdownString(`Raw HTML element \`<${token.name}>\``), token.range)
  if (HTML_ATTRIBUTES.includes(token.name) || /^aria-|^data-/.test(token.name)) return new vscode.Hover(new vscode.MarkdownString(`HTML attribute \`${token.name}\``), token.range)
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
  const pattern = /(?:struct|class|interface|const|function)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g
  let match
  while ((match = pattern.exec(source))) {
    const start = document.positionAt(match.index + match[0].lastIndexOf(match[1]))
    const end = start.translate(0, match[1].length)
    result.set(match[1], new vscode.Location(document.uri, new vscode.Range(start, end)))
  }
  return result
}

function definition(document, position) {
  const token = tokenAt(document, position)
  return declarations(document).get(token.name)
}

function renameEdits(document, position, newName) {
  const token = tokenAt(document, position)
  if (!token.name) return undefined
  const edit = new vscode.WorkspaceEdit()
  const pattern = new RegExp(`\\b${token.name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'g')
  for (let line = 0; line < document.lineCount; line += 1) {
    const text = document.lineAt(line).text
    let match
    while ((match = pattern.exec(text))) {
      edit.replace(document.uri, new vscode.Range(new vscode.Position(line, match.index), new vscode.Position(line, match.index + token.name.length)), newName)
    }
  }
  return edit
}

function diagnosticsInSource(document, source, offset) {
  const diagnostics = []
  const stack = []
  let quote = null
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (quote) {
      if (character === '\\') index += 1
      else if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'") { quote = character; continue }
    if ('({['.includes(character)) stack.push({ character, index })
    if (')}]'.includes(character)) {
      const expected = { ')': '(', ']': '[', '}': '{' }[character]
      const opening = stack.pop()
      if (!opening || opening.character !== expected) {
        const position = document.positionAt(offset + index)
        diagnostics.push(new vscode.Diagnostic(new vscode.Range(position, position.translate(0, 1)), `Unexpected '${character}' in Muse source.`, vscode.DiagnosticSeverity.Error))
      }
    }
  }
  for (const opening of stack) {
    const position = document.positionAt(offset + opening.index)
    diagnostics.push(new vscode.Diagnostic(new vscode.Range(position, position.translate(0, 1)), `Unclosed '${opening.character}' in Muse source.`, vscode.DiagnosticSeverity.Error))
  }
  return diagnostics
}

function diagnostics(document) {
  const source = document.getText()
  if (document.languageId !== 'vue') return diagnosticsInSource(document, source, 0)
  const result = []
  const script = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi
  let match
  while ((match = script.exec(source))) {
    const body = match[1]
    result.push(...diagnosticsInSource(document, body, match.index + match[0].indexOf(body)))
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
  const collection = vscode.languages.createDiagnosticCollection('muse')
  const refresh = document => { if (document.languageId === 'muse' || document.languageId === 'vue') collection.set(document.uri, diagnostics(document)) }
  const languages = ['muse']
  if (vscode.workspace.getConfiguration('muse.languageTools').get('enableVue', true)) languages.push('vue')
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
    prepareRename(document, position) { return tokenAt(document, position).range },
    provideRenameEdits: renameEdits,
  }))
  context.subscriptions.push(vscode.commands.registerCommand('muse.formatDocument', () => vscode.commands.executeCommand('editor.action.formatDocument')))
  vscode.workspace.textDocuments.forEach(refresh)
}

function deactivate() {}

module.exports = { activate, deactivate }
