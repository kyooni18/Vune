import test from 'node:test'
import assert from 'node:assert/strict'
import { Comment, Teleport, ref } from 'vue'
import {
  Alert,
  Image,
  Label,
  LazyGrid,
  LazyHStack,
  LazyVStack,
  Link,
  List,
  Menu,
  Picker,
  ProgressView,
  Section,
  Sheet,
  Slider,
  Stepper,
  Text,
} from '../dist/index.js'

function styleOf(vnode) {
  const style = vnode.props?.style
  if (!Array.isArray(style)) return style ?? {}
  return Object.assign({}, ...style.flat(Infinity).filter(Boolean))
}

function invoke(handler, event = {}) {
  const handlers = Array.isArray(handler) ? handler : [handler]
  for (const item of handlers.flat(Infinity)) item(event)
}

test('Image, Label and Link stay ordinary styled native VNodes', () => {
  const image = Image('/avatar.png', { alt: 'Avatar', fit: 'cover', loading: 'lazy' })
  assert.equal(image.type, 'img')
  assert.equal(image.props.src, '/avatar.png')
  assert.equal(image.props.alt, 'Avatar')
  assert.equal(image.props.loading, 'lazy')
  assert.equal(styleOf(image).objectFit, 'cover')

  const label = Label('Profile', Text('●'), { spacing: 4 })
  assert.equal(label.type, 'div')
  assert.equal(styleOf(label).display, 'flex')
  assert.equal(styleOf(label).gap, '4px')

  const link = Link('Open', '/settings', { target: '_self' })
  assert.equal(link.type, 'a')
  assert.equal(link.props.href, '/settings')
  assert.equal(link.children, 'Open')
})

test('ProgressView supports determinate and indeterminate progress', () => {
  const determinate = ProgressView(0.5, { max: 1 })
  assert.equal(determinate.type, 'progress')
  assert.equal(determinate.props.value, 0.5)
  assert.equal(determinate.props.max, 1)

  const indeterminate = ProgressView()
  assert.equal(indeterminate.type, 'progress')
  assert.equal(indeterminate.props.value, undefined)
})

test('Picker preserves typed values while using native select values', () => {
  const selection = ref(2)
  const picker = Picker(selection, [
    { label: 'One', value: 1 },
    { label: 'Two', value: 2 },
    { label: 'Three', value: 3 },
  ])

  assert.equal(picker.type, 'select')
  assert.equal(picker.props.value, '2')
  invoke(picker.props.onChange, { target: { value: '3' } })
  assert.equal(selection.value, 3)
})

test('Slider and Stepper update refs with native-style controls', () => {
  const sliderValue = ref(4)
  const slider = Slider(sliderValue, { min: 0, max: 10, step: 2 })
  assert.equal(slider.props.type, 'range')
  assert.equal(slider.props.min, 0)
  assert.equal(slider.props.max, 10)
  invoke(slider.props.onInput, { target: { value: '8' } })
  assert.equal(sliderValue.value, 8)

  const stepperValue = ref(1)
  const stepper = Stepper(stepperValue, { min: 0, max: 2, step: 1 })
  const decrement = stepper.children[0]
  const increment = stepper.children[2]
  invoke(increment.props.onClick, {})
  invoke(increment.props.onClick, {})
  assert.equal(stepperValue.value, 2)
  invoke(decrement.props.onClick, {})
  assert.equal(stepperValue.value, 1)
})

test('List and Section create semantic collection structure', () => {
  const section = Section('General', Text('A'), Text('B'))
  assert.equal(section.type, 'section')

  const list = List({ spacing: 6, inset: 8 }, section, Text('C'))
  assert.equal(list.props.role, 'list')
  assert.equal(list.children.length, 2)
  assert.equal(list.children[0].props.role, 'listitem')
  assert.equal(styleOf(list).gap, '6px')
  assert.equal(styleOf(list.children[0]).padding, '8px')
})

test('Lazy containers add browser-native content visibility without changing stack identity', () => {
  const column = LazyVStack({ estimatedItemSize: 60 }, Text('A'), Text('B'))
  assert.equal(styleOf(column).display, 'flex')
  assert.equal(styleOf(column.children[0]).contentVisibility, 'auto')
  assert.equal(styleOf(column.children[0]).containIntrinsicSize, 'auto 60px')

  const row = LazyHStack(Text('A'), Text('B'))
  assert.equal(styleOf(row).flexDirection, 'row')
  assert.equal(styleOf(row.children[0]).contentVisibility, 'auto')

  const grid = LazyGrid(2, Text('A'), Text('B'))
  assert.equal(styleOf(grid).display, 'grid')
  assert.equal(styleOf(grid.children[0]).contentVisibility, 'auto')
})

test('Sheet and Alert are declarative Teleport-based presentation primitives', () => {
  const visible = ref(false)
  assert.equal(Sheet(visible, Text('Hidden')).type, Comment)

  visible.value = true
  const sheet = Sheet(visible, Text('Shown'))
  assert.equal(sheet.type, Teleport)
  assert.equal(sheet.props.to, 'body')

  const alert = Alert(visible, { title: 'Delete?', message: 'This cannot be undone.' })
  assert.equal(alert.type, Teleport)
})

test('Menu uses native details/summary behavior', () => {
  const menu = Menu('Actions', Text('Edit'), Text('Delete'))
  assert.equal(menu.type, 'details')
  assert.equal(menu.children[0].type, 'summary')
  assert.equal(menu.children[1].props.role, 'menu')
})
