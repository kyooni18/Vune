import test from 'node:test'
import assert from 'node:assert/strict'
import { Fragment, h, ref } from 'vue'
import {
  Box,
  Button,
  Capsule,
  Circle,
  Component,
  Grid,
  Group,
  HStack,
  Key,
  Raw,
  Rectangle,
  RoundedRectangle,
  ScrollView,
  TemplateRef,
  Text,
  TextArea,
  TextField,
  Toggle,
  VStack,
  ZStack,
  styled,
} from '../dist/index.js'

function invoke(handler, event) {
  const handlers = Array.isArray(handler) ? handler : [handler]
  for (const item of handlers.flat(Infinity)) item(event)
}

function styleOf(vnode) {
  function flattenStyle(style) {
    if (!Array.isArray(style)) return style ?? {}
    return Object.assign({}, ...style.flatMap(item => [flattenStyle(item)]))
  }
  return flattenStyle(vnode.props?.style)
}

test('styled() is idempotent for an already styled VNode', () => {
  const node = Text('Hello')
  assert.equal(styled(node), node)
  assert.equal(Raw(node), node)
})

test('primitives are real Vue VNodes', () => {
  const text = Text('Hello')
  assert.equal(text.__v_isVNode, true)
  assert.equal(text.type, 'span')
  assert.equal(text.children, 'Hello')

  const root = h('main', null, [text])
  assert.equal(root.children[0], text)
})

test('modifier chaining clones instead of mutating the original VNode', () => {
  const base = Text('Hello')
  const styled = base.padding(8).foreground('red').radius(6)

  assert.notEqual(styled, base)
  assert.equal(base.props?.style, undefined)
  assert.equal(styleOf(styled).padding, '8px')
  assert.equal(styleOf(styled).color, 'red')
  assert.equal(styleOf(styled).borderRadius, '6px')
})

test('key and template ref helpers do not shadow VNode fields', () => {
  const base = Text('Hello')
  assert.equal(base.key, null)
  assert.equal(base.ref, null)
  assert.equal(base.transition, undefined)

  const keyed = base.keyed('row-1')
  assert.equal(keyed.key, 'row-1')
  assert.equal(typeof keyed.keyed, 'function')

  const transitioned = base.cssTransition('opacity 100ms ease')
  assert.equal(styleOf(transitioned).transition, 'opacity 100ms ease')
  assert.equal(transitioned.transition, undefined)

  const viaFunction = Key('row-2', Text('World'))
  assert.equal(viaFunction.key, 'row-2')

  const refTarget = ref(null)
  const referenced = TemplateRef(refTarget, Text('Ref'))
  assert.ok(referenced.ref)
})

test('model modifier maps modelValue and update:modelValue', () => {
  const value = ref('first')
  const Demo = { name: 'Demo' }
  const node = Component(Demo).model(value)

  assert.equal(node.props.modelValue, 'first')
  node.props['onUpdate:modelValue']('second')
  assert.equal(value.value, 'second')
})

test('named model and transforms work', () => {
  const count = ref(2)
  const Demo = { name: 'Demo' }
  const node = Component(Demo).model(count, {
    name: 'count',
    transformIn: value => String(value),
    transformOut: value => Number(value),
  })

  assert.equal(node.props.count, '2')
  node.props['onUpdate:count']('7')
  assert.equal(count.value, 7)
})

test('ordinary Vue VNodes and styled nodes can be mixed freely', () => {
  const normal = h('em', null, 'normal')
  const root = VStack(
    Text('DSL'),
    normal,
    Raw(h('strong', null, 'raw')).margin('left', 4),
  )

  assert.equal(root.type, 'div')
  assert.equal(root.children[1], normal)
  assert.equal(root.children[2].type, 'strong')
})

test('layout primitives create predictable CSS structures', () => {
  const row = HStack(Text('A'), Text('B')).gap(10)
  assert.equal(styleOf(row).display, 'flex')
  assert.equal(styleOf(row).flexDirection, 'row')
  assert.equal(styleOf(row).gap, '10px')

  const grid = Grid(3, Text('A'), Text('B'))
  assert.equal(styleOf(grid).display, 'grid')
  assert.equal(styleOf(grid).gridTemplateColumns, 'repeat(3, minmax(0, 1fr))')

  const z = ZStack(
    Text('Back').keyed('back'),
    Text('Front').keyed('front'),
  )
  assert.equal(styleOf(z).display, 'grid')
  assert.equal(z.children.length, 2)
  assert.equal(z.children[0].key, 'back')
  assert.equal(z.children[1].key, 'front')
})

test('semantic stack alignment and spacing avoid coordinate-style layout', () => {
  const column = VStack(
    { alignment: 'leading', spacing: 12 },
    Text('Title'),
    Text('Body'),
  )
  assert.equal(styleOf(column).alignItems, 'flex-start')
  assert.equal(styleOf(column).gap, '12px')

  const row = HStack(
    { alignment: 'top', spacing: 8 },
    Text('A'),
    Text('B'),
  )
  assert.equal(styleOf(row).alignItems, 'flex-start')
  assert.equal(styleOf(row).gap, '8px')

  const overlay = ZStack(
    { alignment: 'bottomTrailing' },
    Text('Back'),
    Text('Badge'),
  )
  assert.equal(styleOf(overlay).justifyItems, 'end')
  assert.equal(styleOf(overlay).alignItems, 'end')
})

