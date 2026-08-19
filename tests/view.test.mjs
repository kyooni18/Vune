import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'
import { Text, View, VStack } from '../dist/index.js'

test('View hides setup/render boilerplate for stateless views', () => {
  const StaticView = View(() => VStack(Text('Hello')))
  assert.equal(typeof StaticView.setup, 'function')

  const render = StaticView.setup()
  const vnode = render()

  assert.equal(vnode.type, 'div')
  assert.equal(vnode.children[0].children, 'Hello')
})

test('View state is created once per component instance while body can rerender', () => {
  let stateCreations = 0

  const CounterView = View({
    state: () => {
      stateCreations += 1
      return { count: ref(0) }
    },
    body: ({ count }) => Text(() => count.value),
  })

  const render = CounterView.setup()
  assert.equal(stateCreations, 1)
  assert.equal(render().children, '0')
  assert.equal(render().children, '0')
  assert.equal(stateCreations, 1)
})
