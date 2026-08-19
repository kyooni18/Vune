# View API

`View()` is the normal entry point for declaring a Vune component without writing Vue render boilerplate.

## Stateless views

```ts
import { Text, View, VStack } from 'vune'

export default View(() =>
  VStack(
    Text('Hello'),
    Text('Declarative Vue without a hand-written render function.'),
  )
)
```

## Stateful views

```ts
import { ref } from 'vue'
import { Button, Text, View, VStack } from 'vune'

export default View({
  name: 'Counter',

  state: () => ({
    count: ref(0),
  }),

  body: ({ count }) =>
    VStack(
      Text(() => count.value),
      Button('+', () => count.value += 1),
    ),
})
```

`state()` executes inside Vue component setup and exactly once for each component instance. This means Vue refs, computed values, composables, and lifecycle registration can be created there while keeping `setup()` out of application-facing Vune code.

`body` becomes the Vue render body internally. It is reevaluated through Vue's normal reactivity, so getters such as `Text(() => count.value)` participate in the same dependency tracking as an ordinary Vue render function.

## Escape to Vue

`View()` is convenience, not a separate runtime. Existing components may continue to use `defineComponent()`, render functions, SFC templates, JSX, or `h()`. Vune primitives are real VNodes and interoperate with those approaches directly.
