# Roadmap

Vune's next releases prioritize dependable semantics over additional controls or
new syntax. The alpha already has enough surface area for experimentation; the
focus now is reducing cases where valid Vune code behaves differently because of
syntax, nesting, or the API layer that created it.

## View-system foundation

The first workspace architecture slice is now implemented:

- `@vune-ui/core` is React-free and owns graph nodes, initializer metadata,
  `ViewBuilder`, immutable modifiers, `State`, `Binding`, and closure roles.
- `@vune-ui/compiler` and `@vune-ui/vite` handle `.vune.ts` builder/struct lowering.
- `@vune-ui/react`, `@vune-ui/vue`, and `@vune-ui/web` consume the same graph through
  renderer interfaces, with layout primitives and native controls migrated first.
- Core-owned `Text`, stacks, layout, collection, presentation, native control,
  `Element`, and custom View definitions are available without React.
  `.vune.ts` raw HTML lowers to those graph `Element` nodes, including
  typed standard attributes/events and extensible `aria-*`, `data-*`, and
  custom-element attributes.
- The core graph concentration point is split behind stable internal modules
  for graph types/symbols, nodes, immutable modifiers, identity-aware traversal,
  environment helpers, and initializer semantics; the public graph barrel stays
  unchanged and focused modules are covered by boundary tests.
- Type-checker-backed compiler specialization is isolated in its own internal
  pass. Proven calls use a trusted AOT initializer path, compiler-generated
  labeled arguments are normalized to runtime slots, simple ViewBuilders are
  materialized directly, modifier chains use compact fused descriptors, and
  immutable subtrees are hoisted. Proven intrinsic host trees are additionally
  lowered into a renderer-neutral compiled template plus identity-preserving
  dynamic slots; React, Vue, Web DOM, and Web SSR have native template
  materializers. Unresolved or ambiguous calls retain the guarded/dynamic
  fallback contract.
- State dependency metadata can bypass first-render dependency discovery only
  when a conservative closed-body proof succeeds; opaque helpers and shared
  State automatically retain runtime collection.
- The Web renderer is split into shared serialization/DOM contracts, SSR,
  DOM props, hydration, and live DOM reconciliation modules; its public barrel
  remains unchanged and the existing lazy, GeometryReader, hydration, and
  identity tests cover the split.
- `editors/vscode` provides `.vune.ts` Vune/HTML highlighting, diagnostics,
  formatting, completion, hover, definition, rename, and optional `.vue`
  provider coverage.

The first View-system slice is implemented and covered by `tests/view-system.test.mjs`:

- initializer metadata selects overloads from arguments and rejects an
  unsupported trailing closure;
- `defineView`/`structView` provide a user View `init`/`body` boundary;
- builder IR helpers cover block, optional, either, array, and `ForEach`
  composition;
- `State` and `Binding` remain reactive while modifier chains retain value
  semantics and an inspectable graph;
- `@vune-ui/vue` bridges graph values to Vue VNodes, Vue components and slots, with
  explicit `toVueRef`/`fromVueRef` reactivity conversion;
- the builder compiler has a source-ranged builder/struct AST, labeled
  arguments, struct lowering, diagnostics, formatter hooks, source-map output,
  and an original-source language-service adapter without a component-name
  registry.

Collection, presentation, and native control implementations are owned by
`@vune-ui/core`; `@vune-ui/react` keeps reference-identical compatibility re-exports.
The old root entry points are implemented by the separate `@vune-ui/legacy-react`
package and preserved as `@vune-ui/react/legacy` compatibility proxy exports; new
work should target the canonical graph and renderer APIs instead of extending
that legacy surface.

## Correctness release

The first correctness pass covers the parts most likely to change program
behavior silently:

