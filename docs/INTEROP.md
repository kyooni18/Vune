# Vue interoperability

The central rule of Vune is simple: the public result is a Vue VNode, not a parallel node type.

## Mix with `h()` in either direction

DSL inside ordinary Vue:

```ts
h('main', null, [
  Text('Heading').bold(),
  VStack(...rows),
])
```

Ordinary Vue inside the DSL:

```ts
VStack(
  Text('Heading'),
  h(RouterView),
  h(ThirdPartyChart, chartProps),
)
```

`Raw()` is only needed when you want modifiers on a VNode you already created. Modifiers patch that VNode's props; they do not insert a wrapper:

```ts
Raw(h(ThirdPartyChart, chartProps))
  .frame({ minHeight: 320 })
```

For component VNodes, CSS props still rely on Vue's normal attribute fallthrough. If the component has multiple roots, disables fallthrough, or otherwise does not expose a suitable DOM root, use an explicit `Box()`:

```ts
Box(
  h(ThirdPartyChart, chartProps),
)
  .frame({ minHeight: 320 })
```

`Group()` is deliberately different: it returns a plain Fragment and has no modifier chain because there is no CSS box to modify.

## Existing `.vue` components

A normal imported SFC can be passed to `Component()`:

```ts
import UserCard from './UserCard.vue'

Component(UserCard, {
  user,
  compact: true,
})
```

For common SFC/`defineComponent()` component types, props are inferred through the component's public `$props` type. Functional-component props are also supported.

## Slots

Vue render functions pass component slots as functions. The helper does the same:

```ts
Component(Dialog, { open: true }, {
  default: () => Text('Body'),
  footer: () => Button('Close', close),
})
```

There is no slot-specific runtime owned by this package.

## `v-model`

Templates compile component `v-model` to a prop and `update:*` listener. The model modifier writes exactly that render-function shape:

```ts
Component(Editor)
  .model(content)
```

Named model:

```ts
Component(Pager)
  .model(page, 'page')
```

Equivalent Vue render-function structure:

```ts
h(Pager, {
  page: page.value,
  'onUpdate:page': value => {
    page.value = value
  },
})
```

## Router, Pinia, composables, lifecycle APIs

Nothing changes. Use them normally in `setup()`:

```ts
setup() {
  const router = useRouter()
  const store = useAccountStore()

  onMounted(() => {
    store.load()
  })

  return () => VStack(
    Text(store.name),
    Button('Settings', () => router.push('/settings')),
  )
}
```

The library does not wrap the component instance or Composition API.

## JavaScript control flow

Use native language constructs rather than framework-specific control-flow helpers:

```ts
return () => VStack(
  loading.value
    ? Text('Loading…')
    : Results(results.value),

  ...items.value.map(item =>
    ItemRow(item).keyed(item.id),
  ),
)
```

This keeps debugger behavior, TypeScript narrowing, and ordinary function composition intact.

## Vue built-ins

The included wrappers call Vue's own built-ins. You can always bypass them and use `h()` directly.

```ts
Transition(panel, { name: 'fade' })
Teleport('#modals', dialog)
Suspense(page, spinner)
KeepAlive(dynamicPage)
```

## SSR and hydration

Because output is standard VNodes, Vue's SSR pipeline remains the owner of rendering and hydration. Avoid browser-only work during render for the same reasons you would in any other Vue render function.

The repository includes a `vue/server-renderer` smoke test.

## Third-party UI libraries

A third-party component does not need a Vune adapter:

```ts
Component(ExternalButton, {
  variant: 'primary',
  onClick: save,
})
```

If a library uses unusual render conventions, fall back to its documented `h()` usage and optionally wrap the resulting VNode with `Raw()`.
