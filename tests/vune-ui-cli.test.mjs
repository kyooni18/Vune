import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const root = resolve(new URL('..', import.meta.url).pathname)
const cli = resolve(root, 'bin/vune-ui.mjs')
const initializer = resolve(root, 'packages/create-vune-ui/bin/create-vune-ui.mjs')
const currentVersion = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version

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
  assert.equal(manifest.dependencies['vune-ui'], `^${currentVersion}`)
  assert.equal(manifest.dependencies['@vune-ui/core'], `^${currentVersion}`)
  assert.equal(manifest.dependencies['@vune-ui/react'], `^${currentVersion}`)
  assert.equal(manifest.devDependencies['@vune-ui/vite'], `^${currentVersion}`)
  assert.match(readFileSync(resolve(project, 'src/App.tsx'), 'utf8'), /struct HelloVuneApp: View/u)
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

test('local create mode wires a separate app to the source checkout without npm publication', () => {
  const workspace = mkdtempSync(resolve(tmpdir(), 'vune-ui-local-create-'))
  const result = run(['create', 'linked-app', '--local', '--no-install'], workspace)
  const project = resolve(workspace, 'linked-app')

  assert.equal(result.status, 0, result.stderr)
  const manifest = JSON.parse(readFileSync(resolve(project, 'package.json'), 'utf8'))
  assert.match(manifest.dependencies['vune-ui'], /^link:/u)
  assert.match(manifest.dependencies['@vune-ui/react'], /^link:/u)
  assert.match(manifest.devDependencies['@vune-ui/vite'], /^link:/u)
  assert.match(manifest.devDependencies['@vune-ui/core'], /^link:/u)
  assert.match(manifest.devDependencies['@vune-ui/compiler'], /^link:/u)
  assert.equal(manifest.devDependencies['@vune-ui/legacy-react'], undefined)
  assert.equal(manifest.pnpm?.overrides, undefined)
  const workspaceConfig = readFileSync(resolve(project, 'pnpm-workspace.yaml'), 'utf8')
  assert.match(workspaceConfig, /"@vune-ui\/core": "link:/u)
  assert.match(workspaceConfig, /"@vune-ui\/compiler": "link:/u)
  assert.match(workspaceConfig, /"@vune-ui\/legacy-react": "link:/u)
  assert.doesNotMatch(JSON.stringify(manifest), /Desktop\/Muse|@muse\/|react-muse-ui/u)
})

test('vune-ui link upgrades an existing project to robust local source links', () => {
  const project = mkdtempSync(resolve(tmpdir(), 'vune-ui-link-'))
  writeFileSync(resolve(project, 'package.json'), JSON.stringify({
    name: 'consumer',
    private: true,
    dependencies: { react: '^19.0.0' },
  }, null, 2))

  const result = run(['link', project, '--no-install'], root)
  assert.equal(result.status, 0, result.stderr)
  const manifest = JSON.parse(readFileSync(resolve(project, 'package.json'), 'utf8'))
  assert.equal(manifest.dependencies.react, '^19.0.0')
  assert.match(manifest.dependencies['vune-ui'], /^link:/u)
  assert.match(manifest.dependencies['@vune-ui/react'], /^link:/u)
  assert.match(manifest.devDependencies['@vune-ui/vite'], /^link:/u)
  assert.match(manifest.devDependencies['@vune-ui/core'], /^link:/u)
  assert.match(manifest.devDependencies['@vune-ui/compiler'], /^link:/u)
  assert.equal(manifest.devDependencies['@vune-ui/legacy-react'], undefined)
  assert.equal(manifest.pnpm?.overrides, undefined)
  const workspaceConfig = readFileSync(resolve(project, 'pnpm-workspace.yaml'), 'utf8')
  for (const name of [
    'vune-ui',
    '@vune-ui/core',
    '@vune-ui/compiler',
    '@vune-ui/legacy-react',
    '@vune-ui/react',
    '@vune-ui/vue',
    '@vune-ui/web',
    '@vune-ui/vite',
  ]) assert.match(workspaceConfig, new RegExp(`${name.replace('/', '\\/').replace('@', '\\@')}\\": \"link:`), name)
})

test('vune-ui link can select Vue or Web without forcing React renderer dependencies', () => {
  for (const renderer of ['vue', 'web']) {
    const project = mkdtempSync(resolve(tmpdir(), `vune-ui-link-${renderer}-`))
    writeFileSync(resolve(project, 'package.json'), JSON.stringify({ name: `consumer-${renderer}`, private: true }, null, 2))
    const result = run(['link', project, '--renderer', renderer, '--no-install'], root)
    assert.equal(result.status, 0, result.stderr)
    const manifest = JSON.parse(readFileSync(resolve(project, 'package.json'), 'utf8'))
    assert.match(manifest.dependencies[`@vune-ui/${renderer}`], /^link:/u)
    assert.equal(manifest.dependencies['@vune-ui/react'], undefined)
  }
})


test('vune-ui link merges pnpm 11 workspace overrides without destroying existing settings', () => {
  const project = mkdtempSync(resolve(tmpdir(), 'vune-ui-link-workspace-'))
  writeFileSync(resolve(project, 'package.json'), JSON.stringify({ name: 'workspace-consumer', private: true }, null, 2))
  writeFileSync(resolve(project, 'pnpm-workspace.yaml'), `packages:
  - packages/*

overrides:
  "left-pad": "1.3.0"

onlyBuiltDependencies:
  - esbuild
`)

  const result = run(['link', project, '--no-install'], root)
  assert.equal(result.status, 0, result.stderr)
  const workspaceConfig = readFileSync(resolve(project, 'pnpm-workspace.yaml'), 'utf8')
  assert.match(workspaceConfig, /packages:\n  - packages\/\*/u)
  assert.match(workspaceConfig, /"left-pad": "1\.3\.0"/u)
  assert.match(workspaceConfig, /"@vune-ui\/compiler": "link:/u)
  assert.match(workspaceConfig, /onlyBuiltDependencies:\n  - esbuild/u)
})

test('local source mode refuses package managers that do not support the pnpm workspace override contract', () => {
  const project = mkdtempSync(resolve(tmpdir(), 'vune-ui-link-non-pnpm-'))
  writeFileSync(resolve(project, 'package.json'), JSON.stringify({ name: 'consumer-npm', private: true }, null, 2))
  const before = readFileSync(resolve(project, 'package.json'), 'utf8')
  const result = run(['link', project, '--pm', 'npm', '--no-install'], root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /requires pnpm/u)
  assert.equal(readFileSync(resolve(project, 'package.json'), 'utf8'), before)
  assert.equal(existsSync(resolve(project, 'pnpm-workspace.yaml')), false)
})
