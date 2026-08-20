# Rui React design

Rui is a declarative TypeScript UI layer that uses React as its renderer rather than introducing a second rendering engine.

## Layout

The normal API expresses relationships rather than coordinates. `VStack`, `HStack`, `ZStack`, `Grid`, `Spacer`, alignment, spacing, and `frame` are the primary layout vocabulary. Low-level CSS remains available through modifiers when needed.

## React ownership boundary

Rui owns the external layout slot of a child. React owns the child component itself.

For ordinary React components, Rui stores layout metadata outside the React element and inserts one neutral layout host when the component is placed inside a Rui layout container. This avoids relying on prop forwarding or assuming a single DOM root inside the component.

Component props, hooks, refs, context, children, and rendering remain React-owned.

## Modifier model

React elements are treated as immutable. Rui modifiers use `cloneElement()` and a proxy facade for method chaining. Component layout metadata is kept separately rather than mutating React element objects.

## State model

`State()` is a small observable value with a `.value` API. A Rui `view()` tracks State reads during render and subscribes the React component to those values.

With the Vite macro, top-level State declarations are moved into `view({ state, body })`. The state factory runs once per mounted Rui component instance, so two instances of the same View do not share local state.

## Macros

The macro is build-time sugar only. It does not replace React at runtime.

- `State(initial)` becomes per-view state by moving the declaration into the View state factory.
- `view(expression)` becomes a reactive render body.
- `Action(expression)` becomes a deferred callback.

The explicit runtime APIs remain available when macros are undesirable.

## Interoperability

`Component()` creates normal React component elements. `Raw()` accepts existing React elements. Because Rui ultimately returns React elements and components, existing React libraries can be mixed in rather than wrapped behind a separate renderer.
