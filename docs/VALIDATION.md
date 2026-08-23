# Validation

This file records the release-hardening checks expected before a Muse alpha is
published. The commands are intentionally reproducible and are also represented
in CI where they need network or real-browser support.

## Type and runtime gates

- Type-check every workspace package, the root build, and test declarations.
- Run every non-browser `tests/*.test.mjs` file as one suite.
- Run compiler parser fuzzing and renderer live-conformance tests as part of that
  suite rather than as optional checks.
- Validate all relative documentation links and stale canonical API references.

The hardening workspace passed all 281 unique non-browser tests after the final
compiler scanner regression was added.

## Browser and production-build gates

Production Vite builds cover the React, Vue, and Web demos, the three renderer
parity demos, and the medium Showcase application. Browser CI installs Playwright
Chromium, launches each demo with an isolated Vite cache, and exercises:

- native input/event/ref behavior;
- React/Vue/Web live graph parity;
- keyed State preservation across reorder;
- custom elements and GeometryReader;
- Showcase filtering, bindings, async refresh, reorder, and lazy content.

The browser job also executes the minified production bundles directly through
`test:browser:built`; this catches build-time specialization/minification failures
that a dev-server-only test cannot expose. The final Linux/amd64 hardening run
passed all seven production fixtures (React, Vue, Web, three parity fixtures, and
Showcase) in Chromium.

A local system Chromium may be unavailable or policy-restricted; that is not a
reason to skip the CI Playwright gate.

## Package/release gate

Run `pnpm run test:release`. It verifies every package's declared exports, type
entry points, `sideEffects` contract where applicable, and packed file list. It
also uses `pnpm pack` to ensure `workspace:*` dependencies become concrete
versions, then installs packed packages into a fresh offline project and
smoke-tests imports, React/Vue/Web rendering, the compiler, and the Vite plugin.
The final hardening run packed and verified all nine publishable surfaces: the
root compatibility package plus the eight workspace packages.

## Performance gates

`benchmark:modifiers:ci` guards modifier construction against raw React at
multiple chain depths. `benchmark:performance:ci` guards compiler transforms,
View/ForEach construction, State propagation, Web DOM reconciliation, keyed
updates, hydration, React/Vue rerenders, conditional subtrees, burst updates,
and LazyVStack scrolling.

DOM benchmark rounds run sequentially so independent JSDOM instances do not
contend for the same event loop, microtask queue, and garbage collector. In the
final CI-mode validation the 1,000-node Web reconciliation ratio remained around
8–10x its raw-DOM baseline across repeated runs, below the 25x guard.

These numbers are regression budgets, not cross-framework marketing claims;
they are intended to catch unexpectedly nonlinear or catastrophic changes.
