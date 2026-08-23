# Build a Muse screen

This tutorial uses the canonical renderer-independent graph, the React renderer,
and the Muse Vite compiler. It intentionally uses `.muse.ts` syntax rather than
the legacy macro/JSX compatibility layer.

## 1. Install and configure

```bash
pnpm add muse @muse/react react react-dom
pnpm add -D @muse/vite @vitejs/plugin-react vite typescript
```

```ts
// vite.config.ts
import react from "@vitejs/plugin-react"
import { musePlugin } from "@muse/vite"
import { defineConfig } from "vite"

export default defineConfig({ plugins: [musePlugin(), react()] })
```

## 2. Create an instance-owned screen

```ts
// src/App.muse.ts
import { Binding, Button, ForEach, State, Text, TextField, VStack } from "muse"
import { view } from "@muse/react"

const query = State("")
const items = State([
  { id: "compiler", title: "Compiler" },
  { id: "renderer", title: "Renderer" },
])

export default view(() => VStack(spacing: 12) {
  const normalized = query.value.trim().toLowerCase()
  const filtered = normalized
    ? items.value.filter(item => item.title.toLowerCase().includes(normalized))
    : items.value

  Text("Muse modules").fontSize(28).bold()
  TextField(Binding(query), "Filter")

  ForEach(filtered, key: item => item.id) { item in
    Text(item.title)
  }

  Button("Reverse") {
    items.value = [...items.value].reverse()
  }
})
```

Local declarations and normal TypeScript control flow can live inside a
`ViewBuilder`; adding a `const`, loop, conditional, or `try/catch` does not
change how child Views are collected. Give dynamic collections an explicit,
stable key whenever one exists.

The two top-level State declarations above are referenced only by this one Muse
View, so the compiler can make them per-mounted-instance. Shared/exported State
stays at module scope and receives a warning instead of being silently moved.

## 3. Mount the renderer

```ts
// src/main.ts
import { createElement } from "react"
import { createRoot } from "react-dom/client"
import App from "./App.muse.js"

createRoot(document.getElementById("app")!).render(createElement(App))
```

The same graph model can instead be materialized through `@muse/vue` or
`@muse/web`; renderer-owned APIs do not leak through `muse`.

## 4. Use raw HTML when native markup is clearer

Raw HTML and Muse Views can be mixed in one builder:

```ts
VStack() {
  <header class="hero" aria-hidden="false">
    <span>Muse</span>
  </header>
  Text("Graph content")
}
```

HTML character references are decoded by the compiler. DOM hydration makes the
client graph authoritative for attributes, preserves SVG/`foreignObject`
namespaces, and commits refs only after a live node exists.

## 5. Check the real integration fixture

`examples/Showcase.muse.ts` is the repository's medium application fixture. It
adds a custom `struct ...: View`, dynamic Button labels, async updates, `Grid`,
`LazyVStack`, filtering, keyed reorder, bindings, raw HTML, and multiline
modifier chains.

```bash
pnpm run demo:showcase:build
```

For repository development, also run:

```bash
pnpm test
pnpm run test:release
pnpm run benchmark:performance:ci
```

Real-browser CI additionally runs the React, Vue, Web, parity, and Showcase
Playwright flows. The normative behavior shared by all renderers is documented
in `docs/SEMANTICS.md`.
