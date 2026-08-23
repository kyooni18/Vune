import assert from "node:assert/strict"
import test from "node:test"
import { diagnoseVuneSource, parseVuneBuilder, transformVuneSource } from "../packages/compiler/dist/index.js"

const parserCorpus = [
  `VStack(/* options */ spacing: 12) /* trailing builder */ {
  Text("Hello, ${"${"}name${"}"}")
  Button("Save") { await save() }
}`,
  `ForEach(items) { item in
  HStack {
    Text(item.title)
    Text(/\\}/.test(item.kind) ? "regex" : "plain")
  }
}`,
  `if (ready) {
  VStack() { Text(` + "`ready ${value}`" + `) }
} else if (loading) {
  Text("Loading")
} else {
  Text({ status: "idle", nested: { count: 0 } }.status)
}`,
  `const render = ({ value: current }) => VStack() {
  Text(current)
  Button(action: async () => { await save(current) }, label: { Text("Save") })
}`,
  `VStack() {
  /* braces in comments: } } */
  Text({ value: [1, 2, { nested: true }] }.value.join(","))
  Text(template.replace(/\\/\\//g, "//"))
}`,
]

test("parser corpus preserves nested closures, literals, comments, and conditionals", () => {
  for (const [index, source] of parserCorpus.entries()) {
    const program = parseVuneBuilder(source, 17)
    assert.ok(program.statements.length > 0, `corpus case ${index} should produce nodes`)
    assert.equal(program.range.start, 17)
    assert.equal(program.range.end, 17 + source.length)
    const output = transformVuneSource(source, `ParserCorpus${index}.vune.ts`)
    assert.ok(output.length > 0)
  }
})

test("parser corpus survives deterministic nesting and source-range checks", () => {
  let source = `Text(` + "`seed ${value}`" + `)`
  for (let depth = 0; depth < 24; depth += 1) {
    source = `VStack(/* depth ${depth} */) { ${source}; Text(/\\[${depth}\\]/.test(value) ? "yes" : "no") }`
    const program = parseVuneBuilder(source, 100)
    assert.equal(program.range.end, 100 + source.length)
    const visit = node => {
      assert.ok(node.range.start >= 100)
      assert.ok(node.range.end <= 100 + source.length)
      if (node.kind === "call") {
        for (const argument of node.arguments) {
          assert.ok(argument.range.start >= node.range.start)
          assert.ok(argument.range.end <= node.range.end)
          if (argument.value.kind === "closure") visit(argument.value.body.statements[0])
        }
        if (node.trailing) {
          for (const child of node.trailing.body.statements) visit(child)
        }
      } else if (node.kind === "conditional") {
        for (const child of node.then.statements) visit(child)
      }
    }
    for (const node of program.statements) visit(node)
    assert.doesNotThrow(() => transformVuneSource(source, `NestedParser${depth}.vune.ts`))
  }
})

test("malformed parser inputs produce shared syntax diagnostics with source offsets", () => {
  const malformed = [
    `VStack() { Text("missing close")`,
    `Text("unterminated)`,
    `Text(` + "`unterminated ${value}`".slice(0, -1),
    `VStack() /* missing comment close`,
    `if (ready) { VStack() { Text("missing branches") }`,
  ]
  for (const source of malformed) {
    const diagnostics = diagnoseVuneSource(source)
    assert.equal(diagnostics.length, 1)
    assert.equal(diagnostics[0].code, "VUNE_SYNTAX")
    assert.ok(diagnostics[0].line >= 1)
    assert.ok(diagnostics[0].column >= 1)
  }
})
