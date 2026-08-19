# API reference

## Core primitives

### `Element(tag, props?, ...children)`

Creates a native-element VNode and adds modifier chaining.

```ts
Element('section', { 'aria-label': 'Account' },
  Text('Profile'),
)
```

Use this when no higher-level primitive is appropriate.

### `Component(component, props?, slots?)`

Creates a Vue component VNode. The helper attempts to preserve the component's public props and slot types.

```ts
Component(UserCard, {
  user,
  compact: true,
})
```

Slots use the same render-function contract Vue expects:

```ts
Component(Dialog, { title: 'Settings' }, {
  default: () => Text('Body'),
  footer: () => Button('Save', save),
})
```

`ComponentNode` remains as a deprecated alias for 0.1 compatibility.

### `Raw(vnode)`

Adds modifier chaining to an existing Vue VNode. It does not wrap the VNode.

```ts
Raw(h(ThirdPartyWidget, props)).padding(12)
```

### `Slots(object)`

An identity helper that is useful when a slot object is defined separately and you want TypeScript to preserve its function signatures.

### `Group(...children)`

Returns a plain Vue Fragment VNode. A Fragment has no DOM/CSS box, so `Group()` intentionally does not expose modifier chaining. Use `Key(key, Group(...))` when the Fragment itself needs a key.

### `Box(...children)`

Creates a neutral `div` and adds modifier chaining. Use it when you need an explicit DOM styling boundary around arbitrary children or a component whose attrs do not fall through to a single DOM root.

```ts
Box(Component(Panel))
  .padding(16)
  .background('#fff')
```

## Layout

### `VStack(...children)`

A `div` with `display: flex` and `flex-direction: column`.

### `HStack(...children)`

A `div` with horizontal flex layout and centered cross-axis alignment.

### `ZStack(...children)`

Uses CSS Grid to overlay children in the same grid cell. Each child receives one lightweight layer wrapper so arbitrary VNode types remain untouched. When a child VNode has a key, that key is copied to the sibling layer wrapper so keyed reordering preserves identity at the level Vue patches.

### `ScrollView(child, axis?)`

Creates a native overflow container. The default axis is `vertical`; supported values are `vertical`, `horizontal`, and `both`.

```ts
ScrollView(
  HStack(...cards).gap(12),
  'horizontal',
).height(180)
```

The implementation maps the selected axis directly to `overflow-x` and `overflow-y`. It does not create a custom scrolling runtime, scroll position model, or lifecycle.

### `Grid(columnsOrOptions, ...children)`

```ts
Grid(3, ...cards)

Grid({
  columns: '220px 1fr',
  rows: 'auto 1fr',
  autoFlow: 'row',
}, sidebar, content)
```

A numeric `columns` value expands to `repeat(n, minmax(0, 1fr))`.

### `Spacer(minLength?)`

A flex spacer with `flex-grow: 1`.

### `Divider()`

Returns an `hr` VNode.

## Shapes

The shape helpers are normal `div` VNodes with CSS border-radius presets. They remain fully compatible with ordinary modifiers and Vue VNode composition.

### `Rectangle()`

Returns an unrounded CSS box.

### `RoundedRectangle(radius = 8)`

Returns a CSS box with the supplied corner radius.

### `Circle()`

Returns a CSS box with `border-radius: 50%`. Equal width and height are required for a geometric circle; unequal dimensions intentionally produce an ellipse-like box.

### `Capsule()`

Returns a CSS box with a very large border radius (`9999px`) for pill/capsule surfaces.

```ts
HStack(
  Circle().width(32).height(32).background('#5865f2'),
  Capsule().width(72).height(28).background('#eee'),
).gap(12)
```

These helpers do not introduce SVG or path semantics. Use ordinary Vue/SVG VNodes when vector geometry is required.

## Text and controls

### `Text(value, props?)`

Accepts a string, number, ref, or getter.

```ts
Text(() => `Count: ${count.value}`)
```

The getter is evaluated when the node is created. Create the node inside the component's render function to participate naturally in Vue's reactive render cycle.

### `Button(label, action, props?)`

Creates a `button` with `type=button`. If `props.onClick` is also supplied, Vue's prop merging keeps both handlers.

### `TextField(ref, options?)`

Two-way binds a string ref to a native input using `value` and `onInput`. Options use Vue's native `InputHTMLAttributes` typing. User listeners are merged with the internal update listener through `mergeProps()`, and the bound ref remains authoritative for `value`.

### `TextArea(ref, options?)`

