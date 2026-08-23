import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const root = resolve(new URL('..', import.meta.url).pathname)
const cli = resolve(root, 'bin/vune-ui.mjs')
const initializer = resolve(root, 'packages/create-vune-ui/bin/create-vune-ui.mjs')

function run(args, cwd) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' })
}

function runInitializer(args, cwd) {
  return spawnSync(process.execPath, [initializer, ...args], { cwd, encoding: 'utf8' })
}

test('canonical vune-ui create scaffolds a project without legacy imports', () => {
  const workspace = mkdtempSync(resolve(tmpdir(), 'vune-ui-cli-'))
  const result = run(['create', 'hello-vune', '--no-install'], workspace)
  const project = resolve(workspace, 'hello-vune')

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
  assert.equal(manifest.name, 'hello-vune')
  assert.equal(manifest.dependencies['vune-ui'], '^0.1.1')
  assert.equal(manifest.dependencies['@vune-ui/react'], '^0.1.1')
  assert.equal(manifest.devDependencies['@vune-ui/vite'], '^0.1.1')
  assert.match(readFileSync(resolve(project, 'vite.config.ts'), 'utf8'), /vunePlugin\(\),[\s\S]*react\(\)/u)
  assert.doesNotMatch(readFileSync(resolve(project, 'src/App.tsx'), 'utf8'), /vune-ui\/legacy/u)
})

test('canonical vune-ui create protects a non-empty target unless forced', () => {
  const workspace = mkdtempSync(resolve(tmpdir(), 'vune-ui-cli-'))
  const project = resolve(workspace, 'existing')
  const manifest = resolve(project, 'package.json')
  mkdirSync(project, { recursive: true })
  writeFileSync(manifest, '{}')

  const result = run(['create', 'existing', '--no-install'], workspace)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /non-empty directory/u)
  assert.equal(readFileSync(manifest, 'utf8'), '{}')
})

test('create-vune-ui accepts the npm/pnpm create directory shape', () => {
  const project = mkdtempSync(resolve(tmpdir(), 'create-vune-ui-'))
  const result = runInitializer(['.', '--no-install'], project)

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Created canonical Vune app/u)
  assert.equal(existsSync(resolve(project, 'src/App.tsx')), true)
  assert.equal(JSON.parse(readFileSync(resolve(project, 'package.json'), 'utf8')).name, project.split('/').pop().toLowerCase())
})
