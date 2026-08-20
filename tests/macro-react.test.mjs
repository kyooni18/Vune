import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { museMacro, transformMuseMacros } from '../dist/vite.js'

test('moves State declarations into per-view state and defers Action expressions', () => {
  const source = `
import { Action, Button, State, Text, VStack, view } from 'muse'
const count = State(0)
export default view(
  VStack(
    Text(\`Count: \${count.value}\`),
    Button('Add', Action(count.value += 1)),
  )
)
`
  const output = transformMuseMacros(source, '/src/App.ts')
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
import { State, Text, VStack, view } from 'muse'
const count = State(2)
const doubled = State(count.value * 2)
export default view(
  VStack(
    Text(\`Count: \${count.value}\`),
    Text(\`Double: \${doubled.value}\`),
  )
)
`
  const output = transformMuseMacros(source, '/src/App.ts')
  assert.ok(output)
  assert.match(output, /const count = State\(2\)[\s\S]*const doubled = State\(count\.value \* 2\)/)
  assert.match(output, /return \{ count, doubled \}/)
})

test('splits mixed top-level declarations without leaving State module-scoped', () => {
  const source = `
const count = State(0), /* preserve the sibling */ label = 'Count', other = State(1)
export default view(
  VStack(Text(label), Text(String(count.value + other.value))),
)
`
  const output = transformMuseMacros(source, '/src/App.ts')
  assert.ok(output)
  assert.match(output, /label = 'Count';/)
  assert.match(output, /preserve the sibling/)
  assert.match(output, /const count = State\(0\)/)
  assert.match(output, /const other = State\(1\)/)
  assert.doesNotMatch(output, /^const count = State/m)
  assert.doesNotMatch(output, /^const other = State/m)
  const parsed = ts.createSourceFile('App.ts', output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  assert.equal(parsed.parseDiagnostics.length, 0)
})

test('wraps a plain view expression in a render function', () => {
  const source = `import { Text, view } from 'muse'\nexport default view(Text('Hello'))`
  const output = transformMuseMacros(source, '/src/App.ts')
  assert.ok(output)
  assert.match(output, /view\(\(\) => \(Text\('Hello'\)\)\)/)
})

test('transforms the complete example, including top-level State declarations', () => {
  const source = readFileSync(new URL('../examples/App.ts', import.meta.url), 'utf8')
  const output = transformMuseMacros(source, '/src/examples/App.ts')
  assert.ok(output)
  for (const name of ['text', 'value', 'checked']) {
    assert.match(output, new RegExp(`const ${name} = State`))
    assert.doesNotMatch(output, new RegExp(`^const ${name} = State`, 'm'))
  }

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
  const output = transformMuseMacros(source, '/src/App.ts')
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
  const output = transformMuseMacros(source, '/src/App.ts')
  assert.ok(output)
  assert.match(output, /const model = State<\{ value: number \}>\(\{ value: 1 \}\)/)
  assert.match(output, /body: \(\{ model \}, props\) =>/)
  assert.match(output, /const \{ value \} = model\.value/)
  assert.match(output, /Text\(`\$\{label\}: \$\{value\}`\)/)
  const parsed = ts.createSourceFile('App.ts', output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  assert.equal(parsed.parseDiagnostics.length, 0)
})

test('Vite macro returns a source map while keeping the helper string-compatible', () => {
  const source = 'const value = State(0)\nconst prefix = "x"\nexport default view(Text(prefix + value.value))\n'
  const plugin = museMacro()
  const result = plugin.transform(source, '/src/App.ts')
  assert.ok(result)
  assert.equal(typeof result.code, 'string')
  assert.equal(result.map.version, 3)
  assert.deepEqual(result.map.sources, ['/src/App.ts'])
  assert.equal(result.map.sourcesContent[0], source)
  const base64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const decode = (segment, field) => {
    let cursor = 0
    let value = 0
    let shift = 0
    for (let index = 0; index <= field; index += 1) {
      value = 0
      shift = 0
      while (true) {
        const digit = base64.indexOf(segment[cursor++])
        value |= (digit & 31) << shift
        if ((digit & 32) === 0) break
        shift += 5
      }
    }
    return (value & 1) === 0 ? value >> 1 : -(value >> 1)
  }
  const hasColumnMapping = result.map.mappings.split(';').some(line => line.split(',').some(segment =>
    segment.length >= 4 && Math.abs(decode(segment, 0)) > 0 && Math.abs(decode(segment, 3)) > 0,
  ))
  assert.equal(hasColumnMapping, true)
})

test('reports State declarations that cannot become instance-local', () => {
  const source = `
export const exported = State(0)
let mutable = State(1)
export default view(Text(String(exported.value + mutable.value)))
`
  const warnings = []
  const plugin = museMacro()
  const result = plugin.transform.call({ warn(message) { warnings.push(message) } }, source, '/src/App.ts')
  assert.ok(result)
  assert.equal(warnings.length, 2)
  assert.match(warnings[0], /must not be exported/)
  assert.match(warnings[1], /must use const/)
})

test('covers advanced TypeScript syntax and callback forms in the macro corpus', () => {
  const source = `
type Item = { id: number; label: string }
const items = State<Array<{ item: Item; tags: readonly string[] }>>([
  { item: { id: 1, label: 'one' }, tags: ['a'] as const },
] satisfies Array<{ item: Item; tags: readonly string[] }>)
const wrapped = State(0) as StateRef<number>
const checked = State({ value: 1 }) satisfies StateRef<{ value: number }>
const { label: staticLabel } = { label: 'static' } as const
const count = State(0), label = 'Items'
function nestedFunction() {
  const nested = State(1)
  return nested.value
}
class Controller {
  method() { return State(2) }
}
const objectMethods = { method() { return State(3) } }
export default view(
  ({ prefix }: { prefix: string }) => {
    async function load() { return Action(async () => items.value.push({ item: { id: 2, label: staticLabel }, tags: [] })) }
    function* generate() { yield Action(function named() { count.value += 1 }) }
    return VStack(Text(prefix + label), Text(String(count.value + wrapped.value + checked.value.value)), Text(String(load)), Text(String(generate)), Text(String(nestedFunction)), Text(String(objectMethods)))
  },
)
`
  const output = transformMuseMacros(source, '/src/Corpus.ts')
  assert.ok(output)
  assert.match(output, /State<Array<\{ item: Item; tags: readonly string\[\] \}>>/)
  assert.match(output, /tags: \['a'\] as const/)
  assert.match(output, /satisfies Array<\{ item: Item; tags: readonly string\[\] \}>/)
  assert.match(output, /State\(0\) as StateRef<number>/)
  assert.match(output, /State\(\{ value: 1 \}\) satisfies StateRef<\{ value: number \}>/)
  assert.match(output, /const label = 'Items'/)
  assert.match(output, /const nested = State\(1\)/)
  assert.match(output, /class Controller/)
  assert.match(output, /Action\(async \(\) =>/)
  assert.match(output, /Action\(function named\(\)/)
  const parsed = ts.createSourceFile('Corpus.ts', output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  assert.equal(parsed.parseDiagnostics.length, 0)
})
