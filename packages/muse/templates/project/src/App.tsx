import { Button, State, Text, VStack } from 'muse'
import { view } from '@muse/react'
import './App.css'

export default view({
  state: () => ({ count: State(0) }),
  body: ({ count }) => VStack(
    { alignment: 'leading', spacing: 18 },
    Text('Hello, Muse').className('title'),
    Text('Your first canonical Muse project is ready.').className('description'),
    Text(`Count: ${count.value}`).className('count'),
    Button('Increase', () => { count.value += 1 }).className('button'),
  ).className('card'),
})
