import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"

const directory = ".github/collection-runtime-patch"
const encoded = readdirSync(directory)
  .sort()
  .map((name) => readFileSync(`${directory}/${name}`, "utf8"))
  .join("")
const patch = gunzipSync(Buffer.from(encoded, "base64"))
writeFileSync("/tmp/collection-runtime-product.patch", patch)
execFileSync("git", ["apply", "--index", "/tmp/collection-runtime-product.patch"], {
  stdio: "inherit",
})
