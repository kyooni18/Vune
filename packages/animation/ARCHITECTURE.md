# Architecture

## Core execution graph

```text
                              Public API
                                 |
             MotionValue / motion specs / Timeline graph
                                 |
                        MotionEngine scheduler
                                 |
       +----------------+--------+---------+----------------+
       |                |                  |                |
   timing bucket   kinetic release     generic drivers   spring bucket
                                            |            dense SoA
                                            |                |
                                      TimelinePlayer    JS / WASM / Worker
                                            |                |
                                            +--------+-------+
                                                     |
                                            MotionValue commit
                                                     |
                                            renderer adapters
```

The scheduler does not traverse a retained UI scene graph. Springs use dense numeric arrays, kinetic releases use low-count analytical solvers, and timeline players register only while they are actively running. Paused or completed timelines are removed from the driver set.

Generic drivers receive real elapsed wall time, while spring/timing numerical integration keeps its existing defensive `dt` clamp. This separation lets a timeline catch up after a suspended tab without asking a spring solver to integrate an arbitrarily large time step.

## Adaptive backend selection

```text
small workload
     |
     v
    JS  ---- pressure/count ----> main-thread WASM SIMD
                                      |
                                      | pressure/count + WebGPU support (async)
                                      v
                              WebGPU Compute + readback
                                      |
                                      | pressure/count + SAB support
                                      v
                              Worker + shared WASM
```

`FrameBudgetGovernor` observes main-thread execution cost, not total Worker wall time. Under sustained pressure it lowers promotion thresholds. It never changes spring semantics or intentionally drops fidelity.

Once an engine has promoted into a shared Worker batch, small workloads can still use `step()` on the caller thread over that same shared memory. Large auto-scheduled frames use the Worker. No state copy is required to switch between those two execution locations.

## Worker ownership and frame-boundary mutation buffer

A Worker step owns indices `[0, submittedCount)` until it completes. User input can still arrive while that computation is running.

Directly mutating `targets[index]`, swap-removing a spring, or replacing solver parameters during that window would be a real shared-memory data race. The engine therefore separates logical motion state from physical spring slots during an in-flight frame.

```text
Worker owns shared slots
          |
          +---- user retarget ------> logical target updated
          |                           pendingSpringSync
          |
          +---- user cancel --------> logical removal
          |                           deferredSpringRemovals
          |
          +---- new spring ---------> appended beyond submittedCount
                                      safe to initialize immediately

Worker completes
      |
      v
physical removals / swap-compaction
      |
apply pending solver parameter changes
      |
commit surviving positions + velocities
```

Controls use the logical target, so calling `finish()` during a Worker frame never jumps to a stale target stored in shared memory.

Overlapping engine-level `stepAsync()` calls are serialized. The backend also serializes its command slot, giving deterministic frame order at both levels.

## Shared Worker control plane

The Worker receives the shared `WebAssembly.Memory` once during initialization. It blocks on a tiny atomic control buffer.

When `Atomics.waitAsync()` is available:

```text
main                                         worker
 |                                              |
 | write count + dt                             |
 | store command sequence                       |
 | Atomics.notify ----------------------------> |
 |                                              | step_springs(...)
 |                                              | on shared memory
 |                                              | store done sequence
 | <----------------------------- Atomics.notify|
 | read positions/velocities directly           |
```

No per-frame spring payload and no per-frame completion message are required. Older environments retain a tiny `done` message fallback.

If a Worker fails, the engine restores batch position/velocity from authoritative `MotionValue`s before continuing on the local shared-WASM path. This favors continuity and deterministic state over attempting to reuse a potentially half-written failed frame.

## Direct manipulation and kinetic release

Gesture input stays outside renderer code and feeds ordinary numeric `MotionValue`s. The input side is intentionally cheap and the release side is analytical rather than frame-substepped.

```text
pointer / pen / touch samples
          |
          +-- coalesced samples when available
          |
    VelocityTracker
 typed-array ring buffer
 weighted linear regression
          |
          v
     DragController
          |
          +-- in-bounds value
          +-- rubber-band projection outside bounds
          +-- optional axis lock
          |
       pointer up
          |
          v
 analytic exponential decay
          |
          +-- optional target snapping
          |
       cross bound?
        /       \
      no         yes
      |           |
  finish      exact damped spring
                  |
               settle
```

