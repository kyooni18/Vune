import type { CSSProperties, ReactElement, ReactNode } from 'react'

export type { CSSProperties, ReactElement, ReactNode }

export interface StateRef<T> {
  value: T
}

export type Value<T> = T | StateRef<T> | (() => T)
export type Length = number | string

export type UIChild = ReactNode
