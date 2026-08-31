import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve, relative, sep, dirname } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const canonicalPackages = ["execution", "animation", "core", "compiler", "react", "vue", "web", "vite"]
const compatibilityPackages = ["legacy-react"]
const releaseTargets = [
  { dir: root, canonical: false, publishPrefix: "dist/", requireExports: true },
  ...canonicalPackages.map(packageName => ({ dir: resolve(root, "packages", packageName), canonical: true, publishPrefix: "dist/", requireExports: true })),
  ...compatibilityPackages.map(packageName => ({ dir: resolve(root, "packages", packageName), canonical: false, publishPrefix: "dist/", requireExports: true })),
  { dir: resolve(root, "packages", "create-vune-ui"), canonical: false, publishPrefix: "bin/", requireExports: false },
]
const packDir = mkdtempSync(resolve(tmpdir(), "vune-release-pack-"))
const packedTarballs = new Map()

function pnpmCommand(args, cwd) {
  const cli = process.env.VUNE_PNPM_CLI || process.env.npm_execpath
  const command = cli ? process.execPath : "pnpm"
  const commandArgs = cli ? [cli, ...args] : args
  return spawnSync(command, commandArgs, { cwd, encoding: "utf8", env: process.env })
}

function readJSON(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function localPackagePath(name) {
  const direct = resolve(root, "node_modules", name)
  if (existsSync(resolve(direct, "package.json"))) return direct
  const pnpmStore = resolve(root, "node_modules", ".pnpm")
  const entry = readdirSync(pnpmStore).find(candidate => candidate.startsWith(`${name}@`))
  const nested = entry ? resolve(pnpmStore, entry, "node_modules", name) : undefined
  assert.ok(nested && existsSync(resolve(nested, "package.json")), `local dependency ${name} is unavailable for offline release verification`)
  return nested
}

const localDependency = name => `file:${localPackagePath(name)}`

const releaseVersion = readJSON(resolve(root, "package.json")).version

function exportTargets(exportsValue, output = []) {
  if (typeof exportsValue === "string") output.push(exportsValue)
  else if (exportsValue && typeof exportsValue === "object") {
    for (const value of Object.values(exportsValue)) exportTargets(value, output)
  }
  return output
}

function walk(dir, output = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if ([".git", ".pi", "node_modules", "local-packages"].includes(entry.name)) continue
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
  assert.ok(Array.isArray(manifest.files), `${manifest.name} must declare published files`)
  assert.ok(manifest.files.some(value => target.publishPrefix.startsWith(`${value.replace(/\/$/u, "")}/`) || `${value.replace(/\/$/u, "")}/`.startsWith(target.publishPrefix)), `${manifest.name} must publish ${target.publishPrefix}`)
  if (target.requireExports) assert.ok(manifest.exports?.["."], `${manifest.name} must expose its root through exports`)

  if (target.canonical) {
    assert.equal(manifest.sideEffects, false, `${manifest.name} must be declared tree-shakeable`)
  }

  const targets = new Set(exportTargets(manifest.exports))
  if (manifest.main) targets.add(manifest.main)
  if (manifest.types) targets.add(manifest.types)
  for (const exportTarget of targets) {
    if (!exportTarget.startsWith("./")) continue
    assert.ok(existsSync(resolve(dir, exportTarget.slice(2))), `${manifest.name} export target is missing: ${exportTarget}`)
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
  assert.ok([...files].some(file => file.startsWith(target.publishPrefix)), `${manifest.name} pack must contain ${target.publishPrefix}`)
  assert.equal([...files].some(file => file.startsWith("src/") || file.startsWith("tests/") || file.includes("._") || file.startsWith(".pi/")), false, `${manifest.name} pack leaked source/test/metadata files`)
  for (const exportTarget of targets) {
    if (!exportTarget.startsWith("./")) continue
    assert.ok(files.has(exportTarget.slice(2)), `${manifest.name} packed archive is missing exported file ${exportTarget}`)
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
  if (manifest.name === 'vune-ui') {
    for (const name of [
      '@vune-ui/animation',
      '@vune-ui/compiler',
      '@vune-ui/core',
      '@vune-ui/execution',
      '@vune-ui/react',
      '@vune-ui/vite',
      '@vune-ui/vue',
      '@vune-ui/web',
    ]) assert.equal(packedManifest.dependencies?.[name], manifest.version, `canonical vune-ui must install ${name}`)
    assert.equal(packedManifest.peerDependencies, undefined, 'canonical vune-ui should not keep optional renderer peers')
  }

  console.log(`${manifest.name}@${manifest.version}: ${files.size} files, ${(report.unpackedSize / 1024).toFixed(1)} KiB unpacked`)
}

const canonicalOnlyDir = mkdtempSync(resolve(tmpdir(), "vune-canonical-only-"))
try {
  // npm cannot resolve the semver dependencies declared by the packed
  // `vune-ui` tarball in offline mode unless the matching packed dependency
  // tarballs are supplied as install candidates. Keep the project manifest
  // intentionally minimal (only the canonical package and core), while
  // making the release check independent of the machine's npm cache.
  const canonicalDependencyTarballs = canonicalPackages
    .filter(packageName => packageName !== "core")
    .map(packageName => packedTarballs.get(`@vune-ui/${packageName}`))
  writeFileSync(resolve(canonicalOnlyDir, "package.json"), JSON.stringify({
    private: true,
    type: "module",
    dependencies: {
      "vune-ui": `file:${packedTarballs.get("vune-ui")}`,
      "@vune-ui/core": `file:${packedTarballs.get("@vune-ui/core")}`,
      "@vune-ui/execution": `file:${packedTarballs.get("@vune-ui/execution")}`,
      // Satisfy external dependencies/peers from this workspace so the
      // canonical packed-install smoke test is genuinely cache-independent.
      react: localDependency("react"),
      "react-dom": localDependency("react-dom"),
      vue: localDependency("vue"),
      typescript: localDependency("typescript"),
    },
  }, null, 2))
  const install = spawnSync("npm", [
    "install",
    "--offline",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--no-package-lock",
    "--no-save",
    ...canonicalDependencyTarballs,
  ], { cwd: canonicalOnlyDir, encoding: "utf8" })
  assert.equal(install.status, 0, `canonical-only packed install failed:\n${install.stdout}\n${install.stderr}`)
  for (const packageName of ["animation", "compiler", "core", "react", "vite", "vue", "web"]) {
    assert.equal(existsSync(resolve(canonicalOnlyDir, `node_modules/@vune-ui/${packageName}`)), true, `canonical vune-ui did not install @vune-ui/${packageName}`)
  }
  const smoke = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { Text } from "vune-ui";
    const value = Text("renderer-independent");
    if (!value || typeof value !== "object") throw new Error("canonical renderer-independent import failed");
  `], { cwd: canonicalOnlyDir, encoding: "utf8" })
  assert.equal(smoke.status, 0, `canonical-only smoke test failed:\n${smoke.stdout}\n${smoke.stderr}`)
  console.log("Canonical vune-ui installs the Vune compiler, renderers, and Vite adapter")
} finally {
  rmSync(canonicalOnlyDir, { recursive: true, force: true })
}

const installDir = mkdtempSync(resolve(tmpdir(), "vune-clean-install-"))
try {
  const dependency = name => `file:${packedTarballs.get(name)}`
  const installManifest = {
    private: true,
    type: "module",
    dependencies: {
      "vune-ui": dependency("vune-ui"),
      "create-vune-ui": dependency("create-vune-ui"),
      "@vune-ui/animation": dependency("@vune-ui/animation"),
      "@vune-ui/core": dependency("@vune-ui/core"),
      "@vune-ui/compiler": dependency("@vune-ui/compiler"),
      "@vune-ui/execution": dependency("@vune-ui/execution"),
      "@vune-ui/legacy-react": dependency("@vune-ui/legacy-react"),
      "@vune-ui/react": dependency("@vune-ui/react"),
      "@vune-ui/vue": dependency("@vune-ui/vue"),
      "@vune-ui/web": dependency("@vune-ui/web"),
      "@vune-ui/vite": dependency("@vune-ui/vite"),
      react: localDependency("react"),
      "react-dom": localDependency("react-dom"),
      vue: localDependency("vue"),
      typescript: localDependency("typescript"),
    },
  }
  writeFileSync(resolve(installDir, "package.json"), JSON.stringify(installManifest, null, 2))
  const install = spawnSync("npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock"], { cwd: installDir, encoding: "utf8" })
  assert.equal(install.status, 0, `clean packed install failed:\n${install.stdout}\n${install.stderr}`)
  const smoke = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import * as canonical from "vune-ui";
    import { spring } from "@vune-ui/animation";
    import { FrameBudgetSignal } from "@vune-ui/execution";
    import { Text } from "vune-ui";
    import { renderToStaticMarkup } from "react-dom/server";
    import { render as renderReact } from "@vune-ui/react";
    import { render as renderVue } from "@vune-ui/vue";
    import { renderToHTML } from "@vune-ui/web";
    import { compileVuneFile } from "@vune-ui/compiler";
    import { vunePlugin } from "@vune-ui/vite";
    if (typeof canonical.Text !== "function") throw new Error("packed canonical entry failed");
    if (spring().kind !== "spring") throw new Error("packed animation runtime failed");
    if (new FrameBudgetSignal().snapshot().level !== "idle") throw new Error("packed execution runtime failed");
    if (renderToStaticMarkup(renderReact(Text("react"))) !== "<span>react</span>") throw new Error("packed React render failed");
    if (!renderVue(Text("vue"))) throw new Error("packed Vue render failed");
    if (renderToHTML(Text("packed")) !== "<span>packed</span>") throw new Error("packed Web render failed");
    const compiled = compileVuneFile('import { Text } from "vune-ui"\\nexport const value = Text("ok")', "packed.vune.ts");
    if (!compiled.code.includes('export const value')) throw new Error("packed compiler failed");
    if (vunePlugin().name !== "vune-compiler") throw new Error("packed Vite plugin failed");
  `], { cwd: installDir, encoding: "utf8" })
  assert.equal(smoke.status, 0, `clean packed smoke test failed:\n${smoke.stdout}\n${smoke.stderr}`)

  const generated = resolve(installDir, "generated-app")
  const initializer = resolve(installDir, "node_modules/create-vune-ui/bin/create-vune-ui.mjs")
  const scaffold = spawnSync(process.execPath, [initializer, generated, "--no-install"], { cwd: installDir, encoding: "utf8" })
  assert.equal(scaffold.status, 0, `packed create-vune-ui smoke test failed:\n${scaffold.stdout}\n${scaffold.stderr}`)
  const generatedManifest = readJSON(resolve(generated, "package.json"))
  assert.equal(generatedManifest.dependencies["vune-ui"], undefined)
  assert.equal(generatedManifest.dependencies["@vune-ui/core"], `^${releaseVersion}`)
  assert.equal(generatedManifest.dependencies["@vune-ui/web"], `^${releaseVersion}`)
  assert.equal(generatedManifest.dependencies["@vune-ui/react"], undefined)
  assert.equal(generatedManifest.dependencies.react, undefined)
  assert.equal(generatedManifest.dependencies.vue, undefined)
  assert.equal(generatedManifest.devDependencies["@vitejs/plugin-react"], undefined)
  assert.equal(generatedManifest.devDependencies["@types/react"], undefined)
  assert.equal(generatedManifest.devDependencies["@types/react-dom"], undefined)
  assert.equal(generatedManifest.devDependencies["@vune-ui/vite"], `^${releaseVersion}`)
  console.log("Clean offline install and create-vune-ui smoke tests passed")
} finally {
  rmSync(installDir, { recursive: true, force: true })
  rmSync(packDir, { recursive: true, force: true })
}
console.log("Release package verification passed")
