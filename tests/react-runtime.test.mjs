import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  Component,
  HStack,
  Spacer,
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
