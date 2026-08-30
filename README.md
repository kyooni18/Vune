# Vune UI

Vune UI is a renderer-independent declarative UI framework hosted by TypeScript.
Its `vune-ui` package and `@vune-ui/core` build immutable Vune View graphs;
`@vune-ui/react`, `@vune-ui/vue`, and `@vune-ui/web` materialize those graphs for their
respective runtimes. Legacy React APIs are isolated under `vune-ui/legacy`.

The dependency direction is:

```text
.vune / .vune.ts -> @vune-ui/compiler -> Vune View graph -> @vune-ui/react, @vune-ui/vue, or @vune-ui/web
```

React is a renderer, not the definition of a Vune View.

New framework code should import graph values from `vune-ui` and select a renderer
explicitly from `@vune-ui/react`, `@vune-ui/vue`, or `@vune-ui/web`. The
`vune-ui/legacy` entry point remains available for compatibility and is implemented
inside `@vune-ui/react`; the separate `@vune-ui/legacy-react` package remains only
as a compatibility distribution.

Installing `vune-ui` also installs the published Vune compiler, renderer
packages, and Vite adapter. The `create-vune-ui` scaffolding CLI remains a
separate package.

The canonical Vite workflow lowers Vune builders and custom `struct ...: View` declarations without coupling the graph to a renderer. The compatibility React workflow also offers `State`, `Action`, and `view` macros.

## Quick start

### Local checkout (recommended while Vune is unpublished)

Vune can be used from a completely separate project without publishing any
`@vune-ui/*` package to npm. Install and build the Vune checkout once:

```bash
cd ~/Code/Web/React/Vune
pnpm install
pnpm build
```

Then link an existing React project from the Vune repository:

```bash
pnpm dev:link ~/Code/Web/React/MyApp
```

`dev:link` writes direct `link:` entries for the selected renderer plus the
internal `core/compiler` plumbing that bundlers must resolve, and pnpm
11-compatible `overrides:` in the target `pnpm-workspace.yaml` for every
internal `@vune-ui/*` package. That last part is important: unpublished
transitive packages such as `@vune-ui/compiler` never fall through to the
public npm registry.

Run a watch build while developing Vune itself:

```bash
pnpm dev:watch
```

Now edits in the Vune checkout update package `dist/` outputs while the separate
application keeps using the linked packages.

To create a brand-new separate project using this checkout:

```bash
cd ~/Code/Web/React/Vune
pnpm dev:create ~/Code/Web/React/MyVuneApp --no-install
cd ~/Code/Web/React/MyVuneApp
pnpm install
pnpm dev
```

The equivalent direct CLI is:

```bash
node ~/Code/Web/React/Vune/bin/vune-ui.mjs create ./MyVuneApp --local
```

For Vue or the native Web renderer in an existing project:

```bash
pnpm dev:link /path/to/vue-app --renderer vue
pnpm dev:link /path/to/web-app --renderer web
```

If you specifically need portable tarballs instead of source links, Vune can
build a complete local package set and install it with pnpm 11 workspace overrides automatically:

```bash
pnpm pack:local
pnpm local:install /path/to/my-app
```

Generated tarballs live under `local-packages/` and are intentionally ignored by
Git so stale versions cannot be committed accidentally.

### Published-package workflow

After the packages are published, the standard initializer is:

```bash
pnpm create vune-ui my-vune-app
cd my-vune-app
pnpm dev
```

The generated app uses Vune's direct Web renderer and does not install or
configure React or Vue. Add a renderer package separately when an existing
React or Vue application needs framework-specific interop.

The equivalent CLI form is `pnpm dlx vune-ui create my-vune-app`. From an empty
directory, pass `.` to create the app in place. Use `--no-install` to inspect the
generated files before installing dependencies.

For the canonical Vite compiler, put `vunePlugin()` before the renderer plugin:

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

A Vune screen can stay in ordinary TypeScript when you do not need builder
syntax:

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

`@vune-ui/vite` lowers `.vune` and `.vune.ts` builders, labeled initializers, shorthand
modifiers, raw HTML, and custom `struct ...: View` declarations. The root
`vune-ui` entry remains renderer-independent; select React, Vue, or Web from the
corresponding `@vune-ui/*` renderer package.

## Publishing to npm

Once the npm scope is ready, the repository can publish the complete synchronized package set with one command:

```bash
pnpm release:dry   # full verification + npm dry-run
pnpm release       # publish the current version
pnpm release:patch # bump every package, verify, and publish
```

The release helper publishes in dependency order and can resume a partial release by skipping versions that already exist on npm. See [Publishing Vune to npm](docs/PUBLISHING.md) for first-time npm setup, versioning, tags, and recovery.

See [Local development](docs/LOCAL_DEVELOPMENT.md) for the complete separate-
project workflow.

## Editor and LSP integration

