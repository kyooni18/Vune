#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { updatePnpmWorkspaceOverrides } from '../bin/pnpm-workspace.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packDir = resolve(root, 'local-packages')
const args = process.argv.slice(2)
const projectArg = args.find(value => !value.startsWith('-'))
const rendererArg = args.find(value => value.startsWith('--renderer='))?.slice('--renderer='.length) ?? 'react'
const noInstall = args.includes('--no-install')

if (!projectArg) {
  console.error('Usage: node scripts/install-local-packages.mjs <project> [--renderer=react|vue|web] [--no-install]')
  process.exit(1)
}
if (!['react', 'vue', 'web'].includes(rendererArg)) {
  console.error(`Unsupported renderer: ${rendererArg}`)
  process.exit(1)
}

const project = resolve(process.cwd(), projectArg)
const manifestPath = resolve(project, 'package.json')
if (!existsSync(manifestPath)) {
  console.error(`Target project has no package.json: ${project}`)
  process.exit(1)
}

const packages = new Map()
for (const file of readdirSync(packDir)) {
  if (!file.endsWith('.tgz')) continue
  const match = file.match(/^(vune-ui(?:-(?:core|compiler|legacy-react|react|vue|web|vite))?)-(.+)\.tgz$/u)
  if (!match) continue
  const short = match[1]
  const name = short === 'vune-ui' ? 'vune-ui' : `@vune-ui/${short.slice('vune-ui-'.length)}`
  packages.set(name, resolve(packDir, file))
}

for (const required of ['vune-ui', '@vune-ui/core', '@vune-ui/compiler', '@vune-ui/vite', `@vune-ui/${rendererArg}`]) {
  if (!packages.has(required)) {
    console.error(`Missing local tarball for ${required}. Run \`pnpm pack:local\` first.`)
    process.exit(1)
  }
}

function fileSpec(path) {
  return `file:${path.split(sep).join('/')}`
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.dependencies ??= {}
manifest.devDependencies ??= {}
manifest.dependencies['vune-ui'] = fileSpec(packages.get('vune-ui'))
manifest.dependencies[`@vune-ui/${rendererArg}`] = fileSpec(packages.get(`@vune-ui/${rendererArg}`))
manifest.devDependencies['@vune-ui/vite'] = fileSpec(packages.get('@vune-ui/vite'))
if (manifest.pnpm?.overrides) {
  delete manifest.pnpm.overrides
  if (Object.keys(manifest.pnpm).length === 0) delete manifest.pnpm
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
updatePnpmWorkspaceOverrides(
  project,
  Object.fromEntries([...packages].map(([name, tarball]) => [name, fileSpec(tarball)])),
)

console.log(`Configured ${project} to use local Vune tarballs (${rendererArg}).`)
if (!noInstall) {
  const result = spawnSync('pnpm', ['install'], { cwd: project, stdio: 'inherit', env: process.env })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
