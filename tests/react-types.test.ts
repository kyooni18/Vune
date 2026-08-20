import { createElement } from 'react'
import {
  Action,
  Button,
  Component,
  HStack,
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
const custom: StyledElement = Component(Badge, { label: 'React' }).padding(8)

export const StaticView = view(
  VStack(
    Text(() => `Count: ${count.value}`),
    Button('Add', Action(count.value += 1)),
    HStack(Text('Left'), Spacer(), custom).frame({ maxWidth: 'infinity' }),
  ),
)

export const ScopedView = view({
  state: () => ({ count: State(0) }),
  body: ({ count }) => VStack(
    Text(count),
    Button('Add', () => { count.value += 1 }),
  ),
})
