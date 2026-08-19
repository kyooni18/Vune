# Vune

A small functional UI layer for Vue 3 render functions.

`VStack()`, `Text()`, `Button()` and the other helpers are ordinary functions that return real Vue VNodes. There is no custom runtime, compiler, template syntax, JSX transform, or macro system.

```ts
import { defineComponent, h, ref } from 'vue'
import { Button, HStack, Text, VStack } from 'vune'
import ExistingCard from './ExistingCard.vue'

export default defineComponent({
  setup() {
    const count = ref(0)

    function increment() {
      count.value += 1
    }

    return function render() {
      return VStack(
        Text(() => `Count: ${count.value}`)
          .fontSize(24)
          .bold(),

        HStack(
          Button('+', increment),

          // Ordinary Vue VNodes work directly.
          h(ExistingCard, { count: count.value }),
        ).gap(8),
      )
        .gap(16)
        .padding(24)
    }
  },
})
```

No `<template>` or JSX is required.

## Install

```bash
npm install vune vue
```

Vue is a peer dependency. The package supports Vue 3.3+.

## Coordinate-free layout

Vune's default layout model is relationship-based rather than coordinate-based. Use stacks, semantic alignment, spacing, frames, and `Spacer()` before reaching for CSS positioning.

```ts
VStack({ alignment: 'leading', spacing: 12 },
  Text('Profile').fontSize(28).bold(),
  Text('No x/y coordinates required.'),

  HStack({ alignment: 'center', spacing: 8 },
    Button('Cancel', cancel),
    Spacer(),
    Button('Save', save),
  )
    .frame({ maxWidth: 'infinity' }),
)
```

Semantic alignments use SwiftUI-style names: `leading`, `center`, `trailing`, `top`, `bottom`, `topLeading`, `topTrailing`, `bottomLeading`, and `bottomTrailing`. Stack constructors accept the alignments that make sense on their cross axis:

```ts
VStack({ alignment: 'leading', spacing: 16 }, ...children)
HStack({ alignment: 'top', spacing: 12 }, ...children)
ZStack({ alignment: 'topTrailing' }, background, badge)
```

A frame can expand to the available width or height without manual coordinates:

```ts
Text('Settings')
  .frame({ maxWidth: 'infinity', alignment: 'leading' })
```

`.position()`, transforms, and raw CSS layout modifiers remain available as escape hatches for unusual web layouts, but they are not the primary layout path.

## Why this stays compatible with Vue

The library does not create a second component model. A DSL node is still a Vue VNode:

```ts
const title = Text('Profile')

h('header', null, [title])
```

Normal Vue VNodes can be placed inside DSL layouts without an adapter:

```ts
VStack(
  Text('Profile'),
  h(ProfileCard, { user }),
)
```

Use `Raw()` only when an already-created VNode needs modifier chaining:

```ts
Raw(h(ProfileCard, { user }))
  .padding(12)
  .background('#fff')
  .radius(8)
```

Existing Vue components can also be created through the typed `Component()` helper:

```ts
Component(ProfileCard, {
  user,
  compact: true,
})
```

For SFCs and `defineComponent()` components, public props are inferred from the component type.

## Normal JavaScript stays normal JavaScript

There is intentionally no `If` or `ForEach` DSL.

```ts
VStack(
  loggedIn.value
    ? Text('Welcome')
    : Text('Sign in'),

  ...users.value.map(user =>
    UserRow(user).keyed(user.id),
  ),
)
```

The goal is to remove render-function noise, not replace JavaScript.

## Layout primitives

```ts
Box(...children)
VStack(...children)
HStack(...children)
ZStack(...children)
ScrollView(child, 'vertical' | 'horizontal' | 'both')
Grid(3, ...children)
Grid({ columns: '240px 1fr', rows: 'auto 1fr' }, ...children)
Spacer()
Divider()
Group(...children)
```

`ZStack` overlays its children by placing each child in the same CSS grid cell. Keyed child identity is copied to the lightweight layer wrapper so keyed reordering keeps Vue's sibling identity intact.

`ScrollView()` is intentionally just a native overflow container. It does not introduce custom scroll state or lifecycle behavior:

```ts
ScrollView(
  HStack(...cards).gap(12),
  'horizontal',
).height(180)
```

The default axis is `vertical`; `both` enables native scrolling on both axes.

`Group()` is a real Vue Fragment and intentionally does **not** expose modifier chaining because a Fragment has no CSS box. Use `Box()` when you need an explicit DOM styling boundary:

```ts
Group(Text('A'), Text('B'))

Box(
  Component(ThirdPartyPanel),
)
  .padding(16)
  .background('#fff')
```

## Shapes

The basic shape primitives are ordinary CSS boxes, so they keep the same modifier and Vue interop behavior as `Box()`:

