#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { updatePnpmWorkspaceOverrides } from './pnpm-workspace.mjs'
import { installEditors } from '../editors/install.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageManifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'))
const argv = process.argv.slice(2)
const command = argv[0]
const positionals = []
const options = {
  force: false,
  noInstall: false,
  packageManager: undefined,
  help: false,
  local: false,
  localRoot: undefined,
  renderer: undefined,
  editor: 'all',
  global: false,
  projectRoot: undefined,
}

function takeValue(argument, index, longName) {
  if (argument === longName) {
    const value = argv[index + 1]
    if (!value || value.startsWith('-')) throw new Error(`${longName} requires a value.`)
    return { value, consumed: 1 }
  }
  if (argument.startsWith(`${longName}=`)) return { value: argument.slice(longName.length + 1), consumed: 0 }
  return undefined
}

try {
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--force') options.force = true
    else if (argument === '--no-install' || argument === '--skip-install') options.noInstall = true
    else if (argument === '--local') options.local = true
    else if (argument === '--global') options.global = true
    else if (argument === '--help' || argument === '-h') options.help = true
    else {
      const packageManager = takeValue(argument, index, '--package-manager') ?? takeValue(argument, index, '--pm')
      const localRoot = takeValue(argument, index, '--local-root')
      const renderer = takeValue(argument, index, '--renderer')
      const editor = takeValue(argument, index, '--editor')
      const project = takeValue(argument, index, '--project')
      if (packageManager) {
        options.packageManager = packageManager.value
        index += packageManager.consumed
      } else if (localRoot) {
        options.local = true
        options.localRoot = localRoot.value
        index += localRoot.consumed
      } else if (renderer) {
        options.renderer = renderer.value
        index += renderer.consumed
      } else if (editor) {
        options.editor = editor.value
        index += editor.consumed
      } else if (project) {
        options.projectRoot = project.value
        index += project.consumed
      } else {
        positionals.push(argument)
      }
    }
  }
} catch (error) {
  console.error(`Vune ${command ?? 'command'} failed: ${error instanceof Error ? error.message : String(error)}`)
  printHelp()
  process.exitCode = 1
  process.exit(process.exitCode)
}

const projectFiles = [
  ['templates/project/gitignore', '.gitignore'],
  ['templates/project/index.html', 'index.html'],
  ['templates/project/package.json', 'package.json'],
  ['templates/project/tsconfig.json', 'tsconfig.json'],
  ['templates/project/vite.config.ts', 'vite.config.ts'],
  ['templates/project/src/App.vune.ts', 'src/App.vune.ts'],
  ['templates/project/src/App.css', 'src/App.css'],
  ['templates/project/src/index.css', 'src/index.css'],
  ['templates/project/src/main.ts', 'src/main.ts'],
]

const localPackagePaths = {
  'vune-ui': '.',
  '@vune-ui/core': 'packages/core',
  '@vune-ui/compiler': 'packages/compiler',
  '@vune-ui/legacy-react': 'packages/legacy-react',
  '@vune-ui/react': 'packages/react',
  '@vune-ui/vue': 'packages/vue',
  '@vune-ui/web': 'packages/web',
  '@vune-ui/vite': 'packages/vite',
}

function template(source) {
  return readFileSync(resolve(packageRoot, source), 'utf8')
    .replaceAll('__VUNE_VERSION__', packageManifest.version)
}

function writeTemplates(projectRoot, files) {
  for (const [source, destination] of files) {
    const target = resolve(projectRoot, destination)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, template(source)
      .replaceAll('__VUNE_PROJECT_NAME__', projectName(projectRoot))
      .replaceAll('__VUNE_PROJECT_APP_NAME__', projectAppName(projectRoot)))
  }
}

function projectName(projectRoot) {
  const name = basename(projectRoot)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^[._-]+|[._-]+$/gu, '')
  return name || 'vune-ui-app'
}

function projectAppName(projectRoot) {
  const words = projectName(projectRoot).split(/[-._]+/u).filter(Boolean)
  const name = words.map(word => `${word[0].toUpperCase()}${word.slice(1)}`).join('')
  return /^[A-Za-z_$]/u.test(name) ? `${name}App` : `Vune${name}App`
}

function detectPackageManager(projectRoot) {
  const userAgent = process.env.npm_config_user_agent ?? ''
  for (const manager of ['pnpm', 'yarn', 'bun', 'npm']) {
    if (userAgent.startsWith(`${manager}/`)) return manager
  }
  if (existsSync(resolve(projectRoot, 'pnpm-lock.yaml')) || existsSync(resolve(projectRoot, 'pnpm-workspace.yaml'))) return 'pnpm'
  if (existsSync(resolve(projectRoot, 'yarn.lock'))) return 'yarn'
  if (existsSync(resolve(projectRoot, 'bun.lockb')) || existsSync(resolve(projectRoot, 'bun.lock'))) return 'bun'
  return 'npm'
}

