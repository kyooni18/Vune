#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import * as Core from "../packages/core/dist/index.js"

function argument(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback
}

const snapshotPath = resolve(argument("--snapshot", "api/swiftui-symbols.snapshot.json"))
if (!existsSync(snapshotPath)) {
  console.error(`SwiftUI SDK snapshot not found: ${snapshotPath}`)
  console.error("Run `pnpm snapshot:swiftui` on macOS with Xcode first.")
  process.exit(2)
}

const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"))
if (snapshot.module !== "SwiftUI" || !Array.isArray(snapshot.symbols)) {
  throw new Error(`Invalid SwiftUI symbol snapshot: ${snapshotPath}`)
}

const symbols = snapshot.symbols
const failures = []

const titles = new Map()
for (const symbol of symbols) {
  if (!symbol?.title) continue
  const list = titles.get(symbol.title) ?? []
  list.push(symbol)
  titles.set(symbol.title, list)
}

function symbolsNamed(title) {
  return titles.get(title) ?? []
}

function pathStartsWith(symbol, name) {
  return Array.isArray(symbol.pathComponents) && symbol.pathComponents[0] === name
}

for (const [name, spec] of Object.entries(Core.swiftUIApiManifest.views)) {
  const nominal = symbols.some(symbol =>
    pathStartsWith(symbol, name)
    && symbol.pathComponents.length === 1
    && ["swift.struct", "swift.class", "swift.enum"].includes(symbol.kind),
  )
  if (!nominal) {
    failures.push(`View ${name} is not a public nominal SwiftUI symbol in this SDK snapshot.`)
    continue
  }

  for (const initializer of spec.initializers) {
    const matches = symbolsNamed(initializer.signature)
      .filter(symbol => symbol.kind === "swift.init" && pathStartsWith(symbol, name))
    if (matches.length === 0) {
      failures.push(`${name}.${initializer.signature} is not present in this SDK snapshot.`)
    }
  }
}

for (const modifier of Core.swiftUIApiManifest.modifiers) {
  if (modifier.compatibility) continue
  for (const signature of modifier.signatures) {
    const matches = symbolsNamed(signature).filter(symbol => symbol.kind === "swift.func")
    if (matches.length === 0) {
      failures.push(`View modifier ${signature} is not present as a public SwiftUI function in this SDK snapshot.`)
    }
  }
}

if (failures.length > 0) {
  console.error(`SwiftUI SDK parity check failed for ${snapshot.sdk ?? "unknown SDK"} ${snapshot.sdkVersion ?? ""}:\n`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  const viewCount = Object.keys(Core.swiftUIApiManifest.views).length
  const modifierCount = Core.swiftUIApiManifest.modifiers.filter(modifier => !modifier.compatibility).length
  console.log(
    `SwiftUI SDK snapshot matches the current canonical manifest: ${viewCount} views, ${modifierCount} modifiers (${snapshot.sdk ?? "SDK"} ${snapshot.sdkVersion ?? "unknown"}, ${snapshot.xcodeVersion ?? "unknown Xcode"}).`,
  )
}
