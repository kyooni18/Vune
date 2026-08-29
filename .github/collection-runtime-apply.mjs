import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"

const directory = ".github/collection-runtime-patch"
const names = readdirSync(directory).filter((name) => /^\d{2}$/.test(name)).sort()
if (names.length !== 7) throw new Error(`expected 7 patch chunks, received ${names.length}`)
const encoded = names.map((name) => readFileSync(`${directory}/${name}`, "utf8")).join("")
if (encoded.length !== 18256) throw new Error(`unexpected encoded patch length ${encoded.length}`)
const patch = gunzipSync(Buffer.from(encoded, "base64"))
const digest = createHash("sha256").update(patch).digest("hex")
if (digest !== "5f12a1d0a24a629ade9b0bb404b80fc6aeb45a15d8f90f14ab640078cc46dd28") {
  throw new Error(`unexpected patch digest ${digest}`)
}
writeFileSync("/tmp/collection-runtime-product.patch", patch)
execFileSync("git", ["apply", "--index", "/tmp/collection-runtime-product.patch"], {
  stdio: "inherit",
})
