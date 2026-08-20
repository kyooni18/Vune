# Rui styling

Rui provides two styling levels:

- **Simple styling** uses readable modifiers for common layout and visual rules.
- **Advanced styling** uses inline CSS values and external CSS classes when the design needs full CSS control.

Both styles return a new React element, so modifiers can be chained without mutating the original element.

## Simple styling

Use modifiers for styles that describe the intent of a view:

```ts
import { Text, VStack } from 'rui'

VStack(
  { spacing: 12, alignment: 'leading' },
  Text('Welcome')
    .fontSize(32)
    .bold()
    .foreground('#f8fafc')
    .padding(16)
    .background('#1e293b')
    .radius(12),
)
```

Common simple modifiers include:

| Area | Modifiers |
| --- | --- |
| Layout | `.padding()`, `.margin()`, `.gap()`, `.frame()`, `.width()`, `.height()` |
| Color and surface | `.background()`, `.foreground()`, `.opacity()`, `.radius()`, `.border()`, `.shadow()` |
| Typography | `.fontSize()`, `.fontWeight()`, `.fontFamily()`, `.lineHeight()`, `.textAlign()`, `.bold()` |
| Flex layout | `.grow()`, `.shrink()`, `.flex()`, `.wrap()`, `.order()`, `.align()`, `.justify()` |
| Behavior | `.position()`, `.overflow()`, `.cursor()`, `.zIndex()`, `.transform()`, `.cssTransition()` |

Numbers used for dimensions are converted to pixels:

```ts
Text('Card').padding(16).radius(8).width(240)
```

CSS length strings remain available when a relative or calculated value is needed:

```ts
Text('Fluid').width('clamp(12rem, 50vw, 32rem)')
```

## Advanced inline CSS

Use `.style()` for CSS properties that do not have a dedicated modifier:

```ts
Text('Advanced')
  .style({
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    userSelect: 'none',
  })
```

CSS custom properties are supported as well:

```ts
Text('Themed')
  .style({
    '--rui-accent': '#7c3aed',
    color: 'var(--rui-accent)',
  })
```

Styles are merged in call order. A later value replaces an earlier value for the same CSS property:

```ts
Text('Priority')
  .style({ color: 'tomato', padding: 8 })
  .style({ color: 'rebeccapurple' })
```

The resulting element keeps `padding: 8px` and uses `rebeccapurple` for `color`.

## Advanced external CSS

Use `.className()` for selectors, responsive rules, pseudo-classes, keyframes, and other stylesheet features that cannot be expressed by inline styles:

```ts
import './styles.css'
import { Text } from 'rui'

Text('Interactive card')
  .className('card')
  .className(['card--featured', isFeatured && 'card--active'])
```

```css
.card {
  display: block;
  padding: 1rem;
  border: 1px solid var(--rui-border, #cbd5e1);
  transition: transform 160ms ease, box-shadow 160ms ease;
}

.card:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 32px rgb(15 23 42 / 16%);
}

@media (max-width: 640px) {
  .card {
    padding: 0.75rem;
  }
}
```

Class values can be conditional, and repeated calls are composed:

```ts
Text('Composed')
  .className(['card', isFeatured && 'card--featured'])
  .className('u-shadow')
```

This produces `card card--featured u-shadow` when `isFeatured` is true, and `card u-shadow` otherwise.

## JSX modifier attributes

The automatic runtime accepts the same common modifier values as JSX
attributes on intrinsic elements:

```tsx
/** @jsxImportSource rui */

<div
  padding={12}
  gap={8}
  frame={{ maxWidth: 'infinity', alignment: 'center' }}
  background="Canvas"
>
  <span fontSize={18} bold>Rui</span>
</div>
```

Set `jsxImportSource: "rui"` in `tsconfig.json` for project-wide support.
Rui's declarations type-check these attributes, while native `style`,
`className`, event handlers, and element-specific attributes keep React's
normal types. The modifier attributes are applied through the same pipeline as
function-DSL modifiers.

## Styling React components

Rui applies layout and class modifiers to a neutral layout host when the child is a normal React component. The component's own props and internal DOM remain React-owned:

```ts
HStack(
  Component(ProfileCard, { name: 'Rui' })
    .className('profile-card')
    .padding(12),
)
```

The external stylesheet should target the host class:

```css
.profile-card {
  min-width: 0;
  background: white;
}
```

Use `Component()` or `Raw()` when styling an existing React component or element.

## Choosing a style level

Use simple modifiers when the rule is a common visual or layout intent. Use `.style()` for a one-off CSS declaration or a CSS custom property. Use `.className()` when the style needs selectors, responsive behavior, pseudo-classes, animations, or reuse across multiple views.
