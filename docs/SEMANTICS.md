# Muse semantic contract

This document is the normative contract for the renderer-independent Muse
graph. A compiler may lower syntax into this contract, and a renderer may
materialize it, but neither layer may redefine it for a particular component.

## 1. View values and ownership

`View` is an immutable graph value. It is not a React element, Vue VNode, DOM
node, or serialized HTML string.

- `Text("Hello")` is a leaf graph View.
- `VStack { ... }` is a container whose children are the normalized result of a
  `ViewBuilder` closure.
- A user View created by `defineView` or `struct ...: View` is a `ViewHostNode`
  with a declared type, initializer-produced props, optional State, and a body.
- A modifier returns a new `ModifiedContent` node; it never mutates the input
  View or its props.
- `Element(tag, props, children)` is the native graph representation of raw
  HTML. The tag and attribute names remain renderer-neutral until materialization.

The compiler owns syntax recognition, source ranges, lowering, and diagnostics.
The core owns graph construction, initializer resolution, builder normalization,
State/Binding behavior, and identity paths. Renderers own only materialization,
native event/ref wiring, measurement, and host lifecycle.

The public semantic symbol layer is renderer-neutral. Compiler snapshots expose a
TypeScript `TypeChecker` and register their `StructSymbol`, `ViewType`,
`InitializerSymbol`, `State<T>`, `Binding<T>`, `ViewBuilder`, and
`ForeignComponentType` entries in the same symbol shape that runtime `ViewType`
instances expose.

## 2. Initializer resolution

Every callable View declares its valid call forms in initializer metadata. A
renderer or component name must not add an exception or fallback.

Resolution is ordered as follows:

1. Match labels. Labeled arguments are mapped by declaration label; the source
   order of a named carrier distinguishes declarations whose label order differs.
2. Match arity, required parameters, defaults, and variadic parameters.
3. Match closure role: `value`, `@ViewBuilder`, `@Action`, or `@Binding`.
4. Match concrete runtime types when available (`string`, `number`, `View`,
   `Binding<T>`, arrays, and declared unions).
5. Apply declared generic constraints such as `Content: View`.
6. Rank conversion cost. An exact declared match outranks an unknown or
   compatibility conversion.
7. Require one unique best candidate. No candidate is selected by registration
   order; a tie throws `MuseInitializerAmbiguityError` with the candidate
   signatures.

The compiler emits the same metadata boundary for `Button`, `VStack`, custom
generic Views, and foreign components. Trailing-closure validity is determined
by the declared closure role, not by a Button-specific compiler branch.

## 3. ViewBuilder

`ViewBuilder` is a predictable graph normalization boundary:

- `buildBlock` preserves source order and recursively flattens arrays.
- `buildOptional` drops `null`, `undefined`, and `false`.
- `buildEither` retains the selected branch only.
- `buildArray` preserves item order and recursively flattens each item.
- Empty blocks produce an empty child list.
- A generic `Content: View` builder may contain only View graph values after
  normalization.

The lowering of `if/else`, arrays, nested builders, `ForEach`, and trailing
closures must produce the same normalized graph as direct TypeScript calls.

## 4. Identity

Identity is renderer-independent and derives from:

```text
parent path + structural slot + declared View type + explicit key
```

Array, element, and fragment child positions are structural slots. A View type
change at the same slot is a remount boundary. `keyed(key)` and `ForEach` keys
replace the local positional identity so insertion, removal, and reordering do
not move State between logical items. Modifiers do not create a new identity
unless they are an explicit `keyed` modifier.

React keys, Vue VNode keys, and Web identity stores are projections of this
path; they are not independent identity systems. SSR and hydration use the same
path and declared type so server/client construction order does not introduce a
process-local identity.

## 5. State and Binding

`State<T>` owns a mutable value and publishes changes only when the observable
value changes. Its subscription graph follows nested arrays and plain objects,
including shared and circular objects, and detaches stale ownership after root
replacement.

`Binding<T>` is a writable lens. `Binding(state)` reads and writes that State;
custom getter/setter bindings preserve the same writable contract. A renderer
may subscribe or schedule work, but it may not copy State semantics into a
renderer-specific store.

## 6. Native HTML and foreign components

Raw HTML lowers to typed `ElementViewNode` values. Native names such as `class`,
`for`, `aria-*`, and `data-*` are preserved in the graph. Events, refs, children,
modifiers, keys, and renderer materialization follow the same rules as any
other View.

The core semantic layer also publishes the tag/attribute schema used by
`@muse/compiler` and the VS Code extension. Standard elements validate known
attributes and literal value types; `aria-*`, `data-*`, spreads, and hyphenated
custom elements remain extensible. Each lowered element has an
`SemanticHtmlElementSymbol` with per-attribute category and inferred value type,
so HTML diagnostics and completion/hover use the same contract as runtime
`Element` typing.

Foreign component adapters are graph boundaries with props, events, slots,
refs, and a renderer adapter. Vue is an adapter implementation; its lifecycle,
provide/inject, async components, transitions, and teleport remain Vue-owned
after the graph boundary.

Environment and context remain ownership-sensitive. Core graph values encode
portable CSS environment semantics such as `SafeArea`; React and Vue context
providers stay available to foreign components through their native renderer
boundaries, while Web uses the neutral graph descriptor and does not invent a
hidden provider model.

## 7. Renderer conformance

React, Vue, and Web must agree on graph shape, identity, State, Binding,
modifiers, builder normalization, events, raw HTML, SSR output semantics, and
hydration behavior. Differences are limited to native materialization details
such as React `className` versus DOM/Vue `class`, and to renderer-owned
measurement/lifecycle APIs.
