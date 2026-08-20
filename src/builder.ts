import type { ReactNode } from 'react'

export type MuseBuilder = () => ReactNode | ReactNode[]

export function resolveBuilder(value: unknown): ReactNode[] | null {
  if (typeof value !== 'function') return null
  const result = (value as MuseBuilder)()
  return Array.isArray(result) ? result : [result]
}

export function collectChildren(args: unknown[]): ReactNode[] {
  const built = resolveBuilder(args[0])
  if (built) return built
  return args as ReactNode[]
}
