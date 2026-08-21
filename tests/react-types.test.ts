import { createElement } from 'react'
import {
  Action,
  Button,
  Component,
  createViewNode,
  Grid,
  Group,
  HStack,
  Spacer,
  State,
  Text,
  VStack,
  view,
  renderViewNode,
  type MuseRenderer,
  type StyledElement,
} from '../src/index.js'

Text.viewType.name
VStack.viewType.name
Button.viewType.name
Group.viewType.name

function Badge(props: { label: string }) {
  return createElement('strong', null, props.label)
}

const count = State(0)
const custom: StyledElement = Component(Badge, { label: 'React' }).padding(8)
// @ts-expect-error required React props must be supplied to Component()
Component(Badge)
Text('Theme').style({ '--muse-accent': '#7c3aed' })
Text('Conditional').className(['card', false && 'featured'])

export const StaticView = view(
  VStack(
    Text(() => `Count: ${count.value}`),
    Button('Add', Action(count.value += 1)),
    HStack(Text('Left'), Spacer(), custom).frame({ maxWidth: 'infinity' }),
  ),
)

Grid(Text('One'), Text('Two'))
Grid(2, () => Text('Builder'))
VStack({ spacing: 8 }, () => Text('Optioned builder'))
Group(() => [Text('Grouped one'), Text('Grouped two')])

const graphRenderer: MuseRenderer<{ kind: 'node'; type: unknown; children: unknown[] }> = {
  element(type, _props, ...children) { return { kind: 'node', type, children } },
  fragment(children) { return { kind: 'node', type: 'fragment', children: [...children] } },
  render(value) { return renderViewNode(value, graphRenderer) },
}
renderViewNode(createViewNode(Text, ['typed graph']), graphRenderer)

export const ScopedView = view({
  state: () => ({ count: State(0) }),
  body: ({ count }) => VStack(
    Text(count),
    Button('Add', () => { count.value += 1 }),
  ),
})

export const GreetingView = view((props: { name: string }) =>
  Text(`Hello, ${props.name}`),
)

createElement(GreetingView, { name: 'Muse' })
// @ts-expect-error name is required
createElement(GreetingView, {})

type CounterProps = { initial: number; label: string }

export const PropScopedView = view({
  state: (props: CounterProps) => ({ count: State(props.initial) }),
  body: ({ count }, props) => Text(`${props.label}: ${count.value}`),
})

createElement(PropScopedView, { initial: 3, label: 'Count' })
// @ts-expect-error initial is required
createElement(PropScopedView, { label: 'Count' })
