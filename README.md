# Vune UI

Vune UI is a renderer-independent declarative UI framework hosted by TypeScript.
Its `vune-ui` package and `@vune-ui/core` build immutable Vune View graphs;
`@vune-ui/react`, `@vune-ui/vue`, and `@vune-ui/web` materialize those graphs for their
respective runtimes. Legacy React APIs are isolated under `vune-ui/legacy`.

The dependency direction is:

```text
.vune.ts -> @vune-ui/compiler -> Vune View graph -> @vune-ui/react, @vune-ui/vue, or @vune-ui/web
```

React is a renderer, not the definition of a Vune View.

New framework code should import graph values from `vune-ui` and select a renderer
explicitly from `@vune-ui/react`, `@vune-ui/vue`, or `@vune-ui/web`. The
`vune-ui/legacy` entry point remains available for compatibility, backed by the
separate `@vune-ui/legacy-react` package.

The canonical Vite workflow lowers Vune builders and custom `struct ...: View` declarations without coupling the graph to a renderer. The compatibility React workflow also offers `State`, `Action`, and `view` macros.

## Quick start

Create a complete canonical React + Vite + TypeScript project:

```bash
pnpm dlx vune-ui create my-vune-app
cd my-vune-app
pnpm dev
```

The same initializer is available in the standard Vite-style form:

```bash
pnpm create vune-ui my-vune-app
# or: npm create vune-ui my-vune-app
```

From an empty directory, pass `.` to create the app in place:

```bash
pnpm create vune-ui .
```

The command writes the project files, configures `vunePlugin()` before the
React plugin, installs `vune-ui`, `@vune-ui/react`, and `@vune-ui/vite`, and gives you a
small working counter as the first screen. Use `--no-install` when you want to
inspect or edit the generated files before installing dependencies.

For a local checkout, run the same canonical CLI directly:

```bash
node ../vune-ui/bin/vune-ui.mjs create my-vune-app
```

To add the canonical setup to an empty existing directory, run
`vune-ui init --no-install` from that directory. Existing files are preserved
unless `--force` is explicitly provided.

For the canonical Vite compiler, install the React plugin and put `vunePlugin()` before it:

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

A Vune screen can then be a plain `.ts` file:

```ts
import {
  Button,
  HStack,
  Spacer,
  State,
  Text,
  VStack,
} from 'vune-ui'
import { Action, view } from '@vune-ui/react'

const count = State(0)

export default view(() => (
  VStack(
    { alignment: 'leading', spacing: 16 },
    Text('Hello, Vune').fontSize(28).bold(),
    Text(`Count: ${count.value}`),
    Button('Increase', Action(() => { count.value += 1 })),
    HStack(
      Text('Left'),
      Spacer(),
      Text('Right'),
    ).frame({ maxWidth: 'infinity' }),
  )
  .padding(24)
  .frame({ maxWidth: 'infinity' })
))
```

`@vune-ui/vite` is the canonical syntax-lowering plugin. It transforms builder
blocks, labeled initializers, shorthand modifiers, raw HTML, and custom
`struct ...: View` declarations, and returns token-anchored source maps. The
compatibility `vune-ui/vite` entry point remains available for the legacy
TypeScript AST macro that hoists top-level `State()` declarations and rewrites
`view(...)`/`Action(...)` wrappers.

## View values, initializers, and builders

Vune's declarative core now has a View/initializer boundary. Built-in Views and
user Views select a registered initializer from the actual argument list before
rendering; a trailing block is valid only when that selected initializer accepts
`@ViewBuilder` or `@Action`.

```ts
import { defineView, initializer, resolveBuilderClosure, Text, VStack } from 'vune-ui'

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
structured compiler diagnostics and `VuneInitializerError` at the runtime
boundary. When a same-file custom View call has exactly one declaration-defined
initializer match, or an imported View exposes one unique non-variadic typed
call signature, the compiler emits a direct initializer-index path; ambiguous
overloads retain the normal runtime resolver.

The same source syntax can be used with built-in and custom Views:

`Button` intentionally has only these two Vune forms:

```ts
Button('Save') { save() }
Button(action: { save() }, label: { Text('Save') })
```

The custom-label form is declaration-ordered; `label:` before `action:` and
unlabeled closure pairs are compiler errors.

```ts
VStack(alignment: .leading, spacing: 12) {
  Text('Header').font(.title)
  if (enabled) {
    EnabledView()
  } else {
    DisabledView()
  }
}

