import assert from "node:assert/strict"
import test from "node:test"
import ts from "typescript"
import { compileVuneFile, createVuneLanguageService, createVuneSemanticModel, createVuneVitePlugin, diagnoseVuneSource, lowerVuneBuilderAst, mapGeneratedPosition, mapOriginalPosition, parseVuneBuilder, parseVuneStructs, transformVuneSource } from "../packages/compiler/dist/index.js"
import { vunePlugin } from "../packages/vite/dist/index.js"
import { Text, VStack, compiledTemplate, defineCompiledTemplate, defineView, initializer, modifiedContent, modifiedContentCompiled, modifierGraphOf, namedArguments, overloadClosure, renderViewNode, resolveBuilderClosure, resolveBuilderInput } from "../packages/core/dist/index.js"
import { readFileSync } from "node:fs"

test("@vune-ui/compiler lowers .vune.ts builders through declaration-neutral syntax", () => {
  const source = `VStack(spacing: 12) {\n  Text("Header")\n  if (enabled) { Text("On") } else { Text("Off") }\n  ForEach(items) { item in Row(item) }\n  Each(items) { item in Row(item) }\n}`
  const output = transformVuneSource(source, "Counter.vune.ts")
  assert.match(output, /VStack\(namedArguments\(\{ spacing: 12 \}\), \(\) =>/)
  assert.match(output, /if \(enabled\)[\s\S]*Text\("On"\)[\s\S]*Text\("Off"\)/)
  assert.match(output, /ForEach\(items, \(item\) => \[Row\(item\)\]\)/)
  assert.match(output, /Each\(items, \(item\) => \[Row\(item\)\]\)/)
  assert.match(output, /import \{ namedArguments \} from "@vune-ui\/core"/)
  assert.equal(ts.createSourceFile("Builder.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
})

test("@vune-ui/compiler keeps Vue imports separate when ensuring core imports", () => {
  const source = `import { VuneView } from "@vune-ui/vue"
import { Element } from "@vune-ui/core"
const App = VuneView(() => Element("section", null, "Hi"))`
  const output = transformVuneSource(source, "VueImports.vune.ts")
  assert.match(output, /import \{ VuneView \} from "@vune-ui\/vue"/)
  assert.match(output, /import \{ Element \} from "@vune-ui\/core"/)
  assert.doesNotMatch(output, /Element,\s*Element/)
  assert.equal(ts.createSourceFile("VueImports.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
})

test("@vune-ui/compiler keeps TypeScript lexical syntax separate from Vune HTML and blocks", () => {
  const source = `type Bar = number
declare const foo: <T>(value: T) => T
declare const a: number
declare const b: number
function matches(value: string) {
  return /\\{/.test(value)
}
const generic = foo<Bar>(1)
const result = a < b && b > a`
  const output = transformVuneSource(source, "LexicalBoundaries.vune.ts")
  assert.match(output, /foo<Bar>\(1\)/)
  assert.match(output, /a < b && b > a/)
  assert.ok(output.includes(String.raw`return /\{/.test(value)`))
  assert.deepEqual(diagnoseVuneSource(source).filter(diagnostic => diagnostic.code === "VUNE_SYNTAX"), [])
  assert.equal(ts.createSourceFile("LexicalBoundaries.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
})

test("@vune-ui/compiler lowers ViewBuilder statements and children in one executable closure", () => {
  const source = `VStack() {
  const title = "Hello"
  const enabled = count > 0
  Text(title)
  if (enabled) {
    Text("Enabled")
  }
}`
  const output = transformVuneSource(source, "StatementBody.vune.ts")
  assert.match(output, /const __vuneChildren = \[\]/)
  assert.match(output, /const title = "Hello"/)
  assert.match(output, /__vuneChildren\.push\(Text\(title\)\)/)
  assert.match(output, /if \(enabled\)[\s\S]*__vuneChildren\.push\(Text\("Enabled"\)\)/)
  assert.doesNotMatch(output, /\[const title/)
  assert.equal(ts.createSourceFile("StatementBody.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)

  const controlFlow = transformVuneSource(`VStack() {
  switch (mode) {
    case "enabled":
      Text("Enabled")
      break
    default:
      if (fallback) {
        return Text("Fallback")
      }
  }
}`, "StatementControlFlow.vune.ts")
  assert.match(controlFlow, /switch \(mode\)/)
  assert.match(controlFlow, /case "enabled":[\s\S]*__vuneChildren\.push\(Text\("Enabled"\)\)[\s\S]*break;/)
  assert.match(controlFlow, /if \(fallback\)[\s\S]*return Text\("Fallback"\);/)
  assert.equal(ts.createSourceFile("StatementControlFlow.ts", controlFlow, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
})

test("@vune-ui/compiler preserves State call shape, generic arguments, and object initializers", () => {
  const source = `type Foo = { readonly value: string }
import { State, Text } from "vune-ui"
import { view } from "@vune-ui/react"
const count = State(
  0
)
const value = State<Foo | null>(null)
const state = State({
  count: 0,
  text: ""
})
export default view(() => [
  Text(String(count.value)),
  Text(String(value.value?.value ?? "")),
  Text(String(state.value.count)),
])`
  const output = transformVuneSource(source, "StateShapes.vune.ts")
  assert.match(output, /state: \(\) => \{[\s\S]*const count = State\(\n  0\n\);[\s\S]*const value = State<Foo \| null>\(null\);[\s\S]*const state = State\(\{\n  count: 0,\n  text: ""\n\}\);/)
  assert.doesNotMatch(output, /^const count = State/m)
  assert.doesNotMatch(output, /^const value = State/m)
  assert.equal(ts.createSourceFile("StateShapes.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
})

test("@vune-ui/compiler preserves meaningful raw HTML whitespace and explicit ForEach identity", () => {
  const html = transformVuneSource(`<p>Hello <strong>world</strong> !</p>`, "Whitespace.vune.ts")
  assert.match(html, /Element\("p", null, "Hello ", Element\("strong", null, "world"\), " !"\)/)
  assert.doesNotMatch(html, /"Hello".*"world".*"!"/)

  const each = transformVuneSource(`const items = [{ id: "a" }]
ForEach(items, { id: item => item.id }) {
  Row(item)
}`, "ForEachIdentity.vune.ts")
  assert.match(each, /ForEach\(items, namedArguments\(\{ key: item => item\.id \}\), \(\) => \[Row\(item\)\]\)/)
  assert.deepEqual(diagnoseVuneSource(`const items = [{ id: "a" }]
ForEach(items, { id: item => item.id }) { Row(item) }`), [])
})

test("binding shorthand uses AST identifiers and preserves host dollar syntax", () => {
  const source = `Toggle(isOn: $wifi)
const attrs = vm.$attrs
const refs = $refs
const token = foo$bar
const text = "$wifi"
const pattern = /\\$wifi/`
  const output = transformVuneSource(source, "Binding.vune.ts")
  assert.match(output, /Binding\(wifi\)/)
  assert.doesNotMatch(output, /Binding\(attrs\)/)
  assert.doesNotMatch(output, /Binding\(refs\)/)
  assert.match(output, /vm\.\$attrs/)
  assert.match(output, /foo\$bar/)
  assert.match(output, /"\$wifi"/)
  assert.match(output, /\/\\\$wifi\//)
  assert.equal(ts.createSourceFile("Binding.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
})

test("compiler and IDE consumers share one Vune plus TypeScript semantic model", () => {
  const source = `import { Text, VStack } from "@vune-ui/core"
struct Card<Content: View>: View {
  let content: Content
  init(@ViewBuilder content: () => Content) { self.content = content() }
  var body: some View { VStack() { Text("Hello"); content } }
}`
  const model = createVuneSemanticModel(source, "Card.vune.ts")
  const card = model.view("Card")
  assert.equal(model.kind, "VuneSemanticModel")
  assert.equal(card?.qualifiedName, "Card")
  assert.equal(card?.genericParameters, "Content: View")
  assert.equal(card?.initializers[0]?.signature, "Card(@ViewBuilder content: () => Content)")
  assert.ok(model.calls.some(call => call.callee === "VStack" && call.trailingClosure))
  assert.ok(model.calls.some(call => call.callee === "Text"))
  assert.ok(model.imports.some(item => item.module === "@vune-ui/core"))
  assert.equal(model.typescriptDiagnostics.length, 0)
  assert.equal(typeof model.typeChecker.typeToString(model.typeChecker.getTypeAtLocation(model.typescript.statements[0])), "string")
  assert.equal(model.symbol("Card")?.kind, "view")
  assert.equal(model.symbol("ViewBuilder")?.kind, "builder")
  assert.deepEqual(model.symbol("ViewBuilder")?.operations, ["buildBlock", "buildOptional", "buildEither", "buildArray"])
  assert.equal(model.symbol("Card(@ViewBuilder content: () => Content)")?.kind, "initializer")
  assert.equal(createVuneLanguageService().semantic(source, "Card.vune.ts").view("Card")?.name, "Card")
})

test("every known Vune call exposes the shared initializer answer", () => {
  const source = `import { Text, VStack } from "@vune-ui/core"
struct Card: View {
  let title: string
  init(title: string) { self.title = title }
  var body: some View { VStack(spacing: 8) { Text(title) } }
}
const items = [{ id: "a", label: "A" }]
VStack(spacing: 12) { Text("Root") }
ForEach(items, key: item => item.id) { item in Text(item.label) }
Card(title: "Card")`
  const model = createVuneSemanticModel(source, "ResolvedCalls.vune.ts")
  const root = model.calls.find(call => call.callee === "VStack" && call.range.start >= source.indexOf("VStack(spacing: 12)"))
  assert.equal(root?.resolution.resolvedViewType?.name, "VStack")
  assert.equal(root?.resolution.resolvedInitializer?.signature, "options, @ViewBuilder content")
  assert.deepEqual(root?.resolution.argumentTypes, ["number", "function"])
  assert.deepEqual(root?.resolution.closureRoles, [undefined, "viewBuilder"])
  assert.deepEqual(root?.resolution.inferredGenerics, { Content: "View" })
  assert.deepEqual(root?.resolution.diagnostics, [])

  const each = model.calls.find(call => call.callee === "ForEach")
  assert.equal(each?.resolution.resolvedInitializer?.signature, "ForEach(items, key: (item) => string | number, @ViewBuilder content)")
  assert.deepEqual(each?.resolution.closureRoles, ["value", "value", "viewBuilder"])
  assert.deepEqual(each?.resolution.diagnostics, [])

  const card = model.calls.find(call => call.callee === "Card")
  assert.equal(card?.resolution.resolvedViewType?.name, "Card")
  assert.equal(card?.resolution.resolvedInitializer?.signature, "Card(title: string)")
  assert.deepEqual(card?.resolution.argumentTypes, ["string"])
})

test("compiler diagnostics consume shared call resolution without rejecting legacy variadic Views", () => {
  const service = createVuneLanguageService()
  assert.deepEqual(service.diagnose("Text(true)"), [{
    severity: "error",
    code: "VUNE_INITIALIZER",
    message: "No matching initializer for Text. Available initializers: Text(value).",
    line: 1,
    column: 1,
  }])
  assert.deepEqual(service.diagnose("VStack()"), [])
})

test("semantic model exposes lowered HTML and foreign component symbols", () => {
  const source = `import VueChart from "./VueChart.vue"
Element("section", { id: "root", "aria-label": title })
VueChart(values: values)`
  const model = createVuneSemanticModel(source, "Interop.vune.ts")
  assert.deepEqual(model.htmlElements.map(element => [element.tag, element.attributes]), [["section", ["id", "aria-label"]]])
  assert.deepEqual(model.foreignComponents.map(component => [component.localName, component.module]), [["VueChart", "./VueChart.vue"]])
  assert.equal(model.symbol("VueChart")?.kind, "foreign-component")
  assert.equal(model.symbol("VueChart")?.rendererAdapter, "@vune-ui/vue")
  assert.equal(source.slice(model.htmlElements[0].range.start, model.htmlElements[0].range.end), 'Element("section", { id: "root", "aria-label": title })')
  assert.equal(source.slice(model.foreignComponents[0].range.start, model.foreignComponents[0].range.end), "VueChart(values: values)")
  assert.equal(model.typescriptDiagnostics.length, 0)
})

test("semantic model records React foreign components with the React adapter", () => {
  const source = `import ReactChart from "./ReactChart.tsx"
ReactChart(values: values)`
  const model = createVuneSemanticModel(source, "ReactInterop.vune.ts")
  assert.deepEqual(model.foreignComponents.map(component => [component.localName, component.module, component.symbol.rendererAdapter]), [["ReactChart", "./ReactChart.tsx", "@vune-ui/react"]])
  assert.equal(source.slice(model.foreignComponents[0].range.start, model.foreignComponents[0].range.end), "ReactChart(values: values)")
})

test("HTML semantic symbols validate standard attributes while preserving custom elements", () => {
  const validSource = `const id = "email"
<input type="email" aria-label="Email" data-test-id={id} oninput={event => save(event)} />
<x-card framework-prop={{ ready: true }} data-kind="hero" />`
  const valid = createVuneSemanticModel(validSource, "Html.vune.ts")
  assert.equal(valid.htmlDiagnostics.length, 0)
  assert.equal(valid.htmlElements[0].symbol.custom, false)
  assert.deepEqual(valid.htmlElements[0].attributeSymbols.map(attribute => [attribute.name, attribute.category]), [
    ["type", "tag"], ["aria-label", "aria"], ["data-test-id", "data"], ["oninput", "event"],
  ])
  assert.equal(valid.htmlElements[1].symbol.custom, true)
  assert.equal(valid.symbol(valid.htmlElements[0].symbol.name)?.kind, "html-element")

  const invalidSource = `<input href="/wrong" disabled="yes" />
<button type="link">Save</button>`
  const invalid = createVuneSemanticModel(invalidSource, "InvalidHtml.vune.ts")
  assert.deepEqual(invalid.htmlDiagnostics.map(diagnostic => diagnostic.code), ["VUNE_HTML_ATTRIBUTE", "VUNE_HTML_VALUE", "VUNE_HTML_VALUE"])
  assert.match(invalid.htmlDiagnostics[0].message, /Unknown attribute/)
  assert.match(invalid.htmlDiagnostics[2].message, /expects/)
  assert.deepEqual(createVuneLanguageService().diagnose(invalidSource).map(diagnostic => diagnostic.code), ["VUNE_HTML_ATTRIBUTE", "VUNE_HTML_VALUE", "VUNE_HTML_VALUE"])
})

test("@vune-ui/compiler preserves empty, optional, and array builder results", () => {
  const source = `VStack() {
  if (showHeader) { Text("Header") }
  if (showEmpty) { }
  [Text("A"), [Text("B")]]
}`
  const output = transformVuneSource(source, "Builder.vune.ts")
  assert.match(output, /if \(showHeader\)[\s\S]*__vuneChildren\.push\(Text\("Header"\)\)/)
  assert.match(output, /if \(showEmpty\)/)
  assert.match(output, /__vuneChildren\.push\(\[Text\("A"\), \[Text\("B"\)\]\]\)/)
  assert.equal(ts.createSourceFile("Builder.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
})

test("@vune-ui/compiler keeps statement-bearing action closures out of ViewBuilder arrays", () => {
  const output = transformVuneSource("Button(\"Save\") { const value = 1; save(value) }", "Action.vune.ts")
  assert.match(output, /Button\("Save", \(\) => \{ const value = 1; save\(value\) \}\)/)
  assert.doesNotMatch(output, /overloadClosure\(/)
  assert.doesNotMatch(output, /\[const value/)
  assert.equal(ts.createSourceFile("Action.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
})

test("@vune-ui/compiler preserves async action closures", () => {
  const output = transformVuneSource("Button(\"Save\") { await save() }", "AsyncAction.vune.ts")
  assert.match(output, /Button\("Save", async \(\) => \{\s*await save\(\)\s*\}\)/)
  assert.doesNotMatch(output, /overloadClosure\(/)
  assert.equal(ts.createSourceFile("AsyncAction.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
})

test("the compiler enforces Button's two source forms and declaration order", () => {
  const canonicalAction = transformVuneSource('Button("Save") { save() }', "Button.vune.ts")
  assert.match(canonicalAction, /Button\("Save", \(\) => \{ save\(\) \}\)/)
  assert.doesNotMatch(canonicalAction, /overloadClosure\(/)

  const canonicalLabel = transformVuneSource('Button(action: { save() }, label: { HStack() { Text("Save") } })', "Button.vune.ts")
  assert.match(canonicalLabel, /Button\(namedArguments\(\{ action: \(\) => \{save\(\)\}, label: \(\) => \[HStack\(/)
  assert.doesNotMatch(canonicalLabel, /overloadClosure\(/)

  const service = createVuneLanguageService()
  assert.deepEqual(service.diagnose('Button() { save() }'), [{
    severity: "error",
    code: "VUNE_INITIALIZER",
    message: 'Button requires a text label before its trailing action.\nUse:\nButton("Save") { ... }',
    line: 1,
    column: 1,
  }])
  assert.deepEqual(service.diagnose('Button(label: { Text("Save") }, action: { save() })'), [{
    severity: "error",
    code: "VUNE_INITIALIZER",
    message: "Button arguments must follow declaration order: action:, label:.",
    line: 1,
    column: 1,
  }])
  assert.match(service.diagnose('Button(action: { save() }) { Text("Save") }')[0].message, /custom-label initializer requires/)
})

test("@vune-ui/compiler exposes source-ranged builder and struct ASTs", () => {
  const source = `VStack(spacing: 12) {
  Text("Header")
  if (loading) { ProgressView() } else { ContentView() }
  ForEach(items) { item in Row(item) }
}`
  const ast = parseVuneBuilder(source)
  assert.equal(ast.kind, "program")
  assert.equal(ast.statements.length, 1)
  assert.equal(ast.statements[0].kind, "call")
  assert.equal(ast.statements[0].callee, "VStack")
  assert.equal(ast.statements[0].trailing?.parameter, undefined)
  assert.equal(ast.statements[0].trailing?.body.statements[1].kind, "conditional")
  assert.equal(ast.statements[0].trailing?.body.statements[2].kind, "call")
  assert.equal(ast.statements[0].trailing?.body.statements[2].callee, "ForEach")
  const lowered = lowerVuneBuilderAst(ast.statements[0].trailing.body, {
    transformRaw: value => value,
    closure: (body, parameter) => `${parameter ? `(${parameter})` : "()"} => [${body.trim()}]`,
  })
  assert.match(lowered.join(", "), /ProgressView\(\)/)
  const structSource = `struct Card<Content: View>: View {
  @State var count: number = 0
  let content: Content
  init(@ViewBuilder content: () => Content) { self.content = content() }
  var body: some View { VStack() { content } }
}`
  const structs = parseVuneStructs(structSource)
  assert.equal(structs.length, 1)
  assert.equal(structs[0].genericParameters, "Content: View")
  assert.deepEqual(structs[0].fields.map(field => [field.name, field.kind]), [["count", "state"], ["content", "stored"]])
  assert.equal(structs[0].initializers.length, 1)
  assert.equal(structs[0].range.start, 0)
  assert.ok(structs[0].bodyExpressionRange.start > structs[0].bodyRange.start)
})

test("compiler parsing preserves nested template expressions and comment-separated trailing closures", () => {
  const source = `VStack(
  alignment: /* declaration-owned label */ \`leading-\${theme(\`nested-\${mode}\`)}\`
) /* trailing builder */ {
  Text(\`Hello \${user.name}\`)
  Button("Save") /* trailing action */ {
    save(\`item-\${item.id}\`)
  }
}`
  const ast = parseVuneBuilder(source)
  assert.equal(ast.statements.length, 1)
  assert.equal(ast.statements[0].kind, "call")
  assert.equal(ast.statements[0].arguments[0].label, "alignment")
  assert.match(ast.statements[0].arguments[0].value.source, /nested-\$\{mode\}/)
  assert.equal(ast.statements[0].trailing?.body.statements.length, 2)
  const output = transformVuneSource(source, "NestedTemplates.vune.ts")
  assert.match(output, /namedArguments\(\{ alignment:/)
  assert.match(output, /nested-\$\{mode\}/)
  assert.match(output, /Button\("Save", \(\) => \{\s*save\(/)
  assert.doesNotMatch(output, /Button\(namedArguments\(\{ action:/)
  assert.equal(ts.createSourceFile("NestedTemplates.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
})

test("@vune-ui/compiler exposes source maps, diagnostics, language service, and Vite adapter", () => {
  const result = compileVuneFile("Text(\"Hi\")", "/src/Counter.vune.ts")
  assert.equal(result.map.sources[0], "/src/Counter.vune.ts")
  assert.ok(result.map.mappings.length > 0)
  assert.ok(result.map.x_vune.segments.length > 0)
  assert.deepEqual(mapGeneratedPosition(result.map, { line: 1, column: 1 }), { line: 1, column: 1 })
  assert.deepEqual(mapOriginalPosition(result.map, { line: 1, column: 1 }), { line: 1, column: 1 })
  assert.deepEqual(createVuneLanguageService().diagnose("VStack() {"), [{ severity: "error", code: "VUNE_SYNTAX", message: "Unclosed { block in Vune source", line: 1, column: 10 }])
  assert.equal(createVuneVitePlugin().transform("VStack() { Text(\"Hi\") }", "/src/Counter.vune.ts")?.map.version, 3)
  const vitePlugin = vunePlugin()
  assert.equal(vitePlugin.name, "vune-compiler")
  const dependencyScan = vitePlugin.config().optimizeDeps.rolldownOptions.plugins[0]
  assert.match(dependencyScan.transform("VStack() { Text(\"Hi\") }", "virtual-module:/src/Counter.vue?id=0")?.code ?? "", /VStack\(\(\) =>/)
})

test("the Vite adapter compiles native .vune modules and resolves their extension", () => {
  const plugin = createVuneVitePlugin()
  const transformed = plugin.transform('VStack() { Text("Hi") }', "/src/App.vune")
  assert.ok(transformed)
  assert.match(transformed.code, /VStack\(\(\) =>/)
  assert.deepEqual(plugin.config?.().resolve.extensions.slice(0, 3), [".vune", ".vune.ts", ".vune.tsx"])
})

test("compiler source maps keep real tokens anchored after synthesized imports", () => {
  const result = compileVuneFile('VStack() {\n  Text("Hi")\n}', "Counter.vune.ts")
  const generatedLine = result.code.split("\n").findIndex(line => line.includes("Text")) + 1
  const generatedColumn = result.code.split("\n")[generatedLine - 1].indexOf("Text") + 1
  assert.deepEqual(mapGeneratedPosition(result.map, { line: generatedLine, column: generatedColumn }), { line: 2, column: 3 })
  assert.deepEqual(mapOriginalPosition(result.map, { line: 2, column: 3 }), { line: generatedLine, column: generatedColumn })
})

test("the Vite adapter caches unchanged modules and leaves CSS to Vite", () => {
  const plugin = createVuneVitePlugin()
  const source = "VStack() { Text(\"Hi\") }"
  const first = plugin.transform(source, "/src/Counter.vune.ts")
  const second = plugin.transform(source, "/src/Counter.vune.ts?import")
  assert.equal(first, second)
  assert.equal(plugin.transform(".card { color: red }", "/src/style.css"), null)
  assert.equal(plugin.transform("function ordinary() { return 1 }", "/src/node_modules/dependency/index.js"), null)
  assert.equal(plugin.transform('const value = Text("Hi").padding(4)', "/workspace/packages/core/dist/advanced.js"), null)
  assert.equal(plugin.transform("function ordinary() { return 1 }", "/src/ordinary.ts"), null)
  assert.equal(plugin.transform("const pattern = /^[$A-Z_]/", "/src/ordinary.js"), null)
  assert.equal(plugin.transform('const App = () => <div className="card" />', "/src/App.tsx"), null)
  const staticModifier = plugin.transform('import { Text } from "@vune-ui/core"\nconst value = Text("Hi").padding(4)', new URL("../StaticModifier.ts", import.meta.url).pathname)
  assert.ok(staticModifier)
  assert.match(staticModifier.code, /modifiedContentCompiled\(/)
  const scoped = createVuneVitePlugin({ include: /Counter\.vune\.ts/g })
  assert.ok(scoped.transform(source, "/src/Counter.vune.ts"))
  assert.ok(scoped.transform(source, "/src/Counter.vune.ts"))
  assert.equal(scoped.transform(source, "/src/Other.vune.ts"), null)
})

test("the Vite adapter lowers Vune only inside Vue SFC script blocks", () => {
  const plugin = createVuneVitePlugin()
  const sfc = `<template><VStack /></template>
<script setup lang="ts">
VStack() { Text("Hello from Vune") }
</script>`
  const transformed = plugin.transform(sfc, "/src/Counter.vue")
  assert.ok(transformed)
  assert.match(transformed.code, /<template><VStack \/><\/template>/)
  assert.match(transformed.code, /VStack\(\(\) =>/)
  assert.equal(plugin.transform("<template><VStack /></template>", "/src/Counter.vue?vue&type=template"), null)
  assert.equal(plugin.transform(".card { color: red }", "/src/Counter.vue?vue&type=style&index=0&lang.css"), null)
  const script = plugin.transform('VStack() { Text("Query script") }', "/src/Counter.vue?vue&type=script&setup=true&lang.ts")
  assert.ok(script)
  assert.match(script.code, /VStack\(\(\) =>/)
  assert.equal(plugin.transform(`import { defineComponent as _defineComponent } from "vue"
import { openBlock as _openBlock, createBlock as _createBlock } from "vue"
export default _defineComponent({ setup(__props, { expose }) {
  expose()
  return (_ctx: any, _cache: any) => (_openBlock(), _createBlock("div"))
} })`, "/src/Counter.vue?vue&type=script&setup=true&lang.ts"), null)
  const virtualScript = plugin.transform('const graph = () => VStack() { Text("Virtual script") }', "/src/Counter.vue?id=virtual")
  assert.ok(virtualScript)
  assert.match(virtualScript.code, /VStack\(\(\) =>/)
})

test("Vue component adapters use the generic labeled-argument compiler path", () => {
  const source = `const MyVueComponent = vueComponent(Badge)
MyVueComponent(value: data)`
  const output = transformVuneSource(source, "VueInterop.vune.ts")
  assert.match(output, /MyVueComponent\(namedArguments\(\{ value: data \}\)\)/)
  assert.doesNotMatch(output, /VueComponent.*hack/i)
  assert.equal(ts.createSourceFile("VueInterop.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
})

test("Vue SFC default imports become transparent Vune Views", () => {
  const output = transformVuneSource(`import VueChart from "./VueChart.vue"
VueChart(values: values)`, "VueChart.vune.ts")
  assert.match(output, /import \{ foreignComponent as __vuneForeignComponent \} from "@vune-ui\/vue"/)
  assert.match(output, /const VueChart = __vuneForeignComponent\(__vuneForeignComponent0\)/)
  assert.match(output, /VueChart\(namedArguments\(\{ values: values \}\)\)/)
  assert.equal(ts.createSourceFile("VueChart.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
})

test("Vue foreign wrapping follows TypeScript import nodes, not import-line matching", () => {
  const source = `// import Ignored from "./Ignored.vue"
import /* keep the module AST-bound */ Chart from "./Chart.vue";
Chart(values: values)`
  const output = transformVuneSource(source, "AstVueImport.vune.ts")
  assert.match(output, /const Chart = __vuneForeignComponent\(__vuneForeignComponent0\)/)
  assert.doesNotMatch(output, /const Ignored\s*=/)
  assert.match(output, /Chart\(namedArguments\(\{ values: values \}\)\)/)
  assert.equal(ts.createSourceFile("AstVueImport.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
})

test("React TSX and JSX default imports become transparent Vune Views", () => {
  const output = transformVuneSource(`import ReactChart from "./ReactChart.tsx"
ReactChart(values: values)`, "ReactChart.vune.ts")
  assert.match(output, /import \{ reactComponent as __vuneReactComponent \} from "@vune-ui\/react"/)
  assert.match(output, /const ReactChart = __vuneReactComponent\(__vuneReactComponent0\)/)
  assert.match(output, /ReactChart\(namedArguments\(\{ values: values \}\)\)/)
  assert.equal(ts.createSourceFile("ReactChart.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
})

test("the canonical compiler preserves host stylesheet imports", () => {
  const source = `import styles from "./Card.module.css"
import "./tokens.scss"
import { Text } from "vune-ui"
Text("Card").className(styles.card)`
  const output = transformVuneSource(source, "Card.vune.ts")
  assert.match(output, /import styles from "\.\/Card\.module\.css"/)
  assert.match(output, /import "\.\/tokens\.scss"/)
  assert.match(output, /modifiedContentCompiled\(/)
  assert.match(output, /styles\.card/)
})

test("compiler diagnostics retain the original offset for raw HTML and delimiters", () => {
  const htmlDiagnostic = createVuneLanguageService().diagnose("VStack() {\n  <section>\n")
  assert.deepEqual(htmlDiagnostic, [{ severity: "error", code: "VUNE_SYNTAX", message: "Unclosed raw HTML element in Vune source", line: 2, column: 3 }])
  const delimiterDiagnostic = createVuneLanguageService().diagnose("  VStack() {")
  assert.deepEqual(delimiterDiagnostic, [{ severity: "error", code: "VUNE_SYNTAX", message: "Unclosed { block in Vune source", line: 1, column: 12 }])
  const templateDiagnostic = createVuneLanguageService().diagnose("Text(\n  `value \${format(`nested`)}`\n")
  assert.deepEqual(templateDiagnostic, [{ severity: "error", code: "VUNE_SYNTAX", message: "Unclosed ( block in Vune source", line: 1, column: 5 }])
  const commentDiagnostic = createVuneLanguageService().diagnose("Text(\"ok\")\n/* unfinished")
  assert.deepEqual(commentDiagnostic, [{ severity: "error", code: "VUNE_SYNTAX", message: "Unclosed block comment in Vune source", line: 2, column: 1 }])
  assert.deepEqual(createVuneLanguageService().diagnose("<section><span></section>"), [{ severity: "error", code: "VUNE_SYNTAX", message: "Mismatched raw HTML closing tag </section>; expected </span>", line: 1, column: 16 }])
  assert.deepEqual(createVuneLanguageService().diagnose("const value = )"), [{ severity: "error", code: "VUNE_TYPESCRIPT", message: "Expression expected.", line: 1, column: 15 }])
})

test("builder scanning ignores regex literals in TypeScript expressions", () => {
  const source = `VStack() { Text(/[{}]/.test(value) ? "yes" : "no") }`
  const output = transformVuneSource(source, "RegexExpression.vune.ts")
  assert.match(output, /Text\(\/\[\{\}\]\/\.test\(value\) \? "yes" : "no"\)/)
  assert.equal(ts.createSourceFile("RegexExpression.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
})

test("the checked-in .vune.ts example passes through the compiler pipeline", () => {
  const source = readFileSync(new URL("../examples/Counter.vune.ts", import.meta.url), "utf8")
  const output = transformVuneSource(source, "Counter.vune.ts")
  assert.doesNotMatch(output, /VStack\([^\n]*\)\s*\{/)
  assert.match(output, /const __vuneTemplate0 = defineCompiledTemplate\(/)
  assert.match(output, /"gap": "12px"/)
  assert.match(output, /compiledTemplate\(__vuneTemplate0, \[`Count: \${count\.value}`, Button\.viewType\.createNodeCompiled/)
  assert.doesNotMatch(output, /namedArguments\(/)
  assert.match(output, /from "@vune-ui\/react"/)
  assert.match(output, /view\(\{ state: \(\) => \{ const count = State\(0\)/)
  assert.doesNotMatch(output, /^const count = State/m)
  assert.equal(ts.createSourceFile("Counter.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
})

test("custom generic View structs lower to declaration-defined initializer metadata", () => {
  const source = `import { VStack } from "@vune-ui/react"\nstruct Card<Content: View>: View {\n  let content: Content\n  init(@ViewBuilder content: () => Content) { self.content = content() }\n  var body: some View { VStack() { content } }\n}`
  const output = transformVuneSource(source, "Card.vune.ts")
  assert.match(output, /defineView\("Card"/)
  assert.match(output, /genericParameters: "Content: View"/)
  assert.match(output, /fields: \[\{ name: "content", kind: "stored"/)
  assert.match(output, /Card\(@ViewBuilder content\)/)
  assert.match(output, /resolveBuilderInput\(content\)/)
  assert.match(output, /from "@vune-ui\/react"/)
  assert.equal(ts.createSourceFile("Card.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
})

test("compiler specializes unambiguous same-file struct calls from initializer declarations", () => {
  const source = `struct Card: View {
  let title: string
  init(title: string) { self.title = title }
  var body: some View { Text(title) }
}
const card = Card(title: "Hello")`
  const output = transformVuneSource(source, "SpecializedCard.vune.ts")
  assert.match(output, /Card\.viewType\.createNodeCompiled\(0, \["Hello"\]\)/)
  assert.doesNotMatch(output, /namedArguments\(/)
  assert.doesNotMatch(output, /const card = Card\(/)
  assert.equal(ts.createSourceFile("SpecializedCard.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
})

test("compiler specializes imported Views from a unique typed call signature", () => {
  const source = `import { Text } from "@vune-ui/core"
const value = Text("Hello")`
  const output = transformVuneSource(source, "ImportedText.vune.ts")
  assert.match(output, /Text\.viewType\.createNodeCompiled\(0, \["Hello"\]\)/)
  assert.equal(ts.createSourceFile("ImportedText.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
  const generated = output.replace(/^import [^\n]+\n/, "")
  const value = Function("Text", `${generated}; return value`)(Text)
  assert.equal(value.kind, "element")
})

test("compiler normalizes proven Swift-style labels into the compiled runtime payload", () => {
  const source = `import { Text, VStack } from "@vune-ui/core"
const value = VStack(spacing: 12) { Text("Hello") }`
  const output = transformVuneSource(source, "NamedCompiledStack.vune.ts")
  assert.match(output, /VStack\.viewType\.createNodeCompiled\(1, \[\{ "spacing": 12 \}, \[/)
  assert.doesNotMatch(output, /namedArguments\(/)
  const generated = output.replace(/^import [^\n]+\n/, "")
  const value = Function("Text", "VStack", `${generated}; return value`)(Text, VStack)
  assert.equal(value.props.style.gap, "12px")
  assert.equal(value.children[0].children[0], "Hello")
})

test("compiler lowers immutable host structure into a compiled template with dynamic slots", () => {
  const source = `import { Text, VStack } from "@vune-ui/core"
export function App(name: string) { return VStack() { Text("Static"); Text(name) } }`
  const output = transformVuneSource(source, "StaticHoist.vune.ts")
  assert.match(output, /const __vuneTemplate0 = defineCompiledTemplate\(/)
  assert.match(output, /children: \["Static"\]/)
  assert.match(output, /kind: "slot", index: 0, identity: \["element", 1, "element", 0\]/)
  assert.match(output, /return compiledTemplate\(__vuneTemplate0, \[name\]\)/)
  assert.doesNotMatch(output, /createNode(?:Compiled|Specialized)\([^\n]*name/)
  assert.equal(ts.createSourceFile("StaticHoist.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
})

test("compiler keeps opaque custom View children as identity-preserving template slots", () => {
  const source = `import { Text, VStack } from "@vune-ui/core"
struct Card: View {
  let title: string
  var body: some View { Text(title) }
}
export function App(title: string) { return VStack() { Card(title: title) } }`
  const output = transformVuneSource(source, "TemplateCustomChild.vune.ts")
  assert.match(output, /const __vuneTemplate0 = defineCompiledTemplate\(/)
  assert.match(output, /kind: "slot", index: 0, identity: \["element", 0\]/)
  assert.match(output, /compiledTemplate\(__vuneTemplate0, \[Card\.viewType\.createNodeCompiled\(0, \[title\]\)\]\)/)
  assert.equal(ts.createSourceFile("TemplateCustomChild.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
})

test("compiler emits State dependency metadata and templates dynamic primitive content", () => {
  const source = `import { Text } from "@vune-ui/core"
struct Counter: View {
  @State var count: number = 0
  var body: some View { Text(String(count.value)) }
}`
  const output = transformVuneSource(source, "StaticDependencies.vune.ts")
  assert.match(output, /dependencies: \(props: any\) => \[props\.count\]/)
  assert.match(output, /const __vuneTemplate0 = defineCompiledTemplate\(/)
  assert.match(output, /compiledTemplate\(__vuneTemplate0, \[String\(count\.value\)\]\)/)
  assert.equal(ts.createSourceFile("StaticDependencies.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
})

test("compiler specializes a resolved imported ViewBuilder overload by declaration order", () => {
  const source = `import { Text, VStack } from "@vune-ui/core"
const value = VStack() { Text("Hello") }`
  const output = transformVuneSource(source, "ImportedVStack.vune.ts")
  assert.match(output, /VStack\.viewType\.createNodeCompiled\(0, \[\[/)
  assert.match(output, /Text\.viewType\.createNodeCompiled\(0, \["Hello"\]\)/)
})

test("compiler lowers a statically typed modifier chain into one flat graph construction", () => {
  const source = `import { Text } from "@vune-ui/core"
const value = Text("Hello").padding(8).background("red").bold()`
  const output = transformVuneSource(source, "StaticModifiers.vune.ts")
  assert.match(output, /modifiedContentCompiled\(Text\.viewType\.createNodeCompiled\(0, \["Hello"\]\), \[\["padding", \[8\]\], \["background", \["red"\]\], \["bold", \[\]\]\]\)/)
  assert.doesNotMatch(output, /\.padding\(|\.background\(|\.bold\(/)
  assert.equal(ts.createSourceFile("StaticModifiers.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
  const generated = output.replace(/^import [^\n]+\n/gm, "")
  const value = Function("Text", "modifiedContentCompiled", `${generated}; return value`)(Text, modifiedContentCompiled)
  assert.deepEqual(modifierGraphOf(value).map(item => [item.name, item.arguments]), [["padding", [8]], ["background", ["red"]], ["bold", []]])
})

test("compiler preserves dynamic and non-View modifier methods", () => {
  const source = `declare const unknownValue: unknown
const dynamic = (unknownValue as any).padding(8)
const ordinary = { padding(value: number) { return value } }.padding(8)`
  const output = transformVuneSource(source, "DynamicModifiers.vune.ts")
  assert.doesNotMatch(output, /modifiedContent(?:Compiled)?\(/)
  assert.match(output, /unknownValue as any\)\.padding\(8\)/)
  assert.match(output, /const ordinary = .*\.padding\(8\)/)
})

test("compiler keeps unresolved declaration calls on the dynamic resolver", () => {
  const source = `struct Card: View {
  let value: any
  init(_ value: string) { self.value = value }
  init(_ value: number) { self.value = value }
  var body: some View { Text(String(value)) }
}
const card = Card(valueFromRuntime)`
  const output = transformVuneSource(source, "DynamicCard.vune.ts")
  assert.match(output, /const card = Card\(valueFromRuntime\)/)
  assert.doesNotMatch(output, /createNode(?:Compiled|Specialized)/)
})

test("compiler rejects ambiguous statically typed declaration overloads", () => {
  const source = `struct Card: View {
  let value: string
  init(_ value: string) { self.value = value }
  init(_ value: string) { self.value = value }
  var body: some View { Text(value) }
}
const card = Card("runtime")`
  assert.throws(
    () => transformVuneSource(source, "AmbiguousCard.vune.ts"),
    error => error?.code === "VUNE_INITIALIZER" && /Ambiguous initializer for Card/.test(error.message),
  )
})

test("compiled generic ViewBuilder initializers enforce View results", () => {
  const source = `import { Text, VStack } from "@vune-ui/core"
struct GenericBox<Content: View>: View {
  let content: Content
  init(@ViewBuilder content: () => Content) { self.content = content() }
  var body: some View { VStack() { content } }
}`
  const generated = transformVuneSource(source, "GenericBox.vune.ts")
    .replace(/^import [^\n]+\n/, "")
    .replace(/: any\b/g, "")
  const GenericBox = Function(
    "defineView",
    "initializer",
    "resolveBuilderClosure",
    "resolveBuilderInput",
    "overloadClosure",
    "compiledTemplate",
    "defineCompiledTemplate",
    "Text",
    "VStack",
    `${generated}; return GenericBox`,
  )(defineView, initializer, resolveBuilderClosure, resolveBuilderInput, overloadClosure, compiledTemplate, defineCompiledTemplate, Text, VStack)
  assert.doesNotThrow(() => GenericBox(() => Text("valid")))
  assert.throws(() => GenericBox(() => "not a View"), /No matching initializer for GenericBox/)
})

test("compiled structs resolve unlabeled values, labeled actions, and trailing builders through metadata", () => {
  const source = `struct MixedCard<Content: View>: View {
  let title: string
  let action: () => void
  let content: Content
  init(_ title: string, @Action action: () => void, @ViewBuilder content: () => Content) {
    self.title = title
    self.action = action
    self.content = content()
  }
  var body: some View { VStack() { Text(title); content } }
}
const card = MixedCard("Title", action: { save() }) { Text("Body") }`
  const output = transformVuneSource(source, "MixedCard.vune.ts")
  assert.match(output, /MixedCard\.viewType\.createNodeCompiled\(0, \["Title", \(\) => \{save\(\)\}, \[Text\("Body"\)\]\]\)/)
  assert.doesNotMatch(output, /namedArguments\(/)
  assert.doesNotMatch(output, /overloadClosure\(/)
  assert.equal(ts.createSourceFile("MixedCard.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
  const generated = output.replace(/^import [^\n]+\n/, "").replace(/: any\b/g, "")
  let saves = 0
  const card = Function(
    "defineView",
    "initializer",
    "resolveBuilderClosure",
    "resolveBuilderInput",
    "namedArguments",
    "overloadClosure",
    "Text",
    "VStack",
    "save",
    `${generated}; return card`,
  )(defineView, initializer, resolveBuilderClosure, resolveBuilderInput, namedArguments, overloadClosure, Text, VStack, () => { saves += 1 })
  const rendered = renderViewNode(card, {
    element(type, props, ...children) { return { type, props, children } },
    fragment(children) { return { children } },
    value(value) { return value },
    modifier(content) { return content },
  })
  assert.deepEqual(rendered.children.map(child => child.children[0]), ["Title", "Body"])
  assert.equal(saves, 0)
})

test("custom View trailing roles and invalid initializer shapes use compiler metadata", () => {
  const valid = `struct ActionCard: View {
  let action: () => void
  init(@Action action: () => void) { self.action = action }
  var body: some View { Text("Action") }
}
const card = ActionCard() { save() }`
  const output = transformVuneSource(valid, "ActionCard.vune.ts")
  assert.doesNotMatch(output, /overloadClosure\(/)
  assert.match(output, /ActionCard\.viewType\.createNodeCompiled\(0, \[\(\) => \{ save\(\) \}\]\)/)

  const invalid = `struct LabelCard: View {
  let label: any
  init(@ViewBuilder label: () => View) { self.label = label() }
  var body: some View { Text("Label") }
}
const card = LabelCard(action: { save() }) { Text("Label") }`
  assert.throws(
    () => transformVuneSource(invalid, "InvalidLabelCard.vune.ts"),
    error => error?.code === "VUNE_INITIALIZER" && /No matching initializer for LabelCard/.test(error.message),
  )
})

test("struct AST keeps stored fields declared after an initializer and ignores initializer locals", () => {
  const source = `struct FieldOrder: View {
  init(title: string) { let local = title; const text = "init(fake)"; /* init(comment) */ self.title = title }
  let title: string
  @State var count: number = 0
  let suffix = "!"
  var body: some View { Text(title + suffix + String(count.value)) }
}`
  const declaration = parseVuneStructs(source)[0]
  assert.deepEqual(declaration.fields.map(field => [field.name, field.kind]), [
    ["title", "stored"],
    ["count", "state"],
    ["suffix", "stored"],
  ])
  const output = transformVuneSource(source, "FieldOrder.vune.ts")
  assert.match(output, /fields: \[\{ name: "title"/)
  assert.match(output, /name: "suffix", kind: "stored"/)
  assert.doesNotMatch(output, /name: "local"/)
})

test("nested View structs keep the outer body and local View scope", () => {
  const source = `struct Parent: View {
  struct Header: View {
    var body: some View { Text("Header") }
  }
  var body: some View { VStack() { Header() } }
}`
  const declarations = parseVuneStructs(source)
  assert.equal(declarations.length, 1)
  assert.deepEqual(declarations[0].nested?.map(item => item.name), ["Header"])
  assert.match(declarations[0].bodyExpressionSource, /VStack\(\) \{ Header\(\) \}/)
  const output = transformVuneSource(source, "Parent.vune.ts")
  assert.match(output, /const Parent = \(\(\) => \{ const Header = defineView\("Header"/)
  assert.match(output, /return Object\.assign\(defineView\("Parent"/)
  assert.match(output, /\{ Header \}/)
  assert.doesNotMatch(output, /\bstruct\b/)
  assert.equal(ts.createSourceFile("Parent.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
})

test("nested View structs expose qualified constructors as well as local body names", () => {
  const source = `import { Text, VStack } from "@vune-ui/core"
struct Parent: View {
  struct Header: View {
    var body: some View { Text("Header") }
  }
  var body: some View { VStack() { Header() } }
}`
  const generated = transformVuneSource(source, "Parent.vune.ts")
    .replace(/^import [^\n]+\n/, "")
    .replace(/: any\b/g, "")
  const Parent = Function(
    "defineView",
    "initializer",
    "resolveBuilderClosure",
    "resolveBuilderInput",
    "overloadClosure",
    "compiledTemplate",
    "defineCompiledTemplate",
    "Text",
    "VStack",
    `${generated}; return Parent`,
  )(
    defineView,
    initializer,
    resolveBuilderClosure,
    resolveBuilderInput,
    overloadClosure,
    compiledTemplate,
    defineCompiledTemplate,
    Text,
    VStack,
  )
  assert.equal(typeof Parent.Header, "function")
  assert.equal(Parent.Header().kind, "view")
  const rendered = renderViewNode(Parent(), {
    element(type, props, ...children) { return { type, props, children } },
    fragment(children) { return { fragment: children } },
    value(value) { return value },
    modifier(content) { return content },
  })
  assert.equal(rendered.children[0].children[0], "Header")
})

test("custom structs retain multiple initializers, defaults, @State, and @Binding", () => {
  const source = `import { Text, VStack, State } from "vune-ui"
struct Card<Content: View>: View {
  @State var count: number = 0
  @Binding var title: BindingRef<string>
  let content: Content = Text("Default")
  init(@ViewBuilder content: () => Content, title: BindingRef<string>) { self.content = content(); self.title = title }
  init(@Binding title: BindingRef<string>) { self.title = title }
  var body: some View { VStack() { Text(title.value); Text(String(count.value)); content } }
}`
  const output = transformVuneSource(source, "Card.vune.ts")
  assert.equal((output.match(/initializer\(/g) ?? []).length, 2)
  assert.match(output, /state: \(\) => \(\{ count: State\(0\) \}\)/)
  assert.match(output, /Card\(@Binding title\)/)
  assert.match(output, /label: "title"/)
  assert.match(output, /kind: "binding"/)
  assert.doesNotMatch(output, /import \{[^}]*State[^}]*\} from "@vune-ui\/core"/)
  assert.equal(ts.createSourceFile("Card.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
})

test("struct initializers delegate through the same field plan", () => {
  const source = `struct DelegatedCard: View {
  let title: string
  let subtitle: string
  init(title: string) { self.init(title: title, subtitle: "Default") }
  init(title: string, subtitle: string) { self.title = title; self.subtitle = subtitle }
  var body: some View { VStack() { Text(title); Text(subtitle) } }
}`
  const output = transformVuneSource(source, "DelegatedCard.vune.ts")
  assert.match(output, /title: \(title\)/)
  assert.match(output, /subtitle: \("Default"\)/)
  assert.doesNotMatch(output, /title: undefined/)
})

test("AST-backed struct lowering preserves export boundaries and ignores initializer locals", () => {
  const source = `export struct Card: View {
  let title: string
  init(title: string) {
    let local = title
    self.title = title
  }
  var body: some View { Text(title) }
}`
  const output = transformVuneSource(source, "Card.vune.ts")
  assert.match(output, /export const Card = defineView\("Card"/)
  assert.match(output, /const \{ title \} = props/)
  assert.doesNotMatch(output, /const \{[^}]*local/)
  assert.equal(ts.createSourceFile("Card.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
})

test("raw HTML lowers to core Element nodes and preserves real attributes", () => {
  const source = `import { VStack } from "@vune-ui/core"
VStack() {
  <section class="card" data-kind="hero">
    <h1>{title}</h1>
    <button onclick={save} aria-label="Save">Save</button>
  </section>
}`
  const output = transformVuneSource(source, "Card.vune.ts")
  assert.match(output, /import \{ [^}]*Element[^}]* \} from "@vune-ui\/core"/)
  assert.match(output, /Element\("section", \{ "class": "card", "data-kind": "hero" \}/)
  assert.match(output, /Element\("h1", null, title\)/)
  assert.match(output, /Element\("button", \{ "onclick": save, "aria-label": "Save" \}, "Save"\)/)
  assert.doesNotMatch(output, /<section|<h1|<button/)
  assert.equal(ts.createSourceFile("Card.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
})

test("raw HTML supports spread attributes, comments, void elements, custom elements, and inline CSS", () => {
  const source = `const shared = { role: "group", "data-shared": true }
<x-card {...shared} class="card" style="color: red; --accent: blue" aria-label="Card">
  <!-- compiler-only comment -->
  <input data-field="name" disabled>
</x-card>`
  const output = transformVuneSource(source, "RawCard.vune.ts")
  assert.match(output, /Element\("x-card", \{ \.\.\.\(shared\), "class": "card", "style": "color: red; --accent: blue", "aria-label": "Card" \}/)
  assert.match(output, /Element\("input", \{ "data-field": "name", "disabled": true \}\)/)
  assert.doesNotMatch(output, /compiler-only comment|<input|<x-card/)
  assert.equal(ts.createSourceFile("RawCard.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
  const invalid = createVuneLanguageService().diagnose("  <button {disabled}>Save</button>")
  assert.deepEqual(invalid, [{ severity: "error", code: "VUNE_SYNTAX", message: "Raw HTML attribute expressions must use {...value}", line: 1, column: 11 }])
})
