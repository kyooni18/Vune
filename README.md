# Muse

Muse is a SwiftUI-like declarative UI layer for React. It keeps layout coordinate-free, lets UI be written as plain TypeScript expressions, and uses React as the renderer and component runtime.

The default Vite workflow can hide common callback wrappers with `State`, `Action`, and `view` macros, so a stateful screen can stay compact without JSX.

## Quick start

For a local sibling checkout:

```bash
pnpm add ../Muse
pnpm add react react-dom
```

To replace a newly-created Vite app's starter screen with the Muse demo:

```bash
pnpm exec muse init --force
```

This explicitly writes `src/App.tsx`, `src/App.css`, and `src/index.css` in the
current project and adds `museMacro()` before the React plugin in
`vite.config.ts`. Installing Muse alone never overwrites an existing app file.

For Vite, install the React plugin and put the Muse macro before it:

```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { museMacro } from 'react-muse-ui/vite'

export default defineConfig({
  plugins: [
    museMacro(),
    react(),
  ],
})
```

A Muse screen can then be a plain `.ts` file:

```ts
import {
  Action,
  Button,
  HStack,
  Spacer,
  State,
  Text,
  VStack,
  view,
} from 'react-muse-ui'

const count = State(0)

export default view(
  VStack(
    { alignment: 'leading', spacing: 16 },
    Text('Hello, Muse').fontSize(28).bold(),
    Text(`Count: ${count.value}`),
    Button('Increase', Action(count.value += 1)),
    HStack(
      Text('Left'),
      Spacer(),
      Text('Right'),
    ).frame({ maxWidth: 'infinity' }),
  )
  .padding(24)
  .frame({ maxWidth: 'infinity' }),
)
```

The macro is a TypeScript AST transform. It moves only top-level `State()` declarations into per-component-instance state (including generic calls such as `State<Todo[]>(...)`), re-evaluates the `view(...)` body reactively, and turns `Action(expression)` into a deferred event callback. Function-valued actions such as `Action(() => save())` are preserved unchanged. The Vite plugin returns source maps for transformed modules.

## View values, initializers, and builders

Muse's declarative core now has a View/initializer boundary. Built-in Views and
user Views select a registered initializer from the actual argument list before
rendering; a trailing block is valid only when that selected initializer accepts
`@ViewBuilder` or `@Action`.

```ts
import { defineView, initializer, resolveBuilderClosure, Text, VStack } from 'react-muse-ui'

const Card = defineView('Card', {
  initializers: [initializer(
    'Card(@ViewBuilder content)',
    args => args.length === 1 && typeof args[0] === 'function',
    args => ({ content: resolveBuilderClosure(args[0]) }),
  )],
  body: ({ content }) => VStack(() => [content]),
})

Card() {
  Text('CPU')
  Text('72%')
}
```

The compiler also lowers the optional `struct Name: View { ... }` form to this
model, including `var body`, `@ViewBuilder`, `@Action`, and `@State` fields.
Builder blocks support nested Views, conditionals, optional branches, and
`ForEach(items) { item in ... }`. The compiler resolves syntax by initializer
metadata rather than a hard-coded component-name list; malformed calls produce
structured compiler diagnostics and `MuseInitializerError` at the runtime
boundary.

The same source syntax can be used with built-in and custom Views:

```ts
VStack(alignment: .leading, spacing: 12) {
  Text('Header').font(.title)
  if (enabled) {
    EnabledView()
  } else {
    DisabledView()
  }
}

Button(action: { save() }) {
  Text('Save')
}
```

`museMacro()` lowers these builder, labeled-argument, shorthand-modifier, and
`struct` forms before the TypeScript/React transform. `parseMuseBuilder()` and
`parseMuseStructs()` expose the source-ranged AST consumed by that lowering
pass, without a component-name allow-list. Labeled calls use an internal
`namedArguments()` carrier; JavaScript object calls remain available as the
compatibility form. Editor integrations that do not
run Vite can use `createMuseLanguageService()` from `react-muse-ui/compiler`;
its diagnostics and positions remain in the original Muse source space. A
TypeScript host can use `createMuseTypeScriptLanguageService()` to parse the
same lowered snapshots in editor tooling; diagnostics and common text spans are
mapped back to the original Muse file.

## React entry point

A minimal app entry can stay free of JSX too:

```ts
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('app')!).render(createElement(App))
```

