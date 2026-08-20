# Getting started with Rui

Rui is a SwiftUI-like declarative UI layer for React. You describe layout with
relationships such as `VStack`, `HStack`, `Grid`, and `Spacer`, while React
continues to own rendering, components, hooks, refs, and context.

This guide covers the smallest useful Rui application: a Vite app with one
stateful screen, a React component, and a few interactive controls.

## Requirements

- Node.js `20.19` or newer
- React `18` or `19`
- TypeScript when writing `.ts` or `.tsx` source

## Install Rui

In an existing React application:

```bash
pnpm add rui react react-dom
pnpm add -D @vitejs/plugin-react
```

When working from a local Rui checkout:

```bash
pnpm add ../Rui
pnpm add react react-dom
pnpm add -D @vitejs/plugin-react
```

## Configure Vite

The Rui macro is optional, but it makes stateful screens compact. When it is
enabled, place `ruiMacro()` before the React plugin:

```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { ruiMacro } from 'rui/vite'

export default defineConfig({
  plugins: [
    ruiMacro(),
    react(),
  ],
})
```

The macro is a build-time transform. It does not replace React or introduce a
second renderer.

If you use automatic JSX, configure Rui's runtime and modifier attribute types
in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "rui"
  }
}
```

This enables intrinsic JSX such as `<div padding={12} />`. Function DSL and
JSX-created Rui nodes use the same modifier/plugin pipeline.

## Create the React entry point

Rui views are React components, so mount them with the normal React DOM API:

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
import {
  Action,
  Button,
  State,
  Text,
  VStack,
  view,
} from 'rui'

const count = State(0)

export default view(
  VStack(
    { alignment: 'leading', spacing: 12 },
    Text(`Count: ${count.value}`).fontSize(24).bold(),
    Button('Increase', Action(count.value += 1)),
  ).padding(24),
)
```

With the Vite macro, top-level `State()` declarations are moved into the
component's per-instance state factory. Each mounted copy of the view gets its
own `count` value.

`Action(expression)` defers the expression until the event runs. Without the
macro, use a normal callback instead:

```ts
export default view({
  state: () => ({ count: State(0) }),
  body: ({ count }) => VStack(
    Text(`Count: ${count.value}`),
    Button('Increase', () => { count.value += 1 }),
  ),
})
```

The macro uses the TypeScript AST, so generic calls such as `State<Todo[]>([])`
and nested functions are handled according to lexical scope. It also returns
source maps through the Vite plugin. `Action(() => save())` is already a
callback and is left unchanged.

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

Rui layouts accept React nodes, Rui elements, and ordinary React components in
the same tree:

```ts
import { createElement } from 'react'
import { Component, HStack, Spacer, Text, VStack } from 'rui'

function ProfileCard({ name }: { name: string }) {
  return createElement('strong', null, name)
}

VStack(
  Text('Account'),
  HStack(
    Text('Profile'),
    Spacer(),
    Component(ProfileCard, { name: 'Rui' }).padding(12),
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

The root `rui` import is the stable function-DSL surface. The experimental
layout engine, coordinate observer, metadata/plugin registry, and block-builder
transform are available explicitly from `rui/experimental` while their
integration contract evolves.

## Styling

Use modifiers for common layout and appearance rules:

```ts
Text('Card')
  .fontSize(20)
  .bold()
  .padding(16)
  .background('#111827')
  .foreground('#f9fafb')
  .radius(12)
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

## Run the Rui example

The repository includes an end-to-end task app in `examples/App.ts`. It covers
mutable lists, filtering, text input, React component interop, a settings
sheet, and an alert confirmation flow.

From the repository root:

```bash
pnpm install
pnpm run dev
```

Open the local URL printed by Vite and try adding a task, completing it,
changing filters, opening Settings, and clearing completed tasks.

## Verify a Rui project

For the Rui repository itself:

```bash
pnpm test
pnpm run demo:build
pnpm run test:browser
pnpm run benchmark:modifiers
```

`pnpm test` checks the TypeScript build, public type usage, runtime rendering,
macro transforms, controls, presentation, and State behavior.
`benchmark:modifiers` compares raw React styles with Rui modifier chains across
element counts and chain depths; it is a measurement tool, not a virtualization
benchmark.

## Further reading

- [Design](./DESIGN.md) — ownership boundaries and runtime architecture
- [API](./API.md) — stable, integration, and experimental entry points
- [Roadmap](./ROADMAP.md) — correctness priorities and deferred experiments
- [Styling](./STYLING.md) — modifiers, inline CSS, and external stylesheets
- [Migration](./MIGRATION.md) — moving from the 0.x Vue runtime
- [Changelog](./CHANGELOG.md) — release history
