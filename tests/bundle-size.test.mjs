import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve, join } from "node:path"
import test from "node:test"
import { build } from "vite"

const packageBudgets = {
  "packages/core/dist/index.js": 512,
  "dist/index.js": 512,
  "packages/react/dist/index.js": 1024,
  // Vue's renderer now carries the shared animation transaction bridge. Keep
  // this budget explicit while leaving the smaller renderer entry-point caps
  // unchanged.
  "packages/vue/dist/index.js": 20 * 1024,
  "packages/web/dist/index.js": 512,
  "packages/compiler/dist/index.js": 64 * 1024,
}

test("public package entry points stay within their size budgets", async () => {
  for (const [relativePath, budget] of Object.entries(packageBudgets)) {
    const source = await readFile(resolve(relativePath), "utf8")
    assert.ok(Buffer.byteLength(source) <= budget, `${relativePath} grew beyond ${budget} bytes`)
  }
})

test("Web SSR imports tree-shake DOM and hydration internals", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vune-tree-shake-"))
  try {
    const entry = join(directory, "entry.ts")
    await writeFile(entry, `import { Text } from "@vune-ui/core"\nimport { renderToHTML } from "@vune-ui/web"\nconsole.log(renderToHTML(Text("tree-shake")))\n`)
    const built = await build({
      root: directory,
      configFile: false,
      logLevel: "error",
      resolve: {
        alias: {
          "@vune-ui/core": resolve("packages/core/dist/index.js"),
          "@vune-ui/web": resolve("packages/web/dist/index.js"),
        },
      },
      build: {
        write: false,
        minify: false,
        rollupOptions: { input: entry },
      },
    })
    const output = Array.isArray(built) ? built[0].output[0] : built.output[0]
    assert.equal(output.type, "chunk")
    assert.doesNotMatch(output.code, /createDomRenderer|hydrateNode|MutationObserver/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
