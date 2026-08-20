# Vune

Vune is a SwiftUI-like declarative UI layer for React. It keeps layout coordinate-free, lets UI be written as plain TypeScript expressions, and uses React as the renderer and component runtime.

The default Vite workflow can hide common callback wrappers with `State`, `Action`, and `view` macros, so a stateful screen can stay compact without JSX.

## Quick start

For a local sibling checkout:

```bash
pnpm add ../Vune
pnpm add react react-dom
```

For Vite, install the React plugin and put the Vune macro before it:

```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { vuneMacro } from 'vune/vite'

export default defineConfig({
  plugins: [
    vuneMacro(),
    react(),
  ],
})
```

A Vune screen can then be a plain `.ts` file:

```ts
import {
  Action,
  Button,
  HStack,
  Spacer,
  State,
  Text,
  VStack,
  view,
} from 'vune'

const count = State(0)

export default view(
  VStack(
    { alignment: 'leading', spacing: 16 },
    Text('Hello, Vune').fontSize(28).bold(),
    Text(`Count: ${count.value}`),
    Button('Increase', Action(count.value += 1)),
    HStack(
      Text('Left'),
      Spacer(),
      Text('Right'),
    ).frame({ maxWidth: 'infinity' }),
  )
  .padding(24)
  .frame({ maxWidth: 'infinity' }),
)
```

The macro moves top-level `State()` declarations into per-component-instance state, re-evaluates the `view(...)` body reactively, and turns `Action(expression)` into a deferred event callback.

## React entry point

A minimal app entry can stay free of JSX too:

```ts
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('app')!).render(createElement(App))
```

## Reusable views with props

`view()` can also create reusable React components with typed props:

```ts
const Greeting = view((props: { name: string }) =>
  Text(`Hello, ${props.name}`),
)
```

State-scoped views can initialize their local Vune state from React props too:

```ts
type CounterProps = {
  initial: number
  label: string
}

const Counter = view({
  state: (props: CounterProps) => ({
    count: State(props.initial),
  }),
  body: ({ count }, props) =>
    Text(`${props.label}: ${count.value}`),
})
```

The state factory runs once per mounted component instance. Later prop changes are passed to the body without recreating that instance state.

## Coordinate-free layout

Vune prefers relationships over x/y coordinates:

```ts
VStack(
  { alignment: 'leading', spacing: 12 },
  Text('Title'),
  HStack(
    Text('Left'),
    Spacer(),
    Text('Right'),
  ),
)
```

Core layout primitives include `Box`, `VStack`, `HStack`, `ZStack`, `Grid`, `ScrollView`, `Spacer`, `Divider`, and `Group`.

`Spacer()` consumes available flex space. `HStack` is full-width by default, and `.frame({ maxWidth: 'infinity' })` is available when a parent or another element should explicitly stretch.

## Modifiers and CSS

Common styling stays attached to the Vune object:

```ts
Text('Hello')
  .fontSize(32)
  .bold()
  .foreground('#eee')
  .padding(12)
  .background('#222')
  .radius(10)
```

Use `.style()` for CSS properties that do not have a dedicated modifier:

```ts
Text('Hello').style({
  letterSpacing: '0.05em',
  userSelect: 'none',
})
```

Class-based CSS is also available through `.className()`.

## React components are first-class layout items

Ordinary React components can sit beside Vune primitives and `Spacer()`:

```ts
function ProfileCard(props: { name: string }) {
  return createElement('strong', null, props.name)
}

HStack(
  Text('Profile'),
  Spacer(),
  Component(ProfileCard, { name: 'Vune' })
    .padding(12)
    .frame({ minWidth: 240 }),
)
```

Inside a Vune layout container, a normal React component gets one neutral outer layout host. Layout modifiers apply to that host instead of being pushed into the component's own props. React keeps ownership of the component itself, including hooks, refs, context, props, children, and rendering.

`Raw(element)` accepts an already-created React element when needed.

## Controls

```ts
Text('Hello')
Button('Save', save)
TextField(name)
TextArea(description)
Toggle(enabled)

Image('/avatar.png', { alt: 'Profile', fit: 'cover' })
Label('Profile', Text('●'))
Link('Settings', '/settings')
ProgressView(progress, { max: 1 })
Picker(category, categories)
Slider(volume, { min: 0, max: 1, step: 0.05 })
Stepper(quantity, { min: 0, max: 10 })
```

## Collections

```ts
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

`Lazy*` uses browser `content-visibility` hints. It is not a windowed virtualization engine; normal React virtualization libraries can be used through `Component(...)` when true virtualization is needed.

## Navigation and presentation

Navigation remains router-agnostic. Pass any object with `push(destination)`:

```ts
NavigationStack(
  router,
  VStack(
    NavigationLink('/profile', 'Profile'),
    NavigationLink('/settings', 'Settings'),
  ),
)
```

Presentation primitives use React portals and platform HTML:

```ts
Sheet(showingDetails, detailsView)
Alert(showingAlert, { title: 'Delete item?' })
Menu('Actions', editButton, deleteButton)
```

`Sheet()` and `Alert()` use `createPortal()`. `Menu()` uses native `details` / `summary`.

## Explicit no-macro form

Vite macros are optional. The explicit state-scoped form is:

```ts
export default view({
  state: () => ({ count: State(0) }),
  body: ({ count }) => VStack(
    Text(`Count: ${count.value}`),
    Button('Increase', () => { count.value += 1 }),
  ),
})
```

## Tests

```bash
npm test
npm run demo:build
```

CI currently checks TypeScript build output, public type usage, runtime rendering, macro transforms, and the React Vite demo.

## Status

The React rewrite is currently versioned as `1.0.0-alpha.2`. The previous Vue runtime was the 0.x line and is intentionally not retained as a compatibility layer in 1.0.

See [Design](docs/DESIGN.md), [Migration](docs/MIGRATION.md), and [Changelog](docs/CHANGELOG.md).