Release kinetics are kept separate from the dense WASM spring batch. Direct manipulation normally involves one or two axes, so crossing a WASM boundary would cost more than evaluating the closed-form equations locally. This also keeps gesture latency independent of large background spring batches.

The decay integrator uses the exact solution of `dv/dt = -v/tau`, making position and velocity effectively independent of whether frames arrive at 60, 120, or 144 Hz. Bound settling uses the exact underdamped/critical/overdamped harmonic-oscillator solution.

## Timeline / keyframe graph

Timeline data is compiled before playback. Numeric tracks keep keyframe times and values in `Float64Array`s. Segment interpolation does not build frame objects during sampling.

```text
Timeline
  |
  +-- numeric keyframe track ----> MotionValue
  |       times[]
  |       values[]
  |       compiled easing[]
  |
  +-- structured track ----------> callback / renderer adapter
  |       precompiled segment mixers
  |
  +-- nested TimelineClip
          offset + speed + fill
          |
          +--> child Timeline
```

Cubic-bezier keyframe curves are expensive if every track performs Newton/bisection inversion every frame. Timeline compilation therefore stores a shared lookup table per curve identity. Position sampling becomes a pair of typed-array reads plus linear interpolation. Numeric velocity uses the local table slope multiplied by segment duration and player direction/rate.

```text
bezier spec
    | one-time
    v
256-entry LUT
    |
    +-- value(progress)
    +-- slope(progress)
```

This is deliberately timeline-local. Single timing animations can keep the exact evaluator, while large choreographies amortize a tiny bounded approximation for much lower aggregate CPU cost. Built-in curves are regression-tested against the exact evaluator.

`TimelinePlayer` is a `MotionEngine` driver. It supports deterministic manual stepping and the normal engine clock. It maps raw elapsed time to local timeline time through iteration and direction rules, then samples the graph. Nested clips scale velocity by their playback speed so a spring started after interruption receives the correct world-time velocity.

Motion ownership is bidirectional. Before a player starts, it stops engine animations on its numeric targets. Conversely, `MotionEngine.animate()`, `animateVelocity()`, or `stop()` asks registered drivers whether they own the target and interrupts that driver first. Timeline interruption preserves current velocity; explicit pause/cancel zeroes it because motion is no longer physically continuing.

Large elapsed gaps do not dispatch one callback for every skipped loop. A repeat callback receives the final iteration plus a signed `crossedIterations` count once per engine step.

`PhaseTimeline` is a compiler on top of this graph, not a second runtime. Named phases become ordinary keyframe tracks with arrival times and optional hold duplicates.



## State transitions and presence

Named state transitions sit above the engine rather than inside the spring hot loop.

```text
named state graph
      |
      +-- numeric MotionValue binding ----> engine.animate(value, target)
      |                                      preserves property velocity
      |
      +-- structured binding(s)
              |
         current rendered values
              |
       precompiled interpolators
              |
        one progress MotionValue
```

This split is deliberate. A card with x/y/opacity as numeric values keeps independent physical velocity, while ten structured decoration properties do not allocate ten spring slots merely to share the same temporal curve.

`TransitionController` is a two-state specialization (`exited <-> entered`). `PresenceController` adds renderer lifecycle semantics: exit keeps `rendered=true` until successful completion, and a later enter increments a generation token so an older exit promise cannot unmount content after reversal.

## Timeline scrubbing

`TimelineScrubber` converts an arbitrary scalar input domain into timeline-local progress.

```text
DragController / scroll / gamepad / custom input
                    |
                MotionValue
             [inputMin,inputMax]
                    |
             TimelineScrubber
                    |
                 0..1
                    |
              TimelinePlayer.seek
```

On release, the same input `MotionValue` can run bounded inertia with snap points. The timeline package therefore remains independent of pointer/DOM code and receives deterministic seek samples through its normal player API.

## Shared / matched layout projection

A shared-layout snapshot stores keyed viewport rectangles before a tree replacement. Playback measures the new keyed targets and projects each target from its previous geometry.

