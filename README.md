# Vune

Vune is a small SwiftUI-like declarative UI layer for Vue 3. Its default Vite workflow can hide coordinates, `setup()`, `render()`, and common arrow-function wrappers while still rendering ordinary Vue VNodes.

## Macro setup

```ts
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { vuneMacro } from 'vune/vite'

export default defineConfig({
  plugins: [
    vuneMacro(),
    vue(),
  ],
})
```

Then a stateful view can be written without `() =>` in normal Vune code:

```ts
import { Action, Button, HStack, Spacer, State, Text, VStack, view } from 'vune'

const count = State(0)

export default view(
  VStack(
    { alignment: 'leading', spacing: 16 },

    Text(`Count: ${count.value}`)
      .fontSize(28)
      .bold(),

    HStack(
      { spacing: 8 },
      Button('−', Action(count.value -= 1)),
      Button('+', Action(count.value += 1)),
      Spacer(),
    )
      .frame({ maxWidth: 'infinity' }),
  )
    .padding(24),
)
```

`State()` becomes per-component-instance reactive state, `view(...)` becomes the Vue render body, and `Action(expression)` becomes an event callback during the Vite transform. The source stays valid TypeScript and the generated code still delegates to Vue.

## Install

```bash
npm install vune vue
```

Vue is a peer dependency. Vune supports Vue 3.3+.

## Coordinate-free layout

Vune prefers relationships over coordinates. Start with `VStack`, `HStack`, `ZStack`, `Grid`, semantic alignment, spacing, `frame`, and `Spacer()` instead of manual x/y placement.

```ts
VStack(
  { alignment: 'leading', spacing: 12 },
  Text('Profile').fontSize(28).bold(),
  HStack(
    { spacing: 8 },
    Button('Cancel', cancel),
    Spacer(),
    Button('Save', save),
  )
    .frame({ maxWidth: 'infinity' }),
)
```

Semantic alignment names include `leading`, `center`, `trailing`, `top`, `bottom`, `topLeading`, `topTrailing`, `bottomLeading`, and `bottomTrailing`.

Low-level `.position()`, transforms, `.style()`, `.align()`, and `.justify()` remain available as escape hatches when web-specific control is genuinely needed.

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

## No-macro fallback

The explicit `View()` API remains supported for non-Vite projects and advanced code:

```ts
export default View({
  state: () => ({ count: ref(0) }),
  body: ({ count }) => VStack(Text(() => count.value)),
})
```

Vune macros only rewrite the reserved `State`, `view`, and `Action` forms. They do not rewrite arbitrary JavaScript functions, so normal language and Vue behavior stay predictable.

## Vue interoperability

Vune does not introduce a second renderer or component model. Ordinary Vue VNodes can be placed inside Vune layouts, `Component()` can construct typed Vue components, and `Raw()` can add modifiers to an existing VNode.

## Tests

```bash
npm test
```

The suite covers VNode interoperability, coordinate-free layout, `View()` state lifetime, macro transforms, controls, model binding, type contracts, SSR, and Vue 3.3/latest compatibility in CI.

Repository development uses Vite 8, so the demo toolchain requires Node 20.19+ or 22.12+. The published library keeps its package-level Node range at 18+.

## Documentation

- [Macros](docs/MACROS.md)
- [View API](docs/VIEW.md)
- [API reference](docs/API.md)
- [Vue interoperability](docs/INTEROP.md)
- [Design notes](docs/DESIGN.md)
- [Migration notes](docs/MIGRATION.md)
- [Changelog](docs/CHANGELOG.md)
