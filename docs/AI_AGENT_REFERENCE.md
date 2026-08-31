# Vune AI agent reference

Purpose: compact, low-token reference for coding agents working on current Vune.
Prefer this file for retrieval. Use `SEMANTICS.md`, `API.md`, and source only when
more detail is required.

Version context: current checkout is `0.1.20`. Working tree includes experimental
Resident Compute / WASM / WebGPU work. Do not treat experimental execution APIs
as stable authoring APIs.

## 1. Core model

```text
.vune/.vune.ts
  -> @vune-ui/compiler
  -> renderer-independent Vune View graph
  -> @vune-ui/web | @vune-ui/react | @vune-ui/vue
```

Facts:

- A Vune View is an immutable graph value.
- It is not a React element, Vue VNode, DOM node, or HTML string.
- `vune-ui` is the canonical authoring package.
- Renderer packages only materialize the graph and own host lifecycle/interop.
- State, Binding, identity, initializer resolution, builders, and modifiers are
  renderer-independent.

## 2. Canonical imports

```ts
import { ... } from "vune-ui"
import { vunePlugin } from "@vune-ui/vite"

// choose one host boundary as needed
import { mount, renderToHTML } from "@vune-ui/web"
import { ... } from "@vune-ui/react"
import { ... } from "@vune-ui/vue"
```

Other important packages:

```text
@vune-ui/core                 graph/runtime core
@vune-ui/compiler             lowering, diagnostics, language tooling
@vune-ui/animation            motion implementation
@vune-ui/execution            experimental resident execution substrate
@vune-ui/core/web-primitives  browser-only graph primitives
vune-ui/legacy                explicit legacy React compatibility
vune-ui/experimental          experimental APIs
```

## 3. Vite

Direct Web:

```ts
import { defineConfig } from "vite"
import { vunePlugin } from "@vune-ui/vite"

export default defineConfig({ plugins: [vunePlugin()] })
```

React:

```ts
plugins: [vunePlugin(), react()]
```

Vue:

```ts
plugins: [vunePlugin(), vue()]
```

Vune plugin must run before React/Vue plugin.

## 4. Minimal Vune

```ts
import { Button, State, Text, VStack } from "vune-ui"

const count = State(0)

struct App: View {
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text(`Count: ${count.value}`)
      Button("Increment") { count.value += 1 }
    }
    .padding(24)
  }
}

export default App()
```

Web entry:

```ts
import { mount } from "@vune-ui/web"
import App from "./App.vune"

mount(App, document.getElementById("app")!)
```

## 5. Syntax lowering

Compiler supports:

```text
trailing ViewBuilder/Action blocks
Swift-style labeled arguments
implicit members: .leading, .spring(...), etc.
$state -> Binding(state)
if/else and statement-bearing builders
ForEach(items) { item in ... }
struct Name: View
@State / @Binding / @ViewBuilder / @Action
raw HTML in .vune/.vune.ts
source maps + diagnostics
```

Explicit TS remains valid where runtime overload supports it.

## 6. State

```ts
const count = State(0)
count.value += 1
```

Rules:

- Reads are tracked at Vune View boundaries.
- Arrays/plain objects are mutation-aware, including nested plain objects.
- Root replacement also works.
- Replace root for `Map`, `Set`, class instances, frozen values, React elements,
  special host objects.
- Two State objects wrapping the same raw mutable array/object share mutation
  ownership.
- Proxy identity is not application identity.
- Compiler may make top-level `const State()` instance-local only when ownership
  is provably one View; shared/exported/mutable/ambiguous State stays module-level.

Instance-local source:

```ts
struct Counter: View {
  @State var count: number = 0
  var body: some View { Text(String(count.value)) }
}
```

## 7. Binding

```ts
const name = State("")
TextField(Binding(name), "Name")
```

Compiler shorthand:

```ts
TextField($name, "Name")
Toggle("Enabled", isOn: $enabled)
```

Custom lens:

```ts
const b = Binding(
  () => source.value,
  next => { source.value = next },
)
```

## 8. Builder semantics

`ViewBuilder`:

- preserves source order;
- recursively flattens arrays;
- omits `null`, `undefined`, false optional branch values;
- supports conditionals and supported statement-bearing blocks;
- does not reinterpret nested function/class declarations as View builders.

Example:

```ts
VStack() {
  const total = items.value.length
  Text(`Items: ${total}`)
  if (total === 0) { EmptyView() }
}
```

