import assert from "node:assert/strict"
import test from "node:test"
import ts from "typescript"
import { compileMuseFile, createMuseLanguageService, createMuseVitePlugin, lowerMuseBuilderAst, mapGeneratedPosition, mapOriginalPosition, parseMuseBuilder, parseMuseStructs, transformMuseSource } from "../packages/compiler/dist/index.js"
import { musePlugin } from "../packages/vite/dist/index.js"
import { Text, VStack, defineView, initializer, overloadClosure, renderViewNode, resolveBuilderClosure } from "../packages/core/dist/index.js"
import { readFileSync } from "node:fs"

test("@muse/compiler lowers .muse.ts builders through declaration-neutral syntax", () => {
  const source = `VStack(spacing: 12) {\n  Text("Header")\n  if (enabled) { Text("On") } else { Text("Off") }\n  ForEach(items) { item in Row(item) }\n  Each(items) { item in Row(item) }\n}`
  const output = transformMuseSource(source, "Counter.muse.ts")
  assert.match(output, /VStack\(namedArguments\(\{ spacing: 12 \}\), overloadClosure\(/)
  assert.match(output, /enabled \? \[Text\("On"\)\] : \[Text\("Off"\)\]/)
  assert.match(output, /ForEach\(items, \(item\) => \[Row\(item\)\]\)/)
  assert.match(output, /Each\(items, \(item\) => \[Row\(item\)\]\)/)
  assert.match(output, /import \{ namedArguments, overloadClosure \} from "@muse\/core"/)
  assert.equal(ts.createSourceFile("Builder.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
})

test("@muse/compiler preserves empty, optional, and array builder results", () => {
  const source = `VStack() {
  if (showHeader) { Text("Header") }
  if (showEmpty) { }
  [Text("A"), [Text("B")]]
}`
  const output = transformMuseSource(source, "Builder.muse.ts")
  assert.match(output, /showHeader \? \[Text\("Header"\)\] : \[\]/)
  assert.match(output, /showEmpty \? \[\] : \[\]/)
  assert.match(output, /\[Text\("A"\), \[Text\("B"\)\]\]/)
  assert.equal(ts.createSourceFile("Builder.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
})

test("@muse/compiler keeps statement-bearing action closures out of ViewBuilder arrays", () => {
  const output = transformMuseSource("Button() { const value = 1; save(value) }", "Action.muse.ts")
  assert.match(output, /overloadClosure\(\(\) => \[\], \(\) => \{/)
  assert.doesNotMatch(output, /\[const value/)
  assert.equal(ts.createSourceFile("Action.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
})

test("@muse/compiler exposes source-ranged builder and struct ASTs", () => {
  const source = `VStack(spacing: 12) {
  Text("Header")
  if (loading) { ProgressView() } else { ContentView() }
  ForEach(items) { item in Row(item) }
}`
  const ast = parseMuseBuilder(source)
  assert.equal(ast.kind, "program")
  assert.equal(ast.statements.length, 1)
  assert.equal(ast.statements[0].kind, "call")
  assert.equal(ast.statements[0].callee, "VStack")
  assert.equal(ast.statements[0].trailing?.parameter, undefined)
  assert.equal(ast.statements[0].trailing?.body.statements[1].kind, "conditional")
  assert.equal(ast.statements[0].trailing?.body.statements[2].kind, "call")
  assert.equal(ast.statements[0].trailing?.body.statements[2].callee, "ForEach")
  const lowered = lowerMuseBuilderAst(ast.statements[0].trailing.body, {
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
  const structs = parseMuseStructs(structSource)
  assert.equal(structs.length, 1)
  assert.equal(structs[0].genericParameters, "Content: View")
  assert.deepEqual(structs[0].fields.map(field => [field.name, field.kind]), [["count", "state"], ["content", "stored"]])
  assert.equal(structs[0].initializers.length, 1)
  assert.equal(structs[0].range.start, 0)
  assert.ok(structs[0].bodyExpressionRange.start > structs[0].bodyRange.start)
})

test("@muse/compiler exposes source maps, diagnostics, language service, and Vite adapter", () => {
  const result = compileMuseFile("Text(\"Hi\")", "/src/Counter.muse.ts")
  assert.equal(result.map.sources[0], "/src/Counter.muse.ts")
  assert.ok(result.map.mappings.length > 0)
  assert.ok(result.map.x_muse.segments.length > 0)
  assert.deepEqual(mapGeneratedPosition(result.map, { line: 1, column: 1 }), { line: 1, column: 1 })
  assert.deepEqual(mapOriginalPosition(result.map, { line: 1, column: 1 }), { line: 1, column: 1 })
  assert.deepEqual(createMuseLanguageService().diagnose("VStack() {"), [{ severity: "error", code: "MUSE_SYNTAX", message: "Unclosed { block in Muse source", line: 1, column: 10 }])
  assert.equal(createMuseVitePlugin().transform("VStack() { Text(\"Hi\") }", "/src/Counter.muse.ts")?.map.version, 3)
  const vitePlugin = musePlugin()
  assert.equal(vitePlugin.name, "muse-compiler")
  const dependencyScan = vitePlugin.config().optimizeDeps.rolldownOptions.plugins[0]
  assert.match(dependencyScan.transform("VStack() { Text(\"Hi\") }", "virtual-module:/src/Counter.vue?id=0")?.code ?? "", /overloadClosure/)
})

test("compiler source maps keep real tokens anchored after synthesized imports", () => {
  const result = compileMuseFile('VStack() {\n  Text("Hi")\n}', "Counter.muse.ts")
  const generatedLine = result.code.split("\n").findIndex(line => line.includes("Text")) + 1
  const generatedColumn = result.code.split("\n")[generatedLine - 1].indexOf("Text") + 1
  assert.deepEqual(mapGeneratedPosition(result.map, { line: generatedLine, column: generatedColumn }), { line: 2, column: 3 })
  assert.deepEqual(mapOriginalPosition(result.map, { line: 2, column: 3 }), { line: generatedLine, column: generatedColumn })
})

test("the Vite adapter caches unchanged modules and leaves CSS to Vite", () => {
  const plugin = createMuseVitePlugin()
  const source = "VStack() { Text(\"Hi\") }"
  const first = plugin.transform(source, "/src/Counter.muse.ts")
  const second = plugin.transform(source, "/src/Counter.muse.ts?import")
  assert.equal(first, second)
  assert.equal(plugin.transform(".card { color: red }", "/src/style.css"), null)
  assert.equal(plugin.transform("function ordinary() { return 1 }", "/src/node_modules/dependency/index.js"), null)
  assert.equal(plugin.transform("function ordinary() { return 1 }", "/src/ordinary.ts"), null)
  assert.equal(plugin.transform("const pattern = /^[$A-Z_]/", "/src/ordinary.js"), null)
  assert.equal(plugin.transform('const App = () => <div className="card" />', "/src/App.tsx"), null)
  const scoped = createMuseVitePlugin({ include: /Counter\.muse\.ts/g })
  assert.ok(scoped.transform(source, "/src/Counter.muse.ts"))
  assert.ok(scoped.transform(source, "/src/Counter.muse.ts"))
  assert.equal(scoped.transform(source, "/src/Other.muse.ts"), null)
})

test("the Vite adapter lowers Muse only inside Vue SFC script blocks", () => {
  const plugin = createMuseVitePlugin()
  const sfc = `<template><VStack /></template>
<script setup lang="ts">
VStack() { Text("Hello from Muse") }
</script>`
  const transformed = plugin.transform(sfc, "/src/Counter.vue")
  assert.ok(transformed)
  assert.match(transformed.code, /<template><VStack \/><\/template>/)
  assert.match(transformed.code, /overloadClosure\(/)
  assert.equal(plugin.transform("<template><VStack /></template>", "/src/Counter.vue?vue&type=template"), null)
  assert.equal(plugin.transform(".card { color: red }", "/src/Counter.vue?vue&type=style&index=0&lang.css"), null)
  const script = plugin.transform('VStack() { Text("Query script") }', "/src/Counter.vue?vue&type=script&setup=true&lang.ts")
  assert.ok(script)
  assert.match(script.code, /overloadClosure\(/)
  const virtualScript = plugin.transform('const graph = () => VStack() { Text("Virtual script") }', "/src/Counter.vue?id=virtual")
  assert.ok(virtualScript)
  assert.match(virtualScript.code, /overloadClosure\(/)
})

test("the canonical compiler preserves host stylesheet imports", () => {
  const source = `import styles from "./Card.module.css"
import "./tokens.scss"
import { Text } from "muse"
Text("Card").className(styles.card)`
  const output = transformMuseSource(source, "Card.muse.ts")
  assert.match(output, /import styles from "\.\/Card\.module\.css"/)
  assert.match(output, /import "\.\/tokens\.scss"/)
  assert.match(output, /\.className\(styles\.card\)/)
})

test("compiler diagnostics retain the original offset for raw HTML and delimiters", () => {
  const htmlDiagnostic = createMuseLanguageService().diagnose("VStack() {\n  <section>\n")
  assert.deepEqual(htmlDiagnostic, [{ severity: "error", code: "MUSE_SYNTAX", message: "Unclosed raw HTML element in Muse source", line: 2, column: 3 }])
  const delimiterDiagnostic = createMuseLanguageService().diagnose("  VStack() {")
  assert.deepEqual(delimiterDiagnostic, [{ severity: "error", code: "MUSE_SYNTAX", message: "Unclosed { block in Muse source", line: 1, column: 12 }])
})

test("the checked-in .muse.ts example passes through the compiler pipeline", () => {
  const source = readFileSync(new URL("../examples/Counter.muse.ts", import.meta.url), "utf8")
  const output = transformMuseSource(source, "Counter.muse.ts")
  assert.doesNotMatch(output, /VStack\([^\n]*\)\s*\{/)
  assert.match(output, /overloadClosure\(/)
  assert.match(output, /from "@muse\/react"/)
  assert.match(output, /view\(\{ state: \(\) => \{ const count = State\(0\)/)
  assert.doesNotMatch(output, /^const count = State/m)
  assert.equal(ts.createSourceFile("Counter.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
})

test("custom generic View structs lower to declaration-defined initializer metadata", () => {
  const source = `import { VStack } from "@muse/react"\nstruct Card<Content: View>: View {\n  let content: Content\n  init(@ViewBuilder content: () => Content) { self.content = content() }\n  var body: some View { VStack() { content } }\n}`
  const output = transformMuseSource(source, "Card.muse.ts")
  assert.match(output, /defineView\("Card"/)
  assert.match(output, /genericParameters: "Content: View"/)
  assert.match(output, /fields: \[\{ name: "content", kind: "stored"/)
  assert.match(output, /Card\(@ViewBuilder content\)/)
  assert.match(output, /resolveBuilderClosure\(content\)/)
  assert.match(output, /from "@muse\/react"/)
  assert.equal(ts.createSourceFile("Card.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
})

test("compiled generic ViewBuilder initializers enforce View results", () => {
  const source = `import { Text, VStack } from "@muse/core"
struct GenericBox<Content: View>: View {
  let content: Content
  init(@ViewBuilder content: () => Content) { self.content = content() }
  var body: some View { VStack() { content } }
}`
  const generated = transformMuseSource(source, "GenericBox.muse.ts")
    .replace(/^import [^\n]+\n/, "")
    .replace(/: any\b/g, "")
  const GenericBox = Function(
    "defineView",
    "initializer",
    "resolveBuilderClosure",
    "overloadClosure",
    "Text",
    "VStack",
    `${generated}; return GenericBox`,
  )(defineView, initializer, resolveBuilderClosure, overloadClosure, Text, VStack)
  assert.doesNotThrow(() => GenericBox(() => Text("valid")))
  assert.throws(() => GenericBox(() => "not a View"), /No matching initializer for GenericBox/)
})

test("nested View structs keep the outer body and local View scope", () => {
  const source = `struct Parent: View {
  struct Header: View {
    var body: some View { Text("Header") }
  }
  var body: some View { VStack() { Header() } }
}`
  const declarations = parseMuseStructs(source)
  assert.equal(declarations.length, 1)
  assert.deepEqual(declarations[0].nested?.map(item => item.name), ["Header"])
  assert.match(declarations[0].bodyExpressionSource, /VStack\(\) \{ Header\(\) \}/)
  const output = transformMuseSource(source, "Parent.muse.ts")
  assert.match(output, /const Parent = \(\(\) => \{ const Header = defineView\("Header"/)
  assert.match(output, /return Object\.assign\(defineView\("Parent"/)
  assert.match(output, /\{ Header \}/)
  assert.doesNotMatch(output, /\bstruct\b/)
  assert.equal(ts.createSourceFile("Parent.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
})

test("nested View structs expose qualified constructors as well as local body names", () => {
  const source = `import { Text, VStack } from "@muse/core"
struct Parent: View {
  struct Header: View {
    var body: some View { Text("Header") }
  }
  var body: some View { VStack() { Header() } }
}`
  const generated = transformMuseSource(source, "Parent.muse.ts")
    .replace(/^import [^\n]+\n/, "")
    .replace(/: any\b/g, "")
  const Parent = Function(
    "defineView",
    "initializer",
    "resolveBuilderClosure",
    "overloadClosure",
    "Text",
    "VStack",
    `${generated}; return Parent`,
  )(
    defineView,
    initializer,
    resolveBuilderClosure,
    overloadClosure,
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
  const source = `import { Text, VStack, State } from "muse"
struct Card<Content: View>: View {
  @State var count: number = 0
  @Binding var title: BindingRef<string>
  let content: Content = Text("Default")
  init(@ViewBuilder content: () => Content, title: BindingRef<string>) { self.content = content(); self.title = title }
  init(@Binding title: BindingRef<string>) { self.title = title }
  var body: some View { VStack() { Text(title.value); Text(String(count.value)); content } }
}`
  const output = transformMuseSource(source, "Card.muse.ts")
  assert.equal((output.match(/initializer\(/g) ?? []).length, 2)
  assert.match(output, /state: \(\) => \(\{ count: State\(0\) \}\)/)
  assert.match(output, /Card\(@Binding title\)/)
  assert.match(output, /label: "title"/)
  assert.match(output, /kind: "binding"/)
  assert.doesNotMatch(output, /import \{[^}]*State[^}]*\} from "@muse\/core"/)
  assert.equal(ts.createSourceFile("Card.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
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
  const output = transformMuseSource(source, "Card.muse.ts")
  assert.match(output, /export const Card = defineView\("Card"/)
  assert.match(output, /const \{ title \} = props/)
  assert.doesNotMatch(output, /const \{[^}]*local/)
  assert.equal(ts.createSourceFile("Card.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
})

test("raw HTML lowers to core Element nodes and preserves real attributes", () => {
  const source = `import { VStack } from "@muse/core"
VStack() {
  <section class="card" data-kind="hero">
    <h1>{title}</h1>
    <button onclick={save} aria-label="Save">Save</button>
  </section>
}`
  const output = transformMuseSource(source, "Card.muse.ts")
  assert.match(output, /import \{ [^}]*Element[^}]* \} from "@muse\/core"/)
  assert.match(output, /Element\("section", \{ "class": "card", "data-kind": "hero" \}/)
  assert.match(output, /Element\("h1", null, title\)/)
  assert.match(output, /Element\("button", \{ "onclick": save, "aria-label": "Save" \}, "Save"\)/)
  assert.doesNotMatch(output, /<section|<h1|<button/)
  assert.equal(ts.createSourceFile("Card.ts", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
})