```text
old tree READ
  key -> rect snapshot
          |
     tree replacement
          |
new tree READ
  key -> target rect
          |
  matched world projection
          |
remove matched ancestor projection
          |
one shared progress MotionValue
          |
all target WRITE transforms
```

The old element is not required during playback. A whole matched group uses one solver entry, so matching hundreds of nodes increases matrix/write work but not spring count. Keys are unique by contract; duplicate source or target keys are rejected. When a target is already participating in an older layout projection, the new transition captures its currently rendered rectangle before cancelling the old projection and uses that visual geometry as the new source.

## Structured interpolation

Structured values do not add branches to the spring hot loop. One scalar progress `MotionValue` drives a prebuilt interpolator.

```text
progress MotionValue (0 -> 1)
          |
          +-- number
          +-- color (sRGB / linear / OKLab / OKLCH)
          +-- transform decomposition
          +-- material
          +-- SVG path morph
          +-- caller supplied interpolator
          |
       renderer adapter
```

This keeps the hot spring SoA compact while allowing arbitrary high-level output types.

## SVG path morph pipeline

```text
SVG path strings
      |
parse M/L/H/V/C/S/Q/T/A/Z
      |
normalize every segment to cubic Bezier
      |
equalize segment counts by cubic splitting
      |
closed-path direction/start alignment
      |
Float64 coordinate buffers (preprocess once)
      |
per-frame linear numeric sampling
      |
      +-- sampleInto() -> Canvas/WebGL/custom renderer
      |
      +-- format() -> SVG DOM d string
```

For large closed paths, start alignment evaluates a bounded set of nearest promising candidate shifts instead of every cyclic shift. This changes preprocessing from exhaustive O(n^2) scoring to approximately O(k*n) after candidate selection, with small `k`.

## Materials

The material model is pure data:

```text
blur
saturation
brightness
contrast
tint color
tint strength
```

Interpolation is renderer-independent. The DOM adapter maps those values to `backdrop-filter` and `background-color`; another renderer can map the exact same material to shader uniforms.

## DOM batching

All DOM bindings share one global dirty-state queue.

```text
MotionValue callbacks from many elements
             |
             v
       dirty state Set
             |
       one scheduled flush
             |
       +-----+-----+-----+
       |           |     |
    element A   element B ...
```

The default scheduler is a microtask because engine frames already usually originate in RAF. An explicit RAF commit mode is available for integrations that update values outside an animation frame.

## Layout projection

Layout remains outside numeric core:

```text
LayoutTransition
      |
 READ first rectangles
      |
 user mutation
      |
 READ last rectangles
      |
 world projection matrices
      |
 remove selected ancestor projection
      |
 child-local FLIP matrices
      |
 progress MotionValue
      |
 WRITE transforms only
```

Each element gets a viewport-space matrix that maps its last rectangle back to its first rectangle. If a selected ancestor is also projected, the child removes the ancestor's world projection before converting the remaining matrix into child-local coordinates.

The current layout adapter handles axis-aligned rectangle projection. Existing arbitrary transforms are preserved, but exact geometric projection of rotated/skewed layout boxes is intentionally not claimed yet.


## Scroll-linked execution

Scroll is treated as an external numeric input, not as another animation solver.

```text
scroll events / virtual scroll samples
              |
       one RAF-coalesced read
              |
         ScrollTracker
        offset + velocity
              |
       normalized progress
              |
      +-------+--------+
      |                |
 MotionValue users  Timeline seek
```

`ScrollObserver` reads DOM/window metrics only in its adapter. `ScrollTracker` itself only knows numbers and dynamic range functions. A timeline linked to scroll remains paused and receives deterministic seek samples; it does not consume a continuous `MotionEngine` driver slot.

## Compiled constraint graph

Constraint relationships are evaluated after animated source values commit.

```text
MotionValue sources
       |
       v
mark graph dirty
       |
engine driver (one evaluation)
       |
compiled topological program
       |
 typed value/velocity buffers
       |
MotionValue outputs
```

Built-in affine, clamp, sum, and mix instructions propagate both value and first derivative. A derived value therefore retains a physically meaningful instantaneous velocity if ownership later transfers to spring/inertia motion.