## 9. Initializers

Initializer metadata is semantic, not documentation.

Resolution considers:

```text
labels -> arity/defaults/variadics -> closure role -> concrete types
-> generic constraints -> conversion cost -> unique best candidate
```

Ambiguous unique-best failure => initializer ambiguity error.

Canonical `Button` forms only:

```ts
Button("Save") { save() }

Button(action: { save() }, label: {
  Text("Save")
})
```

Do not reverse `label:` / `action:`.

Custom View:

```ts
struct Metric: View {
  let label: string
  let value: string

  init(_ label: string, value: string) {
    self.label = label
    self.value = value
  }

  var body: some View { Text(`${label}: ${value}`) }
}
```

## 10. Identity / collections

Identity:

```text
parent path + structural slot + concrete View declaration identity + explicit key
```

Preferred list form:

```ts
ForEach(items.value, key: item => item.id) { item in
  Row(item)
}
```

Rules:

- Stable primitive keys preferred.
- `id` / `key` may be inferred for objects, but explicit is clearer.
- Duplicate keys => ambiguous State identity.
- Index keys are wrong for reorderable collections.
- React/Vue keys are projections of Vune identity, not separate identity models.

## 11. Core Views

Common:

```text
Text
VStack HStack ZStack
ScrollView SafeArea GeometryReader
Spacer Divider Group
Element
ForEach
List Section
LazyVStack LazyHStack
```

Additional Vune Views:

```text
Box
Grid LazyGrid
Rectangle Circle Capsule RoundedRectangle
```

Important current SwiftUI canonical View manifest slice:

```text
Text VStack HStack ZStack Button Spacer Divider Group GeometryReader
List Section Toggle TextEditor
```

Do not assume familiar names outside this set are canonical SwiftUI parity.

## 12. Layout

Current web semantics:

- `VStack`: column flex.
- `HStack`: row flex, full-width by default.
- `ZStack`: grid stacking.
- `Spacer`: flex growth, optional minimum basis.
- `frame`: renderer-neutral wrapper/host with constraints + alignment.
- `ScrollView`: native overflow.
- `SafeArea`: CSS `env(safe-area-inset-*)`.
- `GeometryReader`: renderer-owned measurement; SSR uses zero geometry.

Do not claim pixel-equivalent SwiftUI proposal-layout behavior.

Example:

```ts
HStack(spacing: 8) {
  Text("Left")
  Spacer()
  Text("Right")
}
```

## 13. Controls

Common signatures/patterns:

```ts
Text("Hello")
Button("Save") { save() }

TextField(Binding(name), "Name")
TextEditor(text: $notes)
TextArea(Binding(description), "Description")

Toggle("Enabled", isOn: $enabled)
Switch("Wi-Fi", Binding(enabled), { size: 24 })

Slider(Binding(volume), { min: 0, max: 1, step: 0.05 })
Stepper(Binding(quantity), 1)
Picker(Binding(selection), options)

Image("/avatar.png", { alt: "Profile" })
Label("Profile", iconView)
Link("Docs", "/docs")
ProgressView(0.5, { max: 1 })
```

Check types/source before relying on optional arguments not shown here.

Current `Stepper` accepts an optional numeric step, not min/max options.

## 14. Raw HTML

Compiler form:

```ts
<section class="card" aria-label="Profile">
  <h2>{title}</h2>
  <button onclick={save}>Save</button>
</section>
```

Explicit graph form:

```ts
Element("button", {
  type: "button",
  "aria-pressed": selected.value,
  onclick: save,
}, "Save")
```

Facts:

- Raw HTML is Vune graph input, not React JSX semantics.
- Standard HTML attributes are typed by core schema.
- `aria-*`, `data-*`, custom elements are extensible.
- SVG namespace and `foreignObject` behavior are handled by Web renderer.

## 15. Modifiers

Modifiers are immutable graph transformations.

```ts
const a = Text("A")
const b = a.padding(12).opacity(0.8)
// a !== b
```

Canonical modifier families include:

```text
layout: padding frame fixedSize layoutPriority position offset zIndex
transform: scaleEffect rotationEffect transformEffect projectionEffect rotation3DEffect
type: font bold fontWeight fontDesign fontWidth italic underline strikethrough
      kerning tracking baselineOffset lineSpacing lineLimit
visual: opacity shadow blur brightness contrast saturation grayscale hueRotation
composition: background overlay mask clipShape border
interaction: disabled allowsHitTesting onTapGesture onLongPressGesture onHover focusable
scroll/list: scrollDisabled scrollIndicators scrollBounceBehavior listStyle row modifiers
accessibility: accessibilityLabel/Hint/Value/Hidden/Identifier/etc.
motion: animation transition contentTransition
```

