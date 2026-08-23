#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(root, 'local-packages')
const targets = [
  root,
  resolve(root, 'packages/core'),
  resolve(root, 'packages/compiler'),
  resolve(root, 'packages/legacy-react'),
  resolve(root, 'packages/react'),
  resolve(root, 'packages/vue'),
  resolve(root, 'packages/web'),
  resolve(root, 'packages/vite'),
  resolve(root, 'packages/create-vune-ui'),
]

mkdirSync(out, { recursive: true })
for (const name of readdirSync(out)) {
  if (name.endsWith('.tgz')) rmSync(resolve(out, name), { force: true })
}

function pnpm(args, cwd) {
  const cli = process.env.VUNE_PNPM_CLI || process.env.npm_execpath
  const command = cli ? process.execPath : 'pnpm'
  const commandArgs = cli ? [cli, ...args] : args
  return spawnSync(command, commandArgs, { cwd, stdio: 'inherit', env: process.env })
}

for (const target of targets) {
  const manifest = JSON.parse(readFileSync(resolve(target, 'package.json'), 'utf8'))
  console.log(`Packing ${manifest.name}@${manifest.version}`)
  const result = pnpm(['pack', '--pack-destination', out], target)
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
writeFileSync(resolve(out, 'manifest.json'), `${JSON.stringify({ version: manifest.version, generatedAt: new Date().toISOString() }, null, 2)}\n`)
console.log(`Local tarballs written to ${out}`)
console.log(`Install them into another project with:\n  node ${resolve(root, 'scripts/install-local-packages.mjs')} /path/to/project`)