test('frame infinity and semantic alignment expand without explicit coordinates', () => {
  const title = Text('Hello').frame({
    maxWidth: 'infinity',
    alignment: 'leading',
  })

  assert.equal(styleOf(title).width, '100%')
  assert.equal(styleOf(title).maxWidth, '100%')
  assert.equal(styleOf(title).display, 'flex')
  assert.equal(styleOf(title).justifyContent, 'flex-start')
  assert.equal(styleOf(title).alignItems, 'center')

  const column = VStack(Text('A'), Text('B')).alignment('topTrailing')
  assert.equal(styleOf(column).alignItems, 'flex-end')
  assert.equal(styleOf(column).justifyContent, 'flex-start')
})

test('ScrollView maps axes directly to native overflow behavior', () => {
  const vertical = ScrollView(VStack(Text('A'), Text('B'))).height(120)
  assert.equal(vertical.type, 'div')
  assert.equal(styleOf(vertical).overflowX, 'hidden')
  assert.equal(styleOf(vertical).overflowY, 'auto')
  assert.equal(styleOf(vertical).height, '120px')

  const horizontal = ScrollView(HStack(Text('A'), Text('B')), 'horizontal')
  assert.equal(styleOf(horizontal).overflowX, 'auto')
  assert.equal(styleOf(horizontal).overflowY, 'hidden')

  const both = ScrollView(Grid(2, Text('A'), Text('B')), 'both')
  assert.equal(styleOf(both).overflowX, 'auto')
  assert.equal(styleOf(both).overflowY, 'auto')
})

test('shape primitives stay ordinary CSS boxes', () => {
  const rectangle = Rectangle().width(40).height(20)
  assert.equal(rectangle.type, 'div')
  assert.equal(styleOf(rectangle).width, '40px')
  assert.equal(styleOf(rectangle).height, '20px')
  assert.equal(styleOf(rectangle).borderRadius, undefined)

  assert.equal(styleOf(RoundedRectangle(12)).borderRadius, '12px')
  assert.equal(styleOf(Circle()).borderRadius, '50%')
  assert.equal(styleOf(Capsule()).borderRadius, '9999px')
})

test('Group stays fragment-only while Box creates an explicit styling boundary', () => {
  const group = Group(Text('A'), Text('B'))
  assert.equal(group.type, Fragment)
  assert.equal(group.padding, undefined)

  const box = Box(Text('A'), Text('B')).padding(12)
  assert.equal(box.type, 'div')
  assert.equal(styleOf(box).padding, '12px')
})

test('native bound controls use Vue listener merging and preserve controlled props', () => {
  const text = ref('old')
  const textCalls = []
  const field = TextField(text, {
    value: 'ignored',
    onInput: [
      () => textCalls.push('first'),
      () => textCalls.push('second'),
    ],
  })
  assert.equal(field.props.value, 'old')
  invoke(field.props.onInput, { target: { value: 'new' } })
  assert.equal(text.value, 'new')
  assert.deepEqual(textCalls, ['first', 'second'])

  const description = ref('before')
  const areaCalls = []
  const area = TextArea(description, {
    value: 'ignored',
    onInput: [
      () => areaCalls.push('first'),
      () => areaCalls.push('second'),
    ],
  })
  assert.equal(area.props.value, 'before')
  invoke(area.props.onInput, { target: { value: 'after' } })
  assert.equal(description.value, 'after')
  assert.deepEqual(areaCalls, ['first', 'second'])

  const enabled = ref(false)
  const toggleCalls = []
  const toggle = Toggle(enabled, {
    type: 'text',
    checked: true,
    onChange: [
      () => toggleCalls.push('first'),
      () => toggleCalls.push('second'),
    ],
  })
  assert.equal(toggle.props.type, 'checkbox')
  assert.equal(toggle.props.checked, false)
  invoke(toggle.props.onChange, { target: { checked: true } })
  assert.equal(enabled.value, true)
  assert.deepEqual(toggleCalls, ['first', 'second'])
})

test('Button keeps type=button while merging a user click listener', () => {
  const calls = []
  const button = Button(
    'Run',
    () => calls.push('action'),
    {
      type: 'submit',
      onClick: () => calls.push('user'),
    },
  )

  assert.equal(button.props.type, 'button')
  invoke(button.props.onClick, new Event('click'))
  assert.deepEqual(calls, ['user', 'action'])
})

test('model listeners merge with existing Vue listeners', () => {
  const value = ref('a')
  const seen = []
  const node = Component(
    { name: 'Demo' },
    { 'onUpdate:modelValue': next => seen.push(next) },
  ).model(value)

  const handlers = Array.isArray(node.props['onUpdate:modelValue'])
    ? node.props['onUpdate:modelValue']
    : [node.props['onUpdate:modelValue']]

  for (const handler of handlers) handler('b')
  assert.deepEqual(seen, ['b'])
  assert.equal(value.value, 'b')
})