```ts
Rectangle()
RoundedRectangle(12)
Circle()
Capsule()
```

For example:

```ts
ZStack(
  Circle()
    .width(48)
    .height(48)
    .background('#5865f2'),
  Text('42').foreground('#fff'),
)
```

`Circle()` uses a 50% border radius; give it equal width and height when you need a true circle. More complex vector shapes are intentionally outside this CSS-box layer.

## Controls

```ts
Text('Hello')
Button('Save', save)
TextField(name)
TextArea(description)
Toggle(enabled)
```

`Text`, `Button`, and other value-taking primitives can read refs or getters when they are created inside the render function:

```ts
Text(() => `Count: ${count.value}`)
```

## Modifiers

Modifiers clone the VNode with Vue's `cloneVNode()` rather than mutating it. They patch VNode props; they do not create a DOM wrapper.

For native elements this maps directly to the element. For component VNodes, CSS props depend on normal Vue attribute fallthrough. If you need a guaranteed DOM box, wrap the node in `Box()`.

```ts
Button('Save', save)
  .disabled(!valid.value)
  .padding('horizontal', 14)
  .padding('vertical', 8)
  .background('#111')
  .foreground('#fff')
  .radius(8)
  .cursor('pointer')
```

Common modifier groups include:

- spacing: `padding`, `margin`, `gap`
- sizing: `width`, `height`, min/max sizing, `frame`
- surfaces: `background`, `foreground`, `opacity`, `radius`, `border`, `shadow`
- typography: `fontSize`, `fontWeight`, `fontFamily`, `lineHeight`, `textAlign`, `bold`
- flex/layout: `grow`, `shrink`, `flex`, `wrap`, `order`, `align`, `justify`
- positioning: `position`, `overflow`, `cursor`, `zIndex`, `transform`, `cssTransition`
- Vue/DOM props: `id`, `role`, `disabled`, `keyed`, `templateRef`, `model`
- escape hatches: `className`, `style`, `withProps`, `attr`, `on`
- typed events: `onClick`, `onInput`, `onChange`, `onKeyDown`, `onKeyUp`, `onFocus`, `onBlur`, `onSubmit`, pointer and mouse helpers

### Why `.keyed()` and `.templateRef()` instead of `.key()` and `.ref()`?

Vue VNodes already have real `key` and `ref` fields. Because styled nodes remain VNodes, shadowing those fields with methods would break Vue's renderer. The safe modifier names are therefore:

```ts
Text(user.name).keyed(user.id)
TextField(name).templateRef(inputRef)
```

Function forms are also available:

```ts
Key(user.id, Text(user.name))
TemplateRef(inputRef, TextField(name))
```

`cssTransition()` is named for the same reason: VNodes already have an internal `transition` field.

## Component slots

```ts
Component(Dialog, { title: 'Settings' }, {
  default: () => VStack(
    Text('General'),
    TextField(name),
  ),
  footer: () => HStack(
    Button('Cancel', cancel),
    Button('Save', save),
  ),
})
```

Typed slots are preserved when the component exposes slot types through Vue's public component instance.

## v-model compatibility

Vue render functions expand component `v-model` into a prop plus an `update:*` event. `model()` does the same thing:

```ts
Component(Editor, { language: 'markdown' })
  .model(content)
```

Named models work too:

```ts
Component(Pager)
  .model(page, 'page')
```

Or use the convenience function:

```ts
Model(Editor, content, { language: 'markdown' })
```

Transforms are available for component APIs whose public value differs from your local ref type:

```ts
Component(Slider)
  .model(percent, {
    name: 'value',
    transformIn: value => value / 100,
    transformOut: value => Number(value) * 100,
  })
```

## Vue built-ins

Render-function wrappers are included for common built-ins:

```ts
Transition(child, { name: 'fade' })
TransitionGroup(items, { name: 'list', tag: 'div' })
Teleport('#modals', dialog)
Suspense(content, loading)
KeepAlive(page)
```

These call Vue's own built-in components. `Suspense` remains subject to Vue's own experimental-status caveat.

## SSR

The nodes are ordinary VNodes, so they can be rendered by Vue's server renderer. The repository includes an SSR smoke test using `vue/server-renderer`.

## Tests

```bash
npm test
```

The suite covers VNode interop, modifier immutability, key/ref safety, model binding, layout identity, native controlled props, event merging, compile-time component/native prop checks, and SSR rendering.

Repository development uses Vite 8, so the demo/dev toolchain requires Node 20.19+ (or 22.12+). The published library itself remains a small ESM package and keeps the package-level `engines.node` range at Node 18+.

## Documentation

- [API reference](docs/API.md)
- [Vue interoperability](docs/INTEROP.md)
- [Design notes](docs/DESIGN.md)
- [Migration from 0.1](docs/MIGRATION.md)
- [Changelog](docs/CHANGELOG.md)
