import type { ReactElement } from 'react'

export interface RuiPlugin {
  name: string
  apply(element: ReactElement): ReactElement
}

const plugins = new Map<string, RuiPlugin>()

export function registerRuiPlugin(plugin: RuiPlugin): void {
  plugins.set(plugin.name, plugin)
}

export function unregisterRuiPlugin(name: string): boolean {
  return plugins.delete(name)
}

export function applyRuiPlugins(element: ReactElement): ReactElement {
  let result = element
  for (const plugin of plugins.values()) result = plugin.apply(result)
  return result
}

export function useRuiPlugin(name: string, element: ReactElement) {
  return plugins.get(name)?.apply(element) ?? element
}