Vune includes a standalone stdio language server and setup generator for Vim,
Neovim, VS Code, Zed, Helix, and generic LSP clients:

```bash
npx vune-ui editor install --editor all
vune-ui lsp --stdio
```

To export the included VS Code extension as an installable VSIX:

```bash
pnpm vscode:package
code --install-extension dist/vune-language-support-<version>.vsix
```

See [Editor integrations](docs/EDITORS.md) for global installs and client
configuration details.

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
call signature, the compiler emits a direct initializer-index path. Calls that
the compiler can fully prove now use the trusted `createNodeCompiled` AOT path:
runtime overload scans, label normalization, and repeated parameter scoring are
removed. Swift-style labeled arguments are normalized to the runtime
initializer's positional payload when that mapping is unambiguous, and simple
`@ViewBuilder` closures are lowered directly to child arrays. Ambiguous,
variadic, `any`/`unknown`, opaque-call, or otherwise unproven cases retain the
guarded specialization or normal runtime resolver.

Production lowering also fuses statically typed modifier chains into compact
`modifiedContentCompiled` descriptors. Proven intrinsic host trees can be
lowered further into an immutable compiled template plus identity-preserving
dynamic slots: static host structure is defined once, while React, Vue, Web DOM,
and Web SSR use cached native template factories and re-enter generic graph
traversal only for the dynamic slots. Fully static View subtrees are still
hoisted to module scope. Every template optimization has a generic graph
fallback, so renderer-independent semantics do not depend on successful AOT
analysis. State dependency metadata follows the same rule: the compiler may mark
a dependency set complete only for a deliberately small, proven closed body;
all other Views continue to use runtime dependency collection.

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

### Symbol and content transitions

`VectorSymbol` accepts both authored symbols and real icon-pack geometry.
Ordinary SVG primitives are normalized to paths, while explicit layer ids keep
semantic identity separate from rendered SVG geometry. `@lucide/icons` data can
be used directly without a Vune/Lucide runtime bridge:

```ts
import { Pause, Play } from '@lucide/icons'

const play = VectorSymbol.fromLucide(Play)
const pause = VectorSymbol.fromLucide(Pause)

Image(isPlaying.value ? pause : play)
  .contentTransition(ContentTransition.symbolEffect(SymbolEffect.automatic))
  .animation(Animation.spring(0.48, 0.7), isPlaying.value)
```

Custom icons do not need hand-normalized `d` strings either:

```ts
const search = VectorSymbol.fromSVGNodes([
  ['circle', { cx: 11, cy: 11, r: 6.5, stroke: 'currentColor', fill: 'none' }],
  ['line', { x1: 16, y1: 16, x2: 21, y2: 21, stroke: 'currentColor' }],
], { name: 'search', viewBox: '0 0 24 24' })
```

Generated ordinal layers such as `layer:0` are treated as geometry, not
semantic identity. Standard icon source keys are retained when available
(including Lucide node keys), so genuinely shared geometry stays live across
related symbols. Unnamed layers are globally assigned by geometry and
presentation instead of array order; compound contours are paired by shape
role before split/merge duplication. Added stroke-only layers draw on/off,
while unrelated topology can still split or converge continuously. Differing
viewBoxes and nested SVG transforms are normalized as part of the transition.

Vune source accepts the matching Swift-style shorthand:

```ts
Image(icon)
  .contentTransition(.symbolEffect(.magicReplace(fallback: .downUp)))
  .animation(.spring(response: 0.28, dampingFraction: 0.86), value: active)

Text(status)
  .contentTransition(.interpolate)
  .animation(.spring(response: 0.42, dampingFraction: 0.78), value: status)

Text(status)
  .contentTransition(.blurReplace(radius: 8))
  .animation()

Text(status)
  .contentTransition(.push(from: .trailing))
  .animation()

Text(status)
  .contentTransition(.scale(scale: 0.84))
  .animation()

Text(String(count))
  .contentTransition(.numericText(value: count))
  .animation()
```

`ContentTransition` changes content inside a stable View; `Transition` remains
the insertion/removal lifecycle API. `Path(d).animation()` also morphs SVG path
data directly without requiring a `VectorSymbol` wrapper. Web path morphing
normalizes path topology once, preserves active presentation state during
retargeting, and keeps path, color, opacity, transform, and layout motion on
independent ownership channels. The path parser accepts compact SVG arc syntax
used by production icon packs. High-confidence geometry preserves spring
overshoot; uncertain correspondence clamps the silhouette to monotonic progress
while the surrounding transform can still spring, reducing self-intersection
and inside-out intermediate shapes.

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

The application-style benchmark includes raw React and raw Vue client baselines
for full-tree, single-item, and keyed-reverse updates alongside the Vune React
and Vue adapters. Ratio thresholds are regression guards rather than claims
that a renderer is intrinsically a fixed multiple faster or slower.

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
