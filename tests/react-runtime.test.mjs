import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement, forwardRef, memo } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  Component,
  HStack,
  Raw,
  Spacer,
  State,
  Text,
  VStack,
  view,
} from '../dist/index.js'
import { subscribeState } from '../dist/state.js'

function Badge({ label }) {
  return createElement('strong', null, label)
}

const MemoBadge = memo(Badge)
const ForwardBadge = forwardRef(function ForwardBadge({ label }, ref) {
  return createElement('strong', { ref }, label)
})

test('renders coordinate-free stack layout', () => {
  const html = renderToStaticMarkup(
    HStack(Text('Left'), Spacer(), Text('Right')).frame({ maxWidth: 'infinity' }),
  )
  assert.match(html, /display:flex/)
  assert.match(html, /width:100%/)
  assert.match(html, /flex-grow:1/)
})

test('Spacer preserves an explicit minimum length', () => {
  const html = renderToStaticMarkup(HStack(Text('Left'), Spacer(24), Text('Right')))
  assert.match(html, /flex-grow:1/)
  assert.match(html, /flex-shrink:0/)
  assert.match(html, /flex-basis:24px/)
})

test('hosts ordinary React components without passing layout styles into them', () => {
  const html = renderToStaticMarkup(
    HStack(Component(Badge, { label: 'React' }).padding(12)),
  )
  assert.match(html, /data-rui-layout-host/)
  assert.match(html, /padding:12px/)
  assert.match(html, /<strong>React<\/strong>/)
})

test('hosts memo, forwardRef, and direct React elements as first-class layout items', () => {
  const html = renderToStaticMarkup(
    HStack(
      createElement(MemoBadge, { label: 'Memo' }),
      createElement(ForwardBadge, { label: 'Forward' }),
      Raw(createElement(Badge, { label: 'Raw' })).padding(7),
    ),
  )

  assert.equal((html.match(/data-rui-layout-host/g) ?? []).length, 3)
  assert.match(html, /<strong>Memo<\/strong>/)
  assert.match(html, /<strong>Forward<\/strong>/)
  assert.match(html, /padding:7px/)
  assert.match(html, /<strong>Raw<\/strong>/)
})

test('State subscriptions notify on changes, ignore identical values, and unsubscribe cleanly', () => {
  const count = State(0)
  let notifications = 0
  const unsubscribe = subscribeState(count, () => { notifications += 1 })

  count.value = 1
  count.value = 1
  assert.equal(notifications, 1)

  unsubscribe()
  count.value = 2
  assert.equal(notifications, 1)
})

test('State tracks array and nested plain-object mutations', () => {
  const todos = State([{ title: 'One', done: false }])
  let notifications = 0
  const unsubscribe = subscribeState(todos, () => { notifications += 1 })

  const stable = todos.value
  assert.equal(todos.value, stable)

  todos.value.push({ title: 'Two', done: false })
  const afterPush = notifications
  assert.ok(afterPush > 0)
  assert.equal(todos.value.length, 2)

  todos.value[0].done = true
  assert.ok(notifications > afterPush)
  const afterNestedChange = notifications

  todos.value[0].done = true
  assert.equal(notifications, afterNestedChange)

  delete todos.value[1].title
  assert.ok(notifications > afterNestedChange)

  const beforeSameRoot = notifications
  todos.value = stable
  assert.equal(notifications, beforeSameRoot)

  unsubscribe()
})

test('view produces a renderable React component', () => {
  const App = view(() => VStack(Text('Hello Rui')))
  const html = renderToStaticMarkup(createElement(App))
  assert.match(html, /Hello Rui/)
})

test('view passes React props into its body', () => {
  const Greeting = view(({ name }) => Text(`Hello, ${name}`))
  const html = renderToStaticMarkup(createElement(Greeting, { name: 'Rui' }))
  assert.match(html, /Hello, Rui/)
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
