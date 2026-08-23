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
| `@muse/core` | `View`, `ViewType`, initializer resolution, `ViewBuilder`, `State`, `Binding`, native controls and layout primitives, `GeometryProxy`, closure roles, immutable `ModifiedContent` | React, React DOM, browser APIs |
| `@muse/compiler` | `.muse.ts` builder lowering, labeled arguments, shorthand binding/modifiers, diagnostics, source-map contract | renderer implementations |
| `@muse/react` | React materialization, React component identity, React external-store subscriptions, React component interop and compatibility re-exports | compiler internals |
| `@muse/vue` | Vue VNode materialization, Vue component/slot bridges, explicit State/Ref bridges | React |
| `@muse/web` | HTML serialization, DOM materialization, events, refs, and State-driven mount invalidation | React |
| `@muse/vite` | Vite plugin entry point for the compiler | View implementation details |

The `muse` package is the renderer-independent canonical authoring entry point.
The repository root remains the `vune-ui` compatibility package. New
language and graph behavior belongs in `@muse/core`; behavior that requires a
specific runtime belongs in that renderer package.

The canonical imports are `muse`, `@muse/core`, `@muse/compiler`, `@muse/react`,
`@muse/vue`, `@muse/web`, and `@muse/vite`. The root package also exposes
`vune-ui/core` and `vune-ui/muse` as compatibility aliases for the
core and React surfaces. The old root API is implemented by the opt-in
`@muse/react/legacy` surface; this keeps compatibility code inside the React
renderer package while leaving the root package as a facade.

### Core graph internals

The public `@muse/core` graph barrel is intentionally thin. Its implementation
is split into focused, renderer-neutral modules:

| Module | Internal contract |
| --- | --- |
| `graph/types` and `graph/symbols` | Recursive graph types and stable metadata symbols |
| `graph/environment` | Zero geometry, safe-area normalization, and class value helpers |
| `graph/nodes` | Element, foreign-component, View host, geometry, and lazy node constructors |
| `graph/modifiers` | Immutable modifier decoration, flattening, and modifier graph inspection |
| `graph/renderer` | Identity-aware graph traversal through `MuseRenderer` |
| `graph/initializers` | Declaration metadata, overload resolution, ViewBuilder, and View construction |

Adapters may consume the public barrel, but these modules must remain free of
React, Vue, and DOM imports. The barrel re-exports the same symbols so this
structural split does not create a second public API or a second identity
implementation.

The compiler keeps its TypeScript specialization machinery separate from the
source scanner and lowering pipeline. Its internal contracts are:

| Module | Internal contract |
| --- | --- |
| `compiler/scanner` | Quote/comment/regex-safe source scanning, builder/raw-HTML discovery, and top-level delimiter parsing |
| `compiler/pipeline` | Binding shorthand, closures, builder/struct lowering, HTML expression lowering, and syntax detection |
| `compiler/specialization` | Type-checker-backed static modifier-chain and imported-View lowering |
| `compiler/diagnostics` | Original-source syntax, TypeScript, and semantic HTML diagnostics |
| `compiler/vite` | Vue SFC and `.muse.ts` Vite transformation orchestration |
| `compiler/index` | Public API barrel, source maps, and language-service composition |

If static type resolution is not unique, the specialization pass leaves the
source for the dynamic runtime resolver. These modules remain renderer-neutral;
only the Vite adapter knows how to attach the compiler to a host build.

The Web adapter follows the same boundary: `web/ssr` owns deterministic HTML
serialization, `web/props` owns DOM attributes/events/refs, `web/hydration`
owns server-to-client activation and structural checks, and `web/dom` owns
live reconciliation, lazy ranges, geometry measurement, and mount cleanup.
Only `web/index` is the package entry point; these implementation modules are
not additional authoring APIs.

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

`ForeignComponent` is the explicit graph boundary for a non-Muse component. It
stores props, events, slots, and refs as one renderer-neutral descriptor;
React, Vue, and Web choose only how to materialize that descriptor.

The core also owns the renderer-neutral semantic symbols used by this graph:
`ViewType`/`StructSymbol`, `InitializerSymbol`, `State<T>`, `Binding<T>`,
`ViewBuilder`, and `ForeignComponentType`. `@muse/compiler` adapts Muse AST and
the TypeScript `TypeChecker` into the same symbol table; its static initializer
selection calls the core semantic resolver, so IDE and runtime do not invent a
second overload contract.

Raw HTML is graph input too. In a `.muse.ts` file the compiler lowers this
without a tag allow-list, retaining attributes such as `class`, `for`, `aria-*`,
and `data-*`:

The core semantic schema describes standard tags, global/event attributes, and
custom-element extension points. The compiler records
`SemanticHtmlElementSymbol` symbols and source-ranged diagnostics from that schema; the VS Code completion
and hover providers consume the same exported schema rather than maintaining a
second HTML attribute list.

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

Canonical `.muse.ts` source exposes exactly two Button shapes:

```ts
Button("Save") { save() }
Button(action: { save() }, label: { Text("Save") })
```

Missing titles, unlabeled closure pairs, trailing custom labels, and reversed
`label:`/`action:` order are compiler diagnostics. The historical React DSL
forms remain available only through the explicit `vune-ui` compatibility
entry point; they are not part of the canonical compiler or editor surface.

At the React boundary, call `render(viewValue)` or use `MuseView`; do not pass a
core graph object directly to `react-dom`.

At the Vue boundary, use `@muse/vue`'s `MuseView` or `createVueView`. Vue
components enter the graph with `Component`; `toVueRef` and `fromVueRef` are
the explicit reactivity bridges.
