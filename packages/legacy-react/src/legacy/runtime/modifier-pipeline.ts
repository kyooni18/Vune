import type { ReactElement } from 'react'

export interface VunePlugin {
  name: string
  apply(element: ReactElement): ReactElement
}

const plugins = new Map<string, VunePlugin>()

export function registerVunePlugin(plugin: VunePlugin): void {
  plugins.set(plugin.name, plugin)
}

export function unregisterVunePlugin(name: string): boolean {
  return plugins.delete(name)
}

export function applyVunePlugins(element: ReactElement): ReactElement {
  let result = element
  for (const plugin of plugins.values()) result = plugin.apply(result)
  return result
}

export function useVunePlugin(name: string, element: ReactElement) {
  return plugins.get(name)?.apply(element) ?? element
}
