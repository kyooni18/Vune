import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve, relative, sep } from "node:path"
import { spawnSync } from "node:child_process"

const root = resolve(new URL("..", import.meta.url).pathname)
const canonicalPackages = ["core", "compiler", "react", "vue", "web", "vite", "muse"]
const compatibilityPackages = ["legacy-react"]
const releaseTargets = [
  { dir: root, canonical: false },
  ...canonicalPackages.map(packageName => ({ dir: resolve(root, "packages", packageName), canonical: true })),
  ...compatibilityPackages.map(packageName => ({ dir: resolve(root, "packages", packageName), canonical: false })),
]
const packDir = mkdtempSync(resolve(tmpdir(), "muse-release-pack-"))
const packedTarballs = new Map()

function pnpmCommand(args, cwd) {
  const cli = process.env.MUSE_PNPM_CLI || process.env.npm_execpath
  const command = cli ? process.execPath : "pnpm"
  const commandArgs = cli ? [cli, ...args] : args
  return spawnSync(command, commandArgs, { cwd, encoding: "utf8", env: process.env })
}

function readJSON(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function exportTargets(exportsValue, output = []) {
  if (typeof exportsValue === "string") output.push(exportsValue)
  else if (exportsValue && typeof exportsValue === "object") {
    for (const value of Object.values(exportsValue)) exportTargets(value, output)
  }
  return output
}

function walk(dir, output = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "node_modules"].includes(entry.name)) continue
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) walk(path, output)
    else output.push(path)
  }
  return output
}

for (const path of walk(root)) {
  assert.equal(path.split(sep).some(part => part.startsWith("._")), false, `AppleDouble metadata must not ship: ${relative(root, path)}`)
}

for (const target of releaseTargets) {
  const dir = target.dir
  const manifestPath = resolve(dir, "package.json")
  const manifest = readJSON(manifestPath)
  assert.equal(manifest.type, "module", `${manifest.name} must publish ESM`)
  assert.ok(Array.isArray(manifest.files) && manifest.files.includes("dist"), `${manifest.name} must publish dist/`)
  assert.ok(manifest.exports?.["."], `${manifest.name} must expose its root through exports`)

  if (target.canonical) {
    assert.equal(manifest.sideEffects, false, `${manifest.name} must be declared tree-shakeable`)
  }

  const targets = new Set(exportTargets(manifest.exports))
  if (manifest.main) targets.add(manifest.main)
  if (manifest.types) targets.add(manifest.types)
  for (const target of targets) {
    if (!target.startsWith("./")) continue
    assert.ok(existsSync(resolve(dir, target.slice(2))), `${manifest.name} export target is missing: ${target}`)
  }

  const packed = spawnSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json", dir], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, npm_config_update_notifier: "false", npm_config_fund: "false", npm_config_audit: "false" },
  })
  assert.equal(packed.status, 0, `${manifest.name} npm pack --dry-run failed:\n${packed.stderr}`)
  const report = JSON.parse(packed.stdout)[0]
  assert.equal(report.name, manifest.name)
  assert.equal(report.version, manifest.version)
  const files = new Set(report.files.map(file => file.path))
  assert.ok(files.has("package.json"), `${manifest.name} pack must contain package.json`)
  assert.ok([...files].some(file => file.startsWith("dist/")), `${manifest.name} pack must contain dist/`)
  assert.equal([...files].some(file => file.startsWith("src/") || file.startsWith("tests/") || file.includes("._")), false, `${manifest.name} pack leaked source/test/AppleDouble files`)
  for (const target of targets) {
    if (!target.startsWith("./")) continue
    assert.ok(files.has(target.slice(2)), `${manifest.name} packed archive is missing exported file ${target}`)
  }
  const before = new Set(readdirSync(packDir))
  const pnpmPack = pnpmCommand(["pack", "--pack-destination", packDir], dir)
  assert.equal(pnpmPack.status, 0, `${manifest.name} pnpm pack failed:\n${pnpmPack.stdout}\n${pnpmPack.stderr}`)
  const packedName = readdirSync(packDir).find(name => name.endsWith(".tgz") && !before.has(name))
  assert.ok(packedName, `${manifest.name} pnpm pack did not create a tarball`)
  const tarball = resolve(packDir, packedName)
  packedTarballs.set(manifest.name, tarball)
  const packedManifestResult = spawnSync("tar", ["-xOf", tarball, "package/package.json"], { encoding: "utf8" })
  assert.equal(packedManifestResult.status, 0, `${manifest.name} packed package.json could not be read`)
  const packedManifest = JSON.parse(packedManifestResult.stdout)
  assert.equal(packedManifest.name, manifest.name)
  assert.equal(packedManifest.version, manifest.version)
  assert.doesNotMatch(JSON.stringify(packedManifest), /workspace:/, `${manifest.name} published manifest leaked a workspace: dependency`)

  console.log(`${manifest.name}@${manifest.version}: ${files.size} files, ${(report.unpackedSize / 1024).toFixed(1)} KiB unpacked`)
}