Compatibility-only modifiers:

```text
margin gap fontSize foreground style className withProps keyed elementRef
continuousCorners
```

Compatibility APIs are valid Vune APIs but excluded from SwiftUI parity counts.

## 16. SwiftUI fidelity

Fidelity tags:

```text
source             close direct semantics for implemented slice
source-subset      SDK-backed spelling but narrower value/generic surface
web-approximation  browser mapping, not native SwiftUI behavior
```

Examples:

```text
opacity -> source
font/foregroundStyle/background -> source-subset
frame/stacks/padding/browser controls -> web-approximation
```

Never infer parity from name alone. Source of truth:

```text
packages/core/src/api-manifest.ts
docs/SWIFTUI_PARITY.md
```

## 17. Styling

Use modifiers for common intent, `.style()` for inline CSS, `.className()` for
real stylesheet behavior.

```ts
Text("Card")
  .padding(12)
  .className(["card", active.value && "card--active"])
  .style({ "--accent": "#5c7cfa" })
```

CSS Modules, Sass, PostCSS, Tailwind stay Vite/host concerns.

## 18. Animation

Core values:

```text
Animation
Transaction
withAnimation
withTransaction
Transition
ContentTransition
SymbolEffect
```

Explicit:

```ts
Text(status.value)
  .opacity(active.value ? 1 : 0.4)
  .animation(
    .spring(response: 0.42, dampingFraction: 0.8),
    value: active.value,
  )
```

Vune extension:

```ts
.animation()
```

Parameterless `.animation()` is not a SwiftUI parity signature. Compiler + Web
renderer infer actual changed properties and motion channels.

Mutation scoped:

```ts
withAnimation(Animation.spring(), () => {
  expanded.value = !expanded.value
})
```

Web renderer is reference host for property-aware motion. React/Vue use simpler
fallbacks for parts of motion behavior.

## 19. Content transitions / symbols

`Transition` = insertion/removal.

`ContentTransition` = content replacement under stable View identity.

```ts
Text(String(count.value))
  .contentTransition(.numericText(value: count.value))
  .animation()
```

Other content transitions:

```text
identity opacity interpolate blurReplace push scale numericText symbolEffect
```

Symbols:

```ts
const play = VectorSymbol.fromLucide(Play)
const pause = VectorSymbol.fromLucide(Pause)

Image(active.value ? pause : play)
  .contentTransition(.symbolEffect(.magicReplace(fallback: .downUp)))
  .animation()
```

`Path(d)` can morph under animation in Web renderer.

## 20. Web primitives

From `@vune-ui/core/web-primitives`:

```text
FilePicker
ContentEditable
Canvas
Video
Audio
Svg
FocusScope
Popover
```

`TextEditor` and `Path` are exported from canonical root too.

Prefer these before adding feature-local imperative DOM wrappers.

## 21. Direct Web renderer

Public root:

```ts
import { mount, renderToHTML } from "@vune-ui/web"
```

Mount:

```ts
mount(App, target)
```

Hydrate:

```ts
mount(App, target, { hydrate: true })
```

SSR:

```ts
const html = renderToHTML(App)
```

Web runtime behavior:

- fine-grained State boundary dependency tracking;
- dirty-boundary microtask batching;
- parent-first processing;
- hydration reuses compatible DOM and removes stale attrs;
- compiler direct-patch fast paths when proven;
- direct lazy windowing;
- reference property-aware animation implementation.

## 22. React renderer / interop

Important exports:

```text
VuneView createReactView mount render view statefulView
Component Raw reactComponent foreignComponent reactElement
useVuneState fromReactState
```

Rules:

- Do not pass core graph directly to `react-dom`.
- Vune graph enters React via `VuneView`, React renderer helpers, or renderer mount.
- React component enters Vune via `Component` / typed foreign adapter.
- Vune owns external layout host; React owns props/hooks/context/refs/children/internal render.
- Avoid duplicated state ownership unless boundary requires it.

Example:

```ts
Component(ProfileCard, { name: "Vune" })
  .padding(12)
  .frame({ minWidth: 240 })
```

## 23. Vue renderer / interop