- The canonical `@vune-ui/compiler` lowers builder/struct syntax with original-source
  diagnostics and token-anchored source maps. The compatibility React Vite macro
  remains a TypeScript AST transform: only top-level `State(...)` declarations
  are made instance-local; generic calls, nested lexical scopes, comments,
  templates, and unusual whitespace are preserved. `Action(() => ...)` keeps its
  callback semantics, and transformed files include source maps.
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
  remain required when the wrapped component is used from Vune.
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

Lazy containers now expose a renderer-neutral range boundary. `@vune-ui/web`
uses estimated-size spacers and scroll/resize range updates to window direct
DOM mounts; SSR, React, and Vue retain a full-graph fallback with
`content-visibility` hints.

## Release hardening gate

The current alpha hardening pass is now backed by executable release gates rather
than documentation-only goals:

- compiler regression coverage includes ordinary TypeScript method/generator
  disambiguation, nested ViewBuilder control flow, renderer-neutral State
  ownership, dynamic initializer values, raw HTML/type-assertion boundaries,
  qualified View calls, source maps, and specialization cache invalidation;
- React, Vue, and Web share concrete View identity, typed collection keys,
  canonical leaf semantics, keyed State lifetime, and live conformance tests;
- Web DOM behavior covers commit-phase refs, event-name normalization, HTML/ARIA
  boolean attributes, SVG/`foreignObject` namespaces, client-authoritative
  hydration, and logically-present lazy State;
- the medium `examples/Showcase.vune.ts` application exercises bindings, async
  actions, custom Views, keyed reordering, lazy collections, Grid, modifier
  chains, and raw HTML in one production build;
- CI builds all standard, parity, and Showcase demos and runs Playwright parity
  against React, Vue, and Web with isolated Vite caches;
- release verification checks package exports/types, tree-shaking declarations,
  `pnpm pack` workspace-version rewriting, package contents, and a clean offline
  install/import/SSR/compiler/Vite smoke test.

Performance remains guarded by both modifier-depth and application-style
workloads so semantic fixes cannot silently introduce unbounded compile or render
regressions.

## Deliberately deferred work

Some useful systems remain explicit experiments until their integration contract
is settled:

- The first renderer-neutral template/slot IR is implemented for proven host
  element/fragment structure. Static props/styles/leaves are frozen once and
  dynamic primitive or custom-View children are slots; renderer-native template
  hooks bypass generic host traversal while preserving core identity. The next
  frontier is dynamic host-prop/event slots, keyed `ForEach` templates, and more
  direct Web patch locations rather than a second renderer-specific language.
- Declaration-driven specialization already emits trusted initializer-index
  calls for proven same-file and imported Views, direct arrays for simple
  ViewBuilders, compact modifier payloads, and module-level static subtrees.
  Predicate-only legacy initializers, unknown/non-View receivers, unsafe
  callable types, and ambiguous overloads remain dynamic by design.
- Legacy layout-engine, coordinate-runtime, observer, builder, and plugin
  facilities remain available from `vune-ui/experimental`; canonical
  `GeometryReader` now owns the cross-renderer measured-host contract while the
  older coordinate types remain compatibility-only.
- JSX runtime support is available, but its modifier typing and plugin behavior
  must stay aligned with the function DSL before it is treated as the primary
  authoring path.
- Modifier performance is benchmarked against raw React styles at 100, 1,000,
  and 10,000 elements with chain depths of 1, 5, 10, and 20. The performance
  suite also measures compiler transforms, State propagation, keyed DOM updates,
  raw React/Vue and Vune adapter rerenders (full, single-item, and keyed reverse),
  SSR, hydration, and retained heap. CI runs the 100/1,000
  matrix with depth-aware and absolute regression guards; large lists and deeply
  modified trees still establish a measurable need before Vune changes its
  materialization strategy.

## Semantic contract

Vune is a SwiftUI-inspired, CSS-native API with web-native semantics. Stacks, `Spacer`,
`frame`, and infinity sizing express familiar relationships through CSS; they
do not promise SwiftUI's proposal-based layout algorithm or pixel-for-pixel
behavior. That distinction is part of the public contract and will remain
explicit as the library grows.
