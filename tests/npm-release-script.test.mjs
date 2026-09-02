import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { resolve } from 'node:path'
import { discoverReleaseTargets } from '../scripts/release-targets.mjs'

const root = resolve(new URL('..', import.meta.url).pathname)
const script = resolve(root, 'scripts/publish-npm.mjs')

function run(args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
  })
}

test('npm release plan lists all publishable packages in dependency order', () => {
  const result = run(['--plan'])
  assert.equal(result.status, 0, result.stderr)
  const names = discoverReleaseTargets(root).map(target => target.manifest.name)
  assert.ok(names.includes('@vune-ui/animation'), '@vune-ui/animation must be a release target')
  const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version
  let offset = -1
  for (const name of names) {
    const next = result.stdout.indexOf(`${name}@${version}`)
    assert.ok(next > offset, `${name} must appear after the previous package`)
    offset = next
  }
})

test('release target discovery includes every public package and publishes dependencies first', () => {
  const targets = discoverReleaseTargets(root)
  const indexByName = new Map(targets.map((target, index) => [target.manifest.name, index]))

  assert.equal(indexByName.has('@vune-ui/animation'), true)
  assert.ok(indexByName.get('@vune-ui/execution') < indexByName.get('@vune-ui/animation'))
  assert.ok(indexByName.get('@vune-ui/animation') < indexByName.get('@vune-ui/web'))
  assert.ok(indexByName.get('@vune-ui/animation') < indexByName.get('vune-ui'))

  for (const target of targets) {
    const dependencies = {
      ...target.manifest.dependencies,
      ...target.manifest.optionalDependencies,
      ...target.manifest.peerDependencies,
    }
    for (const dependency of Object.keys(dependencies)) {
      if (!indexByName.has(dependency)) continue
      assert.ok(indexByName.get(dependency) < indexByName.get(target.manifest.name), `${dependency} must publish before ${target.manifest.name}`)
    }
  }
})

test('patch plan bumps all packages without mutating package.json', () => {
  const packagePath = resolve(root, 'package.json')
  const before = readFileSync(packagePath, 'utf8')
  const current = JSON.parse(before).version
  const [major, minor, patch] = current.split('.').map(Number)
  const result = run(['--patch', '--plan'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, new RegExp(`Version\\s+: ${major}\\.${minor}\\.${patch + 1}`))
  assert.equal(readFileSync(packagePath, 'utf8'), before)
})

test('prerelease plan defaults to next dist-tag', () => {
  const result = run(['--version', '9.8.7-beta.1', '--plan'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Version\s+: 9\.8\.7-beta\.1/u)
  assert.match(result.stdout, /Tag\s+: next/u)
})

test('release helper accepts pnpm argument separators', () => {
  const result = run(['--', '--plan'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Vune npm release plan/u)
})

test('release helper rejects conflicting version bump options', () => {
  const result = run(['--patch', '--minor', '--plan'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Use only one of --patch, --minor, --major, or --version/u)
})

test('release helper rejects conflicting check profiles', () => {
  const result = run(['--quick', '--full', '--plan'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Use only one of --quick or --full/u)
})
