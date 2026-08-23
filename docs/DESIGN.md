# Vune React design

Vune is a declarative TypeScript UI framework. `vune-ui` and `@vune-ui/core` define
the language and immutable View graph; renderers such as `@vune-ui/react`,
`@vune-ui/vue`, and `@vune-ui/web` consume that graph. The root `vune-ui`
package is kept as a compatibility layer.

## Layout

The normal API expresses relationships rather than coordinates. `VStack`, `HStack`, `ZStack`, `Grid`, `Spacer`, alignment, spacing, and `frame` are the primary layout vocabulary. Low-level CSS remains available through modifiers when needed.

Vune's layout is SwiftUI-inspired, not a promise to reproduce SwiftUI's
proposal-based geometry algorithm. `frame`, infinity sizing, and stacks map
the relationship into web-native CSS semantics.

`ScrollView` is a graph View with native `overflow-x`/`overflow-y` behavior.
`SafeArea` is a graph View that applies the selected CSS environment insets.
`GeometryReader` is a graph boundary with a renderer-neutral `GeometryProxy`.
React, Vue, and direct DOM adapters own host measurement and feed the proxy back
into the same body, including normalized CSS safe-area insets; renderer-less
traversal and SSR use zero geometry.

### Web layout contract

The web layout contract is intentionally CSS-native and renderer-independent:

- `VStack` and `HStack` are full-width flex containers. Their alignment controls
  the cross axis and `spacing` becomes `gap`.
- `ZStack` is a full-width grid container. Its alignment maps to grid placement
  and its children remain independent layout items.
- `Spacer` grows on the parent flex axis, never shrinks below its minimum, and
  does not impose a fixed coordinate.
- `frame` creates a grid layout host. Size limits apply to the host and its
  alignment places the content inside it. A frame applied around a component
  therefore does not depend on that component forwarding `style` props.
- `ScrollView` owns overflow only for its declared axis. Other overflow stays
  clipped unless the host's ordinary CSS changes it explicitly.
- `SafeArea` maps selected edges to `env(safe-area-inset-*)`; it does not change
  the child's coordinate system or merge Vune state with browser layout state.
- `GeometryReader` reports the measured host box and normalized safe-area insets.
  SSR and renderer-less evaluation use zero geometry and must remain deterministic.

Arbitrary CSS remains host CSS. A `.style()` modifier before `frame` styles the
content; a `.style()` modifier after `frame` styles the frame host. External
stylesheets, CSS Modules, Sass, PostCSS, and Tailwind can target either element
through ordinary selectors without a Vune-specific preprocessing step.

## Renderer boundary

`Vune View !== React Element` and `Vune View !== Vue VNode`. A call such as
`VStack { Text("Hello") }` first produces a graph. A renderer decides how that
graph becomes a DOM, HTML string, React element, or Vue VNode.

## React ownership boundary

Vune owns the external layout slot of a child. React owns the child component itself.

For ordinary React components, Vune stores layout metadata outside the React element and inserts one neutral layout host when the component is placed inside a Vune layout container. This avoids relying on prop forwarding or assuming a single DOM root inside the component.

Component props, hooks, refs, context, children, and rendering remain React-owned.

## Modifier model

React elements are treated as immutable. Vune modifiers use `cloneElement()` and a proxy facade for method chaining. Component layout metadata is kept separately rather than mutating React element objects.

## State model

`State()` is a small observable value with a `.value` API. A Vune `view()` tracks State reads during render and subscribes the React component to those values.

Arrays and plain objects are mutation-aware. If multiple `State()` values wrap
the same raw mutable container, they share mutation ownership and all of their
subscribers are notified. Proxy identity is intentionally not an application
level contract.

Ownership is lifecycle-aware: each State record is attached only to the raw
containers reachable from its current value while it has subscribers. Root
replacement, nested insertion/deletion, unsubscribe, and re-subscription
reconcile that graph, so old objects do not retain stale records indefinitely.
Circular graphs are traversed with identity tracking.

With the compatibility React Vite macro, top-level State declarations are moved
into `view({ state, body })`. The canonical `@vune-ui/vite` compiler lowers View
syntax and leaves renderer-independent state ownership to the selected adapter.
The state factory runs once per mounted Vune component instance, so two instances
of the same View do not share local state.

## Macros

The compatibility macro is build-time sugar only. It does not replace React at
runtime. The canonical compiler and the compatibility React macro both return
source maps, but they serve different syntax layers.

- `State(initial)` becomes per-view state by moving the declaration into the View state factory.
- `view(expression)` becomes a reactive render body.
- `Action(expression)` becomes a deferred callback.

The stable package entry point is the function DSL. The layout engine,
coordinate runtime, layout observer, metadata/plugin registry, and block-builder
transform are exported from `vune-ui/experimental` until their integration story
is consolidated. Experimental plugins run for both DSL and JSX-created nodes;
JSX additionally records its creation-time modifier metadata.

The explicit runtime APIs remain available when macros are undesirable.

## Interoperability

Raw HTML is represented by graph `Element` nodes and retains ordinary HTML
attributes. `Component()` in `@vune-ui/react` or `@vune-ui/vue` creates a renderer-
owned component node; `reactComponent()` and `vueComponent()` provide typed
callable adapters, while each renderer owns its explicit State/Binding bridge.
The Vue adapter also supports default/named slots. Renderer-specific interop
does not enter `@vune-ui/core`.

## Public surface

The canonical function-DSL entry points are `vune-ui`, `@vune-ui/core`, and
`@vune-ui/react`. The explicit `vune-ui/legacy` subpath retains the legacy React
compatibility surface, implemented by `@vune-ui/legacy-react`. The automatic JSX
runtimes and `vune-ui/vite` remain supported integration entry points.
Coordinate spaces expose `CoordinateNode` values, while the proposal-based
measurement experiment exposes `LayoutNode` values; keeping those concepts
distinct avoids silently treating observed DOM geometry as a layout proposal.
The block-builder transform lives behind `vune-ui/experimental` or `vune-ui/compiler`
until these contracts are consolidated. See [API.md](./API.md) for the current
surface inventory.
