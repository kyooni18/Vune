# Design notes

## Goals

Vune is intended to be a readability layer over Vue render functions.

It should:

1. keep Vue as the only renderer and reactivity system,
2. return real VNodes,
3. preserve normal JavaScript control flow,
4. preserve component prop and slot typing where Vue exposes it,
5. make escape to `h()` and raw CSS/props immediate,
6. avoid custom compilation.

It should not become a second framework.

## VNode identity

Styled nodes are VNodes wrapped by a transparent JavaScript Proxy. The Proxy only intercepts modifier names. Any normal VNode field continues to come from the target.

Calling a modifier does not mutate the target. It delegates to Vue's `cloneVNode()` and returns a styled clone.

This has several benefits:

- existing class/style merging follows Vue behavior,
- existing event listeners can be merged by Vue,
- patch flags and VNode metadata are handled by Vue's clone implementation,
- the original node stays reusable.

## Reserved VNode field names

A Proxy method must never shadow a field that Vue's renderer reads from a VNode.

Important collisions include:

- `key`
- `ref`
- `transition`

Therefore the public modifier names are:

- `keyed()`
- `templateRef()`
- `cssTransition()`

This rule is more important than matching another UI framework's spelling.

## Reactivity

The library does not create its own reactive values. It accepts Vue refs/getters in a few convenience primitives, but reactive invalidation remains Vue's responsibility.

A call such as:

```ts
Text(() => count.value)
```

is evaluated when `Text()` is called. It should normally be inside the render function, where reading `count.value` becomes part of Vue's render dependency tracking just like any normal render function expression.

## Component typing

`ComponentProps<C>` first tries to infer the public `$props` type from a component constructor. This is the path used by typical imported SFCs and `defineComponent()` results. Functional components fall back to their declared generic props.

Slot typing uses the same idea with public `$slots`.

The implementation deliberately does not parse runtime `props` options itself; Vue remains the source of truth for component types.

## Coordinate-free layout

Ordinary Vune layout should describe relationships rather than coordinates. Prefer `VStack`, `HStack`, `ZStack`, `Grid`, semantic alignment, spacing, `frame()`, and `Spacer()` before using explicit positioning or transforms.

The public layout vocabulary intentionally uses names such as `leading`, `trailing`, `topLeading`, and `bottomTrailing` so callers can express intent without translating it into `top`, `left`, or pixel offsets. `frame({ maxWidth: 'infinity' })` represents filling the available parent width without requiring manual size arithmetic.

This is a default path, not a restriction. Web layouts occasionally need CSS positioning, transforms, or application-specific style rules, so `.position()`, `.style()`, `.align()`, and `.justify()` remain available as lower-level escape hatches. The library should not hide CSS when CSS is genuinely the right tool.

Semantic frame alignment still follows the library's no-hidden-wrapper rule: modifiers patch the node's own layout styles rather than inserting an implicit DOM element.

## Styling

Common style operations are exposed as modifiers for readability. `style()` remains the universal escape hatch.

A modifier patches VNode props. It does **not** imply a DOM wrapper. On a native element, CSS props naturally target that element. On a component VNode, they follow Vue's ordinary attribute-fallthrough rules. Vue built-ins may not represent a CSS box at all.

`Group()` is intentionally an unstyled Fragment because a Fragment has no CSS box. `Box()` is the explicit escape hatch when callers require a real `div` styling boundary. The library should not inspect component roots or invent wrapper behavior behind the caller's back.

The library will not try to reproduce every CSS property as a method. If a style is uncommon or application-specific, raw CSS is the preferred answer.

## Wrapper identity

Primitives that add structural wrappers are responsible for preserving identity at the sibling level Vue patches. `ZStack()` uses one grid-layer wrapper per child, so a keyed child VNode has its key copied to that wrapper. The child itself remains untouched.

## Controlled native props

Convenience controls such as `TextField`, `TextArea`, and `Toggle` own the props required for their binding contract (`value`, `checked`, and checkbox `type`). User props are merged with Vue's `mergeProps()` so event listeners compose using Vue semantics while controlled props remain authoritative.

## Control flow

There is no custom `If`, `ForEach`, or expression language. JavaScript and TypeScript already provide control flow, narrowing, map/filter, generators, and normal functions.

## Built-ins

Wrappers for Transition, TransitionGroup, Teleport, Suspense, and KeepAlive do not reimplement those features. They call the corresponding Vue exports with render-function slots.

## Compatibility policy

The peer range is Vue 3.3 through Vue 3.x. New APIs should be added only when they can preserve this compatibility range or when a major version explicitly raises it.

## Native scrolling and basic shapes

`ScrollView()` is a semantic convenience over native CSS overflow, not a second scrolling subsystem. Axis selection maps directly to `overflow-x` / `overflow-y`, and all browser/Vue scrolling behavior remains intact.

`Rectangle()`, `RoundedRectangle()`, `Circle()`, and `Capsule()` are similarly thin presets over an ordinary `div`. They exist because CSS boxes express those shapes exactly and compose naturally with the existing modifier layer. Vector geometry, paths, clipping systems, and SwiftUI-style shape protocols are intentionally out of scope; those would require a separate abstraction rather than pretending to be ordinary CSS boxes.
