import {
  Button,
  Binding,
  Box,
  Circle,
  Alert,
  Element,
  GeometryReader,
  Grid,
  HStack,
  Image,
  Link,
  Menu,
  NavigationLink,
  NavigationStack,
  Picker,
  ProgressView,
  RoundedRectangle,
  SafeArea,
  Sheet,
  ScrollView,
  Slider,
  Spacer,
  State,
  Text,
  TextField,
  TextArea,
  Toggle,
  VStack,
  ZStack,
  type BindingRef,
  type ViewBuilderClosure,
} from '../packages/core/src/index.js'

Text('Muse')
Text(1)
VStack(() => Text('Builder'))
VStack({ alignment: 'leading', spacing: 8 }, () => Text('Options'))
VStack(Text('A'), Text('B'))
HStack({ alignment: 'bottom', spacing: 6 }, Text('A'), Spacer(12), Text('B'))
ZStack({ alignment: 'topTrailing' }, Text('Overlay'))
ScrollView('both', () => Text('Scrollable'))
SafeArea(['top', 'left'], () => Text('Inset'))
GeometryReader(geometry => Text(geometry.size.width))
Text('Frame').frame({ minWidth: 120, maxWidth: 'infinity', height: '3rem', alignment: 'center' })
Text('Styled').foreground('CanvasText').background('Canvas').style({ borderRadius: 8, '--muse-accent': '#7c3aed' })
Button(() => undefined)
Button('Save', () => undefined)
Button(() => undefined, () => Text('Label'))
const count = State(0)
const countBinding = Binding(count)
const enabled = State(false)
const name = State('Muse')
const selection = State<'one' | 'two'>('one')
Toggle('Enabled', Binding(enabled))
TextField(Binding(name), 'Name')
TextArea(Binding(name), 'Description')
Slider(countBinding, { min: 0, max: 10, step: 1 })
Image('/muse.png', { alt: 'Muse' })
Link('Docs', () => '/docs')
Box(() => Text('Box'))
Grid({ columns: 2 }, () => [Text('A'), Text('B')])
Circle()
RoundedRectangle('1rem')
Picker(Binding(selection), [{ label: 'One', value: 'one' }, { label: 'Two', value: 'two' }])
ProgressView(countBinding, { label: 'Loading', max: 10 })
NavigationStack(() => NavigationLink('/settings', 'Settings'))
Menu('Actions', () => Button('Save', () => undefined))
Sheet(Binding(enabled), () => Text('Sheet'))
Alert(Binding(enabled), 'Notice', 'Message')
Element('button', {
  type: 'submit',
  disabled: false,
  class: 'primary',
  'aria-label': 'Save',
  'data-testid': 'save',
  onclick: event => event.currentTarget?.value,
}, 'Save')
Element('input', { type: 'checkbox', checked: true, onchange: event => event.target?.checked })
Element('img', { src: '/muse.png', alt: 'Muse', loading: 'lazy' })
Element('x-card', { value: count.value, theme: 'dark', 'aria-label': 'Card' }, Text('Custom'))
const requiresBinding = (_value: BindingRef<number>) => undefined
requiresBinding(countBinding)
count.value = 1
// @ts-expect-error State and Binding are distinct writable contracts
requiresBinding(count)
// @ts-expect-error Binding preserves its generic value type
countBinding.value = 'one'
// @ts-expect-error Toggle requires a boolean Binding
Toggle('Invalid', countBinding)
// @ts-expect-error TextField requires a string Binding
TextField(countBinding)
// @ts-expect-error Slider options are numeric
Slider(countBinding, { min: 'zero' })
// @ts-expect-error Image options reject unknown properties
Image('/muse.png', { title: 'Invalid' })
// @ts-expect-error Link href must resolve to a string
Link('Invalid', 42)
// @ts-expect-error Grid options reject unknown keys
Grid({ columnCount: 2 }, Text('Invalid'))
// @ts-expect-error Grid builders must produce Views
Grid(() => 'not a View')
// @ts-expect-error RoundedRectangle radius is a CSS length
RoundedRectangle({ radius: 8 })
// @ts-expect-error Picker options must preserve the Binding value type
Picker(Binding(selection), [{ label: 'Three', value: 'three' }])
// @ts-expect-error ProgressView options reject unknown keys
ProgressView(0.5, { title: 'Invalid' })
// @ts-expect-error presentation visibility requires a boolean Binding
Sheet(countBinding, () => Text('Invalid'))
// @ts-expect-error NavigationLink destination must be a string
NavigationLink(42, 'Invalid')
// @ts-expect-error Menu content must be a ViewBuilder
Menu('Invalid', () => 'not a View')
// @ts-expect-error button does not expose anchor-only attributes
Element('button', { href: '/invalid' })
// @ts-expect-error checkbox state is boolean
Element('input', { checked: 'yes' })
// @ts-expect-error images require accessible alt text
Element('img', { src: '/missing-alt.png' })
// @ts-expect-error event attributes require handlers
Element('button', { onclick: 'save' })
// @ts-expect-error aria values must be serializable primitives
Element('section', { 'aria-label': { text: 'Invalid' } })
// @ts-expect-error misspelled standard attributes fail before runtime
Element('button', { disabledd: true })
// @ts-expect-error unknown standard tags are not custom elements
Element('notarealtag', null)

// @ts-expect-error Text initializer accepts only string or number values
Text({ invalid: true })
// @ts-expect-error ViewBuilder closures cannot produce primitive strings
const invalidBuilder: ViewBuilderClosure = () => 'not a View'
// @ts-expect-error VStack ViewBuilder closures must produce Muse Views
VStack(() => 'not a View')
// @ts-expect-error VStack alignment is a closed layout semantic
VStack({ alignment: 'baseline' }, () => Text('Invalid'))
// @ts-expect-error HStack alignment is vertical, not horizontal
HStack({ alignment: 'leading' }, () => Text('Invalid'))
// @ts-expect-error ScrollView axis is a closed semantic
ScrollView('diagonal', () => Text('Invalid'))
// @ts-expect-error SafeArea accepts only declared edges
SafeArea('horizontal', () => Text('Invalid'))
// @ts-expect-error Spacer accepts only a CSS length
Spacer({ minLength: 12 })
// @ts-expect-error frame rejects unknown layout properties
Text('Invalid').frame({ idealWidth: 100 })
// @ts-expect-error frame alignment is a closed semantic
Text('Invalid').frame({ alignment: 'baseline' })
// @ts-expect-error foreground colors are CSS strings
Text('Invalid').foreground({ color: 'red' })
// @ts-expect-error inline CSS values must be serializable CSS primitives
Text('Invalid').style({ transform: { scale: 2 } })
// @ts-expect-error Button requires a declared action closure form
Button('Missing action')
// @ts-expect-error Button titles cannot be arbitrary objects
Button({ title: 'Invalid' }, () => undefined)

export { invalidBuilder }
