import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const wasm = resolve(root, "wasm")
const prebuilt = resolve(wasm, "prebuilt")
mkdirSync(prebuilt, { recursive: true })

for (const name of [
  "kernel-scalar.wasm",
  "kernel-simd.wasm",
  "kernel-shared-scalar.wasm",
  "kernel-shared-simd.wasm",
]) {
  const encoded = readFileSync(resolve(wasm, name)).toString("base64")
  writeFileSync(resolve(prebuilt, `${name}.b64`), `${encoded}\n`)
}
