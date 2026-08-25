/** Check array identity without leaking revoked Proxy errors. */
export function arrayCheck(value: unknown): boolean | undefined {
  try {
    return Array.isArray(value)
  } catch {
    return undefined
  }
}

/** Snapshot array indices without invoking iterators or indexed accessors. */
export function snapshotArrayValues(value: readonly unknown[]): readonly unknown[] {
  try {
    const length = Object.getOwnPropertyDescriptor(value, "length")
    if (!length || !("value" in length) || !Number.isSafeInteger(length.value) || length.value < 0) return Object.freeze([])
    const snapshot = new Array<unknown>(length.value)
    for (let index = 0; index < length.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      snapshot[index] = descriptor && "value" in descriptor ? descriptor.value : undefined
    }
    return Object.freeze(snapshot)
  } catch {
    return Object.freeze([])
  }
}
