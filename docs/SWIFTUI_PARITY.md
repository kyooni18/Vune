# SwiftUI API parity

Vune's canonical authoring surface is moving from hand-maintained TypeScript
signatures to an SDK-derived SwiftUI contract. The goal is that a Vune call uses
the same public name, argument labels, argument order, defaultability, overload
shape, and closure role as SwiftUI whenever that API exists in Vune.

This work deliberately separates two surfaces:

- **Canonical SwiftUI surface** — APIs that participate in parity checks and are
  accepted by the compiler as SwiftUI-style source.
- **Compatibility surface** — historical Vune-only helpers such as `margin`,
  `gap`, `className`, and `withProps`. They remain callable while migration is in
  progress, but they are not counted as SwiftUI API parity.

## Source of truth

`packages/core/src/api-manifest.ts` is the runtime/compiler source of truth for
APIs that Vune currently implements. Compiler initializer resolution, compiler
modifier specialization, and runtime metadata consume this manifest rather than
maintaining independent allow-lists.

The manifest is not intended to be manually invented from memory. On macOS with
Xcode installed, capture the public SwiftUI SDK first:

```sh
pnpm snapshot:swiftui
```

This runs `swift-symbolgraph-extract` against the selected Xcode SDK and writes
`api/swiftui-symbols.snapshot.json`. The snapshot records public declarations,
function signatures, availability, relationships, the Xcode/SDK version, and a
stable symbol digest. A different SDK or target can be selected with:

```sh
node scripts/snapshot-swiftui-api.mjs --sdk iphonesimulator --target <triple>
```

A snapshot should be regenerated intentionally when the project changes its
SwiftUI reference SDK. Do not silently mix declarations from different Xcode
versions.

## Manifest consistency

After changing the manifest or graph API, build core and run:

```sh
pnpm check:swiftui-manifest
```

The check verifies that every manifest View is exported, its compiler initializer
symbols match the canonical signatures, every manifest modifier exists on the
View graph, and the compiler static-modifier set is generated from the same
manifest.

When an SDK snapshot is available, also run:

```sh
pnpm check:swiftui-snapshot
```

That check verifies the canonical View names, initializer titles, and modifier
signatures against the public symbols extracted from the selected Xcode SDK.

The current manifest is only the first migration slice, not a claim of complete
SwiftUI coverage. It seeds `VStack`, `HStack`, `ZStack`, and `Button`, plus the
first canonical modifier set. Additional implemented Views should be moved into
the manifest only after their signatures have been checked against the SDK
snapshot.

## Labeled arguments

Vune source preserves SwiftUI-style labels even though the JavaScript runtime
ultimately receives positional values or an options object. The lowering is
manifest-driven. For example:

```ts
VStack(alignment: .leading, spacing: 12) {
  Text("Hello")
    .frame(width: 240, height: 44)
    .offset(x: 8, y: 0)
}
```

is lowered to the existing renderer-neutral graph representation. Compatibility
runtime overloads do not become canonical compiler overloads merely because they
exist in JavaScript.

## Animation architecture

Animation is split at the graph/renderer boundary so Vune source does not depend
on the initial browser implementation:

```text
State mutation
    |
    v
Transaction(animation)
    |
    v
View invalidation / graph evaluation
    |
    v
renderer transaction
    |
    +--> @vune-ui/web -> o0o0o numeric/color/transform interpolation
    |
    `--> @vune-ui/react / @vune-ui/vue -> renderer-native style transition fallback
```

`Animation`, `Transaction`, `withAnimation`, and `withTransaction` live in core.
State writes snapshot the active mutation transaction, so asynchronous renderer
updates do not lose the animation selected at mutation time. React, Vue, and DOM
renderers consume the same render transaction.

The DOM renderer now uses `o0o0o@0.2` for numeric, color, and transform values.
Spring updates keep the current value and velocity when a state update retargets
an element, and a per-element/property control cancels the previous motion.
The first render remains synchronous for SSR and hydration safety. React and Vue
continue to expose the same transaction contract and use their native style
transition path until they have an equivalent host-commit adapter. Explicit
`.animation(_:value:)` remains available through the existing wrapper path.

Repeat metadata is stored but not yet executed by a dedicated timeline, and
layout/transition retention is not yet a full SwiftUI-compatible animation
engine. The public `Animation`/`Transaction` values remain renderer-independent
so these implementation details can evolve without changing authoring syntax.

## Expansion order

When adding parity for another SwiftUI API:

1. Confirm the declaration in the SDK symbol snapshot.
2. Add its canonical initializer/modifier declaration to the manifest.
3. Add or adapt the renderer-neutral graph implementation.
4. Add lowering only when JavaScript cannot represent the Swift label syntax
   directly.
5. Add positive and negative compiler diagnostics tests.
6. Run the manifest check and renderer tests.

Do not add a second compiler-only signature table. If an API cannot yet be
represented faithfully, leave it outside the canonical manifest rather than
pretending parity.
