# Vune public API

This page describes the public contract for the current Vune release. New code
should import graph values from `vune-ui` and choose `@vune-ui/react`, `@vune-ui/vue`, or
`@vune-ui/web` as the renderer. Legacy React compatibility is available explicitly
from `vune-ui/legacy`.

The candidate 1.0 runtime export surface is pinned by
`tests/api-surface.test.mjs`. Canonical export changes, renderer-only additions,
or renderer API leakage through `vune-ui` therefore require an explicit snapshot
review. Type-level contracts are pinned separately by the TypeScript
conformance suite.

## Stable entry points

The canonical `vune-ui` entry point is the renderer-independent graph surface:

- Core Views and state: `Text`, `VStack`, `HStack`, `ZStack`, `ScrollView`,
  `SafeArea`, `GeometryReader`, `Button`, `Element`, `ForEach`, `defineView`, `View`,
  `ViewBuilder`, `State`, `Binding`, `Action`, and the renderer-neutral
  `ForeignComponent` descriptor.
  View modifiers include immutable `padding`, `margin`, `gap`, `frame`,
  `style`, `className`, `withProps`, `keyed`, and `elementRef` operations.

Renderer-specific entry points add only materialization and runtime bridges:

- `@vune-ui/react` — React materialization and optional React compatibility APIs.
- `@vune-ui/vue` — Vue VNodes, `VuneView`, `createVueView`, `Component`, generic
  foreign-component slots, and
  explicit `toVueRef`/`fromVueRef` bridges. `mount(value, target, { hydrate: true })`
  hydrates Vue SSR markup.
- `@vune-ui/web` — HTML serialization and DOM mounting. `mount(value, target,
  { hydrate: true })` reuses matching SSR markup, attaches DOM events/refs, and
  keeps subsequent State invalidations live.

The explicit `vune-ui/legacy` entry point provides the legacy React compatibility
surface, implemented by `@vune-ui/legacy-react`:

- Core views and state: `view`, `defineView`, `View`, `ViewBuilder`, `State`,
  `Binding`, and `Action`.
- Layout and composition: `Element`, `Component`, `Raw`, `Key`, `ElementRef`, `Group`, `Box`, `VStack`, `HStack`, `ZStack`, `Grid`, `ScrollView`, `Spacer`, `Divider`, and shapes.
- Controls: `Text`, `Button`, `TextField`, `TextArea`, `Toggle`, `Image`, `Label`, `Link`, `ProgressView`, `Picker`, `Slider`, and `Stepper`.
- Collections: `List`, `Section`, `ForEach`, `LazyVStack`, `LazyHStack`, and
  `LazyGrid`.
- Presentation: `NavigationStack`, `NavigationLink`, `Sheet`, `Alert`, and `Menu`.
- Styling and types: `styled` plus the exported modifier, layout, state, and control types.

`Component()` requires the props required by the underlying React component.
Props are optional only when the component's prop type has no required keys.
Vune owns the component's external layout slot; React owns the component's
props, hooks, refs, context, children, and internal rendering.

`Group()` and React fragments are transparent to Vune container layout. Vune
recursively normalizes them before deciding which children need a neutral
layout host.

## View model and compiler

`defineView(name, definition)` creates a `ViewType` plus a callable
constructor with explicit initializer metadata and a `body(props)` function.
Built-in layout, control, collection, and presentation constructors use the same
boundary; `Element`, `Component`, and `Group` are native compatibility views
rather than a separate construction path. The legacy `view(...)` factory also
returns a React component backed by a `ViewType`.
`createViewNode()` can run
the same initializer boundary and return a renderer-neutral graph node before
React is involved; calling the constructor remains the compatibility path that
materializes that node as a React element. User View nodes can be traversed by a
custom renderer through the optional `view` hook or by recursively lowering
their body graph. `initializer()`
describes overload matching, labels, and `value`/`binding`/`viewBuilder`/`action`
parameters; `valueClosure()`, `viewBuilderClosure()`, and `actionClosure()`
retain those roles at runtime as well. `resolveInitializer()`
is the same overload boundary used by built-in Views. `structView` is an alias
for this model.

`ViewBuilder.buildBlock`, `buildOptional`, `buildEither`, and `buildArray` are
the runtime intermediate representation for builder composition. The compiler
entry point `@vune-ui/compiler` transforms trailing blocks, labeled arguments,
conditionals, `ForEach` item closures, and the supported `struct ...: View`
syntax. `parseVuneBuilder()` and `parseVuneStructs()` expose the source-ranged
AST used by the lowering pass; it does not classify calls by a `VStack`-style
allow-list. Labeled syntax is lowered through the internal `namedArguments()`
carrier, while ordinary JavaScript object calls remain a compatibility form.
`formatVuneSource()` and `diagnoseVuneSource()` are available for one-off
editor operations. `createVuneLanguageService()` combines formatting,
diagnostics, source-map output, and original-source position conversion for an
editor integration. `createVuneLanguageService()` exposes the canonical lowered snapshot plus
original/generated position conversion. `mapGeneratedPosition()` and
`mapOriginalPosition()` expose the token-level anchors used by editor adapters.
The older TypeScript-host wrapper remains in the explicit legacy compiler
compatibility package. Vite transforms use the standard
source-map shape.