Two-way binds a string ref to a native textarea. Options use Vue's native `TextareaHTMLAttributes` typing. User input listeners are merged through Vue's `mergeProps()` behavior.

### `Toggle(ref, props?)`

Two-way binds a boolean ref to a native checkbox. Props use Vue's native `InputHTMLAttributes` typing. The helper always owns `type=checkbox` and `checked`; user change listeners are merged rather than replaced.

## Vue identity helpers

### `Key(key, vnode)` / `.keyed(key)`

Applies a VNode key through `cloneVNode()`.

### `TemplateRef(ref, vnode, merge?)` / `.templateRef(ref, merge?)`

Applies a Vue VNode ref. `merge=true` forwards Vue's `cloneVNode()` merge-ref behavior.

Direct `.key()` and `.ref()` modifiers do not exist because those names are already VNode data fields.

## Component model helpers

### `.model(ref, name?)`

```ts
Component(Editor).model(content)
Component(Pager).model(page, 'page')
```

Default expansion:

```ts
{
  modelValue: content.value,
  'onUpdate:modelValue': next => {
    content.value = next
  }
}
```

### `.model(ref, options)`

```ts
Component(Slider).model(percent, {
  name: 'value',
  transformIn: value => value / 100,
  transformOut: value => Number(value) * 100,
})
```

### `Model(component, ref, props?, options?, slots?)`

Convenience function equivalent to `Component(...).model(...)`.

## Built-in Vue components

### `Transition(child, props?)`

Calls Vue's `Transition` built-in.

### `TransitionGroup(children, props?)`

Calls Vue's `TransitionGroup` built-in.

### `Teleport(to, ...children)`

Calls Vue's `Teleport` built-in. Additional props can be added with `withProps()` if needed.

### `Suspense(content, fallback, props?)`

Calls Vue's `Suspense` built-in with `default` and `fallback` slots.

### `KeepAlive(child, props?)`

Calls Vue's `KeepAlive` built-in.

## Modifiers

All modifiers return a new styled VNode. The original VNode is not mutated. Modifiers patch VNode props; they never imply or create a DOM wrapper. CSS modifiers on component VNodes therefore follow Vue's normal attribute-fallthrough rules. Use `Box()` when you require a guaranteed styling boundary.

### Spacing

```ts
.padding(12)
.padding('horizontal', 16)
.margin(8)
.margin('top', 20)
.gap(12)
```

Supported axes are `all`, `horizontal`, `vertical`, `top`, `right`, `bottom`, and `left`.

### Sizing

```ts
.width(320)
.height('100%')
.minWidth(240)
.maxWidth(640)
.minHeight(100)
.maxHeight('80vh')
.frame({ width: 320, maxWidth: '100%' })
```

Numeric lengths are converted to pixels.

### Surface

```ts
.background('#111')
.foreground('#fff')
.opacity(0.8)
.radius(10)
.border({ width: 1, color: '#ddd', style: 'solid' })
.shadow('0 8px 30px rgba(0,0,0,.12)')
```

### Typography

```ts
.fontSize(18)
.fontWeight(500)
.fontFamily('system-ui')
.lineHeight(1.5)
.textAlign('center')
.bold()
```

### Flex and layout

```ts
.grow()
.shrink(0)
.flex('1 1 auto')
.wrap()
.wrap('nowrap')
.order(2)
.align('center')
.justify('space-between')
```

### Position and visual behavior

```ts
.position('relative')
.overflow('hidden')
.cursor('pointer')
.zIndex(10)
.transform('translateY(-2px)')
.cssTransition('transform 150ms ease')
```

The name `cssTransition` intentionally avoids the existing VNode `transition` field.

### Props and attributes

```ts
.id('save')
.role('button')
.disabled(true)
.className(['button', 'primary'])
.style({ display: 'contents' })
.withProps({ 'aria-live': 'polite' })
.attr('data-state', 'open')
```

### Events

Typed helpers:

```ts
.onClick(event => {})
.onDblClick(event => {})
.onInput(event => {})
.onChange(event => {})
.onKeyDown(event => {})
.onKeyUp(event => {})
.onFocus(event => {})
.onBlur(event => {})
.onSubmit(event => {})
.onPointerDown(event => {})
.onPointerMove(event => {})
.onPointerUp(event => {})
.onMouseEnter(event => {})
.onMouseLeave(event => {})
```

Generic escape hatch:

```ts
.on('animationend', event => {})
.on('onUpdate:open', value => {})
```

Existing handlers are merged by Vue through `cloneVNode()` / `mergeProps()` semantics.
