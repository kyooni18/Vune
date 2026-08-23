export type VuneClosureKind = "value" | "viewBuilder" | "action"

export const vuneClosureKind = Symbol.for("vune.closure.kind")
export const vuneClosureVariants = Symbol.for("vune.closure.variants")

export interface VuneClosureVariants {
  readonly value?: (...args: any[]) => any
  readonly viewBuilder?: (...args: any[]) => any
  readonly action?: (...args: any[]) => any
}

export type VuneClosure<T extends (...args: any[]) => any> = T & {
  readonly [vuneClosureKind]?: VuneClosureKind
  readonly [vuneClosureVariants]?: VuneClosureVariants
}

export function overloadClosure<Args extends any[] = any[], Result = any>(
  viewBuilder: (...args: Args) => Result,
  action: (...args: Args) => unknown,
): VuneClosure<(...args: Args) => Result> {
  const closure = ((...args: Args) => viewBuilder(...args)) as VuneClosure<(...args: Args) => Result>
  Object.defineProperty(closure, vuneClosureVariants, {
    configurable: false,
    enumerable: false,
    value: { viewBuilder, action },
  })
  return closure
}

export function closureVariantsOf(value: unknown): VuneClosureVariants | undefined {
  return typeof value === "function"
    ? (value as VuneClosure<(...args: any[]) => any>)[vuneClosureVariants]
    : undefined
}

export function closureForKind<T extends (...args: any[]) => any>(value: T, kind: VuneClosureKind): T {
  return (closureVariantsOf(value)?.[kind] ?? value) as T
}

export function markVuneClosure<T extends (...args: any[]) => any>(closure: T, kind: VuneClosureKind): VuneClosure<T> {
  const current = (closure as VuneClosure<T>)[vuneClosureKind]
  if (current === kind) return closure as VuneClosure<T>
  if (current !== undefined) {
    const wrapped = ((...args: any[]) => closure(...args)) as VuneClosure<T>
    Object.defineProperty(wrapped, vuneClosureKind, { configurable: false, enumerable: false, value: kind })
    return wrapped
  }
  try {
    Object.defineProperty(closure, vuneClosureKind, { configurable: false, enumerable: false, value: kind })
    return closure as VuneClosure<T>
  } catch {
    const wrapped = ((...args: any[]) => closure(...args)) as VuneClosure<T>
    Object.defineProperty(wrapped, vuneClosureKind, { configurable: false, enumerable: false, value: kind })
    return wrapped
  }
}

export function closureKindOf(value: unknown): VuneClosureKind | undefined {
  return typeof value === "function"
    ? (value as VuneClosure<(...args: any[]) => any>)[vuneClosureKind]
    : undefined
}

export const viewBuilderClosure = <T extends (...args: any[]) => any>(closure: T) => markVuneClosure(closure, "viewBuilder")
export const actionClosure = <T extends (...args: any[]) => any>(closure: T) => markVuneClosure(closure, "action")
export const valueClosure = <T extends (...args: any[]) => any>(closure: T) => markVuneClosure(closure, "value")
