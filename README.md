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
    Text(`Count: ${count.value}`).fontSize(28).bold(),
    HStack(
      { spacing: 8 },
      Button('−', Action(count.value -= 1)),
      Button('+', Action(count.value += 1)),
      Spacer(),
    ).frame({ maxWidth: 'infinity' }),
  ).padding(24),
)
```

`State()` becomes per-component-instance reactive state, `view(...)` becomes the Vue render body, and `Action(expression)` becomes an event callback during the Vite transform.

## Install

```bash
npm install vune vue
```

Vue is a peer dependency. Vune supports Vue 3.3+.

## Coordinate-free layout

Vune prefers relationships over coordinates. Start with `VStack`, `HStack`, `ZStack`, `Grid`, semantic alignment, spacing, `frame`, and `Spacer()` instead of manual x/y placement.

## Native Vue components are first-class layout items

Ordinary Vue components can sit beside Vune primitives and `Spacer()` without changing the component itself:

```ts
import ProfileCard from './ProfileCard.vue'

HStack(
  Text('Profile'),
  Spacer(),
  Component(ProfileCard, { user })
    .padding(12)
    .frame({ minWidth: 240 }),
)
```

Inside Vune layout containers, an ordinary Vue component gets one neutral outer layout host. Vune modifiers such as `padding`, `frame`, `grow`, alignment and visual styles apply to that host instead of being pushed through the component root via attribute fallthrough.

The component VNode stays intact inside the host. Vue continues to own props, slots, emits, local refs/state, provide/inject, lifecycle hooks, template refs and rendering. Fragment/multi-root components and `inheritAttrs: false` components therefore remain one Vune layout item without changing their internals.

Plain Vue VNodes work too:

```ts
HStack(
  Text('Chart'),
  Spacer(),
  h(ThirdPartyChart, chartProps),
)
```

The rule is simple: Vune owns the component's external layout slot; Vue owns the component itself. `withProps()` and `attr()` remain explicit escape hatches when attributes should go directly to the component VNode.

## Extended primitives

Vune 0.9 adds common application building blocks without adding a second renderer or UI runtime:

```ts
Image('/avatar.png', { alt: 'Profile', fit: 'cover', loading: 'lazy' })
Label('Profile', Text('●'))
Link('Settings', '/settings')

ProgressView(progress, { max: 1 })
Picker(category, categories)
Slider(volume, { min: 0, max: 1, step: 0.05 })
Stepper(quantity, { min: 0, max: 10 })

List(
  Section('Account',
    Text('Profile'),
    Text('Security'),
  ),
)

LazyVStack({ estimatedItemSize: 56 }, ...rows)
LazyHStack(...cards)
LazyGrid({ columns: 3, estimatedItemSize: 160 }, ...cards)
```

`Lazy*` uses browser-native `content-visibility` hints. Vue still owns all VNodes and component instances; use any normal Vue virtualization component when true windowed virtualization is needed.

Navigation stays router-agnostic. A Vue Router instance can be passed directly because it already exposes `push()`:

```ts
NavigationStack(
  router,
  VStack(
    NavigationLink('/profile', 'Profile'),
    NavigationLink({ name: 'settings' }, 'Settings'),
  ),
)
```

Presentation primitives use existing platform/Vue behavior:

```ts
Sheet(showingDetails, detailsView)
Alert(showingAlert, { title: 'Delete item?' })
Menu('Actions', editButton, deleteButton)
```

`Sheet()` and `Alert()` use Vue `Teleport`; `Menu()` uses native `details` / `summary`.

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
```

## No-macro fallback

The explicit `View()` API remains supported for non-Vite projects and advanced code.

## Tests

```bash
npm test
```

The suite covers VNode interoperability, component layout hosting, props/slots/emits/refs/lifecycle preservation, coordinate-free layout, `View()` state lifetime, macro transforms, native controls, collections, presentation primitives, model binding, type contracts, SSR, and Vue 3.3/latest compatibility in CI.

## Documentation

- [Additional primitives](docs/WIDGETS.md)
- [Macros](docs/MACROS.md)
- [View API](docs/VIEW.md)
- [API reference](docs/API.md)
- [Vue interoperability](docs/INTEROP.md)
- [Design notes](docs/DESIGN.md)
- [Migration notes](docs/MIGRATION.md)
- [Changelog](docs/CHANGELOG.md)
