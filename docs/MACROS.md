# Vune macros

Vune's optional Vite macro removes the function wrappers that Vue render code normally needs. The authored source remains valid TypeScript, while the plugin expands the macro forms before the Vue plugin runs.

## Setup

```ts
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { vuneMacro } from 'vune/vite'

export default defineConfig({
  plugins: [
    vuneMacro(),
    vue(),
  ],
})
```

`vuneMacro()` must appear before `vue()`.

## Arrow-free view source

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

The macro rewrites this into the existing `View()` model. `State()` declarations become per-component-instance state, `view(...)` becomes a reactive render body, and `Action(expression)` becomes a callback so the expression is not evaluated during rendering.

## Scope

The macro only owns Vune's reserved macro forms: top-level `State(...)` declarations associated with the default exported `view(...)`, `view(...)` itself, and `Action(...)` expressions inside that view body. It does not rewrite arbitrary JavaScript lambdas, functions, or third-party APIs.

This keeps the transform small and predictable. Ordinary JavaScript and Vue remain available whenever a screen needs something outside the macro vocabulary.

## Without the macro

`View()` remains available as the no-transform fallback. Calling expression-style `view(...)` or `Action(...)` without `vuneMacro()` produces a clear runtime error rather than silently changing semantics.
