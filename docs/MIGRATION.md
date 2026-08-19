# Migration guide

## 0.3 to 0.4

0.4 is additive; no 0.3 API is removed or renamed.

New layout helper:

```ts
ScrollView(VStack(...rows))
ScrollView(HStack(...cards), 'horizontal')
ScrollView(content, 'both')
```

New CSS-box shape helpers:

```ts
Rectangle()
RoundedRectangle(12)
Circle()
Capsule()
```

Use equal width and height with `Circle()` when a true circle is required. Complex SVG/path geometry remains ordinary Vue/SVG rather than being wrapped in a new shape runtime.

0.3 tightens layout and modifier semantics rather than expanding the framework surface.

## `Group()` no longer exposes modifiers

`Group()` is a Vue Fragment. Since a Fragment has no CSS box, code such as this was visually misleading in 0.2:

```ts
Group(Text('A'), Text('B')).padding(12)
```

Use `Box()` when you need a real DOM styling boundary:

```ts
Box(Text('A'), Text('B')).padding(12)
```

If you only need to key the Fragment itself, use the function helper:

```ts
Key(groupId, Group(...children))
```

## Native controls now keep their controlled props

`Button()` always emits `type=button`, `Toggle()` always emits `type=checkbox`, and bound `value` / `checked` props come from the supplied ref. Conflicting values passed through the optional props object are ignored by design. User event listeners still run and are merged through Vue's `mergeProps()`.

## Native primitive prop types are narrower

`Text`, `Button`, `TextField`, `TextArea`, and `Toggle` now use Vue's corresponding native HTML attribute types. If application-specific attributes no longer type-check, use the modifier escape hatches such as `.attr()` / `.withProps()`, or `Element()` where a deliberately open prop surface is appropriate.

---

# Migration from 0.1 to 0.2

0.2 is designed to keep 0.1 code working while improving Vue interoperability and type safety.

## `ComponentNode` → `Component`

Old:

```ts
ComponentNode(UserCard, { user })
```

Preferred in 0.2:

```ts
Component(UserCard, { user })
```

`ComponentNode` remains as a deprecated alias, so this is not an immediate breaking change.

## New component props and slot inference

`Component()` infers public component props and slots where Vue exposes them through the component type. Code that passed a clearly wrong prop type may now fail TypeScript checks, which is intentional.

## New `v-model` support

```ts
Component(Editor).model(content)
Component(Pager).model(page, 'page')
```

The standalone `Model()` helper is also available.

## New safe identity modifiers

Use:

```ts
node.keyed(key)
node.templateRef(inputRef)
```

or:

```ts
Key(key, node)
TemplateRef(inputRef, node)
```

There are intentionally no `.key()` or `.ref()` methods because those names are real fields on Vue VNodes.

## CSS transition naming

The CSS modifier is named:

```ts
node.cssTransition('opacity 150ms ease')
```

not `.transition()`, because `transition` is also an internal VNode field used by Vue.

## New primitives

0.2 adds:

- `Grid`
- `ZStack`
- `TextArea`
- typed `Component`
- `Slots`
- `Key`
- `TemplateRef`
- Vue built-in wrappers

## New modifiers

0.2 adds typed event helpers, component model binding, VNode identity helpers, more typography, flex, position, overflow, cursor, z-index, transform, CSS transition, and shadow helpers.

The generic `style()`, `withProps()`, `attr()`, and `on()` escape hatches remain available.
