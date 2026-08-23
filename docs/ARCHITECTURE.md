# Vune architecture

Vune is split into a language/runtime core and renderer packages. The important
boundary is:

```text
Vune source (.vune.ts)
        |
        v
@vune-ui/compiler -----> Vune View graph -----> renderer adapter -----> runtime
                              |                    |
                              +-----------------> @vune-ui/web -> DOM/HTML
                              +-----------------> @vune-ui/vue -> Vue VNode/DOM
```

## Package responsibilities

| Package | Owns | Must not import |
| --- | --- | --- |
| `@vune-ui/core` | `View`, `ViewType`, initializer resolution, `ViewBuilder`, `State`, `Binding`, native controls and layout primitives, `GeometryProxy`, closure roles, immutable `ModifiedContent` | React, React DOM, browser APIs |
| `@vune-ui/compiler` | `.vune.ts` builder lowering, labeled arguments, shorthand binding/modifiers, diagnostics, source-map contract | renderer implementations |
| `@vune-ui/react` | React materialization, React component identity, React external-store subscriptions, React component interop and compatibility re-exports | compiler internals |
| `@vune-ui/vue` | Vue VNode materialization, Vue component/slot bridges, explicit State/Ref bridges | React |
| `@vune-ui/web` | HTML serialization, DOM materialization, events, refs, and State-driven mount invalidation | React |
| `@vune-ui/vite` | Vite plugin entry point for the compiler | View implementation details |

The `vune-ui` package is the renderer-independent canonical authoring entry point.
The repository root publishes the canonical `vune-ui` authoring package. New
language and graph behavior belongs in `@vune-ui/core`; behavior that requires a
specific runtime belongs in that renderer package.

The canonical imports are `vune-ui`, `@vune-ui/core`, `@vune-ui/compiler`, `@vune-ui/react`,
`@vune-ui/vue`, `@vune-ui/web`, and `@vune-ui/vite`. The root package also exposes
`vune-ui/core` and `vune-ui/vune` for explicit core and React entry points. Legacy
React APIs live under the opt-in `vune-ui/legacy` subpath, keeping compatibility
code inside the React renderer package.

### Core graph internals

The public `@vune-ui/core` graph barrel is intentionally thin. Its implementation
is split into focused, renderer-neutral modules:

| Module | Internal contract |
| --- | --- |
| `graph/types` and `graph/symbols` | Recursive graph types and stable metadata symbols |
| `graph/environment` | Zero geometry, safe-area normalization, and class value helpers |
| `graph/nodes` | Element, foreign-component, View host, geometry, and lazy node constructors |
| `graph/modifiers` | Immutable modifier decoration, flattening, and modifier graph inspection |
| `graph/renderer` | Identity-aware graph traversal through `VuneRenderer` |
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
| `compiler/vite` | Vue SFC and `.vune.ts` Vite transformation orchestration |
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

`Text("Hello")` in `vune-ui` returns a frozen graph node. It is not a React or Vue
element. A modifier returns a new graph node:

```ts
const original = Text("Hello")
const styled = original.font("title").padding(12)
// original !== styled
```

The graph can be rendered by multiple renderer implementations through the
`VuneRenderer` interface. This keeps initializer selection, builder flattening,
modifier value semantics, and state ownership independent from React.

`ForeignComponent` is the explicit graph boundary for a non-Vune component. It
stores props, events, slots, and refs as one renderer-neutral descriptor;
React, Vue, and Web choose only how to materialize that descriptor.

The core also owns the renderer-neutral semantic symbols used by this graph:
`ViewType`/`StructSymbol`, `InitializerSymbol`, `State<T>`, `Binding<T>`,
`ViewBuilder`, and `ForeignComponentType`. `@vune-ui/compiler` adapts Vune AST and
the TypeScript `TypeChecker` into the same symbol table; its static initializer
selection calls the core semantic resolver, so IDE and runtime do not invent a
second overload contract.

Raw HTML is graph input too. In a `.vune.ts` file the compiler lowers this
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
The Vite adapter also lowers Vune code in Vue SFC script blocks without touching
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

Canonical `.vune.ts` source exposes exactly two Button shapes:

```ts
Button("Save") { save() }
Button(action: { save() }, label: { Text("Save") })
```

Missing titles, unlabeled closure pairs, trailing custom labels, and reversed
`label:`/`action:` order are compiler diagnostics. The historical React DSL
forms remain available only through the explicit `vune-ui` compatibility
entry point; they are not part of the canonical compiler or editor surface.

At the React boundary, call `render(viewValue)` or use `VuneView`; do not pass a
core graph object directly to `react-dom`.

At the Vue boundary, use `@vune-ui/vue`'s `VuneView` or `createVueView`. Vue
components enter the graph with `Component`; `toVueRef` and `fromVueRef` are
the explicit reactivity bridges.
