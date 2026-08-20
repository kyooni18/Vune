import assert from 'node:assert/strict'
import test from 'node:test'
import { transformRuiMacros } from '../dist/vite.js'

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
