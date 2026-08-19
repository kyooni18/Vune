# View API

Vune has two view entry points. Macro-first projects normally use lowercase `view(...)`; projects that do not want a build transform can use `View(...)` directly.

## Macro-first view

After adding `vuneMacro()` to Vite, normal source can avoid `setup()`, `render()`, and arrow wrappers:

```ts
import { Action, Button, State, Text, VStack, view } from 'vune'

const count = State(0)

export default view(
  VStack(
    Text(`Count: ${count.value}`),
    Button('+', Action(count.value += 1)),
  )
)
```

`State()` is relocated into per-instance component state, `view(...)` becomes the reactive view body, and `Action(...)` becomes an event callback at build time.

## Manual fallback

The underlying runtime API remains public:

```ts
import { ref } from 'vue'
import { Button, Text, View, VStack } from 'vune'

export default View({
  state: () => ({ count: ref(0) }),
  body: ({ count }) =>
    VStack(
      Text(() => count.value),
      Button('+', () => count.value += 1),
    ),
})
```

`View()` is useful outside Vite, when writing library internals, or whenever explicit functions are preferable.

Both forms still use Vue's renderer, reactivity, components, composables, and VNodes. The macro is syntax sugar, not a second runtime.
