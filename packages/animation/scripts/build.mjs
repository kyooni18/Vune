import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const dist = resolve(root, "dist")
const prebuilt = resolve(root, "wasm", "prebuilt")
const sourceWasm = resolve(root, "wasm")
const distWasm = resolve(dist, "wasm")
const wasmNames = [
  "kernel-scalar.wasm",
  "kernel-simd.wasm",
  "kernel-shared-scalar.wasm",
  "kernel-shared-simd.wasm",
]

rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })
cpSync(resolve(root, "src"), resolve(dist, "src"), { recursive: true })
cpSync(resolve(root, "index.d.ts"), resolve(dist, "index.d.ts"))
mkdirSync(distWasm, { recursive: true })

for (const name of wasmNames) {
  const encoded = readFileSync(resolve(prebuilt, `${name}.b64`), "utf8").replace(/\s+/gu, "")
  const bytes = Buffer.from(encoded, "base64")
  writeFileSync(resolve(distWasm, name), bytes)
  // Source-level tests and local direct imports use the same loader paths as
  // the published dist tree. Materialize ignored runtime kernels for them.
  writeFileSync(resolve(sourceWasm, name), bytes)
}