Important exports:

```text
VuneView createVueView mount render
Component vueComponent foreignComponent
toVueRef fromVueRef
```

Rules:

- Vue owns native Vue component lifecycle/slots/provide-inject/teleport after boundary.
- Vune State remains Vune-owned unless explicitly bridged.

SFC example:

```vue
<script setup lang="ts">
import { Button, State, Text, VStack } from "vune-ui"
import { VuneView } from "@vune-ui/vue"

const count = State(0)
const graph = () => VStack() {
  Text(String(count.value))
  Button("+") { count.value += 1 }
}
</script>

<template>
  <VuneView :render="graph" />
</template>
```

## 24. Presentation

```text
NavigationStack NavigationLink Sheet Alert Menu
```

Current initializer shapes:

```ts
NavigationStack() {
  NavigationLink("/settings", "Settings")
}

Sheet(Binding(showing)) {
  DetailsView()
}

Alert(Binding(showingAlert), "Delete item?", "This cannot be undone.")

Menu("Actions") {
  Button("Edit") { edit() }
  Button("Delete") { remove() }
}
```

`NavigationStack` currently has no router argument. `NavigationLink` is a
destination link. Host/router integration belongs outside the core initializer.
Renderer packages own host materialization details.

Check source/types for exact current overloads before generating code.

## 25. Compiler optimization rules

All optimizations are proof-driven and must preserve fallback semantics.

Current important passes:

```text
initializer specialization
simple ViewBuilder closure -> child arrays
labeled arg normalization
modifier-chain fusion
compiled intrinsic templates + dynamic slots
static subtree hoisting
State dependency metadata
collection specialization
Patch IR generation
experimental resident compute planning
```

If compiler cannot prove safety due to `any`, `unknown`, variadics, ambiguous
call type, opaque closures, etc., keep guarded/dynamic path.

Never weaken correctness to force an AOT path.

## 26. Web rendering performance rules

Prefer:

```text
stable primitive keys
narrow State read boundaries
typed calls the compiler can prove
normal stacks for small lists
Lazy* for genuinely large lists
few unnecessary renderer ownership crossings
```

Do not assume Vune = traditional full-tree VDOM. Direct Web can use boundary
invalidation, compiled templates, Patch IR, and direct slot updates.

## 27. Resident Compute [EXPERIMENTAL]

Principle:

```text
promote only packed producer -> fused compute -> packed/GPU consumer regions
```

Backends:

```text
packed-js             mandatory baseline
wasm-simd             experimental
shared-worker-wasm    experimental
webgpu                experimental
renderer-fallback     when residency does not justify native path
```

Rules:

- Ordinary object `State<T[]>` + DOM rows is not automatically resident.
- Native backend must beat optimized packed JS end-to-end.
- Scheduler uses dirty rows, weighted kernel cost, SIMD suitability, frame
  pressure, and measured crossover data.
- Small/sparse work often stays packed JS.
- WebGPU is useful when producer/compute/render data can stay GPU-resident.
- Avoid CPU readback just to render normal DOM.
- Experimental native backends are disabled by default.

Enable experimentally:

```ts
createVuneVitePlugin({ experimentalResidentCompute: true })
mount(App(), target, { experimentalResidentCompute: true })
```

Source docs: `docs/RESIDENT_COMPUTE.md`.

## 28. React -> Vune translation

```tsx
const [x, setX] = useState(0)
```

->

```ts
const x = State(0)
```

```tsx
<input value={q} onChange={e => setQ(e.target.value)} />
```

->

```ts
TextField(Binding(q), "Search")
```

```tsx
{items.map(item => <Row key={item.id} item={item} />)}
```

->

```ts
ForEach(items.value, key: item => item.id) { item in Row(item) }
```

Keep mature React components behind `Component(...)` when ownership need not move.

## 29. Vue -> Vune translation

```ts
const x = ref(0)
```

->

```ts
const x = State(0)
```

```vue
<input v-model="query" />
```

->

```ts
TextField(Binding(query), "Search")
```

```vue
<Row v-for="item in items" :key="item.id" :item="item" />
```

->

```ts
ForEach(items.value, key: item => item.id) { item in Row(item) }
```

Keep useful SFC boundaries via `VuneView` while migrating incrementally.

## 30. SwiftUI -> Vune translation

Often source-close:

```swift
VStack(alignment: .leading, spacing: 12) { ... }
.padding(24)
```

->

