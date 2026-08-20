import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  Component,
  HStack,
  Spacer,
  State,
  Text,
  VStack,
  view,
} from '../dist/index.js'

function Badge({ label }) {
  return createElement('strong', null, label)
}

test('renders coordinate-free stack layout', () => {
  const html = renderToStaticMarkup(
    HStack(Text('Left'), Spacer(), Text('Right')).frame({ maxWidth: 'infinity' }),
  )
  assert.match(html, /display:flex/)
  assert.match(html, /width:100%/)
  assert.match(html, /flex-grow:1/)
})

test('hosts ordinary React components without passing layout styles into them', () => {
  const html = renderToStaticMarkup(
    HStack(Component(Badge, { label: 'React' }).padding(12)),
  )
  assert.match(html, /data-vune-layout-host/)
  assert.match(html, /padding:12px/)
  assert.match(html, /<strong>React<\/strong>/)
})

test('view produces a renderable React component', () => {
  const App = view(() => VStack(Text('Hello Vune')))
  const html = renderToStaticMarkup(createElement(App))
  assert.match(html, /Hello Vune/)
})

test('view passes React props into its body', () => {
  const Greeting = view(({ name }) => Text(`Hello, ${name}`))
  const html = renderToStaticMarkup(createElement(Greeting, { name: 'Vune' }))
  assert.match(html, /Hello, Vune/)
})

test('view state factories are scoped to a component instance', () => {
  let factoryCalls = 0
  const App = view({
    state: () => {
      factoryCalls += 1
      return { count: State(2) }
    },
    body: ({ count }) => Text(`Count: ${count.value}`),
  })

  const html = renderToStaticMarkup(createElement(App))
  assert.match(html, /Count: 2/)
  assert.equal(factoryCalls, 1)
})

test('view state factories can initialize from React props', () => {
  const Counter = view({
    state: ({ initial }) => ({ count: State(initial) }),
    body: ({ count }, { label }) => Text(`${label}: ${count.value}`),
  })

  const html = renderToStaticMarkup(createElement(Counter, { initial: 3, label: 'Count' }))
  assert.match(html, /Count: 3/)
})
