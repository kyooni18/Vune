# Getting started with Vune

Vune is a renderer-independent, SwiftUI-like declarative UI graph for
TypeScript. `vune-ui` defines Views, state, builders, modifiers, and raw HTML;
`@vune-ui/react` materializes the graph in React. The same graph can also be
rendered by `@vune-ui/vue` or `@vune-ui/web`.

## Requirements

- Node.js `20.19` or newer
- React `18` or `19` when using the React renderer
- TypeScript when writing `.ts` or `.tsx` source

## Create a project

While Vune is being developed locally, use the source checkout rather than an
npm package name:

```bash
cd ~/Code/Web/React/Vune
pnpm install
pnpm build
pnpm dev:create ~/Code/Web/React/my-vune-app
cd ~/Code/Web/React/my-vune-app
pnpm dev
```

To connect an existing React/Vite app instead:

```bash
cd ~/Code/Web/React/Vune
pnpm dev:link ~/Code/Web/React/my-existing-app
pnpm dev:watch
```

`dev:link` adds pnpm 11 `pnpm-workspace.yaml` overrides for every internal Vune package, so dependencies
such as `@vune-ui/compiler` never fall back to npm while they are unpublished.
See [Local development](LOCAL_DEVELOPMENT.md) for React, Vue, Web, watch mode,
and tarball workflows.

After Vune is published, the standard initializer becomes:

```bash
pnpm create vune-ui my-vune-app
# or: npm create vune-ui my-vune-app
```

Use `--no-install` when you want to inspect generated files before installing.

## Install Vune manually

After publication, installing `vune-ui` brings the Vune core, compiler, React/Vue/Web
renderers, and Vite adapter into the application together. An existing React
application only needs:

```bash
pnpm add vune-ui
pnpm add -D @vitejs/plugin-react
```

The separate `create-vune-ui` package is only needed when using the project
scaffolding command.

For a local checkout, do not use a plain `pnpm add ../Vune/...` chain; internal
transitive packages can otherwise fall through to the registry. Use the
supported linker instead:

```bash
cd /path/to/Vune
pnpm dev:link /path/to/application
```

## Initialize an existing directory

From an empty directory, `vune-ui init` uses the same canonical template as
`vune-ui create`:

```bash
vune-ui init
```

Use `--no-install` to defer dependency installation or `--force` when the
directory already contains files you explicitly want to replace.

## Configure Vite

The canonical compiler handles `.vune` and `.vune.ts` files and must run before the React
plugin:

```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { vunePlugin } from '@vune-ui/vite'

export default defineConfig({
  plugins: [
    vunePlugin(),
    react(),
  ],
})
```

The plugin is a build-time syntax transform. It does not replace React or
introduce a second renderer.

In a `.vune` or `.vune.ts` graph, a default import from a `.tsx` or `.jsx` module is
lowered to the typed React foreign-component adapter automatically. You can
also use `Component(MyComponent, props)` or `reactComponent(MyComponent)`
explicitly when the component is not a default file import.

For Vue, install `@vitejs/plugin-vue` and keep the same `vunePlugin()` before
it. The adapter lowers Vune syntax in `.vue` script blocks and Vue virtual
script modules while leaving `<template>` and stylesheet modules to Vue/Vite:

```ts
import vue from '@vitejs/plugin-vue'
import { vunePlugin } from '@vune-ui/vite'

export default defineConfig({ plugins: [vunePlugin(), vue()] })
```

If a compatibility JSX entry is needed, configure it explicitly. Canonical
Vune source does not require JSX:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@vune-ui/react/legacy"
  }
}
```

This enables legacy intrinsic JSX such as `<div padding={12} />`. Function DSL
and canonical `.vune.ts` source use the same graph modifier pipeline.

## Create the React entry point

Vune views are React components, so mount them with the normal React DOM API:

```ts
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('app')!).render(createElement(App))
```

## Build a stateful screen

Put canonical builder syntax in `App.vune` (the `.vune.ts` form remains supported):

```ts
import { Button, State, Text, VStack } from "vune-ui"
import { view } from "@vune-ui/react"

const count = State(0)

export default view(() => VStack(alignment: .leading, spacing: 12) {
  Text(`Count: ${count.value}`).fontSize(24).bold()
  Button("Increase") {
    count.value += 1
  }
})
  .padding(24)
```

Because `count` belongs unambiguously to this one Vune `view`, the compiler makes
it instance-local. A top-level State that is exported, mutable, destructured,
shared by multiple Views, or used outside its owning View remains module-scoped
and emits `VUNE_STATE_SCOPE` as a warning. This decision is based on bindings and
references, not formatting.

The explicit no-hoisting form remains available through `view({ state, body })`
when you want ownership to be visible in ordinary TypeScript.

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

Vune layouts accept React nodes, Vune elements, and ordinary React components in
the same tree:

```ts
import { createElement } from 'react'
import { HStack, Spacer, Text, VStack } from 'vune-ui'
import { Component } from '@vune-ui/react'

function ProfileCard({ name }: { name: string }) {
  return createElement('strong', null, name)
}

VStack(
  Text('Account'),
  HStack(
    Text('Profile'),
    Spacer(),
    Component(ProfileCard, { name: 'Vune' }).padding(12),
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

The root `vune-ui` import and `vune-ui/vite` macro remain available
only for compatibility with older applications. New code should use `vune-ui`,
`@vune-ui/react`, and `@vune-ui/vite`.

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

## Run the Vune example

The repository includes React, Vue, and direct Web adapter demos in
`examples/App.ts`, `examples/VueCounter.vue`, and `examples/WebCounter.vune.ts`.
They use the same Vune graph primitives at their renderer boundary.

From the repository root:

```bash
pnpm install
pnpm run dev
```

For the larger integration fixture, run `pnpm run demo:showcase:build` or start
the Showcase Vite config. It exercises filtering, bindings, async actions, keyed
reordering, lazy collections, custom Views, raw HTML, and modifier chains.

## Verify a Vune project

For the Vune repository itself:

```bash
pnpm test
pnpm run demo:build
pnpm run demo:vue:build
pnpm run demo:web:build
pnpm run test:browser
pnpm run test:browser:vue
pnpm run test:browser:web
pnpm run benchmark:modifiers
pnpm run benchmark:performance:ci
```

`pnpm test` checks the TypeScript build, public type usage, runtime rendering,
macro transforms, controls, presentation, and State behavior.
`benchmark:modifiers` compares raw React styles with Vune modifier chains and
the compiler-shaped flat modifier construction across element counts and chain
depths. `benchmark:performance:ci` additionally guards initializer
specialization, compiler transforms, View construction, `ForEach`, State
updates, keyed DOM updates, React/Vue rerenders, React/Vue/Web SSR and Web
hydration, live DOM reconciliation, and heap-aware runs when Node is launched with
`--expose-gc`. Modifier CI uses a depth-aware `base + depth × per-depth`
regression budget instead of one global loose ratio.

## Further reading

- [Design](./DESIGN.md) — ownership boundaries and runtime architecture
- [API](./API.md) — stable, integration, and experimental entry points
- [Roadmap](./ROADMAP.md) — correctness priorities and deferred experiments
- [Styling](./STYLING.md) — modifiers, inline CSS, and external stylesheets
- [Migration](./MIGRATION.md) — moving from the 0.x Vue runtime
- [Changelog](./CHANGELOG.md) — release history