Button(action: { save() }, label: {
  Text('Save')
})
```

`vunePlugin()` lowers these builder, labeled-argument, shorthand-modifier, and
`struct` forms before the TypeScript/React transform. `parseVuneBuilder()` and
`parseVuneStructs()` expose the source-ranged AST consumed by that lowering
pass, without a component-name allow-list. Labeled calls use an internal
`namedArguments()` carrier; JavaScript object calls remain available as the
compatibility form. Editor integrations that do not
run Vite can use `createVuneLanguageService()` from `@vune-ui/compiler`;
its diagnostics and positions remain in the original Vune source space. A
TypeScript host can use `createVuneTypeScriptLanguageService()` to parse the
same lowered snapshots in editor tooling; diagnostics and common text spans are
mapped back to the original Vune file.

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

State-scoped views can initialize their local Vune state from React props too:

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
  { title: 'Ship Vune', done: false },
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
import { layoutPass, registerVunePlugin } from 'vune-ui/experimental'
```

The automatic JSX runtime remains available through `vune-ui/jsx-runtime` and
`vune-ui/jsx-dev-runtime`. Function-DSL and JSX-created elements both pass through
registered experimental plugins. The block-builder compiler adapter remains
available through `vune-ui/compiler`; it is not part of the stable root DSL
contract.

## Coordinate-free layout

Vune prefers relationships over x/y coordinates:

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

Core layout primitives include `Box`, `VStack`, `HStack`, `ZStack`, `Grid`, `ScrollView`, `SafeArea`, `GeometryReader`, `Spacer`, `Divider`, and `Group`.

`Spacer()` consumes available flex space. `Spacer(minLength)` keeps that explicit minimum when flex space becomes tight. `HStack` is full-width by default, and `.frame({ maxWidth: 'infinity' })` is available when a parent or another element should explicitly stretch.

`frame` creates a renderer-neutral layout host around its content. Its width and
height constraints apply to that host, while `alignment` places the content in
the host (`leading`/`trailing` are horizontal, `top`/`bottom` are vertical, and
the corner values combine both axes). This keeps alignment predictable for raw
HTML, custom Views, React components, and Vue components, including SSR output.
Styles applied before `frame` belong to the content; styles applied after it
belong to the frame host.

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
  .style({ borderRadius: 10 })
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

## React compatibility JSX

Automatic JSX remains an optional React compatibility surface. Set
`jsxImportSource` to `vune-ui` when using its legacy JSX runtime. New
renderer-independent code should use the `vune-ui` function DSL; the canonical
graph does not depend on JSX or React's runtime.

## React components are first-class layout items

Ordinary React components can sit beside Vune primitives and `Spacer()`:

```ts
function ProfileCard(props: { name: string }) {
  return createElement('strong', null, props.name)
}

HStack(
  Text('Profile'),
  Spacer(),
  Component(ProfileCard, { name: 'Vune' })
    .padding(12)
    .frame({ minWidth: 240 }),
)
```

Inside a Vune layout container, a normal React component gets one neutral outer layout host. Layout modifiers apply to that host instead of being pushed into the component's own props. React keeps ownership of the component itself, including hooks, refs, context, props, children, and rendering. Direct React elements, `memo(...)`, and `forwardRef(...)` components follow the same layout-host rule.

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

`Lazy*` carries estimated-size metadata for every renderer. Direct `@vune-ui/web`
mounts window children and updates the range on scroll/resize; SSR, React, and
Vue materialize the full graph while retaining the browser `content-visibility`
hint.

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
pnpm run benchmark:performance:ci
```

`test:browser` is opt-in and uses `VUNE_BROWSER_URL` so it can target a running
demo server, for example
`VUNE_BROWSER_URL=http://localhost:5173 pnpm run test:browser`. CI uses the
committed `pnpm-lock.yaml` with frozen-lockfile mode
and runs the suite against React 18 and React 19.

## End-to-end example

The Vite example is a small component demo in [`examples/App.ts`](examples/App.ts). It
shows a text field, slider, checkbox, button, and progress view in a Vune
layout.

Run it locally with:

```bash
pnpm run dev
```

Then open the local URL printed by Vite and exercise the text field, slider,
toggle, button, progress view, and responsive stack layout.

## Status

The package family is currently versioned as `0.1.0`. React is an optional
renderer; Vue and direct web/DOM renderers are first-class canonical adapters.
The previous root API remains available only through the explicit legacy layer.

Vune's layout API is SwiftUI-inspired and CSS-native rather than a promise of
SwiftUI's proposal-based geometry algorithm. `frame`, `Spacer`, stacks, and
infinity sizing translate the relationship into CSS-native web layout semantics; they
do not guarantee pixel-for-pixel SwiftUI behavior.

See [Getting started](docs/GETTING_STARTED.md), [Design](docs/DESIGN.md),
[Styling](docs/STYLING.md), [Migration](docs/MIGRATION.md), [API](docs/API.md),
[Roadmap](docs/ROADMAP.md), and [Changelog](docs/CHANGELOG.md).
