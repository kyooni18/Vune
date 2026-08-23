#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageManifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'))
const argv = process.argv.slice(2)
const command = argv[0]
const positionals = []
const options = { force: false, noInstall: false, packageManager: undefined, help: false }

for (let index = 1; index < argv.length; index += 1) {
  const argument = argv[index]
  if (argument === '--force') options.force = true
  else if (argument === '--no-install' || argument === '--skip-install') options.noInstall = true
  else if (argument === '--pm' || argument === '--package-manager') options.packageManager = argv[++index]
  else if (argument?.startsWith('--pm=')) options.packageManager = argument.slice('--pm='.length)
  else if (argument?.startsWith('--package-manager=')) options.packageManager = argument.slice('--package-manager='.length)
  else if (argument === '--help' || argument === '-h') options.help = true
  else positionals.push(argument)
}

const projectFiles = [
  ['templates/project/gitignore', '.gitignore'],
  ['templates/project/index.html', 'index.html'],
  ['templates/project/package.json', 'package.json'],
  ['templates/project/tsconfig.json', 'tsconfig.json'],
  ['templates/project/vite.config.ts', 'vite.config.ts'],
  ['templates/project/src/App.tsx', 'src/App.tsx'],
  ['templates/project/src/App.css', 'src/App.css'],
  ['templates/project/src/index.css', 'src/index.css'],
  ['templates/project/src/main.tsx', 'src/main.tsx'],
]

function template(source) {
  return readFileSync(resolve(packageRoot, source), 'utf8')
    .replaceAll('__VUNE_VERSION__', packageManifest.version)
}

function writeTemplates(projectRoot, files) {
  for (const [source, destination] of files) {
    const target = resolve(projectRoot, destination)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, template(source).replaceAll('__VUNE_PROJECT_NAME__', projectName(projectRoot)))
  }
}

function projectName(projectRoot) {
  const name = basename(projectRoot)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^[._-]+|[._-]+$/gu, '')
  return name || 'vune-ui-app'
}

function detectPackageManager(projectRoot) {
  const userAgent = process.env.npm_config_user_agent ?? ''
  for (const manager of ['pnpm', 'yarn', 'bun', 'npm']) {
    if (userAgent.startsWith(`${manager}/`)) return manager
  }
  if (existsSync(resolve(projectRoot, 'pnpm-lock.yaml'))) return 'pnpm'
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

function printHelp() {
  console.log(`Vune UI CLI

Usage:
  vune-ui create <directory> [--pm <manager>] [--no-install] [--force]
  vune-ui init [--force] [--no-install]

Initializer aliases:
  npm create vune-ui <directory> [--no-install]
  pnpm create vune-ui <directory> [--no-install]

create scaffolds a ready-to-run canonical Vune app with Vite, React, and
TypeScript. It installs dependencies unless --no-install is provided.

init scaffolds the current directory using the same canonical template.`)
}

function scaffold(projectRoot, commandName) {
  if (existsSync(projectRoot) && !options.force && readdirSync(projectRoot).length > 0) {
    console.error(`Vune ${commandName} cannot use a non-empty directory: ${projectRoot}`)
    console.error('Choose a new directory, use an empty directory, or re-run with --force.')
    return 1
  }

  mkdirSync(projectRoot, { recursive: true })
  writeTemplates(projectRoot, projectFiles)
  console.log(`Created canonical Vune app in ${projectRoot}`)
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
      console.error('Usage: vune-ui create <directory> [--pm <manager>] [--no-install] [--force]')
      return 1
    }
    const projectRoot = resolve(process.cwd(), target)
    const status = scaffold(projectRoot, 'create')
    if (status === 0) console.log(`\nNext steps:\n  cd ${target}\n  ${options.packageManager ?? detectPackageManager(projectRoot)} run dev`)
    return status
  }
  if (command === 'init') {
    if (positionals.length > 0) {
      console.error('Usage: vune-ui init [--force] [--no-install]')
      return 1
    }
    return scaffold(process.cwd(), 'init')
  }
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
