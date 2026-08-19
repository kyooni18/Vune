# Changelog

## 0.7.0

- Added the optional `vuneMacro()` Vite transform through the `vune/vite` package entry.
- Added macro-first `view(...)`, `State(...)`, and `Action(...)` forms so ordinary Vune view source can avoid `setup()`, `render()`, and common `() =>` wrappers.
- `State(...)` declarations are relocated into per-component-instance state during the transform.
- `Action(expression)` is rewritten into a deferred event callback rather than evaluating during render.
- Reworked the example app to contain no authored arrow functions.
- Added macro transform runtime tests, type-contract coverage, documentation, and explicit runtime errors when macro-only forms are used without the plugin.
- Kept `View()` as the macro-free fallback and Vue as the only renderer/reactivity system.

## 0.6.0

- Added `View()` as a declarative component entry point that hides `defineComponent()`, `setup()`, and hand-written render functions.
- Added stateful and stateless view forms while preserving per-instance Vue state lifetime.
- Reworked the example and README around declarative views.

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
- Switched native bound controls to Vue `mergeProps()` listener semantics.
- Added Vue native HTML attribute types and Vue 3.3/latest compatibility CI.

## 0.2.0

- Added typed `Component()`, `Grid`, `ZStack`, `TextArea`, model helpers, key/ref helpers, typed DOM events, Vue built-ins, and expanded tests/docs.

## 0.1.0

- Initial release with basic stack, text, control, raw VNode, and modifier helpers.
