# Muse public API

This page describes the public contract for the current React release.

## Stable entry points

The root `react-muse-ui` entry point is the stable function-DSL surface:

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
Muse owns the component's external layout slot; React owns the component's
props, hooks, refs, context, children, and internal rendering.

`Group()` and React fragments are transparent to Muse container layout. Muse
recursively normalizes them before deciding which children need a neutral
layout host.

## View model and compiler

`defineView(name, definition)` creates a React-compatible View constructor with
explicit initializer metadata and a `body(props)` function. `initializer()`
describes overload matching, labels, and `value`/`viewBuilder`/`action`
parameters. `resolveInitializer()` is the same overload boundary used by
built-in Views. `structView` is an alias for this model.

`ViewBuilder.buildBlock`, `buildOptional`, `buildEither`, and `buildArray` are
the runtime intermediate representation for builder composition. The compiler
entry point `react-muse-ui/compiler` transforms trailing blocks, labeled arguments,
conditionals, `ForEach` item closures, and the supported `struct ...: View`
syntax. It does not classify calls by a `VStack`-style allow-list. Use
`formatMuseSource()` and `diagnoseMuseSource()` from that entry point for editor
and formatter integrations; Vite transforms return source maps.

Modifier chains are immutable. They return cloned React values and retain an
inspectable `modifierGraphOf()` record, analogous to a `ModifiedContent<View,
Modifier>` graph. `Binding()` provides a writable lens over State or a custom
getter/setter and remains compatible with controlled Muse controls.

## Supported integration entry points

- `react-muse-ui/vite` — the optional TypeScript AST macro for `State`, `Action`, and
  `view`. Put `museMacro()` before `@vitejs/plugin-react`. Transformed modules
  include source maps.
- `react-muse-ui/jsx-runtime` and `react-muse-ui/jsx-dev-runtime` — the automatic JSX runtimes.
  With `jsxImportSource: "react-muse-ui"`, Muse modifier attributes on intrinsic elements
  are type-checked as well as applied at runtime.

## Experimental entry points

Import exploratory infrastructure explicitly from `react-muse-ui/experimental`:

- coordinate spaces and the layout observer;
- observed `CoordinateNode` values;
- measured `LayoutNode` values through `createLayoutNode` and `layoutPass`;
- JSX metadata and the plugin registry;
- coordinate runtime helpers;
- builder collection helpers and the block-builder transform.

The builder/compiler adapters are also available from `react-muse-ui/compiler` for
experimentation. They are not part of the stable root API and may change as
the layout and JSX integration contracts are consolidated.

## Behavioral contracts

`State()` proxies arrays and plain objects, including nested plain objects. If
two State containers wrap the same raw mutable container, they share mutation
ownership and both subscribers are notified. Proxy identity is not an
application-level contract. Frozen values, class instances, `Map`, `Set`, and
React elements should be replaced at the State root when they change.

`Lazy*` uses browser `content-visibility` and intrinsic-size hints. It is not
windowed virtualization. Use a React virtualization library through
`Component()` when actual windowing is required.

Muse layout is SwiftUI-inspired and web-native. `frame`, `Spacer`, stacks, and
infinity sizing express relationships through CSS; they do not promise
pixel-equivalent behavior to SwiftUI's proposal-based layout algorithm.

`Sheet` provides Escape dismissal, initial focus, focus wrapping, focus
restoration, and deterministic stacking for nested portals. Presentation hosts
render empty during SSR and mount their portals after hydration so server
markup remains hydration-safe. `Alert` uses instance-specific `useId()` labels
and exposes one `alertdialog` host. `Menu` uses native `details`/`summary`
plus `menuitem` children with first-item focus, Arrow/Home/End navigation,
disabled-item skipping, typeahead, Escape, and Tab-close behavior. Closing by
keyboard or item action restores the trigger focus; Tab is allowed to continue
normal document navigation.

Experimental plugins run for both function-DSL-created and JSX-created Muse
elements. JSX additionally records its modifier metadata because JSX receives
the modifier attributes as a single creation-time pass.
