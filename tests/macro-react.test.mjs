import assert from 'node:assert/strict'
import test from 'node:test'
import { transformVuneMacros } from '../dist/vite.js'

test('moves State declarations into per-view state and defers Action expressions', () => {
  const source = `
import { Action, Button, State, Text, VStack, view } from 'vune'
const count = State(0)
export default view(
  VStack(
    Text(\`Count: \${count.value}\`),
    Button('Add', Action(count.value += 1)),
  )
)
`
  const output = transformVuneMacros(source, '/src/App.ts')
  assert.ok(output)
  assert.match(output, /state: \(\) => \(\{/)
  assert.match(output, /count: State\(0\)/)
  assert.match(output, /body: \(\{ count \}\) =>/)
  assert.match(output, /\(\(\) => \(count\.value \+= 1\)\)/)
  assert.doesNotMatch(output, /^const count = State\(0\)/m)
})

test('wraps a plain view expression in a render function', () => {
  const source = `import { Text, view } from 'vune'\nexport default view(Text('Hello'))`
  const output = transformVuneMacros(source, '/src/App.ts')
  assert.ok(output)
  assert.match(output, /view\(\(\) => \(Text\('Hello'\)\)\)/)
})
