import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const root = resolve(new URL('..', import.meta.url).pathname)
const cli = resolve(root, 'packages/muse/bin/muse.mjs')

function run(args, cwd) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' })
}

test('canonical muse create scaffolds a project without legacy imports', () => {
  const workspace = mkdtempSync(resolve(tmpdir(), 'muse-cli-'))
  const result = run(['create', 'hello-muse', '--no-install'], workspace)
  const project = resolve(workspace, 'hello-muse')

  assert.equal(result.status, 0, result.stderr)
  for (const file of [
    '.gitignore',
    'package.json',
    'index.html',
    'tsconfig.json',
    'vite.config.ts',
    'src/App.tsx',
    'src/App.css',
    'src/index.css',
    'src/main.tsx',
  ]) assert.equal(existsSync(resolve(project, file)), true, file)

  const manifest = JSON.parse(readFileSync(resolve(project, 'package.json'), 'utf8'))
  assert.equal(manifest.name, 'hello-muse')
  assert.equal(manifest.dependencies.muse, '^0.1.0')
  assert.equal(manifest.dependencies['@muse/react'], '^0.1.0')
  assert.equal(manifest.devDependencies['@muse/vite'], '^0.1.0')
  assert.match(readFileSync(resolve(project, 'vite.config.ts'), 'utf8'), /musePlugin\(\),[\s\S]*react\(\)/u)
  assert.doesNotMatch(readFileSync(resolve(project, 'src/App.tsx'), 'utf8'), /vune-ui/u)
})

test('canonical muse create protects a non-empty target unless forced', () => {
  const workspace = mkdtempSync(resolve(tmpdir(), 'muse-cli-'))
  const project = resolve(workspace, 'existing')
  const manifest = resolve(project, 'package.json')
  mkdirSync(project, { recursive: true })
  writeFileSync(manifest, '{}')

  const result = run(['create', 'existing', '--no-install'], workspace)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /non-empty directory/u)
  assert.equal(readFileSync(manifest, 'utf8'), '{}')
})
