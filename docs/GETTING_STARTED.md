# Getting started with Muse

Muse is a renderer-independent, SwiftUI-like declarative UI graph for
TypeScript. `muse` defines Views, state, builders, modifiers, and raw HTML;
`@muse/react` materializes the graph in React. The same graph can also be
rendered by `@muse/vue` or `@muse/web`.

## Requirements

- Node.js `20.19` or newer
- React `18` or `19`
- TypeScript when writing `.ts` or `.tsx` source

## Install Muse

In an existing React application:

```bash
pnpm add muse @muse/react @muse/vite react react-dom
pnpm add -D @vitejs/plugin-react
```

When working from a local Muse checkout:

```bash
pnpm add ../Muse/packages/muse ../Muse/packages/react ../Muse/packages/vite
pnpm add react react-dom
pnpm add -D @vitejs/plugin-react
```

## Install the starter demo (compatibility CLI)

The repository's `muse init` command is retained for the legacy React starter.
It writes the starter files and configures the compatibility macro; it is not
required by the canonical package workflow.

```bash
pnpm exec muse init --force
```

The command replaces `src/App.tsx` and the two starter style files, then adds
`museMacro()` before the React plugin in `vite.config.ts`. The `--force` flag is
required when those files already exist.

## Configure Vite

The canonical compiler handles `.muse.ts` files and must run before the React
plugin:

```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { musePlugin } from '@muse/vite'

export default defineConfig({
  plugins: [
    musePlugin(),
    react(),
  ],
})
```

The plugin is a build-time syntax transform. It does not replace React or
introduce a second renderer.

For Vue, install `@vitejs/plugin-vue` and keep the same `musePlugin()` before
it. The adapter lowers Muse syntax in `.vue` script blocks and Vue virtual
script modules while leaving `<template>` and stylesheet modules to Vue/Vite:

```ts
import vue from '@vitejs/plugin-vue'
import { musePlugin } from '@muse/vite'

export default defineConfig({ plugins: [musePlugin(), vue()] })
```

If a compatibility JSX entry is needed, configure it explicitly. Canonical
Muse source does not require JSX:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@muse/react/legacy"
  }
}
```

This enables legacy intrinsic JSX such as `<div padding={12} />`. Function DSL
and canonical `.muse.ts` source use the same graph modifier pipeline.

## Create the React entry point

Muse views are React components, so mount them with the normal React DOM API:

```ts
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('app')!).render(createElement(App))
```

## Build a stateful screen

The following screen uses a `State` value, a coordinate-free layout, and an
event action:

```ts
import { Action, Button, State, Text, VStack } from 'muse'
import { view } from '@muse/react'

export default view({
  state: () => ({ count: State(0) }),
  body: ({ count }) => VStack(
    { alignment: 'leading', spacing: 12 },
    Text(`Count: ${count.value}`).fontSize(24).bold(),
    Button('Increase', Action(() => { count.value += 1 })),
  ).padding(24),
})
```

`state` is a per-mounted-view factory, so each mounted copy owns its `count`.
`Action(() => save())` is evaluated when the event runs. The compiler preserves
source ranges for diagnostics and source maps.

## Use mutable collections

Arrays and plain objects in `State()` are mutation-aware, including nested
objects:

```ts
type Todo = { title: string; done: boolean }

const todos = State<Todo[]>([
  { title: 'Read the docs', done: false },
])

Button('Add', () => {
  todos.value.push({ title: 'Build a screen', done: false })
})

Button('Complete', () => {
  todos.value[0].done = true
})
```

For special values such as `Map`, `Set`, class instances, frozen values, and
React elements, replace the root value instead of mutating it in place.

## Compose layouts and controls

Muse layouts accept React nodes, Muse elements, and ordinary React components in
the same tree:

```ts
import { createElement } from 'react'
import { HStack, Spacer, Text, VStack } from 'muse'
import { Component } from '@muse/react'

function ProfileCard({ name }: { name: string }) {
  return createElement('strong', null, name)
}

VStack(
  Text('Account'),
  HStack(
    Text('Profile'),
    Spacer(),
    Component(ProfileCard, { name: 'Muse' }).padding(12),
  ),
)
```

Common controls include:

```ts
TextField(name)
TextArea(description)
Toggle(enabled)
Picker(selection, options)
Slider(volume, { min: 0, max: 1 })
Stepper(quantity, { min: 0, max: 10 })
```

`TextField`, `TextArea`, `Toggle`, `Picker`, `Slider`, and `Stepper` update the
provided `StateRef` directly and re-render views that read that state.

When two State containers wrap the same raw array or plain object, they share
mutation ownership and both containers' subscribers are notified. Proxy
identity is not a public contract; replace the State root for frozen values,
class instances, `Map`, `Set`, or React elements.

The root `react-muse-ui` import and `react-muse-ui/vite` macro remain available
only for compatibility with older applications. New code should use `muse`,
`@muse/react`, and `@muse/vite`.

## Styling

Use modifiers for common layout and appearance rules:

```ts
Text('Card')
  .fontSize(20)
  .bold()
  .padding(16)
  .background('#111827')
  .foreground('#f9fafb')
  .style({ borderRadius: 12 })
```

Use `.style()` for an inline CSS escape hatch and `.className()` for external
CSS, responsive rules, pseudo-classes, and animations. See [STYLING.md](./STYLING.md)
for the complete styling guide.

## Navigation and presentation

`NavigationStack` is router-agnostic. Pass an object with `push(destination)`
and use `NavigationLink` inside it. `Sheet` and `Alert` use React portals and
are safe to render during SSR when no `document` exists.

```ts
NavigationStack(
  router,
  NavigationLink('/settings', 'Settings'),
)

Sheet(showingDetails, detailsView)
Alert(showingAlert, { title: 'Delete item?' })
```

On the client, `Sheet` handles Escape, initial focus, focus wrapping, and focus
restoration. `Alert` exposes one `alertdialog` host, and `Menu` provides
keyboard navigation with `menuitem` children.

## Run the Muse example

The repository includes a small React component demo in `examples/App.ts` and a
canonical Vue SFC bridge in `examples/VueCounter.vue`. Both use the same Muse
graph primitives at their renderer boundary.

From the repository root:

```bash
pnpm install
pnpm run dev
```

Open the local URL printed by Vite and try adding a task, completing it,
changing filters, opening Settings, and clearing completed tasks.

## Verify a Muse project

For the Muse repository itself:

```bash
pnpm test
pnpm run demo:build
pnpm run test:browser
pnpm run benchmark:modifiers
pnpm run benchmark:performance:ci
```

`pnpm test` checks the TypeScript build, public type usage, runtime rendering,
macro transforms, controls, presentation, and State behavior.
`benchmark:modifiers` compares raw React styles with Muse modifier chains and
the compiler-shaped flat modifier construction across element counts and chain
depths. `benchmark:performance:ci` additionally guards initializer
specialization, View construction, `ForEach`, State updates, React/Vue/Web SSR,
live DOM reconciliation, and heap-aware runs when Node is launched with
`--expose-gc`. Modifier CI uses a depth-aware `base + depth × per-depth`
regression budget instead of one global loose ratio.

## Further reading

- [Design](./DESIGN.md) — ownership boundaries and runtime architecture
- [API](./API.md) — stable, integration, and experimental entry points
- [Roadmap](./ROADMAP.md) — correctness priorities and deferred experiments
- [Styling](./STYLING.md) — modifiers, inline CSS, and external stylesheets
- [Migration](./MIGRATION.md) — moving from the 0.x Vue runtime
- [Changelog](./CHANGELOG.md) — release history