function installDependencies(projectRoot) {
  const packageManager = options.packageManager ?? detectPackageManager(projectRoot)
  if (!['pnpm', 'npm', 'yarn', 'bun'].includes(packageManager)) {
    throw new Error(`Unsupported package manager: ${packageManager}. Use pnpm, npm, yarn, or bun.`)
  }
  console.log(`Installing dependencies with ${packageManager}...`)
  const result = spawnSync(packageManager, ['install'], { cwd: projectRoot, stdio: 'inherit' })
  if (result.error) throw new Error(`Could not run ${packageManager}: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`${packageManager} install failed with exit code ${result.status ?? 1}.`)
}

function normalizeLocalRoot(value = packageRoot) {
  return resolve(process.cwd(), value)
}

function assertLocalPackageManager() {
  if (options.packageManager && options.packageManager !== 'pnpm') {
    throw new Error('Local Vune source linking currently requires pnpm. Remove --pm or use --pm pnpm.')
  }
}

function assertSourceCheckout(localRoot) {
  const manifestPath = resolve(localRoot, 'package.json')
  if (!existsSync(manifestPath)) throw new Error(`Local Vune checkout has no package.json: ${localRoot}`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.name !== 'vune-ui') throw new Error(`Local checkout is not vune-ui: ${localRoot}`)
  for (const relativePath of Object.values(localPackagePaths)) {
    if (relativePath === '.') continue
    if (!existsSync(resolve(localRoot, relativePath, 'package.json'))) {
      throw new Error(`Local Vune checkout is incomplete; missing ${relativePath}/package.json in ${localRoot}`)
    }
  }
  return localRoot
}

function linkSpecifier(path) {
  return `link:${path.split(sep).join('/')}`
}

function configureLocalDependencies(projectRoot, localRoot, renderer = 'react', { includeRootPackage = true } = {}) {
  if (!['react', 'vue', 'web'].includes(renderer)) {
    throw new Error(`Unsupported Vune renderer: ${renderer}. Use react, vue, or web.`)
  }
  localRoot = assertSourceCheckout(localRoot)
  const manifestPath = resolve(projectRoot, 'package.json')
  if (!existsSync(manifestPath)) throw new Error(`Target project has no package.json: ${projectRoot}`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.dependencies ??= {}
  manifest.devDependencies ??= {}

  if (includeRootPackage) manifest.dependencies['vune-ui'] = linkSpecifier(localRoot)
  manifest.dependencies[`@vune-ui/${renderer}`] = linkSpecifier(resolve(localRoot, `packages/${renderer}`))
  manifest.devDependencies['@vune-ui/vite'] = linkSpecifier(resolve(localRoot, 'packages/vite'))

  // link: packages deliberately do not install their own dependency graph.
  // Add the internal runtime/compiler plumbing directly so bundlers that
  // resolve through the consumer's node_modules (Vite/Rolldown included)
  // see the same graph as the Vune workspace.
  for (const name of ['@vune-ui/core', '@vune-ui/compiler']) {
    manifest.devDependencies[name] = linkSpecifier(resolve(localRoot, localPackagePaths[name]))
  }
  // pnpm 11 moved overrides out of package.json and into pnpm-workspace.yaml.
  // Keep every internal package pinned to this checkout so unpublished
  // transitive @vune-ui/* dependencies never fall through to the registry.
  if (manifest.pnpm?.overrides) {
    delete manifest.pnpm.overrides
    if (Object.keys(manifest.pnpm).length === 0) delete manifest.pnpm
  }
  const overridePaths = includeRootPackage
    ? localPackagePaths
    : Object.fromEntries(['@vune-ui/core', '@vune-ui/compiler', '@vune-ui/web', '@vune-ui/vite'].map(name => [name, localPackagePaths[name]]))
  const overrides = Object.fromEntries(
    Object.entries(overridePaths).map(([name, relativePath]) => [
      name,
      linkSpecifier(resolve(localRoot, relativePath)),
    ]),
  )

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  updatePnpmWorkspaceOverrides(projectRoot, overrides)
  console.log(`Linked Vune ${packageManifest.version} (${renderer}) from ${localRoot}`)
  return manifest
}

function printHelp() {
  console.log(`Vune UI CLI

Usage:
  vune-ui create <directory> [--pm <manager>] [--no-install] [--force] [--local] [--local-root <path>]
  vune-ui init [--force] [--no-install] [--local] [--local-root <path>]
  vune-ui link <project> [--renderer react|vue|web] [--pm <manager>] [--no-install] [--local-root <path>]
  vune-ui lsp [--stdio]
  vune-ui lsp install [--editor ...] [--project <path>] [--global]
  vune-ui editor install [--editor vim|nvim|vscode|zed|helix|generic|all] [--project <path>] [--global]
  vune-ui editor export vscode [output.vsix]

Local checkout workflow:
  # from the Vune repository
  pnpm build
  pnpm dev:link ../my-app

  # or scaffold a separate app using this checkout without npm publication
  node bin/vune-ui.mjs create ../my-app --local

Initializer aliases after publishing:
  npm create vune-ui <directory>
  pnpm create vune-ui <directory>

create scaffolds a renderer-independent Web + Vite + TypeScript Vune app.
--local rewrites Vune dependencies to link: paths pointing at the source checkout.
link adds the same local links and pnpm-workspace.yaml overrides to an existing project.`)
}

function editorCommand() {
  const action = positionals[0]
  if (action === 'install') {
    if (positionals.length > 1) options.editor = positionals[1]
    return installEditors({ editor: options.editor, projectRoot: options.projectRoot ?? process.cwd(), global: options.global }) && 0
  }
  if (action === 'export' && positionals[1] === 'vscode') {
    const script = resolve(packageRoot, 'editors/vscode/export.mjs')
    const result = spawnSync(process.execPath, [script, ...positionals.slice(2)], { cwd: packageRoot, stdio: 'inherit' })
    return result.status ?? 1
  }
  console.error('Usage: vune-ui editor install [--editor vim|nvim|vscode|zed|helix|generic|all] [--project <path>] [--global]')
  console.error('       vune-ui editor export vscode [output.vsix]')
  return 1
}

function scaffold(projectRoot, commandName) {
  if (options.local) assertLocalPackageManager()
  if (existsSync(projectRoot) && !options.force && readdirSync(projectRoot).length > 0) {
    console.error(`Vune ${commandName} cannot use a non-empty directory: ${projectRoot}`)
    console.error('Choose a new directory, use an empty directory, or re-run with --force.')
    return 1
  }

  if (options.renderer && options.renderer !== 'web') {
    throw new Error('The built-in project template uses the renderer-independent Web adapter. Use `vune-ui link` to connect an existing React or Vue project.')
  }

  mkdirSync(projectRoot, { recursive: true })
  writeTemplates(projectRoot, projectFiles)
  if (options.local) configureLocalDependencies(projectRoot, normalizeLocalRoot(options.localRoot), 'web', { includeRootPackage: false })
  console.log(`Created canonical Vune app in ${projectRoot}`)
  if (!options.noInstall) installDependencies(projectRoot)
  else console.log('Skipped dependency installation (--no-install).')
  return 0
}

function linkProject(target) {
  assertLocalPackageManager()
  const projectRoot = resolve(process.cwd(), target)
  const localRoot = normalizeLocalRoot(options.localRoot)
  configureLocalDependencies(projectRoot, localRoot, options.renderer ?? 'react')
  if (!options.noInstall) installDependencies(projectRoot)
  else console.log('Skipped dependency installation (--no-install).')
  return 0
}

function main() {
  if (options.help || !command) {
    printHelp()
    return 0
  }
  if (command === 'create' || command === 'new') {
    const target = positionals[0]
    if (!target || positionals.length > 1) {
      console.error('Usage: vune-ui create <directory> [--pm <manager>] [--no-install] [--force] [--local]')
      return 1
    }
    const projectRoot = resolve(process.cwd(), target)
    const status = scaffold(projectRoot, 'create')
    if (status === 0) console.log(`\nNext steps:\n  cd ${target}\n  ${options.packageManager ?? detectPackageManager(projectRoot)} run dev`)
    return status
  }
  if (command === 'init') {
    if (positionals.length > 0) {
      console.error('Usage: vune-ui init [--force] [--no-install] [--local]')
      return 1
    }
    return scaffold(process.cwd(), 'init')
  }
  if (command === 'link') {
    if (positionals.length !== 1) {
      console.error('Usage: vune-ui link <project> [--renderer react|vue|web] [--no-install] [--local-root <path>]')
      return 1
    }
    return linkProject(positionals[0])
  }
  if (command === 'lsp') {
    if (positionals[0] === 'install') return installEditors({ editor: options.editor, projectRoot: options.projectRoot ?? process.cwd(), global: options.global }) && 0
    const script = resolve(packageRoot, 'editors/lsp/vune-lsp.mjs')
    const result = spawnSync(process.execPath, [script, ...argv.slice(1)], { cwd: packageRoot, stdio: 'inherit' })
    return result.status ?? 1
  }
  if (command === 'editor') return editorCommand()
  console.error(`Unknown Vune command: ${command}`)
  printHelp()
  return 1
}

try {
  process.exitCode = main()
} catch (error) {
  console.error(`Vune ${command ?? 'command'} failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