## Reusable views with props

`view()` can also create reusable React components with typed props:

```ts
const Greeting = view((props: { name: string }) =>
  Text(`Hello, ${props.name}`),
)
```

State-scoped views can initialize their local Muse state from React props too:

```ts
type CounterProps = {
  initial: number
  label: string
}

const Counter = view({
  state: (props: CounterProps) => ({
    count: State(props.initial),
  }),
  body: ({ count }, props) =>
    Text(`${props.label}: ${count.value}`),
})
```

The state factory runs once per mounted component instance. Later prop changes are passed to the body without recreating that instance state.

## Mutable State containers

Arrays and plain objects stored in `State()` are mutation-aware, including nested plain objects. You can update them directly without cloning the whole root value:

```ts
const todos = State([
  { title: 'Ship Muse', done: false },
])

Button('Add', Action(
  todos.value.push({ title: 'Next item', done: false })
))

Button('Complete', Action(
  todos.value[0].done = true
))
```

Direct assignment still works normally. React elements, frozen values, class instances, `Map`, `Set`, and other special objects are not proxied as mutable containers; replace the `State.value` root when those values change.

If two `State()` containers are created from the same raw array or plain object,
they share mutation ownership: a mutation through either container notifies both
containers' subscribers. The containers keep their own state references, so
application code should treat `State()` as the ownership boundary rather than
comparing proxy identity. Sharing raw mutable containers is supported and is
observable behavior, not an accidental implementation detail.

## Stable and experimental APIs

The stable root API is the function DSL: views, state, elements, controls,
collections, presentation primitives, modifiers, and the React component
interop helpers. The layout-engine, coordinate runtime, layout observer,
metadata/plugin registry, and block-builder transform are experimental while
their integration contract is being consolidated:

```ts
import { layoutPass, registerMusePlugin } from 'react-muse-ui/experimental'
```

The automatic JSX runtime remains available through `react-muse-ui/jsx-runtime` and
`react-muse-ui/jsx-dev-runtime`. Function-DSL and JSX-created elements both pass through
registered experimental plugins. The block-builder compiler adapter remains
available through `react-muse-ui/compiler`; it is not part of the stable root DSL
contract.

## Coordinate-free layout

Muse prefers relationships over x/y coordinates:

```ts
VStack(
  { alignment: 'leading', spacing: 12 },
  Text('Title'),
  HStack(
    Text('Left'),
    Spacer(),
    Text('Right'),
  ),
)
```

Core layout primitives include `Box`, `VStack`, `HStack`, `ZStack`, `Grid`, `ScrollView`, `Spacer`, `Divider`, and `Group`.

`Spacer()` consumes available flex space. `Spacer(minLength)` keeps that explicit minimum when flex space becomes tight. `HStack` is full-width by default, and `.frame({ maxWidth: 'infinity' })` is available when a parent or another element should explicitly stretch.

## Simple and advanced CSS styling

Use the simple modifiers for the styles that are common to most views. They stay
readable and can be chained with layout modifiers:

```ts
Text('Hello')
  .fontSize(32)
  .bold()
  .foreground('#eee')
  .padding(12)
  .background('#222')
  .radius(10)
```

Use `.style()` when you need an arbitrary inline CSS property, including CSS
custom properties. Custom properties are useful for sharing a value with an
external stylesheet:

```ts
Text('Hello')
  .style({
    letterSpacing: '0.05em',
    userSelect: 'none',
    '--accent': '#7c3aed',
  })
```

For advanced selectors, responsive rules, pseudo-classes, and animations, keep
the CSS in a normal stylesheet and attach one or more classes. Class arrays can
contain conditional values, and repeated `.className()` calls are composed:

```ts
Text('Hello')
  .className(['card', isFeatured && 'card--featured'])
  .className('u-shadow')
```

This gives simple styles a concise modifier syntax while preserving the full
CSS escape hatch through `.style()` and `.className()`.

## JSX typing

When using automatic JSX, set `jsxImportSource` to `muse` (or configure the
equivalent TypeScript setting). Muse's `react-muse-ui/jsx-runtime` declarations add the
Muse modifier attributes to intrinsic elements, so runtime features such as
`<div padding={12} frame={{ maxWidth: 'infinity' }} />` are type-checked by the
editor as well as handled at runtime. Function-DSL nodes and JSX nodes both
pass through registered experimental plugins.

## React components are first-class layout items

