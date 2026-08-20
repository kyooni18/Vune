# Roadmap

Muse's next releases prioritize dependable semantics over additional controls or
new syntax. The alpha already has enough surface area for experimentation; the
focus now is reducing cases where valid Muse code behaves differently because of
syntax, nesting, or the API layer that created it.

## Correctness release

The first correctness pass covers the parts most likely to change program
behavior silently:

- The Vite macro uses a TypeScript AST transform. Only top-level `State(...)`
  declarations are made instance-local; generic calls, nested lexical scopes,
  comments, templates, and unusual whitespace are preserved. `Action(() => ...)`
  keeps its callback semantics, and transformed files include source maps.
- The complete example app is compiled in regression tests, alongside focused
  cases for nested functions, arrow functions, callbacks, generics,
  destructuring, and formatting variations.
- `Group` and `Fragment` are transparent for layout normalization, so a
  container can determine the correct external layout host through nested
  transparent children.
- Mutable raw objects shared by multiple `State` instances have shared
  notification ownership. A mutation notifies every owning subscriber, including
  owners reached through nested state values.
- `Component(...)` preserves required React props in TypeScript. Required props
  remain required when the wrapped component is used from Muse.
- Shared State ownership is reconciled against the current raw object graph;
  root replacement, nested deletion, unsubscribe, re-subscription, arrays,
  shared objects, and circular graphs have regression coverage.
- Macro diagnostics warn when an exported or mutable top-level State declaration
  cannot become instance-local. Mixed declarations are split at the AST
  declaration level, and source maps carry column-level anchors for transformed
  call and argument spans.

## Browser and accessibility release

The browser-facing behavior is covered separately from SSR markup. Client
tests exercise State-driven rerendering, changing dependencies, bindings,
events, mounting and unmounting, subscriptions, refs, context, portals, and
modifiers. A small Playwright suite covers behavior that needs a real browser.

Presentation primitives follow the same direction: `Sheet` handles Escape,
initial focus, focus wrapping, restoration, and portal stacking; `Alert` uses
instance-specific IDs and hydration-safe portals; and `Menu` provides first
item focus, Home/End, disabled skipping, typeahead, Tab close, and
`menuitem` semantics.

## Deliberately deferred work

Some useful systems remain explicit experiments until their integration contract
is settled:

- `LazyVStack` and related APIs use `content-visibility: auto`. This is a
  browser-assisted rendering optimization, not virtualization or windowing.
- Layout-engine, coordinate-runtime, observer, builder, and plugin facilities
  are available from `muse/experimental`; their geometry types now distinguish
  observed `CoordinateNode` values from measured `LayoutNode` values, but they
  are not part of the stable root API yet.
- JSX runtime support is available, but its modifier typing and plugin behavior
  must stay aligned with the function DSL before it is treated as the primary
  authoring path.
- Modifier performance is benchmarked against raw React styles at 100, 1,000,
  and 10,000 elements with chain depths of 1, 5, 10, and 20. CI runs a smaller
  matrix with a generous regression guard; large lists and deeply modified
  trees still establish a measurable need before Muse changes its materialization
  strategy.

## Semantic contract

Muse is a SwiftUI-inspired, CSS-native API with web-native semantics. Stacks, `Spacer`,
`frame`, and infinity sizing express familiar relationships through CSS; they
do not promise SwiftUI's proposal-based layout algorithm or pixel-for-pixel
behavior. That distinction is part of the public contract and will remain
explicit as the library grows.
