# Changelog

## 0.8.0

- Made ordinary Vue component VNodes first-class Vune layout items through a neutral outer layout host.
- `VStack`, `HStack`, `Grid`, `Box`, `ScrollView`, and `ZStack` keep a component as one parent-level layout item even when it renders Fragment/multiple roots.
- Routed Vune style/layout modifiers on component VNodes to the host instead of relying on Vue attribute fallthrough.
- Kept props, slots, emits, model bindings, keys, template refs, local state and lifecycle on the original Vue component VNode.
- Added custom-renderer interoperability tests covering `Spacer()` adjacency, Fragment roots, `inheritAttrs: false`, props, slots, emits, refs, local state, mount/unmount lifecycle, and plain `h(component)` VNodes.
- Documented the boundary: Vune owns external layout; Vue owns the component instance and internals.

## 0.7.0

- Added the optional `vuneMacro()` Vite transform through the `vune/vite` package entry.
- Added macro-first `view(...)`, `State(...)`, and `Action(...)` forms so ordinary Vune view source can avoid `setup()`, `render()`, and common `() =>` wrappers.
- `State(...)` declarations are relocated into per-component-instance state during the transform.
- `Action(expression)` is rewritten into a deferred event callback rather than evaluating during render.
- Reworked the example app to contain no authored arrow functions.
- Kept `View()` as the macro-free fallback and Vue as the only renderer/reactivity system.

## 0.6.0

- Added `View()` as a declarative component entry point that hides `defineComponent()`, `setup()`, and hand-written render functions.
- Added stateful and stateless view forms while preserving per-instance Vue state lifetime.

## 0.5.0

- Added coordinate-free semantic stack options and SwiftUI-style alignment names.
- Added `.alignment()` and infinity frame expansion.

## 0.4.0

- Added `ScrollView()` and CSS-box shape primitives.

## 0.3.0

- Added `Box()`, Fragment-based `Group()`, native control merging, and Vue compatibility CI.

## 0.2.0

- Added typed `Component()`, `Grid`, `ZStack`, `TextArea`, model helpers, typed events, Vue built-ins, tests and docs.

## 0.1.0

- Initial release with basic stack, text, control, raw VNode, and modifier helpers.
