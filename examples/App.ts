import {
  Button,
  HStack,
  ProgressView,
  Slider,
  Spacer,
  State,
  Text,
  TextField,
  Toggle,
  VStack,
  view,
} from '../src/index.js'

const text = State('Muse')
const value = State(60)
const checked = State(true)
const codeSample = `const count = State(0)

VStack(
  Text('Hello, Muse'),
  Button('Count: ' + count.value, ...),
)`

function ComponentRow(label: string, content: any) {
  return HStack(
    { spacing: 12 },
    Text(label).className('object-name'),
    Spacer(),
    content,
  ).className('object-row')
}

export default view(() => VStack(
  { alignment: 'leading', spacing: 24 },
  Text('DEMO').className('demo-title'),
  Text('SwiftUI-like declarative UI for React.').className('demo-description'),
  Text(codeSample).className('code-sample'),
  VStack(
    { alignment: 'leading', spacing: 10 },
    Text('TextField').className('field-label'),
    TextField(text, {
      placeholder: 'Type here',
      'aria-label': 'Demo text field',
    }).className('demo-input'),
  ),
  VStack(
    { alignment: 'leading', spacing: 10 },
    HStack(
      { spacing: 12 },
      Text('Slider').className('field-label'),
      Spacer(),
      Text(() => String(value.value)).className('field-value'),
    ),
    Slider(value, {
      min: 0,
      max: 100,
      step: 1,
      'aria-label': 'Demo slider',
    }).className('demo-slider'),
  ),
  HStack(
    { spacing: 12 },
    Text('Checkbox').className('field-label').grow(),
    Toggle(checked, { 'aria-label': 'Demo checkbox' }),
  ),
  VStack(
    { alignment: 'leading', spacing: 10 },
    Text('Components').className('section-label'),
    ComponentRow('Text', Text('Hello, Muse').className('object-preview')),
    ComponentRow('Button', Button('Button', () => {}).className('demo-button')),
    ComponentRow('ProgressView', ProgressView(0.7, { max: 1, 'aria-label': 'Demo progress' }).className('object-progress')),
    ComponentRow('Toggle', Toggle(checked, { 'aria-label': 'Component toggle' })),
  ).className('component-list'),
).className('demo-page'))
