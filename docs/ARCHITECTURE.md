# Muse architecture

Muse is split into a language/runtime core and renderer packages. The important
boundary is:

```text
Muse source (.muse.ts)
        |
        v
@muse/compiler -----> Muse View graph -----> renderer adapter -----> runtime
                              |                    |
                              +-----------------> @muse/web -> DOM/HTML
                              +-----------------> @muse/vue -> Vue VNode/DOM
```

## Package responsibilities

| Package | Owns | Must not import |
| --- | --- | --- |
| `@muse/core` | `View`, `ViewType`, initializer resolution, `ViewBuilder`, `State`, `Binding`, `GeometryProxy`, closure roles, immutable `ModifiedContent` | React, React DOM, browser APIs |
| `@muse/compiler` | `.muse.ts` builder lowering, labeled arguments, shorthand binding/modifiers, diagnostics, source-map contract | renderer implementations |
| `@muse/react` | React materialization, React component identity, React external-store subscriptions, React built-ins | compiler internals |
| `@muse/vue` | Vue VNode materialization, Vue component/slot bridges, explicit State/Ref bridges | React |
| `@muse/web` | HTML serialization, DOM materialization, events, refs, and State-driven mount invalidation | React |
| `@muse/vite` | Vite plugin entry point for the compiler | View implementation details |

The `muse` package is the renderer-independent canonical authoring entry point.
The repository root remains the `react-muse-ui` compatibility package. New
language and graph behavior belongs in `@muse/core`; behavior that requires a
specific runtime belongs in that renderer package.

The canonical imports are `muse`, `@muse/core`, `@muse/compiler`, `@muse/react`,
`@muse/vue`, `@muse/web`, and `@muse/vite`. The root package also exposes
`react-muse-ui/core` and `react-muse-ui/muse` as compatibility aliases for the
core and React surfaces. The old root API is implemented by the opt-in
`@muse/react/legacy` surface; this keeps compatibility code inside the React
renderer package while leaving the root package as a facade.

## View values

`Text("Hello")` in `muse` returns a frozen graph node. It is not a React or Vue
element. A modifier returns a new graph node:

```ts
const original = Text("Hello")
const styled = original.font("title").padding(12)
// original !== styled
```

The graph can be rendered by multiple renderer implementations through the
`MuseRenderer` interface. This keeps initializer selection, builder flattening,
modifier value semantics, and state ownership independent from React.

Raw HTML is graph input too. In a `.muse.ts` file the compiler lowers this
without a tag allow-list, retaining attributes such as `class`, `for`, `aria-*`,
and `data-*`:

```ts
VStack() {
  <section class="card">
    <h1>{title}</h1>
    <button onclick={save}>Save</button>
  </section>
}
```

Normal CSS remains a Vite concern: `import "./style.css"` works unchanged, and
CSS Modules, Sass, PostCSS, and Tailwind remain renderer/build-tool features.
The Vite adapter also lowers Muse code in Vue SFC script blocks without touching
Vue templates or stylesheet modules.

`ScrollView` and `SafeArea` are core graph Views whose overflow and
`env(safe-area-inset-*)` behavior is expressed by each renderer. `GeometryReader`
is also core-owned, but measurement is renderer-owned: React, Vue, and direct
DOM mount measure the host and re-evaluate the body with the resulting
`GeometryProxy`. DOM adapters normalize measured CSS safe-area paddings into
`safeAreaInsets`; SSR and renderer-less traversal use zero geometry.

## Initializers and builders

Initializer metadata is attached to a callable View and selected from the
actual arguments. Closure roles are marked as `value`, `viewBuilder`, or
`action`, so the compiler does not need a `Button`-specific syntax branch.

The core tests cover the same rule for the four Button shapes:

```ts
Button() { save() }
Button("Save") { save() }
Button(action: { save() }) { Text("Save") }
Button(label: { Text("Save") }, action: { save() })
```

At the React boundary, call `render(viewValue)` or use `MuseView`; do not pass a
core graph object directly to `react-dom`.

At the Vue boundary, use `@muse/vue`'s `MuseView` or `createVueView`. Vue
components enter the graph with `Component`; `toVueRef` and `fromVueRef` are
the explicit reactivity bridges.
