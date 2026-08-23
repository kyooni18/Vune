# Changelog

## Next alpha

- Hardened canonical Muse parsing/lowering against ordinary TypeScript methods, generators, generics, regex literals, multiline State, qualified View calls, statement-bearing ViewBuilders, and raw-HTML/entity edge cases.
- Made top-level State ownership binding-aware and scope-aware; shared/exported/mutable State remains module-scoped and emits `MUSE_STATE_SCOPE` warnings in compiler and VS Code diagnostics.
- Unified concrete View identity and typed `ForEach` keys across React, Vue, and Web, including same-display-name remounts and lazy offscreen State preservation.
- Hardened the Web renderer's commit/ref lifecycle, native event aliases, boolean/ARIA attributes, SVG/XML namespaces, hydration prop reconciliation, and lazy State cleanup.
- Added context-aware source maps, cache-safe TypeScript specialization reuse, renderer parity/browser CI, the medium Showcase fixture, expanded performance workloads, and release-package verification.
- Aligned `Grid`/`LazyGrid` TypeScript overload order with runtime initializer indices, added minified production-bundle Chromium validation for all seven browser fixtures, and made DOM benchmark rounds sequential to remove cross-instance JSDOM scheduling noise.
- Replaced the State/Action Vite macro scanner with a TypeScript AST transform and source maps; generic State calls, lexical scopes, and function-valued actions are preserved.
- Added regression coverage for `examples/App.ts`, transparent Group fragments, shared mutable State ownership, required Component props, JSX modifier typing, JSDOM interaction, and presentation accessibility.
- Added Escape/focus handling for Sheet, a single alertdialog host for Alert, and keyboard/menuitem semantics for Menu.
- Added State owner reconciliation and cleanup for replacement, nested, shared, circular, and unsubscribed object graphs; split mixed macro declarations and added column-level source-map anchors plus diagnostics.
- Added unique Alert IDs, stacked-presentation hydration tests, expanded Menu keyboard behavior, repeated dynamic-dependency tests, fragment stress cases, and SSR hydration coverage.
- Unified experimental geometry naming around `CoordinateNode` and measured `LayoutNode`; expanded the modifier benchmark matrix and added a CI benchmark guard.
- Moved layout experiments, coordinate/observer infrastructure, plugin metadata, and the block-builder transform behind `vune-ui/experimental`.
- Standardized repository commands on pnpm and added React 18/19 CI coverage plus an opt-in Playwright browser suite.

## 0.1.0

- Made arrays and plain objects stored in `State()` mutation-aware, including nested plain-object updates such as `items.value.push(...)` and `items.value[0].done = true`.
- Kept React elements, frozen values, class instances, `Map`, `Set`, and other special objects outside the mutable-container proxy path.
- Fixed `Spacer(minLength)` so an explicit minimum length is not lost to flex shrinking.
- Expanded React interoperability coverage for `memo`, `forwardRef`, `Raw(...)`, and directly-created React component elements inside Muse layout containers.
- Revalidated TypeScript build, runtime tests, macro transforms, and the React/Vite demo in CI.

## 1.0.0-alpha.3

- Switched Muse state subscriptions to React `useSyncExternalStore` semantics.
- Preserved top-level `State()` declaration order inside macro-generated per-view state factories so later state initializers can reference earlier state values.
- Added typed React props support to `view()` and allowed scoped state factories to initialize from props.
- Expanded runtime coverage for controls, collections, navigation, presentation, SSR portal safety, and state subscription behavior.
- Revalidated TypeScript build, runtime tests, macro transforms, and the React/Vite demo in CI.

## 1.0.0-alpha.2

- Replaced the Vue runtime with React and React DOM.
- Reimplemented Muse elements as React elements while preserving method-style modifiers.
- Reimplemented coordinate-free stack, grid, spacer, scroll, and shape primitives.
- Added React component layout hosts so normal React components remain first-class Muse layout items.
- Reworked `State`, `Action`, and `view` macros for per-component-instance React state.
- Ported controls: Image, Label, Link, ProgressView, Picker, Slider, and Stepper.
- Ported collections: List, Section, LazyVStack, LazyHStack, and LazyGrid.
- Ported navigation and presentation with React Context and React portals.
- Replaced the example app and CI with React/Vite coverage.

## 0.9.x and earlier

The 0.x line was Vue-based. Muse 1.0 intentionally changes renderer rather than maintaining a dual-runtime compatibility layer.
