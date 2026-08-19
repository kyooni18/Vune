import { ref } from 'vue'
import { Button, Text, View, VStack } from '../src/index.js'

View(() => Text('Static'))

View({
  name: 'Counter',
  state: () => ({ count: ref(0) }),
  body: ({ count }) => VStack(
    Text(() => count.value),
    Button('+', () => count.value += 1),
  ),
})

View({
  state: () => ({ count: ref(0) }),
  body: state => {
    // @ts-expect-error missing is not part of the inferred state shape
    state.missing
    return Text('Typed state')
  },
})
