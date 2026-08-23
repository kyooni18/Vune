import assert from "node:assert/strict"
import test from "node:test"
import ts from "typescript"
import { diagnoseMuseSource, transformMuseSource } from "../packages/compiler/dist/index.js"

function parses(output, name = "Generated.ts") {
  assert.equal(ts.createSourceFile(name, output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0)
}

test("compiler never rewrites ordinary TypeScript methods or generators as Muse closures", () => {
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
  const output = transformMuseSource(source, "Methods.muse.ts")
  assert.doesNotMatch(output, /overloadClosure/)
  assert.match(output, /method\(\) \{/)
  assert.match(output, /\*values\(\)/)
  parses(output)
  assert.deepEqual(diagnoseMuseSource(source), [])
})

test("Muse trailing closures remain callable inside object-valued property expressions", () => {
  const source = `const Graph = defineView("Graph", {
  body: () => VStack(
    Text("A"),
    Button("Increment") { count.value += 1 },
    ForEach(items) { item in Text(item.id) },
  ),
})`
  const output = transformMuseSource(source, "ObjectPropertyClosures.muse.ts")
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
  const output = transformMuseSource(source, "ControlFlow.muse.ts")
  assert.match(output, /__museChildren\.push\(enabled \? Text\("on"\) : Text\("off"\)\)/)
  assert.match(output, /__museChildren\.push\(enabled && Text\("extra"\)\)/)
  assert.match(output, /for \(const value of values\)[\s\S]*__museChildren\.push\(Text\(String\(value\)\)\)/)
  assert.match(output, /while \(ready\)[\s\S]*__museChildren\.push\(Text\("ready"\)\)/)
  assert.match(output, /try[\s\S]*__museChildren\.push\(Text\("try"\)\)[\s\S]*catch[\s\S]*__museChildren\.push\(Text\("catch"\)\)[\s\S]*finally[\s\S]*__museChildren\.push\(Text\("finally"\)\)/)
  parses(output)
})

test("top-level State ownership is per-view and shared State remains module-scoped", () => {
  const source = `import { State } from "muse"
import { view } from "@muse/react"
const first = State(1)
const second = State(2)
const shared = State(3)
export const A = view(() => VStack() { Text(String(first.value)); Text(String(shared.value)) })
export const B = view(() => VStack() { Text(String(second.value)); Text(String(shared.value)) })`
  const output = transformMuseSource(source, "StateOwnership.muse.ts")
  assert.match(output, /^const shared = State\(3\)/m)
  assert.doesNotMatch(output, /^const first = State\(1\)/m)
  assert.doesNotMatch(output, /^const second = State\(2\)/m)
  assert.match(output, /state: \(\) => \{ const first = State\(1\)/)
  assert.match(output, /state: \(\) => \{ const second = State\(2\)/)
  parses(output)
})

test("top-level State ownership respects outer references and lexical shadowing", () => {
  const outside = `import { State } from "muse"
import { view } from "@muse/react"
const count = State(0)
export function readCount() { return count.value }
export default view(() => Text(String(count.value)))`
  assert.match(transformMuseSource(outside, "Outside.muse.ts"), /^const count = State\(0\)/m)

  const shadowed = `import { State } from "muse"
import { view } from "@muse/react"
const count = State(0)
function helper(count: number) { return count + 1 }
export default view(() => Text(String(count.value)))`
  const output = transformMuseSource(shadowed, "Shadowed.muse.ts")
  assert.doesNotMatch(output, /^const count = State\(0\)/m)
  assert.match(output, /state: \(\) => \{ const count = State\(0\)/)
  parses(output)
})

test("semantic initializer matching widens const primitive literal types", () => {
  const source = `const title = "Muse"
const count = 3
const enabled = true
Text(title)
Text(count)
Text(String(enabled))`
  const diagnostics = diagnoseMuseSource(source).filter(item => item.code === "MUSE_INITIALIZER")
  assert.deepEqual(diagnostics, [])
})

test("raw HTML disambiguates TypeScript assertions and decodes character references", () => {
  const assertion = `const result = <Foo>input\nText(String(result))`
  const assertionOutput = transformMuseSource(assertion, "Assertion.muse.ts")
  assert.match(assertionOutput, /<Foo>input/)
  assert.doesNotMatch(assertionOutput, /Element\("Foo"/)
  parses(assertionOutput)

  const html = `<div title="A &amp; B">A &amp; B &#x21;</div>`
  const htmlOutput = transformMuseSource(html, "Entities.muse.ts")
  assert.match(htmlOutput, /Element\("div", \{ "?title"?: "A & B" \}, "A & B !"\)/)
  parses(htmlOutput)
})

test("qualified nested Muse view calls lower named arguments without losing the qualifier", () => {
  const source = `struct Outer: View {
  struct Inner: View {
    let title: string
    init(title: string) { self.title = title }
    var body: some View { Text(title) }
  }
  var body: some View { Outer.Inner(title: "x") }
}`
  const output = transformMuseSource(source, "Nested.muse.ts")
  assert.match(output, /Outer\.Inner\(namedArguments\(\{ title: "x" \}\)\)/)
  assert.doesNotMatch(output, /Outer\.Inner\(title:/)
  parses(output)
})

test("source maps keep moved State declarations and body uses on their original spans", async () => {
  const { compileMuseFile, mapGeneratedPosition } = await import("../packages/compiler/dist/index.js")
  const source = `import { State, Text, view } from "muse"
const count = State(0)
const label = "x"

export default view(() =>
  Text(String(count.value))
)`
  const result = compileMuseFile(source, "SourceMap.muse.ts")
  const lines = result.code.split("\n")
  const stateLine = lines.findIndex(line => line.includes("const count = State(0)"))
  const stateColumn = lines[stateLine].indexOf("count")
  const useLine = lines.findIndex(line => line.includes("String(count.value)"))
  const useColumn = lines[useLine].indexOf("count")
  assert.deepEqual(mapGeneratedPosition(result.map, { line: stateLine + 1, column: stateColumn + 1 }), { line: 2, column: 7 })
  assert.deepEqual(mapGeneratedPosition(result.map, { line: useLine + 1, column: useColumn + 1 }), { line: 6, column: 15 })
})

test("diagnostics warn when top-level State cannot become instance-local", () => {
  const source = `import { State as S } from "@muse/core"
export const exported = S(0)
let mutable = S(1)
const local = S(2)`
  const warnings = diagnoseMuseSource(source).filter(item => item.code === "MUSE_STATE_SCOPE")
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
  const directory = mkdtempSync(join(tmpdir(), "muse-specialization-"))
  try {
    const dependency = join(directory, "dep.ts")
    const fileName = join(directory, "main.muse.ts")
    const source = `import { Card } from "./dep"\nconst value = Card("x")\n`
    writeFileSync(dependency, `export declare const Card: { (value: string): unknown; readonly viewType: {} }\n`)
    assert.match(lowerStaticImportedCalls(source, fileName), /createNodeSpecialized/)
    writeFileSync(dependency, `export declare const Card: { (...value: string[]): unknown; readonly viewType: {} }\n`)
    assert.doesNotMatch(lowerStaticImportedCalls(source, fileName), /createNodeSpecialized/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("dynamic Button values defer initializer choice instead of producing a false compiler error", () => {
  const source = `const label = enabled ? "Pause" : "Resume"\nButton(label) { save() }`
  assert.deepEqual(diagnoseMuseSource(source).filter(item => item.code === "MUSE_INITIALIZER"), [])
  const output = transformMuseSource(source, "DynamicButton.muse.ts")
  assert.match(output, /Button\(label, \(\) => \{\s*save\(\)\s*\}\)/)
  parses(output)

  const named = `const action = () => save()\nButton(action: action, label: { Text("Save") })`
  assert.deepEqual(diagnoseMuseSource(named).filter(item => item.code === "MUSE_INITIALIZER"), [])
  parses(transformMuseSource(named, "DynamicNamedButton.muse.ts"))
})


test("Grid and LazyGrid static specialization indices match runtime initializer order", () => {
  const source = `import { Grid, LazyGrid, Text } from "muse"
Grid({ columns: 3 }) { Text("A") }
LazyGrid({ columns: 2, estimatedItemSize: 44 }) { Text("B") }`
  const output = transformMuseSource(source, "GridSpecialization.muse.ts")
  assert.match(output, /Grid\.viewType\.createNodeSpecialized\(0,/)
  assert.match(output, /LazyGrid\.viewType\.createNodeSpecialized\(0,/)
  parses(output)
})
