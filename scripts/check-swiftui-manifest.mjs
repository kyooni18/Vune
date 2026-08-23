#!/usr/bin/env node
import assert from "node:assert/strict"
import * as Core from "../packages/core/dist/index.js"

const manifest = Core.swiftUIApiManifest
const probe = Core.Text("manifest-probe")
const failures = []

for (const [name, spec] of Object.entries(manifest.views)) {
  const runtime = Core[name]
  if (typeof runtime !== "function") {
    failures.push(`View ${name} is in the SwiftUI manifest but is not exported by @vune-ui/core.`)
    continue
  }
  const generated = Core.swiftUIInitializerSymbols(name) ?? []
  const expected = spec.initializers.map(initializer => initializer.signature)
  const actual = generated.map(initializer => initializer.signature)
  try { assert.deepEqual(actual, expected) } catch {
    failures.push(`View ${name} initializer symbols do not match its manifest signatures.`)
  }
}

for (const modifier of manifest.modifiers) {
  if (typeof probe[modifier.name] !== "function") {
    failures.push(`Modifier .${modifier.name}(...) is in the manifest but is missing from ModifiableViewNode.`)
  }
  if (!Core.swiftUIStaticModifierNames.has(modifier.name)) {
    failures.push(`Modifier .${modifier.name}(...) is missing from compiler static modifier names.`)
  }
}

for (const name of Core.swiftUIStaticModifierNames) {
  if (!manifest.modifiers.some(modifier => modifier.name === name)) {
    failures.push(`Static modifier ${name} has no manifest entry.`)
  }
}

if (failures.length > 0) {
  console.error("SwiftUI manifest consistency check failed:\n")
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  const canonicalModifiers = manifest.modifiers.filter(modifier => !modifier.compatibility).length
  const compatibilityModifiers = manifest.modifiers.length - canonicalModifiers
  console.log(`SwiftUI manifest OK: ${Object.keys(manifest.views).length} canonical views, ${canonicalModifiers} canonical modifiers, ${compatibilityModifiers} compatibility modifiers.`)
}
