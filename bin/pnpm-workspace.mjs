import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

function decodeKey(source) {
  const value = source.trim()
  if (!value) return undefined
  if (value.startsWith('"')) {
    try { return JSON.parse(value) } catch { return undefined }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'")
  return value
}

function overrideKey(line) {
  const match = /^ {2}((?:"(?:\\.|[^"\\])*")|(?:'(?:''|[^'])*')|(?:[^:#][^:]*?)):\s*/u.exec(line)
  return match ? decodeKey(match[1]) : undefined
}

function renderedEntries(overrides) {
  return Object.entries(overrides)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, specifier]) => `  ${JSON.stringify(name)}: ${JSON.stringify(specifier)}`)
}

/**
 * Merge package overrides into pnpm 11+'s canonical settings file without
 * destroying unrelated workspace settings or user-defined overrides.
 */
export function updatePnpmWorkspaceOverrides(projectRoot, overrides) {
  const path = resolve(projectRoot, 'pnpm-workspace.yaml')
  const source = existsSync(path) ? readFileSync(path, 'utf8').replaceAll('\r\n', '\n') : ''
  const lines = source ? source.split('\n') : []
  if (lines.at(-1) === '') lines.pop()

  const start = lines.findIndex(line => /^overrides:\s*(?:#.*)?$/u.test(line))
  const entries = renderedEntries(overrides)

  if (start < 0) {
    if (lines.length > 0 && lines.at(-1)?.trim() !== '') lines.push('')
    lines.push('overrides:', ...entries)
  } else {
    let end = start + 1
    while (end < lines.length) {
      const line = lines[end]
      if (/^\S/u.test(line) && line.trim() !== '' && !line.startsWith('#')) break
      end += 1
    }
    const names = new Set(Object.keys(overrides))
    const preserved = lines.slice(start + 1, end).filter(line => {
      const key = overrideKey(line)
      return !key || !names.has(key)
    })
    lines.splice(start + 1, end - start - 1, ...preserved, ...entries)
  }

  writeFileSync(path, `${lines.join('\n').replace(/\n{3,}/gu, '\n\n')}\n`)
  return path
}
