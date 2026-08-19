# Vue interoperability

The central rule of Vune is that Vue remains the component model, renderer and reactivity system. Vune only adds a declarative layout/styling layer around ordinary Vue VNodes.

## Ordinary Vue components are Vune layout items

A normal SFC or `defineComponent()` component can be placed directly beside Vune primitives and `Spacer()`:

```ts
import UserCard from './UserCard.vue'

HStack(
  Text('Account'),
  Spacer(),
  Component(UserCard, { user, compact: true }),
)
```

Plain `h()` component VNodes work as well:

```ts
HStack(
  Text('Chart'),
  Spacer(),
  h(ThirdPartyChart, chartProps),
)
```

When a component VNode is a direct child of `VStack`, `HStack`, `Grid`, `Box` or `ScrollView`, Vune gives it one neutral layout host. `ZStack` reuses its existing layer wrapper as that host. The component stays untouched inside it.

This means a Fragment/multi-root component is still one layout item:

```text
HStack
├─ Text
├─ Spacer
└─ layout host
   └─ Vue component
      ├─ root A
      └─ root B
```

The host carries Vune layout/visual modifiers such as `padding`, `margin`, `frame`, `grow`, `background`, `border`, `alignment`, and raw `.style()`. They no longer depend on Vue attribute fallthrough.

The inner component VNode continues to carry component semantics: props, emits/listeners, slots, `v-model`, key, template ref and explicit component props. Local state, composables, provide/inject, lifecycle and rendering stay entirely Vue-owned.

## Why the host exists

Without a host, a component with multiple roots or `inheritAttrs: false` cannot reliably receive CSS/layout modifiers from its parent. Passing `style` to the component would also make Vune layout depend on the component's attribute-fallthrough policy.

The host separates responsibilities:

```text
Vune: outer placement and styling
Vue:  component instance and internal render tree
```

This keeps a component beside `Spacer()` as one flex/grid sibling regardless of how many DOM roots it renders internally.

## Modifier routing

Style-oriented Vune modifiers target the layout host:

```ts
Component(UserCard, { user })
  .padding(12)
  .frame({ minWidth: 240 })
  .background('#fff')
  .radius(12)
```

Component-oriented modifiers stay on the component VNode:

```ts
Component(Editor)
  .model(content)
  .keyed(editorId)
  .templateRef(editorRef)
```

`withProps()` and `attr()` continue to patch the component VNode directly when a third-party component intentionally accepts those values as part of its public API.

## Slots, emits, refs and lifecycle

`Component()` passes Vue render-function slots unchanged. Event listeners remain component props and are not moved to the host. `.templateRef()` remains attached to the inner component VNode, so it resolves to the component's normal public instance/exposed API. Mount/unmount hooks follow Vue's normal lifecycle.

## Router, Pinia, composables and provide/inject

Nothing changes. These APIs still execute inside the normal Vue component instance. The layout host is only an ordinary DOM parent and does not create a second component context.

## Low-level DOM composition

Vune does not insert layout hosts inside arbitrary `Element(tag, ...)` children because doing so could produce invalid HTML, for example inside tables or lists. `Group()` also remains a real Fragment and does not create a styling/layout box.

## SSR and hydration

The inner nodes remain standard Vue VNodes and the host is deterministic output from Vune layout primitives, so Vue remains responsible for SSR and hydration.
