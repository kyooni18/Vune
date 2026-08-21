# Migration from the 0.x Vue release to Muse 1.0 (React)

Muse 1.0 is a renderer rewrite, not a Vue compatibility release. The SwiftUI-like API shape is preserved where practical, but Vue itself is removed from the runtime.

## Dependencies

Remove Vue and the Vue Vite plugin from a Muse-only app and use React instead:

```bash
pnpm remove vue @vitejs/plugin-vue
pnpm add react react-dom
pnpm add -D @vitejs/plugin-react
```

For a local Muse checkout:

```bash
pnpm add ../Muse
```

## Vite

Before:

```ts
import vue from '@vitejs/plugin-vue'
import { museMacro } from 'react-muse-ui/vite'

plugins: [museMacro(), vue()]
```

After:

```ts
import react from '@vitejs/plugin-react'
import { museMacro } from 'react-muse-ui/vite'

plugins: [museMacro(), react()]
```

## Application entry

Vue `createApp(...).mount(...)` becomes React `createRoot(...).render(...)`.

```ts
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('app')!).render(createElement(App))
```

A Muse screen can be `.ts`; `.vue` files are no longer part of Muse itself.

## State and macro syntax

The intended macro syntax remains close to the 0.x form:

```ts
const count = State(0)

export default view(
  VStack(
    Text(`Count: ${count.value}`),
    Button('Increase', Action(count.value += 1)),
  ),
)
```

The React macro now lowers this to per-component-instance `view({ state, body })` state.

The current macro is parsed with the TypeScript AST. It recognizes generic
calls such as `State<Todo[]>([])`, respects lexical scope, preserves
`Action(() => callback)` functions, and emits source maps through the Vite
plugin. Only top-level State declarations before the default `view(...)` are
hoisted.

## Component interoperability

`Component()` now accepts React component types instead of Vue component definitions. Muse still applies layout modifiers to a neutral outer host so component internals remain framework-owned.

Required React props are required by TypeScript when calling `Component()`;
props are optional only for components whose prop type has no required keys.

## Removed Vue-specific APIs

The 1.0 runtime does not carry Vue `Transition`, `TransitionGroup`, `Teleport`, `Suspense`, `KeepAlive`, Vue slots helpers, Vue refs/models, or `defineComponent`-oriented APIs as compatibility shims.

Use React equivalents directly where appropriate. Muse `Sheet` and `Alert` use React portals internally.

## Presentation and navigation

`NavigationStack` remains router-agnostic and only requires a `push(destination)` method. Existing React routers can be adapted by passing a small object that satisfies that interface.
