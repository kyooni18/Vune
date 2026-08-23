# Migrating to canonical Vune

Vune now separates the renderer-independent graph from its runtime adapters.
New code should define Views with `vune-ui`, then choose `@vune-ui/react`,
`@vune-ui/vue`, or `@vune-ui/web` at the application boundary. The root
`vune-ui` package remains available only as a compatibility layer.

## Dependencies

For a React application:

```bash
pnpm add vune-ui @vune-ui/react @vune-ui/vite react react-dom
pnpm add -D @vitejs/plugin-react
```

For a Vue application:

```bash
pnpm add vune-ui @vune-ui/vue @vune-ui/vite vue
pnpm add -D @vitejs/plugin-vue
```

For direct HTML/DOM materialization:

```bash
pnpm add vune-ui @vune-ui/web @vune-ui/vite
```

## Vite

The canonical compiler handles `.vune.ts` syntax. Keep it before the host
framework plugin and keep the host's normal CSS pipeline unchanged:

```ts
import { defineConfig } from 'vite'
import { vunePlugin } from '@vune-ui/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({ plugins: [vunePlugin(), react()] })
```

Vue applications use the same Vune plugin with `@vitejs/plugin-vue`:

```ts
export default defineConfig({ plugins: [vunePlugin(), vue()] })
```

The plugin also handles Vue virtual script-module IDs such as
`?vue&type=script&setup=true&lang.ts`. When it receives a complete `.vue` SFC,
it lowers only JavaScript/TypeScript `<script>` blocks and leaves the Vue
`<template>` and stylesheet blocks for Vue and Vite.

`import './style.css'`, CSS Modules, Sass, PostCSS, and Tailwind remain host
Vite features; the Vune compiler preserves those imports for the host pipeline.

## Imports and View construction

Before:

```ts
import { VStack, Text, view } from 'vune-ui'
```

After:

```ts
import { State, Text, VStack } from 'vune-ui'
import { view } from '@vune-ui/react'
```

The graph is created before a renderer is selected. Built-in Views and custom
`struct ...: View` declarations share the same initializer metadata:

```ts
struct Card<Content: View>: View {
  let content: Content

  init(@ViewBuilder content: () => Content) {
    self.content = content()
  }

  var body: some View {
    VStack() { content }
  }
}
```

Trailing builders, labels, `@Action`, defaults, `@State`, `@Binding`, raw HTML,
and `ForEach` are lowered by `@vune-ui/vite` without a component-name allow-list.

## State and explicit interop

State belongs to Vune, not to a renderer hook:

```ts
import { Action, Button, State } from 'vune-ui'
import { view } from '@vune-ui/react'

const Counter = view({
  state: () => ({ count: State(0) }),
  body: ({ count }) => Button(
    `Count: ${count.value}`,
    Action(() => { count.value += 1 }),
  ),
})
```

Vue bridges are explicit. Use `toVueRef(state)` when a Vue `Ref` is required,
and `fromVueRef(ref)` when a Vune `Binding` is required. Use `Component()` for
Vue components inside a Vune graph and `VuneView` or `createVueView()` for a
Vune graph inside a Vue SFC. Props, events, keys, refs, and default/named slots
stay at the Vue boundary.

## Compatibility macro

Existing applications may continue using `vune-ui/vite` and its
`vuneMacro()` transform. It is intentionally separate from `@vune-ui/vite`: the
compatibility macro provides React-oriented `State` hoisting and legacy JSX
behavior, while the canonical plugin lowers renderer-independent Vune syntax.

Migrate incrementally by moving graph imports to `vune-ui`, replacing the macro
with `vunePlugin()`, and selecting the renderer explicitly. Keep legacy JSX and
root imports only in files that still require compatibility behavior.
