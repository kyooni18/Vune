import assert from "node:assert/strict"
import test from "node:test"
import ts from "typescript"
import { diagnoseVuneSource, transformVuneSource } from "../packages/compiler/dist/index.js"

function parses(output, name = "Generated.ts") {
  assert.equal(ts.createSourceFile(name, output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
}

test("compiler never rewrites ordinary TypeScript methods or generators as Vune closures", () => {
  const source = `
class Service {
  method() { const value = 1; return value }
  static async Load() { return 2 }
  get value() { return 3 }
  set value(next: number) { void next }
  *values() { yield 1 }
}
const object = {
  method() { const value = 4; return value },
  async Load() { return 5 },
  get value() { return 6 },
  *values() { yield 7 },
}
function* topLevel() { yield 8 }
`
  const output = transformVuneSource(source, "Methods.vune.ts")
  assert.doesNotMatch(output, /overloadClosure/)
  assert.match(output, /method\(\) \{/)
  assert.match(output, /\*values\(\)/)
  parses(output)
  assert.deepEqual(diagnoseVuneSource(source), [])
})

test("Vune trailing closures remain callable inside object-valued property expressions", () => {
  const source = `const Graph = defineView("Graph", {
  body: () => VStack(
    Text("A"),
    Button("Increment") { count.value += 1 },
    ForEach(items) { item in Text(item.id) },
  ),
})`
  const output = transformVuneSource(source, "ObjectPropertyClosures.vune.ts")
  assert.match(output, /Button(?:\.viewType\.createNodeSpecialized\([^\n]*|\()(?=[\s\S]*count\.value \+= 1)/)
  assert.match(output, /ForEach(?:\.viewType\.createNodeSpecialized|\()/)
  assert.doesNotMatch(output, /Button\([^\n]*\), \{ count\.value/)
  parses(output)
})

test("statement-aware ViewBuilder recursively collects conditional, loop, and try children", () => {
  const source = `VStack() {
  const values = [1, 2]
  enabled ? Text("on") : Text("off")
  enabled && Text("extra")
  for (const value of values) Text(String(value))
  while (ready) { Text("ready"); break }
  try { Text("try") } catch { Text("catch") } finally { Text("finally") }
}`
  const output = transformVuneSource(source, "ControlFlow.vune.ts")
  assert.match(output, /__vuneChildren\.push\(enabled \? Text\("on"\) : Text\("off"\)\)/)
  assert.match(output, /__vuneChildren\.push\(enabled && Text\("extra"\)\)/)
  assert.match(output, /for \(const value of values\)[\s\S]*__vuneChildren\.push\(Text\(String\(value\)\)\)/)
  assert.match(output, /while \(ready\)[\s\S]*__vuneChildren\.push\(Text\("ready"\)\)/)
  assert.match(output, /try[\s\S]*__vuneChildren\.push\(Text\("try"\)\)[\s\S]*catch[\s\S]*__vuneChildren\.push\(Text\("catch"\)\)[\s\S]*finally[\s\S]*__vuneChildren\.push\(Text\("finally"\)\)/)
  parses(output)
})

test("top-level State ownership is per-view and shared State remains module-scoped", () => {
  const source = `import { State } from "vune-ui"
import { view } from "@vune-ui/react"
const first = State(1)
const second = State(2)
const shared = State(3)
export const A = view(() => VStack() { Text(String(first.value)); Text(String(shared.value)) })
export const B = view(() => VStack() { Text(String(second.value)); Text(String(shared.value)) })`
  const output = transformVuneSource(source, "StateOwnership.vune.ts")
  assert.match(output, /^const shared = State\(3\)/m)
  assert.doesNotMatch(output, /^const first = State\(1\)/m)
  assert.doesNotMatch(output, /^const second = State\(2\)/m)
  assert.match(output, /state: \(\) => \{ const first = State\(1\)/)
  assert.match(output, /state: \(\) => \{ const second = State\(2\)/)
  assert.match(output, /dependencies: \(\{ first \}\) => \[first\]/)
  assert.match(output, /dependencies: \(\{ second \}\) => \[second\]/)
  assert.doesNotMatch(output, /dependenciesComplete: true/)
  parses(output)
})

test("top-level State skips runtime dependency discovery only for a compiler-proven closed body", () => {
  const source = `import { State, Text } from "@vune-ui/core"
import { view } from "@vune-ui/react"
const count = State(0)
export default view(() => Text(String(count.value)))`
  const output = transformVuneSource(source, "ClosedStateDependencies.vune.ts")
  assert.match(output, /dependencies: \(\{ count \}\) => \[count\], dependenciesComplete: true/)
  parses(output)
})

test("top-level State keeps runtime dependency discovery for unproven member calls", () => {
  const source = `import { State, Text } from "@vune-ui/core"
import { view } from "@vune-ui/react"
const count = State(0)
const helper = { padding(value: number) { return Text(String(value)) } }
export default view(() => count.value > 0 ? helper.padding(8) : Text(String(count.value)))`
  const output = transformVuneSource(source, "OpaqueModifierName.vune.ts")
  assert.match(output, /dependencies: \(\{ count \}\) => \[count\]/)
  assert.doesNotMatch(output, /dependenciesComplete: true/)
  parses(output)
})

test("top-level State ownership respects outer references and lexical shadowing", () => {
  const outside = `import { State } from "vune-ui"
import { view } from "@vune-ui/react"
const count = State(0)
export function readCount() { return count.value }
export default view(() => Text(String(count.value)))`
  assert.match(transformVuneSource(outside, "Outside.vune.ts"), /^const count = State\(0\)/m)

  const shadowed = `import { State } from "vune-ui"
import { view } from "@vune-ui/react"
const count = State(0)
function helper(count: number) { return count + 1 }
export default view(() => Text(String(count.value)))`
  const output = transformVuneSource(shadowed, "Shadowed.vune.ts")
  assert.doesNotMatch(output, /^const count = State\(0\)/m)
  assert.match(output, /state: \(\) => \{ const count = State\(0\)/)
  parses(output)
})

test("semantic initializer matching widens const primitive literal types", () => {
  const source = `const title = "Vune"
const count = 3
const enabled = true
Text(title)
Text(count)
Text(String(enabled))`
  const diagnostics = diagnoseVuneSource(source).filter(item => item.code === "VUNE_INITIALIZER")
  assert.deepEqual(diagnostics, [])
})

test("semantic initializer matching preserves direct string literals for literal contracts", () => {
  const valid = diagnoseVuneSource('ScrollView("both") { Text("valid") }').filter(item => item.code === "VUNE_INITIALIZER")
  const invalid = diagnoseVuneSource('ScrollView("sideways") { Text("invalid") }').filter(item => item.code === "VUNE_INITIALIZER")
  assert.deepEqual(valid, [])
  assert.equal(invalid.length, 1)
})

test("raw HTML disambiguates TypeScript assertions and decodes character references", () => {
  const assertion = `const result = <Foo>input\nText(String(result))`
  const assertionOutput = transformVuneSource(assertion, "Assertion.vune.ts")
  assert.match(assertionOutput, /<Foo>input/)
  assert.doesNotMatch(assertionOutput, /Element\("Foo"/)
  parses(assertionOutput)

  const html = `<div title="A &amp; B">A &amp; B &#x21;</div>`
  const htmlOutput = transformVuneSource(html, "Entities.vune.ts")
  assert.match(htmlOutput, /Element\("div", \{ "?title"?: "A & B" \}, "A & B !"\)/)
  parses(htmlOutput)
})

test("qualified nested Vune view calls lower named arguments without losing the qualifier", () => {
  const source = `struct Outer: View {
  struct Inner: View {
    let title: string
    init(title: string) { self.title = title }
    var body: some View { Text(title) }
  }
  var body: some View { Outer.Inner(title: "x") }
}`
  const output = transformVuneSource(source, "Nested.vune.ts")
  assert.match(output, /Outer\.Inner\(namedArguments\(\{ title: "x" \}\)\)/)
  assert.doesNotMatch(output, /Outer\.Inner\(title:/)
  parses(output)
})

test("source maps keep moved State declarations and body uses on their original spans", async () => {
  const { compileVuneFile, mapGeneratedPosition } = await import("../packages/compiler/dist/index.js")
  const source = `import { State, Text, view } from "vune-ui"
const count = State(0)
const label = "x"

export default view(() =>
  Text(String(count.value))
)`
  const result = compileVuneFile(source, "SourceMap.vune.ts")
  const lines = result.code.split("\n")
  const stateLine = lines.findIndex(line => line.includes("const count = State(0)"))
  const stateColumn = lines[stateLine].indexOf("count")
  const useLine = lines.findIndex(line => line.includes("String(count.value)"))
  const useColumn = lines[useLine].indexOf("count")
  assert.deepEqual(mapGeneratedPosition(result.map, { line: stateLine + 1, column: stateColumn + 1 }), { line: 2, column: 7 })
  assert.deepEqual(mapGeneratedPosition(result.map, { line: useLine + 1, column: useColumn + 1 }), { line: 6, column: 15 })
})

test("diagnostics warn when top-level State cannot become instance-local", () => {
  const source = `import { State as S } from "@vune-ui/core"
export const exported = S(0)
let mutable = S(1)
const local = S(2)`
  const warnings = diagnoseVuneSource(source).filter(item => item.code === "VUNE_STATE_SCOPE")
  assert.equal(warnings.length, 2)
  assert.deepEqual(warnings.map(item => [item.severity, item.line]), [["warning", 2], ["warning", 3]])
  assert.match(warnings[0].message, /exported/)
  assert.match(warnings[1].message, /mutable/)
})

test("static specialization cache invalidates when an imported type file changes", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const { lowerStaticImportedCalls } = await import("../packages/compiler/dist/specialization.js")
  const directory = mkdtempSync(join(tmpdir(), "vune-specialization-"))
  try {
    const dependency = join(directory, "dep.ts")
    const fileName = join(directory, "main.vune.ts")
    const source = `import { Card } from "./dep"\nconst value = Card("x")\n`
    writeFileSync(dependency, `export declare const Card: { (value: string): unknown; readonly viewType: {} }\n`)
    assert.match(lowerStaticImportedCalls(source, fileName), /createNodeCompiled/)
    writeFileSync(dependency, `export declare const Card: { (...value: string[]): unknown; readonly viewType: {} }\n`)
    assert.doesNotMatch(lowerStaticImportedCalls(source, fileName), /createNode(?:Compiled|Specialized)/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("trusted imported specialization rejects callables with unsafe return types", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const { lowerStaticImportedCalls } = await import("../packages/compiler/dist/specialization.js")
  const directory = mkdtempSync(join(tmpdir(), "vune-unsafe-builder-"))
  try {
    const dependency = join(directory, "dep.ts")
    const fileName = join(directory, "main.vune.ts")
    writeFileSync(dependency, `export declare const Stack: { (content: () => any): unknown; readonly viewType: {} }\n`)
    const source = `import { Stack } from "./dep"\ndeclare const content: () => any\nconst value = Stack(content)\n`
    const output = lowerStaticImportedCalls(source, fileName)
    assert.match(output, /createNodeSpecialized/)
    assert.doesNotMatch(output, /createNodeCompiled/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("dynamic Button values defer initializer choice instead of producing a false compiler error", () => {
  const source = `const label = enabled ? "Pause" : "Resume"\nButton(label) { save() }`
  assert.deepEqual(diagnoseVuneSource(source).filter(item => item.code === "VUNE_INITIALIZER"), [])
  const output = transformVuneSource(source, "DynamicButton.vune.ts")
  assert.match(output, /Button\(label, \(\) => \{\s*save\(\)\s*\}\)/)
  parses(output)

  const named = `const action = () => save()\nButton(action: action, label: { Text("Save") })`
  assert.deepEqual(diagnoseVuneSource(named).filter(item => item.code === "VUNE_INITIALIZER"), [])
  parses(transformVuneSource(named, "DynamicNamedButton.vune.ts"))
})


test("Grid and LazyGrid static specialization indices match runtime initializer order", () => {
  const source = `import { Grid, LazyGrid, Text } from "vune-ui"
Grid({ columns: 3 }) { Text("A") }
LazyGrid({ columns: 2, estimatedItemSize: 44 }) { Text("B") }`
  const output = transformVuneSource(source, "GridSpecialization.vune.ts")
  assert.match(output, /Grid\.viewType\.createNodeCompiled\(0,/)
  assert.match(output, /LazyGrid\.viewType\.createNodeCompiled\(0,/)
  parses(output)
})

test("implicit member arguments survive static modifier chain specialization", () => {
  // `.red` is not valid TypeScript, so the checker recovers with a zero-width
  // base; the emitted argument must still be the lowered string literal.
  const source = `import { Text } from "vune-ui"\nconst view = Text("x").foregroundStyle(.red)`
  const output = transformVuneSource(source, "ImplicitMemberModifier.vune.ts")
  assert.match(output, /\[\["foregroundStyle", \["red"\]\]\]/)
  assert.doesNotMatch(output, /\[red\]/)
  parses(output)
})

test("ternary implicit members lower in labeled arguments and keep optional chaining intact", () => {
  const output = transformVuneSource(
    'VStack(alignment: flag ? .center : .leading) { Text("a") }',
    "TernaryMember.vune.ts",
  )
  assert.match(output, /alignment: flag \? "center" : "leading"/)
  parses(output)

  const chaining = transformVuneSource('const name = obj?.value?.name ?? "fallback"', "OptionalChaining.ts")
  assert.equal(chaining, 'const name = obj?.value?.name ?? "fallback"')
})

test("single-line struct initializer bodies produce valid field assignments", () => {
  const source = `struct Gauge: View {
  var v: number
  init(v: number) { if (v < 0) { self.v = 0 } else { self.v = v } }
  var body: some View { Text(String(v)) }
}`
  const output = transformVuneSource(source, "SingleLineInit.vune.ts")
  // The closing braces of the single-line body must not be swallowed into
  // the field expression; the final assignment wins.
  assert.match(output, /return \{ v: v \} \}/)
  parses(output)
})

test("mixed State and view declarators hoist without corrupting sibling edits", () => {
  const source = `import { State } from "vune-ui"
import { view } from "@vune-ui/react"
const count = State(0), app = view(() => Text(String(count.value)))`
  const output = transformVuneSource(source, "MixedDeclarators.vune.ts")
  // The State declaration is removed and the view call gains its state body
  // without leaving fragments of the original statement behind.
  assert.match(output, /const\s+app = view\(\{\s*state:/)
  assert.doesNotMatch(output, /\)\)tate\(0\)/)
  assert.doesNotMatch(output, /view\([^)]*\)[a-zA-Z]/)
  assert.doesNotMatch(output, /^const count = State\(0\)/m)
  parses(output)
})

test("spread arguments and member access survive static modifier specialization", () => {
  const source = `import { Text } from "vune-ui"\nconst values = [8]\nconst view = Text("x").padding(...values)`
  const output = transformVuneSource(source, "SpreadModifier.vune.ts")
  assert.match(output, /\[\["padding", \[\.\.\.values\]\]\]/)
  assert.doesNotMatch(output, /\["values"\]/)
  parses(output)
})

test("implicit-member lowering never rewrites string or comment content", () => {
  const source = `import { Text } from "vune-ui"
// return .red inside a comment
const view = Text("Press return .red to confirm")`
  const output = transformVuneSource(source, "ProseMember.vune.ts")
  // The prose keeps its literal `.red`; only authored implicit members lower.
  assert.match(output, /Press return \.red to confirm/)
  assert.match(output, /return \.red inside a comment/)
  assert.doesNotMatch(output, /"red" to confirm/)
  parses(output)
})

test("struct field assignments continue across operator-terminated lines", () => {
  const source = `struct Banner: View {
  var title: string
  init(prefix: string) { self.title = prefix +\n  " World" }
  var body: some View { Text(title) }
}`
  const output = transformVuneSource(source, "MultilineInit.vune.ts")
  assert.match(output, /title: prefix \+\s+" World"/)
  parses(output)
})
