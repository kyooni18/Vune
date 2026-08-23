import assert from "node:assert/strict"
import test from "node:test"
import {
  Animation,
  State,
  Text,
  Transaction,
  modifierGraphOf,
  stateTransaction,
  subscribeState,
  swiftUIApiManifest,
  swiftUICanonicalModifierNames,
  swiftUIInitializerSymbols,
  swiftUIStaticModifierNames,
  withAnimation,
  withRenderTransaction,
  withTransaction,
} from "../packages/core/dist/index.js"
import { renderToHTML } from "../packages/web/dist/index.js"

test("SwiftUI API manifest is the canonical compiler/runtime seed", () => {
  const vstack = swiftUIInitializerSymbols("VStack")
  assert.equal(vstack?.length, 1)
  assert.equal(vstack?.[0].signature, "init(alignment:spacing:content:)")
  assert.deepEqual(vstack?.[0].parameters.map(parameter => parameter.name), ["alignment", "spacing", "content"])
  assert.equal(vstack?.[0].parameters.at(-1)?.kind, "viewBuilder")
  assert.equal(vstack?.[0].parameters.at(-1)?.trailing, true)

  assert.equal(swiftUICanonicalModifierNames.has("opacity"), true)
  assert.equal(swiftUICanonicalModifierNames.has("margin"), false)
  assert.equal(swiftUIStaticModifierNames.has("margin"), true)
  assert.equal(swiftUIApiManifest.schemaVersion, 1)
})

test("withAnimation snapshots its Transaction onto State changes", () => {
  const count = State(0)
  let delivered
  const unsubscribe = subscribeState(count, transaction => { delivered = transaction })
  const animation = Animation.linear(0.2).delay(0.05)

  withAnimation(animation, () => { count.value = 1 })

  unsubscribe()
  assert.strictEqual(delivered?.animation, animation)
  const snapshot = stateTransaction(count)
  assert.strictEqual(snapshot.animation, animation)
  assert.equal(snapshot.disablesAnimations, false)
})

test("withTransaction preserves animation suppression metadata", () => {
  const state = State(false)
  const transaction = new Transaction({ animation: Animation.easeOut(0.1), disablesAnimations: true, isContinuous: true })
  withTransaction(transaction, () => { state.value = true })
  const snapshot = stateTransaction(state)
  assert.strictEqual(snapshot.animation, transaction.animation)
  assert.equal(snapshot.disablesAnimations, true)
  assert.equal(snapshot.isContinuous, true)
})

test("animatable modifiers stay renderer-neutral and Web wrapper composes transforms", () => {
  const animation = Animation.easeInOut(0.25)
  const graph = Text("Motion")
    .opacity(0.5)
    .scaleEffect({ x: 1.2, y: 0.8 })
    .rotationEffect(45)
    .offset(10, 5)
    .animation(animation, true)

  assert.deepEqual(modifierGraphOf(graph).map(modifier => modifier.name), [
    "opacity",
    "scaleEffect",
    "rotationEffect",
    "offset",
    "animation",
  ])

  const html = renderToHTML(graph)
  assert.match(html, /opacity:0\.5/)
  assert.match(html, /transform:scale\(1\.2, 0\.8\) rotate\(45deg\) translate\(10px, 5px\)/)
  assert.match(html, /transition-duration:0\.25s/)
})

test("render Transactions feed the initial Web animation wrapper", () => {
  const graph = Text("Transaction").opacity(0.25).scaleEffect(0.9)
  const html = withRenderTransaction(
    new Transaction(Animation.spring(0.4, 0.8)),
    () => renderToHTML(graph),
  )
  assert.match(html, /transition-property:/)
  assert.match(html, /transition-duration:0\.4s/)
  assert.match(html, /transform:scale\(0\.9\)/)
})

import { diagnoseVuneSource, transformVuneSource } from "../packages/compiler/dist/index.js"

test("Swift-style labeled modifiers lower before TypeScript parsing", () => {
  assert.equal(
    transformVuneSource('Text("Hi").frame(width: 100, height: 40)', "Modifier.vune.ts"),
    'Text("Hi").frame({ width: 100, height: 40 })',
  )
  assert.equal(
    transformVuneSource('Text("Hi").offset(x: 10, y: 5)', "Modifier.vune.ts"),
    'Text("Hi").offset({ x: 10, y: 5 })',
  )
  assert.equal(
    transformVuneSource('Text("Hi").scaleEffect(x: 1.2, y: 0.8, anchor: .center)', "Modifier.vune.ts"),
    'Text("Hi").scaleEffect({ x: 1.2, y: 0.8 }, "center")',
  )
})

test("canonical stack syntax and diagnostics use the same manifest", () => {
  const source = 'VStack(alignment: .leading, spacing: 12) { Text("Hi") }'
  const output = transformVuneSource(source, "Stack.vune.ts")
  assert.match(output, /VStack\(namedArguments\(\{ alignment: "leading", spacing: 12 \}\), \(\) => \[Text\("Hi"\)\]\)/)
  assert.deepEqual(diagnoseVuneSource(source), [])
})

test("withAnimation lowers Swift-style Animation factories and action closures", () => {
  const source = 'withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) { expanded.value = true }'
  assert.equal(
    transformVuneSource(source, "Animation.vune.ts"),
    'withAnimation(Animation.spring(0.4, 0.8), () => { expanded.value = true })',
  )
  assert.deepEqual(diagnoseVuneSource(source), [])

  const skippedDefault = 'Animation.spring(dampingFraction: 0.7)'
  assert.equal(transformVuneSource(skippedDefault, "Animation.vune.ts"), 'Animation.spring(undefined, 0.7)')
  assert.deepEqual(diagnoseVuneSource(skippedDefault), [])

  assert.equal(
    transformVuneSource('withAnimation(.default) { expanded.value = false }', "Animation.vune.ts"),
    'withAnimation(Animation.default, () => { expanded.value = false })',
  )
  assert.equal(
    transformVuneSource('Text("Hi").animation(.easeInOut, value: active)', "Animation.vune.ts"),
    'Text("Hi").animation(Animation.easeInOut(), active)',
  )
})