const installDir = mkdtempSync(resolve(tmpdir(), "muse-clean-install-"))
try {
  const dependency = name => `file:${packedTarballs.get(name)}`
  const installManifest = {
    private: true,
    type: "module",
    dependencies: {
      "vune-ui": dependency("vune-ui"),
      "@muse/core": dependency("@muse/core"),
      "@muse/compiler": dependency("@muse/compiler"),
      "@muse/legacy-react": dependency("@muse/legacy-react"),
      "@muse/react": dependency("@muse/react"),
      "@muse/vue": dependency("@muse/vue"),
      "@muse/web": dependency("@muse/web"),
      "@muse/vite": dependency("@muse/vite"),
      muse: dependency("muse"),
      react: `file:${resolve(root, "node_modules/react")}`,
      "react-dom": `file:${resolve(root, "node_modules/react-dom")}`,
      vue: `file:${resolve(root, "node_modules/vue")}`,
      typescript: `file:${resolve(root, "node_modules/typescript")}`,
    },
  }
  writeFileSync(resolve(installDir, "package.json"), JSON.stringify(installManifest, null, 2))
  const install = spawnSync("npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock"], { cwd: installDir, encoding: "utf8" })
  assert.equal(install.status, 0, `clean packed install failed:\n${install.stdout}\n${install.stderr}`)
  const smoke = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import * as compatibility from "vune-ui";
    import { Text } from "muse";
    import { renderToStaticMarkup } from "react-dom/server";
    import { render as renderReact } from "@muse/react";
    import { render as renderVue } from "@muse/vue";
    import { renderToHTML } from "@muse/web";
    import { compileMuseFile } from "@muse/compiler";
    import { musePlugin } from "@muse/vite";
    if (typeof compatibility.Text !== "function") throw new Error("packed compatibility entry failed");
    if (renderToStaticMarkup(renderReact(Text("react"))) !== "<span>react</span>") throw new Error("packed React render failed");
    if (!renderVue(Text("vue"))) throw new Error("packed Vue render failed");
    if (renderToHTML(Text("packed")) !== "<span>packed</span>") throw new Error("packed Web render failed");
    const compiled = compileMuseFile('import { Text } from "muse"\\nexport const value = Text("ok")', "packed.muse.ts");
    if (!compiled.code.includes('export const value')) throw new Error("packed compiler failed");
    if (musePlugin().name !== "muse-compiler") throw new Error("packed Vite plugin failed");
  `], { cwd: installDir, encoding: "utf8" })
  assert.equal(smoke.status, 0, `clean packed smoke test failed:\n${smoke.stdout}\n${smoke.stderr}`)
  console.log("Clean offline install smoke test passed (root/core/compiler/legacy/react/vue/web/vite/muse)")
} finally {
  rmSync(installDir, { recursive: true, force: true })
  rmSync(packDir, { recursive: true, force: true })
}
console.log("Release package verification passed")
