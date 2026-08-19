# Changelog

## 0.6.0

- Added `View()` as the primary declarative component entry point.
- Normal Vune views no longer need callers to write `defineComponent()`, `setup()`, or a render function.
- Added `View(() => body)` for stateless views.
- Added `View({ state, body })` for stateful views; state is created once per Vue component instance while `body` participates in Vue reactive rendering.
- Reworked the example app and README to use `View()` as the default style.
- Added dedicated runtime and type-contract tests for the View API.
- Kept ordinary Vue SFCs, `defineComponent()`, render functions, composables, lifecycle hooks, and `h()` as fully supported escape/interoperability paths.

## 0.5.0

- Added coordinate-free semantic stack options: `VStack({ alignment, spacing })`, `HStack({ alignment, spacing })`, and `ZStack({ alignment })`.
- Added SwiftUI-style alignment names including `leading`, `trailing`, `topLeading`, and `bottomTrailing`.
- Added `.alignment()` for semantic alignment on styled nodes and containers.
- Added `frame({ maxWidth: 'infinity' })` / `maxHeight: 'infinity'` expansion plus frame alignment.
- Kept `.position()`, `.align()`, `.justify()`, transforms, and raw CSS available as lower-level escape hatches.
- Added runtime and type-contract coverage for semantic layout behavior.

## 0.4.0

- Added `ScrollView()` with vertical, horizontal, and two-axis native overflow behavior.
- Added CSS-box shape primitives: `Rectangle()`, `RoundedRectangle()`, `Circle()`, and `Capsule()`.
- Kept scrolling deliberately runtime-free: no custom scroll state, listeners, or lifecycle layer.
- Kept basic shapes deliberately CSS-native: no SVG/path abstraction or separate graphics runtime.
- Added runtime, type-contract, and SSR coverage for scrolling and shape primitives.
- Expanded the example app to dogfood `ScrollView`, shapes, and `ZStack` together.

## 0.3.0

- Added `Box()` as an explicit `div` styling boundary.
- Changed `Group()` to return a plain Vue Fragment without modifier chaining.
- Preserved keyed child identity through `ZStack()` layer wrappers.
- Switched bound native control listener composition to Vue `mergeProps()` semantics.
- Added Vue native HTML attribute types and Vue 3.3/latest compatibility CI.

## 0.2.0

- Added typed `Component()`, `Grid`, `ZStack`, `TextArea`, model helpers, typed events, Vue built-in wrappers, runtime/type/SSR tests, and expanded documentation.

## 0.1.0

- Initial release with basic stack, text, control, raw VNode, and modifier helpers.
