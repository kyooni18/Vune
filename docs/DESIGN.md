# Muse React design

Muse is a declarative TypeScript UI layer that uses React as its renderer rather than introducing a second rendering engine.

## Layout

The normal API expresses relationships rather than coordinates. `VStack`, `HStack`, `ZStack`, `Grid`, `Spacer`, alignment, spacing, and `frame` are the primary layout vocabulary. Low-level CSS remains available through modifiers when needed.

Muse's layout is SwiftUI-inspired, not a promise to reproduce SwiftUI's
proposal-based geometry algorithm. `frame`, infinity sizing, and stacks map
the relationship into web-native CSS semantics.

## React ownership boundary

Muse owns the external layout slot of a child. React owns the child component itself.

For ordinary React components, Muse stores layout metadata outside the React element and inserts one neutral layout host when the component is placed inside a Muse layout container. This avoids relying on prop forwarding or assuming a single DOM root inside the component.

Component props, hooks, refs, context, children, and rendering remain React-owned.

## Modifier model

React elements are treated as immutable. Muse modifiers use `cloneElement()` and a proxy facade for method chaining. Component layout metadata is kept separately rather than mutating React element objects.

## State model

`State()` is a small observable value with a `.value` API. A Muse `view()` tracks State reads during render and subscribes the React component to those values.

Arrays and plain objects are mutation-aware. If multiple `State()` values wrap
the same raw mutable container, they share mutation ownership and all of their
subscribers are notified. Proxy identity is intentionally not an application
level contract.

Ownership is lifecycle-aware: each State record is attached only to the raw
containers reachable from its current value while it has subscribers. Root
replacement, nested insertion/deletion, unsubscribe, and re-subscription
reconcile that graph, so old objects do not retain stale records indefinitely.
Circular graphs are traversed with identity tracking.

With the Vite macro, top-level State declarations are moved into `view({ state, body })`. The state factory runs once per mounted Muse component instance, so two instances of the same View do not share local state.

## Macros

The macro is build-time sugar only. It does not replace React at runtime. The
Vite macro is parsed with the TypeScript AST and returns source maps.

- `State(initial)` becomes per-view state by moving the declaration into the View state factory.
- `view(expression)` becomes a reactive render body.
- `Action(expression)` becomes a deferred callback.

The stable package entry point is the function DSL. The layout engine,
coordinate runtime, layout observer, metadata/plugin registry, and block-builder
transform are exported from `muse/experimental` until their integration story
is consolidated. Experimental plugins run for both DSL and JSX-created nodes;
JSX additionally records its creation-time modifier metadata.

The explicit runtime APIs remain available when macros are undesirable.

## Interoperability

`Component()` creates normal React component elements. `Raw()` accepts existing React elements. Because Muse ultimately returns React elements and components, existing React libraries can be mixed in rather than wrapped behind a separate renderer.

## Public surface

The root `muse` entry point intentionally contains the stable function DSL. The
automatic JSX runtimes and `muse/vite` are supported integration entry points.
Coordinate spaces expose `CoordinateNode` values, while the proposal-based
measurement experiment exposes `LayoutNode` values; keeping those concepts
distinct avoids silently treating observed DOM geometry as a layout proposal.
The block-builder transform lives behind `muse/experimental` or `muse/compiler`
until these contracts are consolidated. See [API.md](./API.md) for the current
surface inventory.
