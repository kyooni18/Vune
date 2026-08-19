import { Action, Button, State, Text, VStack, view } from '../src/index.js'

const count = State(0)
const label = State('Counter')

view(
  VStack(
    Text(label.value),
    Text(count.value),
    Button('+', Action(count.value += 1)),
  ),
)
