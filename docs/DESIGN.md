# Design notes

## Goals

Vune should keep Vue as the only renderer and reactivity system, return real VNodes, preserve JavaScript control flow and Vue component typing, and keep optional build-time transforms small and explicit.

## Native-component layout boundary

An opaque Vue component has two responsibilities that Vune must not confuse: its external position in the Vune layout and its internal Vue component tree/behavior.

For direct component children of Vune layout boundaries, Vune creates one neutral layout host. Layout/style metadata is attached to the outer host while the original component VNode remains its child.

This makes Fragment/multi-root components and `inheritAttrs: false` deterministic layout items. Vune does not inspect or rewrite a component's rendered root to position it.

Props, slots, emits, model bindings, keys and template refs remain on the component VNode. Local refs/state, composables, provide/inject and lifecycle remain Vue-owned. Keyed component identity is copied to the host so keyed sibling reordering preserves parent-level identity.

Once inside a Vune layout, Vune intentionally owns the outer flex/grid item while the component owns everything inside it.

Automatic hosts are limited to Vune layout boundaries (`VStack`, `HStack`, `Grid`, `ZStack`, `Box`, `ScrollView`). Arbitrary `Element(tag, ...)` composition does not inject a `div`, because doing so could invalidate semantic HTML.

## Styling

On native VNodes, style modifiers patch normal VNode style props. On component VNodes used in Vune layout, style-oriented modifiers are stored as layout-host metadata instead of being pushed through component attribute fallthrough.

`withProps()` and `attr()` remain explicit component-level escape hatches. `Group()` remains an unstyled Fragment.

## Coordinate-free layout

Ordinary Vune layout should describe relationships rather than coordinates. Prefer `VStack`, `HStack`, `ZStack`, `Grid`, semantic alignment, spacing, `frame()`, and `Spacer()` before explicit positioning or transforms.

## Reactivity and macros

Vune does not create a second reactive system. Runtime state is backed by Vue refs and Vue remains responsible for dependency tracking and invalidation. The optional Vite macro remains syntax sugar over the public runtime APIs and must not create a second lifecycle, renderer or expression language.

## Compatibility policy

The peer range is Vue 3.3 through Vue 3.x. New APIs should preserve that compatibility range unless a major version explicitly raises it.
