# Performance snapshot

Measurements below include a fresh 0.7.0 verification run. The existing spring/Worker/timeline paths are unchanged semantically; new scroll, constraint, and renderer-bridge measurements were collected in the same Node environment. They are microbenchmarks unless explicitly stated and do not include browser layout, paint, compositing, framework overhead, or real input latency.

```text
Node.js v22.16.0
Clang 17.0.0 wasm32 target
```

## Dense spring kernel

```sh
npm run bench -- 10000 600
```

```text
JS            66.12 ms total | 0.1102 ms/frame | 10000 springs
WASM-simd     13.65 ms total | 0.0227 ms/frame | 10000 springs
```

The design property that matters more than the exact ratio is unchanged: the WASM path evaluates a dense Structure-of-Arrays batch instead of crossing the JS/WASM boundary once per value. After promotion, active spring state remains in WASM linear memory.

## Shared Worker path

```sh
npm run bench:worker -- 10000 300
```

```text
JS                 40.02 ms solver wall | 0.1334 ms/frame | 10000 active springs
WASM-simd           7.43 ms solver wall | 0.0248 ms/frame | 10000 active springs
Worker-simd        20.08 ms solver wall | 0.0669 ms/frame | 10000 active springs
Worker submit    0.00086 ms/frame main-thread submission cost
```

Worker wall time is expected to vary with scheduler noise. Its main benefit is moving a large numeric workload away from the UI thread while keeping the same shared state buffers. `Atomics.waitAsync()` is used when available, so supported runtimes do not need a per-frame Worker completion message.

## Compiled timeline/keyframe tracks

```sh
npm run bench:timeline -- 1000 600
npm run bench:timeline -- 10000 600
```

```text
Timeline     36.46 ms total | 0.0608 ms/frame | 1000 numeric tracks | 600 frames
Timeline    336.66 ms total | 0.5611 ms/frame | 10000 numeric tracks | 600 frames
```

The timeline benchmark uses three-keyframe numeric tracks with cubic-bezier easing and velocity propagation. Keyframe times and numeric values are compiled into typed arrays. Built-in cubic-bezier curves are compiled once into a shared 256-entry lookup table, avoiding Newton/bisection solving for every track on every frame.

The lookup path was verified against the exact cubic-bezier evaluator with a normalized position error below `0.0002` across the built-in non-linear curves. Numeric timeline sampling itself creates no per-frame timeline metadata objects.

Timeline drivers receive real elapsed wall time even though spring solvers keep their own defensive `dt` clamp. That lets a finite timeline catch up immediately after a suspended tab. Infinite-repeat callbacks are coalesced into one callback per engine frame with a `crossedIterations` count, so a long suspension cannot create an unbounded callback loop.

## SVG path morph

```sh
npm run bench:path -- 256 10000
```

```text
Path preprocess     10.41 ms | 256 segments
Numeric sample      23.43 ms | 0.00234 ms/frame | 10000 frames
String format      544.45 ms | 0.54445 ms/frame | 1000 frames
```

After path topology preprocessing, the numeric morph is cheap. For long SVG paths, formatting the `d` string dominates. `PathMorpher.sampleInto()` exists so Canvas/WebGL/custom renderers can consume the reusable numeric buffer without string serialization.

## Gesture / direct-manipulation primitives

```sh
npm run bench:gestures -- 500000
```

```text
rubber-band              6.99 ms | 14.0 ns/op
analytic decay           13.15 ms | 26.3 ns/op
analytic bounce spring   32.55 ms | 65.1 ns/op
velocity regression      83.89 ms | 335.6 ns/sample
```

`VelocityTracker` stores history in a fixed typed-array ring buffer. Release physics remains caller-thread analytical math because a drag generally owns one or two axes; dispatching that amount of arithmetic to WASM/Worker would cost more than computing it locally.

## MotionValue / DOM allocation policy

`MotionValue.subscribeValue()` is the value-only hot subscription path. Internal DOM, structured interpolation, and layout-progress bindings use it when available, so ordinary render bindings do not allocate `{ previous, velocity, version }` metadata on each frame. The older detailed `subscribe()` API remains compatible for consumers that need velocity/version metadata.

The DOM adapter also keeps one global dirty-element queue, so a frame updating many elements schedules one flush rather than one microtask per element.

## Interpretation

Exact values are machine- and workload-dependent. Backend thresholds are policy inputs, not universal constants. `FrameBudgetGovernor` exists so an integration can respond to measured main-thread pressure rather than tuning around one benchmark machine.

## State transitions and matched layout (0.6.0)

```sh
npm run bench:transitions -- 10000 1000
```

Final median-of-nine verification run:

```text
state graph numeric  0.2851 ms/frame | 10000 MotionValues
state graph shared   0.1764 ms/frame | 10000 callback values, 1 progress animation
shared layout setup  5.3111 ms total | 1000 matched targets
shared layout write  0.2963 ms/frame | 1000 matched targets, 1 progress animation
```

The numeric state-graph case uses long-running timing animations so all 10,000 values stay active for the measured frames. Spring-based state changes use the existing dense spring backend and can therefore promote to WASM/Worker under the normal thresholds.

The structured case routes 10,000 callback values through one scalar progress animation. Numeric callback interpolation is inlined (`from + delta * progress`) and current structured values are only snapshotted on interruption/completion instead of being written to a `Map` every frame.

Shared-layout setup includes keyed snapshot matching, target measurement, projection construction, decomposition, and the initial write for 1,000 synthetic Element-like targets. Steady-state projection reuses one six-number matrix buffer per item and writes `will-change`/`transform-origin` only at setup, not every frame. This cut the synthetic 1,000-target write path from roughly 0.7 ms/frame during development to about 0.32 ms/frame in the final run.

This is still not a browser rendering benchmark: style recalculation, real layout, paint, and compositing are excluded. The important invariant is that one matched group consumes one motion solver entry regardless of target count.


## Scroll tracker and constraint graph (0.7.0)

```sh
npm run bench:constraints -- 10000 1000
npm run bench:scroll -- 500000
```

Verification run:

```text
Constraints 10000: 124.61 ms total | 0.1246 ms/frame | 10000 chained relations
ScrollTracker 500000: 201.23 ms total | 402.5 ns/sample
```

The constraint benchmark is intentionally adversarial: 10,000 affine relations form one dependency chain, so every result depends on the previous one and all 10,000 instructions must execute. The graph is already compiled before timing. Steady-state evaluation uses typed value/velocity arrays and a compact topological instruction stream.

The scroll benchmark includes `VelocityTracker` regression plus offset/progress `MotionValue` commits. Real DOM scrolling is normally cheaper in aggregate because delivered events are coalesced and scroll metrics are read once per animation frame rather than once per raw event.

## Renderer bridges (0.7.0)

```sh
npm run bench:renderers -- 1000 500
```

Synthetic verification run with 1,000 scalar `MotionValue`s changing on every frame:

```text
Canvas snapshot  1000: 0.0337 ms/frame | one draw callback
WebGL uniforms   1000: 0.0561 ms/frame | 1000 uniform writes/frame
WebGPU buffer    1000: 0.0361 ms/frame | one writeBuffer/frame
```

These numbers measure JavaScript adapter overhead against fake renderer APIs, not actual GPU driver cost or rasterization. The useful invariant is submission shape: Canvas gets one retained numeric snapshot and one draw callback, while WebGPU packs all 1,000 scalars into one retained staging array and one buffer upload. WebGL still requires one API uniform write per declared scalar uniform; real high-count data should therefore be packed into UBOs/textures/buffers rather than represented as thousands of standalone uniforms.
