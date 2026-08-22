import type { ReactElement } from 'react'

export interface MusePlugin {
  name: string
  apply(element: ReactElement): ReactElement
}

const plugins = new Map<string, MusePlugin>()

export function registerMusePlugin(plugin: MusePlugin): void {
  plugins.set(plugin.name, plugin)
}

export function unregisterMusePlugin(name: string): boolean {
  return plugins.delete(name)
}

export function applyMusePlugins(element: ReactElement): ReactElement {
  let result = element
  for (const plugin of plugins.values()) result = plugin.apply(result)
  return result
}

export function useMusePlugin(name: string, element: ReactElement) {
  return plugins.get(name)?.apply(element) ?? element
}
