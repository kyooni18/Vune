import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const root = resolve(new URL('..', import.meta.url).pathname)
const manifests = [
  'package.json',
  'packages/compiler/package.json',
  'packages/core/package.json',
  'packages/create-vune-ui/package.json',
  'packages/legacy-react/package.json',
  'packages/react/package.json',
  'packages/vite/package.json',
  'packages/vue/package.json',
  'packages/web/package.json',
]

function readJSON(relative) {
  return JSON.parse(readFileSync(resolve(root, relative), 'utf8'))
}

test('workspace-internal dependencies never require a published Vune package during development', () => {
  for (const relative of manifests) {
    const manifest = readJSON(relative)
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const [name, specifier] of Object.entries(manifest[field] ?? {})) {
        if (name === 'vune-ui' || name.startsWith('@vune-ui/')) {
          assert.equal(specifier, 'workspace:*', `${relative} ${field}.${name}`)
        }
      }
    }
  }
})

test('renderer-independent root does not force a renderer into canonical consumers', () => {
  const manifest = readJSON('package.json')
  assert.equal(manifest.dependencies['@vune-ui/vue'], undefined)
  assert.equal(manifest.dependencies['@vune-ui/react'], undefined)
  assert.equal(manifest.dependencies['@vune-ui/web'], undefined)
  assert.equal(manifest.dependencies['@vune-ui/core'], 'workspace:*')
  assert.equal(manifest.peerDependencies['@vune-ui/react'], 'workspace:*')
  assert.equal(manifest.peerDependenciesMeta['@vune-ui/react'].optional, true)
  assert.equal(manifest.peerDependenciesMeta.react.optional, true)
  assert.equal(manifest.peerDependenciesMeta['react-dom'].optional, true)
})

test('local package output never checks stale archives into source', () => {
  const localDir = resolve(root, 'local-packages')
  assert.equal(existsSync(resolve(localDir, 'README.md')), true)
  assert.deepEqual(readdirSync(localDir).filter(name => name.endsWith('.tgz')), [])
  const ignore = readFileSync(resolve(root, '.gitignore'), 'utf8')
  assert.match(ignore, /^\.pi\/$/mu)
  assert.match(ignore, /^local-packages\/\*\.tgz$/mu)
})
