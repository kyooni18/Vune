# Design notes

## Goals

Vune is intended to be a readability layer over Vue render functions.

It should:

1. keep Vue as the only renderer and reactivity system,
2. return real VNodes,
3. preserve normal JavaScript control flow,
4. preserve component prop and slot typing where Vue exposes it,
5. make escape to `h()` and raw CSS/props immediate,
6. keep optional build-time transforms small, explicit, and independent from the runtime renderer.

It should not become a second framework.

## Optional macro layer

The Vite macro is syntax sugar over the public runtime APIs. It rewrites only Vune-owned forms: `State(...)`, the default exported `view(...)`, and `Action(...)` expressions inside that view. The transformed result delegates to `View()` and Vue refs.

The macro must not invent a second component lifecycle, renderer, reactivity graph, or expression language. It should be possible to understand the generated semantics in terms of ordinary `View()`, functions, and Vue state.

Macro-free code remains supported. `View()` is the explicit fallback when a project does not use Vite or does not want source transformation.

## VNode identity

Styled nodes are VNodes wrapped by a transparent JavaScript Proxy. The Proxy only intercepts modifier names. Any normal VNode field continues to come from the target.

Calling a modifier does not mutate the target. It delegates to Vue's `cloneVNode()` and returns a styled clone.

This preserves Vue class/style merging, event-listener composition, patch metadata, and original-node reuse.

## Reserved VNode field names

A Proxy method must never shadow a field that Vue's renderer reads from a VNode. Important collisions include `key`, `ref`, and `transition`, so the public modifier names are `keyed()`, `templateRef()`, and `cssTransition()`.

## Reactivity

Vune does not create a second reactive system. Runtime state is backed by Vue refs and Vue remains responsible for dependency tracking and invalidation.

With the macro, top-level `State(...)` declarations associated with the default `view(...)` are relocated into per-component-instance state. Without the macro, `View({ state, body })` provides the same lifetime explicitly.

## Component typing

`ComponentProps<C>` infers public `$props` from component constructors when available, with functional-component fallbacks. Slot typing follows the same public-instance approach. Vue remains the source of truth for component types.

## Coordinate-free layout

Ordinary Vune layout should describe relationships rather than coordinates. Prefer `VStack`, `HStack`, `ZStack`, `Grid`, semantic alignment, spacing, `frame()`, and `Spacer()` before explicit positioning or transforms.

The public vocabulary uses semantic names such as `leading`, `trailing`, `topLeading`, and `bottomTrailing`. `frame({ maxWidth: 'infinity' })` represents filling the available parent width without manual size arithmetic.

This is a default path, not a restriction. `.position()`, `.style()`, `.align()`, `.justify()`, and transforms remain lower-level escape hatches for web layouts that genuinely need them.

## Styling

Common style operations are exposed as modifiers for readability. `style()` remains the universal escape hatch.

A modifier patches VNode props and does not imply a DOM wrapper. On component VNodes, styles follow Vue's ordinary attribute-fallthrough rules. `Group()` is an unstyled Fragment; `Box()` is the explicit real-DOM styling boundary.

## Wrapper identity

Primitives that add structural wrappers preserve identity at the sibling level Vue patches. `ZStack()` copies a keyed child VNode's key to its grid-layer wrapper while leaving the child untouched.

## Controlled native props

`TextField`, `TextArea`, and `Toggle` own the props required for their binding contract. User props are merged with Vue's `mergeProps()` so event listeners compose while controlled props remain authoritative.

## Control flow

There is no custom `If`, `ForEach`, or general expression language. JavaScript and TypeScript remain the control-flow language. The macro does not rewrite arbitrary lambdas or third-party APIs.

## Built-ins

Wrappers for Transition, TransitionGroup, Teleport, Suspense, and KeepAlive call the corresponding Vue exports rather than reimplementing those features.

## Compatibility policy

The peer range is Vue 3.3 through Vue 3.x. New APIs should preserve that compatibility range unless a major version explicitly raises it.

## Native scrolling and basic shapes

`ScrollView()` maps directly to native CSS overflow. `Rectangle()`, `RoundedRectangle()`, `Circle()`, and `Capsule()` are thin presets over ordinary CSS boxes. Vector geometry and a separate graphics runtime remain out of scope.
