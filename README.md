# Vune

Vune is a small SwiftUI-like declarative UI layer for Vue 3.

Normal Vune views do not require a Vue `<template>`, JSX, `defineComponent()`, `setup()`, or a hand-written `render()` function. Vune still uses Vue as the renderer and reactivity system, and its UI primitives return real Vue VNodes.

```ts
import { ref } from 'vue'
import { Button, HStack, Spacer, Text, View, VStack } from 'vune'

export default View({
  state: () => ({
    count: ref(0),
  }),

  body: ({ count }) =>
    VStack(
      { alignment: 'leading', spacing: 16 },

      Text(() => `Count: ${count.value}`)
        .fontSize(28)
        .bold(),

      HStack(
        { spacing: 8 },
        Button('−', () => count.value -= 1),
        Button('+', () => count.value += 1),
        Spacer(),
      )
        .frame({ maxWidth: 'infinity' }),
    )
      .padding(24),
})
```

## Install

```bash
npm install vune vue
```

Vue is a peer dependency. Vune supports Vue 3.3+.

## Views without render boilerplate

For a stateless view, `View()` can take the body directly:

```ts
export default View(() =>
  VStack(
    Text('Hello').fontSize(32).bold(),
    Text('No setup() or render() required.'),
  )
)
```

For local state, use `state` and `body`:

```ts
export default View({
  state: () => ({
    name: ref(''),
    enabled: ref(true),
  }),

  body: ({ name, enabled }) =>
    VStack(
      TextField(name),
      HStack(Toggle(enabled), Text(() => enabled.value ? 'On' : 'Off')),
    ),
})
```

`state()` runs once for each Vue component instance. `body` is the reactive view body Vue evaluates when dependencies change. This keeps state creation separate from rendering without exposing Vue's render-function boilerplate to normal Vune code.

Advanced Vue code can still use `defineComponent()`, `h()`, lifecycle hooks, composables, and ordinary Vue components whenever needed.

## Coordinate-free layout

Vune prefers relationships over coordinates. Start with stacks, semantic alignment, spacing, frames, grids, and `Spacer()` rather than `top`, `left`, or manual x/y placement.

```ts
VStack(
  { alignment: 'leading', spacing: 12 },
  Text('Profile').fontSize(28).bold(),
  Text('No x/y coordinates required.'),

  HStack(
    { alignment: 'center', spacing: 8 },
    Button('Cancel', cancel),
    Spacer(),
    Button('Save', save),
  )
    .frame({ maxWidth: 'infinity' }),
)
```

Semantic alignment names include `leading`, `center`, `trailing`, `top`, `bottom`, `topLeading`, `topTrailing`, `bottomLeading`, and `bottomTrailing`.

```ts
VStack({ alignment: 'leading', spacing: 16 }, ...children)
HStack({ alignment: 'top', spacing: 12 }, ...children)
ZStack({ alignment: 'topTrailing' }, background, badge)
```

Frames can expand into available space without coordinate math:

```ts
Text('Settings')
  .frame({ maxWidth: 'infinity', alignment: 'leading' })
```

Low-level `.position()`, transforms, `.style()`, `.align()`, and `.justify()` remain available as escape hatches for web layouts that genuinely need CSS-level control.

## Core primitives

```ts
Box(...children)
VStack(...children)
HStack(...children)
ZStack(...children)
Grid(3, ...children)
ScrollView(child, 'vertical' | 'horizontal' | 'both')
Spacer()
Divider()
Group(...children)

Text('Hello')
Button('Save', save)
TextField(name)
TextArea(description)
Toggle(enabled)

Rectangle()
RoundedRectangle(12)
Circle()
Capsule()
```

## Modifiers

Modifiers return styled Vue VNodes and can be chained:

```ts
Button('Save', save)
  .padding('horizontal', 14)
  .padding('vertical', 8)
  .background('#111')
  .foreground('#fff')
  .radius(8)
  .cursor('pointer')
```

Common groups include spacing, sizing and `frame`, surfaces, typography, flex layout, semantic alignment, DOM/Vue props, events, and raw `style()` / `withProps()` escape hatches.

## Vue interoperability

Vune does not introduce a second component model. Ordinary Vue VNodes can be placed inside Vune layouts directly:

```ts
VStack(
  Text('Profile'),
  h(ProfileCard, { user }),
)
```

Use `Component()` for typed Vue component construction:

```ts
Component(ProfileCard, {
  user,
  compact: true,
})
```

Use `Raw()` when an existing VNode needs Vune modifier chaining:

```ts
Raw(h(ProfileCard, { user }))
  .padding(12)
  .background('#fff')
  .radius(8)
```

Normal JavaScript control flow stays normal JavaScript. Vune intentionally does not add custom `If` or `ForEach` constructs.

## Tests

```bash
npm test
```

The suite covers Vue VNode interoperability, modifiers, semantic coordinate-free layout, `View()` state lifetime, type contracts, controls, model binding, SSR, and Vue 3.3/latest compatibility in CI.

Repository development uses Vite 8, so the demo toolchain requires Node 20.19+ or 22.12+. The published library keeps its package-level Node range at 18+.

## Documentation

- [View API](docs/VIEW.md)
- [API reference](docs/API.md)
- [Vue interoperability](docs/INTEROP.md)
- [Design notes](docs/DESIGN.md)
- [Migration notes](docs/MIGRATION.md)
- [Changelog](docs/CHANGELOG.md)
