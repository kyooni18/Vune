# Vune styling

Vune provides two styling levels:

- **Simple styling** uses readable modifiers for common layout and visual rules.
- **Advanced styling** uses inline CSS values and external CSS classes when the design needs full CSS control.

Both styles return a new renderer-independent ViewGraph node, so modifiers can
be chained without mutating the original View.

## Simple styling

Use modifiers for styles that describe the intent of a view:

```ts
import { Text, VStack } from 'vune-ui'

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
| Layout | `.padding()`, `.margin()`, `.gap()`, `.frame()` |
| Color and surface | `.background()`, `.foreground()`, `.style()` |
| Typography | `.font()`, `.fontSize()`, `.bold()` |
| Attributes and identity | `.className()`, `.withProps()`, `.keyed()`, `.elementRef()` |

Numbers used for dimensions are converted to pixels:

```ts
Text('Card').padding(16).style({ borderRadius: 8, width: 240 })
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
    '--vune-accent': '#7c3aed',
    color: 'var(--vune-accent)',
  })
```

Inline style objects use checked camelCase CSS property names. Misspelled
properties are rejected by TypeScript, while names beginning with `--` remain
open for application-defined custom properties. Stylesheet imports continue to
use the host CSS pipeline described below.

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
import { Text } from 'vune-ui'

Text('Interactive card')
  .className('card')
  .className(['card--featured', isFeatured && 'card--active'])
```

```css
.card {
  display: block;
  padding: 1rem;
  border: 1px solid var(--vune-border, #cbd5e1);
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

## Vite stylesheet interoperability

The Vune compiler leaves stylesheet imports untouched, so Vite's normal CSS
pipeline remains authoritative. CSS Modules, Sass, PostCSS, and Tailwind can be
used without a Vune-specific transform:

```ts
import styles from './Card.module.css'
import './tokens.scss'
import { Text } from 'vune-ui'

Text('Card').className([styles.card, 'text-slate-900'])
```

Install and configure the relevant Vite/PostCSS/Tailwind plugins in the host
application. `@vune-ui/vite` lowers `.vune.ts` syntax and Vune code inside Vue
`<script>` blocks, while deliberately skipping `.css`, `.module.css`, `.scss`,
and other stylesheet modules.

The repository's host demo exercises all four paths: `demo.module.css`, Sass,
PostCSS/autoprefixer, and Tailwind through Vite. These remain optional host
dependencies; no renderer package imports them.

## JSX modifier attributes

The automatic runtime accepts the same common modifier values as JSX
attributes on intrinsic elements:

```tsx
/** @jsxImportSource vune-ui */

<div
  padding={12}
  gap={8}
  frame={{ maxWidth: 'infinity', alignment: 'center' }}
  background="Canvas"
>
  <span fontSize={18} bold>Vune</span>
</div>
```

The automatic JSX runtime remains a React compatibility feature. Enable it with
`jsxImportSource: "vune-ui"` and import the runtime from the legacy
compatibility entry point; canonical renderer-independent code should use the
function DSL and `className`/`style` modifiers above.

## Styling React components

Vune applies layout and class modifiers to a neutral layout host when the child is a normal React component. The component's own props and internal DOM remain React-owned:

```ts
HStack(
  Component(ProfileCard, { name: 'Vune' })
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

Use `Component()` from `@vune-ui/react` when styling an existing React component or
element. `Raw()` is available from `@vune-ui/react` as an explicit compatibility
escape hatch for an already-created React node.

## Choosing a style level

Use simple modifiers when the rule is a common visual or layout intent. Use `.style()` for a one-off CSS declaration or a CSS custom property. Use `.className()` when the style needs selectors, responsive behavior, pseudo-classes, animations, or reuse across multiple views.
