#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const command = process.argv[2]
const force = process.argv.includes('--force')

const files = [
  ['templates/vite/src/App.tsx', 'src/App.tsx'],
  ['templates/vite/src/App.css', 'src/App.css'],
  ['templates/vite/src/index.css', 'src/index.css'],
]

function configureVite(projectRoot) {
  const target = resolve(projectRoot, 'vite.config.ts')
  if (!existsSync(target)) {
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, readFileSync(resolve(packageRoot, 'templates/vite/vite.config.ts')))
    return 'created vite.config.ts'
  }

  let source = readFileSync(target, 'utf8')
  const hasMacroImport = source.includes("from 'react-muse-ui/vite'")
    || source.includes('from "react-muse-ui/vite"')
  const hasMacroPlugin = source.includes('museMacro()')

  if (!hasMacroImport) {
    const reactImport = /import\s+react\s+from\s+['"]@vitejs\/plugin-react['"];?/u
    source = reactImport.test(source)
      ? source.replace(reactImport, match => `${match}\nimport { museMacro } from 'react-muse-ui/vite'`)
      : `import { museMacro } from 'react-muse-ui/vite'\n${source}`
  }

  if (!hasMacroPlugin) {
    const plugins = /plugins\s*:\s*\[/u
    if (!plugins.test(source)) {
      throw new Error('Could not find a Vite plugins array in vite.config.ts.')
    }
    source = source.replace(plugins, match => `${match}museMacro(), `)
  }

  if (source !== readFileSync(target, 'utf8')) writeFileSync(target, source)
  return hasMacroImport && hasMacroPlugin ? 'vite.config.ts already configured' : 'configured vite.config.ts'
}

function printHelp() {
  console.log(`Muse CLI

Usage:
  muse init [--force]  Install the minimal Muse demo into a Vite app

The init command writes src/App.tsx, the demo styles, and configures
vite.config.ts with museMacro(). Existing app files are left untouched unless
--force is provided.`)
}

if (command !== 'init') {
  printHelp()
  process.exitCode = command ? 1 : 0
} else {
  const projectRoot = process.cwd()
  const conflicts = files
    .map(([, destination]) => resolve(projectRoot, destination))
    .filter(destination => existsSync(destination))

  if (conflicts.length > 0 && !force) {
    console.error('Muse init found existing files:')
    for (const destination of conflicts) console.error(`  ${destination}`)
    console.error('Re-run with --force to replace them.')
    process.exitCode = 1
  } else {
    for (const [source, destination] of files) {
      const target = resolve(projectRoot, destination)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, readFileSync(resolve(packageRoot, source)))
    }
    console.log(configureVite(projectRoot))
    console.log('Muse demo installed into the Vite project.')
  }
}