The normative cross-layer contracts for these APIs are in
[`docs/SEMANTICS.md`](./SEMANTICS.md). `createVuneSemanticModel()` exposes the
shared Vune AST plus lowered TypeScript AST used by compiler and IDE clients.

Modifier chains are immutable. They return cloned compatibility values and retain an
inspectable `modifierGraphOf()` record, analogous to a `ModifiedContent<View,
Modifier>` graph. The graph also exposes a renderer-neutral `ModifiedContent`
node and can be traversed with `renderViewNode(value, renderer)`. React is the
default materializer; other renderers can implement `value()` for primitive
leaves and `view()`/`modifier()` for host-specific behavior. `Binding()` provides
a writable lens over State or a custom getter/setter and remains compatible with
controlled Vune controls.

`createViewIdentityStore()` exposes the same renderer-independent identity
primitive used by the React host for per-mounted-View storage; the host-specific
hook only supplies mount lifetime.

## Supported integration entry points

- `@vune-ui/vite` — the canonical Vune compiler adapter for builder blocks,
  labeled initializers, shorthand modifiers, raw HTML, and `struct ...: View`.
  Put `vunePlugin()` before `@vitejs/plugin-react`; transformed modules include
  token-anchored source maps.
- `@vune-ui/compiler` — the renderer-independent compiler and language-service
  primitives used by the Vite and editor adapters.
- `vune-ui/vite` — the TypeScript AST macro for `State`, `Action`, `view`,
  builder blocks, labeled arguments, shorthand modifiers, and `struct ...: View`.
  This is the compatibility React workflow; put `vuneMacro()` before
  `@vitejs/plugin-react` when that state-hoisting behavior is required.
- `vune-ui/jsx-runtime` and `vune-ui/jsx-dev-runtime` — the automatic JSX runtimes.
  With `jsxImportSource: "vune-ui"`, Vune modifier attributes on intrinsic elements
  are type-checked as well as applied at runtime.

## Experimental entry points

Import exploratory infrastructure explicitly from `vune-ui/experimental`:

- coordinate spaces and the layout observer;
- observed `CoordinateNode` values;
- measured `LayoutNode` values through `createLayoutNode` and `layoutPass`;
- JSX metadata and the plugin registry;
- coordinate runtime helpers;
- builder collection helpers and the block-builder transform.

The builder/compiler adapters are also available from `@vune-ui/compiler` for
experimentation. They are not part of the stable root API and may change as
the layout and JSX integration contracts are consolidated.

## Behavioral contracts

`State()` proxies arrays and plain objects, including nested plain objects. If
two State containers wrap the same raw mutable container, they share mutation
ownership and both subscribers are notified. Proxy identity is not an
application-level contract. Frozen values, class instances, `Map`, `Set`, and
React elements should be replaced at the State root when they change.

`Lazy*` stores a renderer-neutral range boundary with estimated item size and
overscan metadata. `@vune-ui/web` mounts a windowed range, maintains spacers while
the viewport scrolls, and preserves keyed identity; React and Vue retain a
full-graph fallback while exposing the same lazy metadata and SSR shape.

Vune layout is SwiftUI-inspired and web-native. `frame`, `Spacer`, stacks, and
infinity sizing express relationships through CSS; they do not promise
pixel-equivalent behavior to SwiftUI's proposal-based layout algorithm.
`ScrollView` maps its axis to native overflow behavior, while `SafeArea` maps
selected edges to `env(safe-area-inset-*)`. Geometry observation remains a
renderer-owned observation boundary: React and Vue measure the host after mount,
web DOM mount remeasures it, and all DOM adapters also read the CSS environment
insets into `GeometryProxy.safeAreaInsets`; SSR uses a deterministic zero proxy.

`Sheet` provides Escape dismissal, initial focus, focus wrapping, focus
restoration, and deterministic stacking for nested portals. Presentation hosts
render empty during SSR and mount their portals after hydration so server
markup remains hydration-safe. `Alert` uses instance-specific `useId()` labels
and exposes one `alertdialog` host. `Menu` uses native `details`/`summary`
plus `menuitem` children with first-item focus, Arrow/Home/End navigation,
disabled-item skipping, typeahead, Escape, and Tab-close behavior. Closing by
keyboard or item action restores the trigger focus; Tab is allowed to continue
normal document navigation.

Experimental plugins run for both function-DSL-created and JSX-created Vune
elements. JSX additionally records its modifier metadata because JSX receives
the modifier attributes as a single creation-time pass.