```ts
VStack(alignment: .leading, spacing: 12) { ... }
.padding(24)
```

Do not blindly translate:

```text
proposal-sensitive native layout
unsupported Environment APIs
native navigation/toolbars/presentation assumptions
full gesture composition
preference keys
arbitrary SwiftUI style protocols
same-name APIs absent from current manifest
```

## 31. Common mistakes

Avoid:

```text
passing core graph directly to react-dom
assuming familiar SwiftUI name means parity
unstable/index keys for reorderable data
duplicate ForEach keys
using `any` unnecessarily in statically optimizable graphs
manually rebuilding existing web primitives with imperative DOM
assuming WASM/WebGPU is always faster
using reversed Button(label:, action:) order
creating duplicate renderer-specific State semantics
adding compiler-only signature tables separate from core manifest
```

## 32. Source-of-truth files

When uncertain, inspect in this order:

```text
docs/SEMANTICS.md                    normative graph semantics
docs/API.md                          public API contract
packages/core/src/api-manifest.ts    canonical SwiftUI source surface
docs/SWIFTUI_PARITY.md               fidelity/parity rules
packages/core/src/views.ts            core Views / ForEach / layout hosts
packages/core/src/controls.ts         controls
packages/core/src/advanced.ts         Grid/shapes/additional controls
packages/core/src/state.ts            State/Binding
packages/core/src/animation.ts        Animation/Transaction
packages/core/src/web-primitives.ts   browser primitives
packages/compiler/src/pipeline.ts     syntax lowering
packages/compiler/src/specialization.ts AOT graph specialization
packages/web/src/dom.ts               live Web renderer
packages/web/src/ssr.ts               HTML serialization
docs/RESIDENT_COMPUTE.md              experimental native compute architecture
```

## 33. Validation commands

Broad:

```sh
pnpm test
```

Useful focused:

```sh
pnpm test:docs
pnpm test:packages
pnpm test:runtime
pnpm test:animation
pnpm demo:all:build
pnpm benchmark:performance
pnpm benchmark:resident
pnpm benchmark:resident:native
pnpm benchmark:browser
```

SwiftUI API work:

```sh
pnpm snapshot:swiftui
pnpm check:swiftui-manifest
pnpm check:swiftui-snapshot
```

## 34. Generation rules for agents

When writing new Vune code:

1. Prefer `vune-ui` canonical graph APIs.
2. Use `.vune` / `.vune.ts` for Swift-like syntax.
3. Give `ForEach` stable primitive keys.
4. Use `Binding` for writable child/control state.
5. Use `struct ...: View` + `@State` for explicit instance-local state.
6. Prefer canonical modifiers; use `className`/`style` for genuine CSS needs.
7. Use Web/React/Vue interop only at actual ownership boundaries.
8. Do not invent initializer forms; inspect metadata/types.
9. Do not invent SwiftUI parity; check manifest.
10. Keep experimental Resident Compute isolated and opt-in.

## 35. Compact examples

State + binding:

```ts
const name = State("")
const enabled = State(false)

VStack(spacing: 8) {
  TextField($name, "Name")
  Toggle("Enabled", isOn: $enabled)
}
```

Conditional:

```ts
VStack() {
  if (loading.value) { ProgressView() }
  else { Content() }
}
```

Keyed collection:

```ts
ForEach(items.value, key: item => item.id) { item in
  Row(item)
}
```

Custom View:

```ts
struct Row: View {
  let title: string
  @State var selected: boolean = false

  init(_ title: string) { self.title = title }

  var body: some View {
    Button(title) { selected.value = !selected.value }
  }
}
```

Animation:

```ts
Circle()
  .opacity(active.value ? 1 : 0.3)
  .scaleEffect(active.value ? 1 : 0.8)
  .animation()
```

Raw HTML:

```ts
<button class="primary" onclick={save}>Save</button>
```

React boundary:

```ts
Component(ExistingReactComponent, props)
  .frame(maxWidth: .infinity)
```

Direct Web:

```ts
mount(App, target)
```

## 36. Short semantic invariants

```text
View graph immutable.
Modifier graph immutable.
Renderer cannot redefine core semantics.
Initializer selection must have unique best candidate.
Builder output normalization deterministic.
State semantics renderer-independent.
Binding is writable lens.
Keys preserve logical identity.
Optimization must have semantically equivalent fallback.
Hydration client graph authoritative for compatible nodes.
Native compute promotion based on whole residency region.
```

