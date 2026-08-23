# Migrating to canonical Muse

Muse now separates the renderer-independent graph from its runtime adapters.
New code should define Views with `muse`, then choose `@muse/react`,
`@muse/vue`, or `@muse/web` at the application boundary. The root
`vune-ui` package remains available only as a compatibility layer.

## Dependencies

For a React application:

```bash
pnpm add muse @muse/react @muse/vite react react-dom
pnpm add -D @vitejs/plugin-react
```

For a Vue application:

```bash
pnpm add muse @muse/vue @muse/vite vue
pnpm add -D @vitejs/plugin-vue
```

For direct HTML/DOM materialization:

```bash
pnpm add muse @muse/web @muse/vite
```

## Vite

The canonical compiler handles `.muse.ts` syntax. Keep it before the host
framework plugin and keep the host's normal CSS pipeline unchanged:

```ts
import { defineConfig } from 'vite'
import { musePlugin } from '@muse/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({ plugins: [musePlugin(), react()] })
```

Vue applications use the same Muse plugin with `@vitejs/plugin-vue`:

```ts
export default defineConfig({ plugins: [musePlugin(), vue()] })
```

The plugin also handles Vue virtual script-module IDs such as
`?vue&type=script&setup=true&lang.ts`. When it receives a complete `.vue` SFC,
it lowers only JavaScript/TypeScript `<script>` blocks and leaves the Vue
`<template>` and stylesheet blocks for Vue and Vite.

`import './style.css'`, CSS Modules, Sass, PostCSS, and Tailwind remain host
Vite features; the Muse compiler preserves those imports for the host pipeline.

## Imports and View construction

Before:

```ts
import { VStack, Text, view } from 'vune-ui'
```

After:

```ts
import { State, Text, VStack } from 'muse'
import { view } from '@muse/react'
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
and `ForEach` are lowered by `@muse/vite` without a component-name allow-list.

## State and explicit interop

State belongs to Muse, not to a renderer hook:

```ts
import { Action, Button, State } from 'muse'
import { view } from '@muse/react'

const Counter = view({
  state: () => ({ count: State(0) }),
  body: ({ count }) => Button(
    `Count: ${count.value}`,
    Action(() => { count.value += 1 }),
  ),
})
```

Vue bridges are explicit. Use `toVueRef(state)` when a Vue `Ref` is required,
and `fromVueRef(ref)` when a Muse `Binding` is required. Use `Component()` for
Vue components inside a Muse graph and `MuseView` or `createVueView()` for a
Muse graph inside a Vue SFC. Props, events, keys, refs, and default/named slots
stay at the Vue boundary.

## Compatibility macro

Existing applications may continue using `vune-ui/vite` and its
`museMacro()` transform. It is intentionally separate from `@muse/vite`: the
compatibility macro provides React-oriented `State` hoisting and legacy JSX
behavior, while the canonical plugin lowers renderer-independent Muse syntax.

Migrate incrementally by moving graph imports to `muse`, replacing the macro
with `musePlugin()`, and selecting the renderer explicitly. Keep legacy JSX and
root imports only in files that still require compatibility behavior.
