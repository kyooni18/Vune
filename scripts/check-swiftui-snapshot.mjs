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
const modules = Array.isArray(snapshot.modules) ? snapshot.modules : [snapshot.module]
if (!modules.includes("SwiftUI") || !Array.isArray(snapshot.symbols)) {
  throw new Error(`Invalid SwiftUI symbol snapshot: ${snapshotPath}`)
}

const symbols = snapshot.symbols
const failures = []

function swiftUISignatures(modifier) {
  return modifier.compatibility ? [] : modifier.swiftUISignatures ?? modifier.signatures
}

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

function declarationParameters(declaration, memberName) {
  if (typeof declaration !== "string") return []
  const marker = declaration.indexOf(`${memberName}(`)
  if (marker < 0) return []
  const open = declaration.indexOf("(", marker)
  if (open < 0) return []
  let parens = 1
  let angle = 0
  let square = 0
  let braces = 0
  let start = open + 1
  const result = []
  for (let index = open + 1; index < declaration.length; index += 1) {
    const character = declaration[index]
    if (character === "(") parens += 1
    else if (character === ")") {
      parens -= 1
      if (parens === 0) {
        const value = declaration.slice(start, index).trim()
        if (value) result.push(value)
        break
      }
    } else if (character === "<") angle += 1
    else if (character === ">") angle = Math.max(0, angle - 1)
    else if (character === "[") square += 1
    else if (character === "]") square = Math.max(0, square - 1)
    else if (character === "{") braces += 1
    else if (character === "}") braces = Math.max(0, braces - 1)
    else if (character === "," && parens === 1 && angle === 0 && square === 0 && braces === 0) {
      result.push(declaration.slice(start, index).trim())
      start = index + 1
    }
  }
  return result
}

function parameterDeclaration(parameters, name) {
  return parameters.find(parameter => new RegExp(`(?:^|\\s)${name.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*:`).test(parameter))
}

function optionalDefaultsMatch(symbol, initializer) {
  const parameters = declarationParameters(symbol.declaration, "init")
  return initializer.parameters.every(parameter => {
    if (parameter.required !== false) return true
    const name = parameter.label ?? parameter.name
    if (!name) return false
    const declaration = parameterDeclaration(parameters, name)
    return declaration !== undefined && /\s=\s/.test(declaration)
  })
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
      continue
    }
    if (!matches.some(symbol => optionalDefaultsMatch(symbol, initializer))) {
      failures.push(`${name}.${initializer.signature} does not preserve the manifest's optional/defaultable parameter contract in this SDK snapshot.`)
    }
  }
}

for (const modifier of Core.swiftUIApiManifest.modifiers) {
  if (modifier.compatibility) continue
  for (const signature of swiftUISignatures(modifier)) {
    const matches = symbolsNamed(signature).filter(symbol => symbol.kind === "swift.func" || symbol.kind === "swift.method")
    if (matches.length === 0) {
      failures.push(`View modifier ${signature} is not present as a public SwiftUI member in this SDK snapshot.`)
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
    `SwiftUI SDK snapshot matches the current canonical manifest: ${viewCount} views, ${modifierCount} modifiers across ${modules.filter(Boolean).join(" + ")} (${snapshot.sdk ?? "SDK"} ${snapshot.sdkVersion ?? "unknown"}, ${snapshot.xcodeVersion ?? "unknown Xcode"}).`,
  )
}
