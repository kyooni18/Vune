# Additional Vune primitives

Vune 0.9 expands the small core with native-web primitives that keep Vue as the renderer and reactivity owner.

## Media and labels

```ts
Image('/avatar.png', {
  alt: 'Profile',
  fit: 'cover',
  loading: 'lazy',
})

Label('Account', Image('/account.svg'))
Link('Open settings', '/settings')
```

`Image()` is a normal `img` VNode. `Link()` is a normal anchor. Neither introduces a custom loading or navigation runtime.

## Progress and form controls

```ts
const category = State('all')
const volume = State(0.5)
const count = State(1)

Picker(category, [
  { label: 'All', value: 'all' },
  { label: 'Unread', value: 'unread' },
])

Slider(volume, { min: 0, max: 1, step: 0.05 })
Stepper(count, { min: 0, max: 10 })
ProgressView(volume, { max: 1 })
```

`Picker()` uses a native `select`, `Slider()` uses `input[type=range]`, and `ProgressView()` uses the native `progress` element. Bound refs stay authoritative just like `TextField()` and `Toggle()`.

## Lists and sections

```ts
List(
  Section('Account',
    Text('Profile'),
    Text('Security'),
  ),
  Section('About',
    Text('Version'),
  ),
)
```

`List()` creates one semantic list row per direct child. Ordinary Vue components inside rows keep the same neutral layout-host behavior used by the rest of Vune.

## Lazy containers

```ts
LazyVStack(
  { spacing: 8, estimatedItemSize: 56 },
  ...rows,
)

LazyHStack(...cards)
LazyGrid({ columns: 3, estimatedItemSize: 160 }, ...cards)
```

The lazy containers deliberately do not create a second virtualization runtime. They apply browser-native `content-visibility: auto` and `contain-intrinsic-size` hints to VNode children. Vue still creates and owns the component instances. If an application needs true windowed virtualization, a normal Vue virtual-list component can be placed inside Vune like any other Vue component.

## Navigation

Vune does not depend directly on Vue Router. `NavigationStack()` accepts any router-like object with `push(destination)`, so a Vue Router instance can be passed directly.

```ts
NavigationStack(
  router,
  VStack(
    NavigationLink('/profile', 'Profile'),
    NavigationLink({ name: 'settings' }, 'Settings'),
  ),
)
```

`NavigationLink()` renders a normal anchor and uses the nearest `NavigationStack()` router for ordinary left-click navigation. Modified clicks and `_blank` links keep native browser behavior.

## Presentation

```ts
Sheet(showingDetails,
  VStack(
    Text('Details'),
    Button('Close', Action(showingDetails.value = false)),
  ),
)

Alert(showingDeleteAlert, {
  title: 'Delete item?',
  message: 'This cannot be undone.',
  actions: [
    { label: 'Cancel', role: 'cancel' },
    { label: 'Delete', role: 'destructive', action: removeItem },
  ],
})

Menu('Actions',
  Button('Edit', edit),
  Button('Delete', remove),
)
```

`Sheet()` and `Alert()` use Vue's own `Teleport`. `Menu()` uses the browser's native `details` / `summary` behavior. No separate modal, focus, navigation, or reactivity runtime is introduced.
