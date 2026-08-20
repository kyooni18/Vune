import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { ruiMacro, transformRuiMacros } from '../dist/vite.js'

test('moves State declarations into per-view state and defers Action expressions', () => {
  const source = `
import { Action, Button, State, Text, VStack, view } from 'rui'
const count = State(0)
export default view(
  VStack(
    Text(\`Count: \${count.value}\`),
    Button('Add', Action(count.value += 1)),
  )
)
`
  const output = transformRuiMacros(source, '/src/App.ts')
  assert.ok(output)
  assert.match(output, /state: \(\) => \{/)
  assert.match(output, /const count = State\(0\)/)
  assert.match(output, /return \{ count \}/)
  assert.match(output, /body: \(\{ count \}\) =>/)
  assert.match(output, /\(\(\) => \(count\.value \+= 1\)\)/)
  assert.doesNotMatch(output, /^const count = State\(0\)/m)
})

test('preserves State declaration order inside the per-view factory', () => {
  const source = `
import { State, Text, VStack, view } from 'rui'
const count = State(2)
const doubled = State(count.value * 2)
export default view(
  VStack(
    Text(\`Count: \${count.value}\`),
    Text(\`Double: \${doubled.value}\`),
  )
)
`
  const output = transformRuiMacros(source, '/src/App.ts')
  assert.ok(output)
  assert.match(output, /const count = State\(2\)[\s\S]*const doubled = State\(count\.value \* 2\)/)
  assert.match(output, /return \{ count, doubled \}/)
})

test('wraps a plain view expression in a render function', () => {
  const source = `import { Text, view } from 'rui'\nexport default view(Text('Hello'))`
  const output = transformRuiMacros(source, '/src/App.ts')
  assert.ok(output)
  assert.match(output, /view\(\(\) => \(Text\('Hello'\)\)\)/)
})

test('transforms the complete example, including generic State declarations', () => {
  const source = readFileSync(new URL('../examples/App.ts', import.meta.url), 'utf8')
  const output = transformRuiMacros(source, '/src/examples/App.ts')
  assert.ok(output)
  for (const name of ['todos', 'draft', 'filter', 'showSettings', 'showClearAlert', 'compactMode']) {
    assert.match(output, new RegExp(`const ${name} = State`))
    assert.doesNotMatch(output, new RegExp(`^const ${name} = State`, 'm'))
  }
  assert.match(output, /State<Todo\[\]>\(/)
  assert.doesNotMatch(output, /state: \(\) => \{[\s\S]*State<Todo\[\]>\(\[[\s\S]*\n\}\n\nexport default/)

  const parsed = ts.createSourceFile('App.ts', output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  assert.equal(parsed.parseDiagnostics.length, 0)
})

test('respects lexical scopes and preserves function-valued Action callbacks', () => {
  const source = `
const count = State<number>(0) // top-level
function makeLocal() {
  const nested = State(1)
  return nested.value
}
export default view(
  VStack(
    Text(\`Count: \${count.value}\`),
    Button('direct', Action( count.value += 1 )),
    Button('callback', Action(() => { count.value += 1 })),
    Button('function', Action(function () { count.value += 1 })),
  ),
)
`
  const output = transformRuiMacros(source, '/src/App.ts')
  assert.ok(output)
  assert.match(output, /const count = State<number>\(0\)/)
  assert.match(output, /const nested = State\(1\)/)
  assert.match(output, /\(\(\) => \(count\.value \+= 1\)\)/)
  assert.match(output, /Action\(\(\) => \{ count\.value \+= 1 \}\)/)
  assert.match(output, /Action\(function \(\) \{ count\.value \+= 1 \}\)/)
  assert.doesNotMatch(output, /Action\(\(\(\) => \(\(\) =>/)
})

test('handles destructuring, templates, comments, and typed view parameters', () => {
  const source = `
const model = State<{ value: number }>({ value: 1 })
export default view(
  ({ label }: { label: string }) => {
    const { value } = model.value /* nested State reads stay in the body */
    return Text(\`\${label}: \${value}\`)
  },
)
`
  const output = transformRuiMacros(source, '/src/App.ts')
  assert.ok(output)
  assert.match(output, /const model = State<\{ value: number \}>\(\{ value: 1 \}\)/)
  assert.match(output, /body: \(\{ model \}, props\) =>/)
  assert.match(output, /const \{ value \} = model\.value/)
  assert.match(output, /Text\(`\$\{label\}: \$\{value\}`\)/)
  const parsed = ts.createSourceFile('App.ts', output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  assert.equal(parsed.parseDiagnostics.length, 0)
})

test('Vite macro returns a source map while keeping the helper string-compatible', () => {
  const source = 'const value = State(0)\nexport default view(Text(value.value))\n'
  const plugin = ruiMacro()
  const result = plugin.transform(source, '/src/App.ts')
  assert.ok(result)
  assert.equal(typeof result.code, 'string')
  assert.equal(result.map.version, 3)
  assert.deepEqual(result.map.sources, ['/src/App.ts'])
  assert.equal(result.map.sourcesContent[0], source)
})