The graph topology is compiled once. Dependencies are topologically sorted, operation metadata moves into typed arrays, custom constraints receive retained scratch buffers, and output writes are stored as a compact index list. Cycles are rejected rather than iterated implicitly. This is a relationship graph, not a general nonlinear physics constraint solver; iterative/PBD constraints can be a separate backend later without slowing simple UI relationships.

## Canvas / WebGL / WebGPU renderer bridges

Renderer bridges consume ordinary `MotionValue`s and share a small frame batcher.

```text
many MotionValue commits
        |
        v
 one dirty-frame flag
        |
        +-- Canvas: retained Float64 snapshot -> one draw callback
        |
        +-- WebGL: cached locations -> dirty uniform uploads
        |
        +-- WebGPU: retained Float32 packing -> one writeBuffer
        |
        `-- WebGPU Compute: storage buffer -> bounded dispatches -> one readback
```

No renderer adapter changes the solver or motion semantics. Canvas/WebGL/WebGPU work remains tree-shakable behind package subpaths. WebGPU Compute is an optional asynchronous spring backend; it is selected only for workloads large enough to amortize command encoding and readback.

## Hot-path rules

1. Never traverse inactive UI trees. Only active arrays are stepped.
2. Spring state stays dense; removal swap-moves the final slot.
3. Never call WASM once per value. One spring batch is one WASM call per solver substep.
4. Keep solver state in typed arrays, not transient object graphs.
5. JS -> WASM promotion copies active state once; WASM memory remains authoritative afterward.
6. Worker mode shares WASM memory instead of cloning spring arrays.
7. Never mutate Worker-owned shared indices from the main thread.
8. Convert high-level spring configuration before entering the hot loop.
9. Bound bad `dt` spikes before integration.
10. Keep DOM/layout reads and writes outside numeric core.
11. Finish layout reads before projection writes.
12. Preprocess structured interpolation and path topology once; frame work should be scalar progress + numeric mixing.
13. Batch DOM writes globally instead of scheduling one microtask per element.
14. Prefer platform compositor/WAAPI execution when an adapter knows the animation can be handed off safely.
15. Keep gesture sample history in fixed storage; do not allocate one object per pointer sample.
16. Use analytical release physics for low-count direct manipulation instead of routing it through a bulk backend.
17. Compile timeline keyframe times/values and structured mixers once; do not construct per-frame keyframe objects.
18. Share compiled cubic-bezier lookup tables across timeline segments instead of solving the same curve per track per frame.
19. Remove paused/completed timeline players from the engine driver set; only running clocks are stepped.
20. Use `MotionValue.subscribeValue()` for render bindings that do not consume velocity/version metadata.
21. Keep wall-clock catch-up policy separate from numerical solver stability policy.
22. Preserve per-property velocity for numeric state transitions; do not force unrelated values through one progress scalar.
23. Share one progress animation across structured state bindings and matched-layout groups when independent physical velocity is not meaningful.
24. Treat shared-layout keys as unique identities; reject ambiguous duplicates before animation begins.
25. Preallocate per-item layout matrix buffers and move transform-origin/will-change writes out of the per-frame projection loop.
26. Coalesce scroll events before reading scroll metrics; never read layout once per delivered scroll event.
27. Compile simple value relationships into one topological constraint program instead of chaining per-edge subscriptions.
28. Propagate derivatives through built-in constraints so ownership transfers preserve motion continuity.
29. Batch renderer bridge submissions once per dirty frame and retain their numeric staging buffers.

## Backend philosophy

- Small batches: JS avoids startup and boundary overhead.
- Medium/large numeric batches: main-thread WASM SIMD gives very low solver latency.
- Large batches competing with input/layout: Worker + shared WASM minimizes main-thread occupancy.
- Fixed compositor-friendly keyframes: WAAPI escape hatch.
- Canvas/WebGL/WebGPU value bridges: renderer-specific uploads/draw invalidation outside core.
- Large spring batches: WebGPU Compute, only when dispatch and readback overhead can be amortized.
- Massive particle/mesh fields: a separate future compute backend.

Backend choice remains an optimization detail. Public motion semantics should stay stable across execution locations.
