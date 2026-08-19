import test from 'node:test'
import assert from 'node:assert/strict'
import { transformVuneMacros } from '../dist/vite.js'

test('macro relocates State and delays Action expressions', () => {
  const source = `
import { Action, Button, State, Text, VStack, view } from 'vune'
const count = State(0)
const name = State('Hare')
export default view(
  VStack(
    Text(\`Count: \${count.value} / \${name.value}\`),
    Button('+', Action(count.value += 1)),
  )
)
`

  const output = transformVuneMacros(source, '/src/App.ts')
  assert.ok(output)
  assert.match(output, /state:\s*\(\)\s*=>\s*\(\{/)
  assert.match(output, /count:\s*State\(0\)/)
  assert.match(output, /name:\s*State\('Hare'\)/)
  assert.match(output, /body:\s*\(\{ count, name \}\)\s*=>/)
  assert.match(output, /Button\('\+'\s*,\s*\(\(\)\s*=>\s*\(count\.value \+= 1\)\)\)/)
  assert.doesNotMatch(output, /const\s+count\s*=\s*State/)
})

test('macro wraps a stateless view body', () => {
  const source = `
import { Text, VStack, view } from 'vune'
export default view(VStack(Text('Hello')))
`

  const output = transformVuneMacros(source, '/src/App.ts')
  assert.ok(output)
  assert.match(output, /export default view\(\(\) => \(VStack\(Text\('Hello'\)\)\)\)/)
})

test('macro skips Vue virtual submodules after the SFC pass', () => {
  const source = `export default view(Text('Hello'))`
  assert.equal(transformVuneMacros(source, '/src/App.vue?vue&type=script'), null)
})
