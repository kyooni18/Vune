export type MuseClosureKind = "value" | "viewBuilder" | "action"

export const museClosureKind = Symbol.for("muse.closure.kind")
export const museClosureVariants = Symbol.for("muse.closure.variants")

export interface MuseClosureVariants {
  readonly value?: (...args: any[]) => any
  readonly viewBuilder?: (...args: any[]) => any
  readonly action?: (...args: any[]) => any
}

export type MuseClosure<T extends (...args: any[]) => any> = T & {
  readonly [museClosureKind]?: MuseClosureKind
  readonly [museClosureVariants]?: MuseClosureVariants
}

export function overloadClosure<Args extends any[] = any[], Result = any>(
  viewBuilder: (...args: Args) => Result,
  action: (...args: Args) => unknown,
): MuseClosure<(...args: Args) => Result> {
  const closure = ((...args: Args) => viewBuilder(...args)) as MuseClosure<(...args: Args) => Result>
  Object.defineProperty(closure, museClosureVariants, {
    configurable: false,
    enumerable: false,
    value: { viewBuilder, action },
  })
  return closure
}

export function closureVariantsOf(value: unknown): MuseClosureVariants | undefined {
  return typeof value === "function"
    ? (value as MuseClosure<(...args: any[]) => any>)[museClosureVariants]
    : undefined
}

export function closureForKind<T extends (...args: any[]) => any>(value: T, kind: MuseClosureKind): T {
  return (closureVariantsOf(value)?.[kind] ?? value) as T
}

export function markMuseClosure<T extends (...args: any[]) => any>(closure: T, kind: MuseClosureKind): MuseClosure<T> {
  const current = (closure as MuseClosure<T>)[museClosureKind]
  if (current === kind) return closure as MuseClosure<T>
  if (current !== undefined) {
    const wrapped = ((...args: any[]) => closure(...args)) as MuseClosure<T>
    Object.defineProperty(wrapped, museClosureKind, { configurable: false, enumerable: false, value: kind })
    return wrapped
  }
  try {
    Object.defineProperty(closure, museClosureKind, { configurable: false, enumerable: false, value: kind })
    return closure as MuseClosure<T>
  } catch {
    const wrapped = ((...args: any[]) => closure(...args)) as MuseClosure<T>
    Object.defineProperty(wrapped, museClosureKind, { configurable: false, enumerable: false, value: kind })
    return wrapped
  }
}

export function closureKindOf(value: unknown): MuseClosureKind | undefined {
  return typeof value === "function"
    ? (value as MuseClosure<(...args: any[]) => any>)[museClosureKind]
    : undefined
}

export const viewBuilderClosure = <T extends (...args: any[]) => any>(closure: T) => markMuseClosure(closure, "viewBuilder")
export const actionClosure = <T extends (...args: any[]) => any>(closure: T) => markMuseClosure(closure, "action")
export const valueClosure = <T extends (...args: any[]) => any>(closure: T) => markMuseClosure(closure, "value")
