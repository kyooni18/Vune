# Changelog

## 1.0.0-alpha.4

- Made arrays and plain objects stored in `State()` mutation-aware, including nested plain-object updates such as `items.value.push(...)` and `items.value[0].done = true`.
- Kept React elements, frozen values, class instances, `Map`, `Set`, and other special objects outside the mutable-container proxy path.
- Fixed `Spacer(minLength)` so an explicit minimum length is not lost to flex shrinking.
- Expanded React interoperability coverage for `memo`, `forwardRef`, `Raw(...)`, and directly-created React component elements inside Rui layout containers.
- Revalidated TypeScript build, runtime tests, macro transforms, and the React/Vite demo in CI.

## 1.0.0-alpha.3

- Switched Rui state subscriptions to React `useSyncExternalStore` semantics.
- Preserved top-level `State()` declaration order inside macro-generated per-view state factories so later state initializers can reference earlier state values.
- Added typed React props support to `view()` and allowed scoped state factories to initialize from props.
- Expanded runtime coverage for controls, collections, navigation, presentation, SSR portal safety, and state subscription behavior.
- Revalidated TypeScript build, runtime tests, macro transforms, and the React/Vite demo in CI.

## 1.0.0-alpha.2

- Replaced the Vue runtime with React and React DOM.
- Reimplemented Rui elements as React elements while preserving method-style modifiers.
- Reimplemented coordinate-free stack, grid, spacer, scroll, and shape primitives.
- Added React component layout hosts so normal React components remain first-class Rui layout items.
- Reworked `State`, `Action`, and `view` macros for per-component-instance React state.
- Ported controls: Image, Label, Link, ProgressView, Picker, Slider, and Stepper.
- Ported collections: List, Section, LazyVStack, LazyHStack, and LazyGrid.
- Ported navigation and presentation with React Context and React portals.
- Replaced the example app and CI with React/Vite coverage.

## 0.9.x and earlier

The 0.x line was Vue-based. Rui 1.0 intentionally changes renderer rather than maintaining a dual-runtime compatibility layer.
