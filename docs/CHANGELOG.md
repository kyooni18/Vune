# Changelog

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
- Changed `Group()` to return a plain Vue Fragment without modifier chaining, avoiding CSS modifiers that could not have a box to affect.
- Preserved keyed child identity through `ZStack()` layer wrappers by copying child keys to the sibling wrapper level.
- Switched `TextField`, `TextArea`, and `Toggle` listener composition to Vue `mergeProps()` semantics.
- Made controlled native props authoritative (`TextField`/`TextArea` value, `Toggle` type/checked, and `Button` type).
- Added Vue native HTML attribute types for `Text`, `Button`, `TextField`, `TextArea`, and `Toggle`.
- Added compatibility CI for Vue 3.3 and the latest Vue 3.x line.
- Documented VNode-prop modifier semantics, component attribute fallthrough, and explicit DOM styling boundaries.

## 0.2.0

- Added `Component()` with public prop and slot type inference.
- Kept `ComponentNode` as a deprecated compatibility alias.
- Added `Grid`, `ZStack`, and `TextArea` primitives.
- Added `Key`, `TemplateRef`, `Slots`, and `Model` helpers.
- Added `.model()` support for default and named Vue component models.
- Added optional model input/output transforms.
- Added `.keyed()` and `.templateRef()` without shadowing VNode fields.
- Added typed DOM event modifiers.
- Added more typography, flex, position, overflow, cursor, shadow, transform, z-index, and CSS transition modifiers.
- Added wrappers for Vue Transition, TransitionGroup, Teleport, Suspense, and KeepAlive.
- Added runtime, type-contract, and SSR tests.
- Added API, interoperability, design, and migration documentation.
- Expanded the example application.

## 0.1.0

- Initial release with basic stack, text, control, raw VNode, and modifier helpers.
