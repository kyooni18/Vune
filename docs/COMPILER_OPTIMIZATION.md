# Compiler optimization

Vune treats optimization as removal of work whose semantic answer is already
known, not as a second definition of the UI language. The canonical View graph,
initializer metadata, State/Binding semantics, identity rules, and renderer
contracts remain owned by `@vune-ui/core`.

## Optimization pipeline

After Vune-only syntax has been lowered to valid TypeScript, the compiler can
use the TypeScript `TypeChecker` and Vune's semantic metadata to specialize the
program. The current production path performs these high-value steps:

1. Resolve same-file and imported View calls when the initializer is uniquely
   known. Proven calls use `createNodeCompiled`; uncertain calls keep
   `createNodeSpecialized` or the ordinary runtime callable path.
2. Normalize compiler-generated labeled-argument carriers into the exact
   runtime parameter slots when labels/properties map unambiguously.
3. Replace simple zero-argument `@ViewBuilder` closures with their produced
   child arrays. Action closures remain closures because their execution is
   intentionally deferred.
4. Fuse statically typed modifier chains into one `modifiedContentCompiled`
   operation with compact `[name, arguments]` tuples.
5. Lower proven intrinsic host subtrees into a renderer-neutral compiled
   template plus dynamic slots. Static host element names, props, styles, and
   leaves are frozen once at module evaluation; only slot values are allocated
   per evaluation. Opaque/custom View children can remain slots without forcing
   the intrinsic parent back to the generic builder path.
6. Hoist fully static compiled subtrees whose construction contains no dynamic
   values, opaque calls, State reads, refs, or user-controlled accessors.
7. Attach declared State dependency metadata. A separate
   `dependenciesComplete` flag tells a renderer whether runtime discovery may
   be skipped or whether the metadata is only a seed.

## Trusted initializer path

`createNodeCompiled` is intentionally narrower than the normal callable View
API. It assumes the compiler has already selected the concrete initializer and
validated the argument shape. It therefore does not repeat overload search,
named-argument normalization, closure-role selection, or runtime parameter
scoring. Initializer build functions still own semantic materialization such as
option snapshotting and immutable graph construction.

The compiler will not enter this path merely because a call looks static. `any`,
`unknown`, `never`, unsafe callable return/parameter types, unresolved
variadics, and ambiguous mappings force a guarded fallback. Callable types are
inspected recursively so `() => any` cannot bypass ViewBuilder validation by
hiding an unsafe result inside an otherwise object-like function type.

## Compiled template and slot IR

`defineCompiledTemplate` freezes a renderer-neutral host template once, while
`compiledTemplate` binds the dynamic graph/value slots for one evaluation. A
template contains only host `element`/`fragment` instructions, inert data props,
primitive leaves, and explicit slots. Each slot records the structural identity
path that the equivalent ordinary graph would have used. `defineCompiledTemplate`
validates that every slot is present exactly once and pre-indexes those identity
paths, so updates do not rescan the static template just to route dynamic Views.
This keeps keyed/custom View lifetime identical when a static parent is compiled
away.

The compiler derives host props by executing the already-proven core builtin
initializer at compile time with inert marker values. It does not maintain a
second VStack/Text/CSS semantic table. If the resulting graph contains geometry,
lazy nodes, modified content, functions, foreign renderer values, unsupported
props, unsafe arguments, or another shape it cannot serialize, the pass simply
keeps the existing compiled/generic graph path.

React, Vue, Web DOM, and Web SSR expose a `VuneRenderer.template` fast path. They
compile each immutable descriptor into a renderer-native factory once and reuse
that factory for later instances, materializing native elements/VNodes/DOM/HTML
without repeating the generic host-node kind dispatch. They re-enter generic
graph traversal only for dynamic slots. A renderer that does
not implement the hook receives an equivalent generic traversal from core. This
makes the optimization optional and preserves the renderer-independent semantic
contract.

## Static subtrees

A compiled node can be hoisted only when its complete construction is immutable
and independent of render-time state. The analysis intentionally rejects opaque
identifiers, arbitrary property access, function/action values, refs, dynamic
State, and unknown calls. A dynamic parent may still reuse a proven static
child.

The important optimization is structural: repeated renders no longer allocate
identical Vune graph objects for content such as a fixed title or static stack.
This preserves renderer independence while reducing allocation and graph
traversal before React, Vue, or Web materialization.

## State dependency proof

Runtime dependency collection remains the correctness baseline. Compiler
metadata only replaces it when the complete read set is proven. The proof uses
a deliberately small closed world of locally owned State reads and known Vune
or intrinsic operations. Arbitrary member calls are not assumed pure merely
because a method happens to have a modifier-like name.

When the proof fails, renderers merge declared dependencies with the reads
observed during graph evaluation. This allows the optimization to expand later
without making an incomplete static analysis a correctness dependency.

## Renderer boundary

The first renderer-native AOT phase is implemented through the shared template/
slot IR. The compiler still emits renderer-neutral Vune values; it never imports
React, Vue, or DOM APIs. Each renderer owns the final native materialization of
that IR. This is deliberately preferable to three compiler backends that could
quietly redefine Vune semantics.

The next frontier is richer slot kinds (dynamic host props/styles, event/action
slots, keyed collection templates, and eventually direct Web patch locations).
Those extensions must preserve the same rule: code the compiler cannot prove
remains a normal Vune graph and is handled by the existing traversal.

## Performance measurement

Optimization is evaluated against equivalent host-framework work. The
application benchmark contains raw React and raw Vue client baselines alongside
Vune React/Vue for full-tree updates, single-item changes, and keyed reversal.
The benchmark also measures dynamic, specialized, and compiled initializer
construction, plus ordinary dynamic graph construction against compiled
template instantiation.

Ratio limits are regression ceilings, not promises of a fixed performance
multiple. The target is to make Vune's semantic abstraction disappear from hot
production paths whenever its answer is statically knowable, while preserving
identical behavior for every fallback case.
