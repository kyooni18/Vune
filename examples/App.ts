import {
  Action,
  Button,
  HStack,
  Spacer,
  State,
  Text,
  VStack,
  view,
} from '../src/index.js'

const count = State(0)

export default view(() =>
  VStack(
    { spacing: 16, alignment: 'leading' },
    Text('Hello, Vune').fontSize(28).bold(),
    Text(() => `Count: ${count.value}`),
    Button('Increase', Action(count.value += 1)),
    HStack(
      Text('Left'),
      Spacer(),
      Text('Right'),
    ).frame({ maxWidth: 'infinity' }),
  )
  .padding(24)
  .frame({ maxWidth: 'infinity' })
)
