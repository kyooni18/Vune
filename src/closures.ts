export type MuseClosureKind = 'value' | 'viewBuilder' | 'action'

export const museClosureKind = Symbol.for('muse.closure.kind')
export const museClosureVariants = Symbol.for('muse.closure.variants')

export interface MuseClosureVariants {
  readonly value?: (...args: any[]) => any
  readonly viewBuilder?: (...args: any[]) => any
  readonly action?: (...args: any[]) => any
}

export type MuseClosure<T extends (...args: any[]) => any> = T & {
  readonly [museClosureKind]?: MuseClosureKind
  readonly [museClosureVariants]?: MuseClosureVariants
}

/** A syntax-level closure that is resolved to one role by initializer metadata. */
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
  return typeof value === 'function'
    ? (value as MuseClosure<(...args: any[]) => any>)[museClosureVariants]
    : undefined
}

export function closureForKind<T extends (...args: any[]) => any>(
  value: T,
  kind: MuseClosureKind,
): T {
  const variants = closureVariantsOf(value)
  return (variants?.[kind] ?? value) as T
}

/** Attach a non-enumerable language-level closure role to a callable value. */
export function markMuseClosure<T extends (...args: any[]) => any>(
  closure: T,
  kind: MuseClosureKind,
): MuseClosure<T> {
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
  return typeof value === 'function'
    ? (value as MuseClosure<(...args: any[]) => any>)[museClosureKind]
    : undefined
}

export function viewBuilderClosure<T extends (...args: any[]) => any>(closure: T): MuseClosure<T> {
  return markMuseClosure(closure, 'viewBuilder')
}

export function actionClosure<T extends (...args: any[]) => any>(closure: T): MuseClosure<T> {
  return markMuseClosure(closure, 'action')
}

/** Mark a function-valued initializer argument as a value, not a builder or action. */
export function valueClosure<T extends (...args: any[]) => any>(closure: T): MuseClosure<T> {
  return markMuseClosure(closure, 'value')
}