Ordinary React components can sit beside Muse primitives and `Spacer()`:

```ts
function ProfileCard(props: { name: string }) {
  return createElement('strong', null, props.name)
}

HStack(
  Text('Profile'),
  Spacer(),
  Component(ProfileCard, { name: 'Muse' })
    .padding(12)
    .frame({ minWidth: 240 }),
)
```

Inside a Muse layout container, a normal React component gets one neutral outer layout host. Layout modifiers apply to that host instead of being pushed into the component's own props. React keeps ownership of the component itself, including hooks, refs, context, props, children, and rendering. Direct React elements, `memo(...)`, and `forwardRef(...)` components follow the same layout-host rule.

`Raw(element)` accepts an already-created React element when modifier chaining is needed.

## Controls

```ts
Text('Hello')
Button('Save', save)
TextField(name)
TextArea(description)
Toggle(enabled)

Image('/avatar.png', { alt: 'Profile', fit: 'cover' })
Label('Profile', Text('●'))
Link('Settings', '/settings')
ProgressView(progress, { max: 1 })
Picker(category, categories)
Slider(volume, { min: 0, max: 1, step: 0.05 })
Stepper(quantity, { min: 0, max: 10 })
```

## Collections

```ts
List(
  Section('Account',
    Text('Profile'),
    Text('Security'),
  ),
)

LazyVStack({ estimatedItemSize: 56 }, ...rows)
LazyHStack(...cards)
LazyGrid({ columns: 3, estimatedItemSize: 160 }, ...cards)
```

`Lazy*` uses browser `content-visibility` hints. It is not a windowed virtualization engine; normal React virtualization libraries can be used through `Component(...)` when true virtualization is needed.

## Navigation and presentation

Navigation remains router-agnostic. Pass any object with `push(destination)`:

```ts
NavigationStack(
  router,
  VStack(
    NavigationLink('/profile', 'Profile'),
    NavigationLink('/settings', 'Settings'),
  ),
)
```

Presentation primitives use React portals and platform HTML:

```ts
Sheet(showingDetails, detailsView)
Alert(showingAlert, { title: 'Delete item?' })
Menu('Actions', editButton, deleteButton)
```

`Sheet()` and `Alert()` use `createPortal()`. They render no portal markup in
the server or hydration render and mount after the client effect, avoiding
hydration mismatches. Nested presentations receive increasing z-index values.
`Menu()` uses native `details` / `summary`, first-item focus, keyboard
navigation, disabled-item skipping, typeahead, and trigger restoration.

## Explicit no-macro form

Vite macros are optional. The explicit state-scoped form is:

```ts
export default view({
  state: () => ({ count: State(0) }),
  body: ({ count }) => VStack(
    Text(`Count: ${count.value}`),
    Button('Increase', () => { count.value += 1 }),
  ),
})
```

## Tests

```bash
pnpm test
pnpm run demo:build
pnpm run test:browser
pnpm run benchmark:modifiers
```

`test:browser` is opt-in and uses `MUSE_BROWSER_URL` so it can target a running
demo server, for example
`MUSE_BROWSER_URL=http://localhost:5173 pnpm run test:browser`. CI uses the
committed `pnpm-lock.yaml` with frozen-lockfile mode
and runs the suite against React 18 and React 19.

## End-to-end example

The Vite example is a small component demo in [`examples/App.ts`](examples/App.ts). It
shows a text field, slider, checkbox, button, and progress view in a Muse
layout.

Run it locally with:

```bash
pnpm run dev
```

Then open the local URL printed by Vite and try adding a task, completing it,
changing filters, opening Settings, and clearing completed tasks.

## Status

The React rewrite is currently versioned as `0.1.0`. The previous Vue runtime is
not retained as a compatibility layer in this release.

Muse's layout API is SwiftUI-inspired and CSS-native rather than a promise of
SwiftUI's proposal-based geometry algorithm. `frame`, `Spacer`, stacks, and
infinity sizing translate the relationship into CSS-native web layout semantics; they
do not guarantee pixel-for-pixel SwiftUI behavior.

See [Getting started](docs/GETTING_STARTED.md), [Design](docs/DESIGN.md),
[Styling](docs/STYLING.md), [Migration](docs/MIGRATION.md), [API](docs/API.md),
[Roadmap](docs/ROADMAP.md), and [Changelog](docs/CHANGELOG.md).
