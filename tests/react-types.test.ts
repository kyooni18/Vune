import { createElement } from 'react'
import {
  Action,
  Button,
  Component,
  HStack,
  Image,
  List,
  Picker,
  Spacer,
  State,
  Text,
  VStack,
  view,
  type StyledElement,
} from '../src/index.js'

function Badge(props: { label: string }) {
  return createElement('strong', null, props.label)
}

const count = State(0)
const choice = State<'a' | 'b'>('a')
const custom: StyledElement = Component(Badge, { label: 'React' }).padding(8)

const screen = VStack(
  Text(() => `Count: ${count.value}`),
  Button('Add', Action(() => { count.value += 1 })),
  HStack(Text('Left'), Spacer(), custom).frame({ maxWidth: 'infinity' }),
  Image('/logo.svg', { alt: 'Logo', fit: 'contain' }),
  Picker(choice, [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }]),
  List(Text('One'), Text('Two')),
)

export default view(() => screen)
