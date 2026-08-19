import { h, ref, type FunctionalComponent } from 'vue'
import {
  Box,
  Button,
  Capsule,
  Circle,
  Component,
  Group,
  HStack,
  Model,
  Rectangle,
  RoundedRectangle,
  ScrollView,
  Text,
  TextArea,
  TextField,
  Toggle,
  VStack,
  ZStack,
  type ComponentProps,
  type Alignment,
  type ComponentSlots,
  type ScrollAxis,
} from '../src/index.js'

const FunctionalCard: FunctionalComponent<{
  title: string
  count?: number
}> = props => h('div', null, `${props.title}:${props.count ?? 0}`)

Component(FunctionalCard, { title: 'Hello' })
Component(FunctionalCard, { title: 'Hello', count: 2 })

// @ts-expect-error count must be numeric
Component(FunctionalCard, { title: 'Hello', count: 'bad' })

// Public-instance extraction used by imported SFC / defineComponent-like types.
type SfcLike = abstract new () => {
  $props: {
    title: string
    count?: number
  }
  $slots: {
    default(props: { value: number }): unknown
    footer(): unknown
  }
}

type SfcProps = ComponentProps<SfcLike>
const sfcProps: SfcProps = { title: 'Typed' }
void sfcProps

// @ts-expect-error count remains numeric after public-instance extraction
const invalidSfcProps: SfcProps = { title: 'Typed', count: 'bad' }
void invalidSfcProps

type SfcSlots = ComponentSlots<SfcLike>
const slots: SfcSlots = {
  default: props => Text(props.value),
  footer: () => Text('Footer'),
}
void slots

const model = ref('hello')
Model(FunctionalCard, model, { title: 'Model host' })

VStack(
  Text('Normal JavaScript control flow'),
  ...[1, 2, 3].map(value => Text(value).keyed(value)),
)

const fragment = Group(Text('A'), Text('B'))
void fragment
// @ts-expect-error Group is a Fragment and intentionally has no modifier chain.
fragment.padding(8)

Box(Text('Boxed')).padding(8).background('#fff')

Button('Save', () => {}, { disabled: true, type: 'submit' })
// @ts-expect-error rows is not a button attribute
Button('Invalid', () => {}, { rows: 3 })

const nativeText = ref('')
TextField(nativeText, { type: 'email', placeholder: 'Email' })
TextArea(nativeText, { rows: 4 })
Toggle(ref(false), { disabled: true })

const scrollAxis: ScrollAxis = 'horizontal'
ScrollView(VStack(Text('One'), Text('Two')), scrollAxis).height(120)
ScrollView(HStack(Text('One'), Text('Two')), 'both')
// @ts-expect-error unsupported scroll axis
ScrollView(Text('Nope'), 'diagonal')

Rectangle().width(120).height(60).background('#eee')
RoundedRectangle(12).width(120).height(60)
Circle().width(40).height(40)
Capsule().width(80).height(28)

const semanticAlignment: Alignment = 'topTrailing'
VStack({ alignment: 'leading', spacing: 12 }, Text('A'), Text('B'))
HStack({ alignment: 'top', spacing: 8 }, Text('A'), Text('B'))
ZStack({ alignment: semanticAlignment }, Text('Back'), Text('Front'))
Text('Fill').frame({ maxWidth: 'infinity', alignment: 'leading' })
Text('Aligned').alignment('bottomTrailing')

// @ts-expect-error VStack only accepts horizontal semantic alignment
VStack({ alignment: 'top' }, Text('Invalid'))
// @ts-expect-error HStack only accepts vertical semantic alignment
HStack({ alignment: 'leading' }, Text('Invalid'))
// @ts-expect-error unsupported semantic alignment
ZStack({ alignment: 'upperRight' }, Text('Invalid'))
