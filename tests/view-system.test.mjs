import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  Binding,
  Button,
  defineView,
  ForEach,
  initializer,
  modifierGraphOf,
  resolveBuilderClosure,
  State,
  Text,
  VStack,
  isViewNode,
  viewNodeOf,
} from '../dist/index.js'
import { diagnoseMuseSource, formatMuseSource, transformMuseBuilderSyntax, transformMuseStructSyntax } from '../dist/compiler/index.js'

test('struct syntax lowers to initializer metadata, a body, and instance State', () => {
  const output = transformMuseStructSyntax(`
    export struct Counter: View {
      @State var count = 0
      var body: some View {
        VStack(spacing: 12) {
          Text(String(count.value))
        }
      }
    }
  `)
  assert.match(output, /export const Counter = defineView\("Counter"/)
  assert.match(output, /state: \(_props: any\) => \(\{ count: State\(0\) \}\)/)
  assert.match(output, /VStack\(\{ spacing: 12 \}, \(\) =>/)
  assert.doesNotMatch(output, /DEFAULT_BUILDER_COMPONENTS/)
  assert.doesNotMatch(output, /\bstruct\b/)
})

test('custom View initializers resolve trailing builders and render the body', () => {
  const Card = defineView('Card', {
    initializers: [initializer(
      'Card(@ViewBuilder content)',
      args => args.length === 1 && typeof args[0] === 'function',
      args => ({ content: resolveBuilderClosure(args[0]) }),
      [{ kind: 'viewBuilder', label: 'content', required: true }],
    )],
    body: ({ content }) => VStack(() => [content]),
  })

  const html = renderToStaticMarkup(Card(() => [Text('CPU'), Text('72%')]))
  assert.match(html, /CPU/)
  assert.match(html, /72%/)
  assert.match(renderToStaticMarkup(Card({ content: () => [Text('named')] })), /named/)
  assert.throws(() => Card(Text('not a builder')), /No matching initializer for Card/)
})

test('Button overloads distinguish actions from label builders', () => {
  const html = renderToStaticMarkup(VStack(
    Button(() => undefined),
    Button('Save', () => undefined),
    Button({ action: () => undefined, label: () => [Text('Custom')] }),
  ))
  assert.match(html, /<button type="button"><\/button>/)
  assert.match(html, /Save/)
  assert.match(html, /Custom/)
  assert.throws(() => Text('Hello', () => Text('invalid')), /No matching initializer for Text/)
})

test('ViewBuilder conditionals and ForEach compose in the same graph', () => {
  const enabled = true
  const html = renderToStaticMarkup(VStack(() => [
    enabled ? [Text('B')] : [Text('C')],
    ForEach(['A', 'B'], item => Text(item)),
  ]))
  assert.match(html, /B/)
  assert.match(html, /A/)
  assert.match(html, /B/)
})

test('compiler language hooks preserve labeled closure overloads and diagnostics', () => {
  const output = formatMuseSource('Button(label: { Text("Save") }, action: { save() })')
  assert.match(output, /Button\(\{ label: \(\) => \[Text\("Save"\)\], action: \(\) => \{/)
  assert.deepEqual(diagnoseMuseSource('VStack() { Text("missing")'), [{
    severity: 'error',
    code: 'MUSE_SYNTAX',
    message: 'Unclosed { block in Muse builder source',
    line: 1,
    column: 1,
  }])
  assert.equal(transformMuseBuilderSyntax('Text("Hello")'), 'Text("Hello")')
})

test('Binding is a writable lens and modifiers produce an immutable graph', () => {
  const state = State(1)
  const binding = Binding(state)
  binding.value = 2
  assert.equal(state.value, 2)

  const original = Text('Hello')
  const modified = original.padding(4).foreground('red')
  assert.notEqual(original, modified)
  assert.deepEqual(modifierGraphOf(modified).map(record => record.name), ['padding', 'foreground'])
  assert.equal(isViewNode(viewNodeOf(original)), true)
  assert.equal(viewNodeOf(original)?.kind, 'element')
  assert.equal(viewNodeOf(modified)?.kind, 'modified')
})
