import fs from "node:fs"

function patch(path, before, after) {
  let source = fs.readFileSync(path, "utf8")
  if (!source.includes(before)) throw new Error(`marker missing in ${path}: ${before.slice(0, 120)}`)
  source = source.replace(before, after)
  fs.writeFileSync(path, source)
}

// Persistent duplicate-key occurrence counts make append cost proportional to
// appended rows instead of existing collection width.
const domPath = "packages/web/src/dom.ts"
patch(domPath,
`  rowsByItem: Map<object, Set<DomCollectionRow>>
  actualKeys: Set<string | number>
  pendingTransaction?: Transaction`,
`  rowsByItem: Map<object, Set<DomCollectionRow>>
  actualKeys: Set<string | number>
  occurrenceCounts: Map<string, number>
  pendingTransaction?: Transaction`)

patch(domPath,
`function indexCollectionRowsByItem(rows: readonly DomCollectionRow[]): Map<object, Set<DomCollectionRow>> {
  const result = new Map<object, Set<DomCollectionRow>>()`,
`function indexCollectionOccurrences(rows: readonly DomCollectionRow[]): Map<string, number> {
  const result = new Map<string, number>()
  for (const row of rows) result.set(row.baseKey, Math.max(result.get(row.baseKey) ?? 0, row.occurrence + 1))
  return result
}

function indexCollectionRowsByItem(rows: readonly DomCollectionRow[]): Map<object, Set<DomCollectionRow>> {
  const result = new Map<object, Set<DomCollectionRow>>()`)

patch(domPath,
`    rowsByItem: indexCollectionRowsByItem(order),
    actualKeys: new Set(order.map(row => row.key)),
    pendingMutations: [],`,
`    rowsByItem: indexCollectionRowsByItem(order),
    actualKeys: new Set(order.map(row => row.key)),
    occurrenceCounts: indexCollectionOccurrences(order),
    pendingMutations: [],`)

patch(domPath,
`    instance.rows.delete(row.entryKey)
    instance.actualKeys.delete(row.key)
    removeCollectionRowFromItemIndex(instance, row)`,
`    instance.rows.delete(row.entryKey)
    instance.actualKeys.delete(row.key)
    const occurrences = instance.occurrenceCounts.get(row.baseKey) ?? 0
    if (occurrences <= 1) instance.occurrenceCounts.delete(row.baseKey)
    else instance.occurrenceCounts.set(row.baseKey, occurrences - 1)
    removeCollectionRowFromItemIndex(instance, row)`)

patch(domPath,
`    const occurrenceCounts = new Map<string, number>()
    for (const row of instance.order) occurrenceCounts.set(row.baseKey, Math.max(occurrenceCounts.get(row.baseKey) ?? 0, row.occurrence + 1))
    const staged: Array<{ readonly entry: KeyedCollectionEntry; readonly plan: FlatKeyedHostRow; readonly item: unknown }> = []`,
`    const stagedOccurrenceCounts = new Map(instance.occurrenceCounts)
    const staged: Array<{ readonly entry: KeyedCollectionEntry; readonly plan: FlatKeyedHostRow; readonly item: unknown }> = []`)

patch(domPath,
`      const occurrence = occurrenceCounts.get(resolved.identity) ?? 0
      occurrenceCounts.set(resolved.identity, occurrence + 1)`,
`      const occurrence = stagedOccurrenceCounts.get(resolved.identity) ?? 0
      stagedOccurrenceCounts.set(resolved.identity, occurrence + 1)`)

patch(domPath,
`    instance.node = node
    return true
  }

  if (mutation.method === "reverse")`,
`    instance.occurrenceCounts = stagedOccurrenceCounts
    instance.node = node
    return true
  }

  if (mutation.method === "reverse")`)

patch(domPath,
`  instance.rowsByItem = indexCollectionRowsByItem(order)
  instance.actualKeys = new Set(order.map(row => row.key))
  return true`,
`  instance.rowsByItem = indexCollectionRowsByItem(order)
  instance.actualKeys = new Set(order.map(row => row.key))
  instance.occurrenceCounts = indexCollectionOccurrences(order)
  return true`)

// State ownership hot paths for root arrays of shallow row records. We keep a
// root-item reference count and detach only reactive leaves whose last root
// reference disappeared. Any nested reactive subtree keeps the existing full
// reconcile path, preserving shared/cyclic semantics.
const statePath = "packages/core/src/state.ts"
patch(statePath,
`  owners: Set<ReactiveOwner>
  transaction: Transaction`,
`  owners: Set<ReactiveOwner>
  rootArrayRefs?: Map<object, number>
  transaction: Transaction`)

patch(statePath,
`function detach(record: StateRecord<unknown>): void {
  for (const owner of record.owners) owner.records.delete(record)
  record.owners.clear()
}

function reconcile(record: StateRecord<unknown>): void {
  detach(record)
  attachGraph(record, record.current)
}`,
`function detach(record: StateRecord<unknown>): void {
  for (const owner of record.owners) owner.records.delete(record)
  record.owners.clear()
  record.rootArrayRefs = undefined
}

function buildRootArrayRefs(record: StateRecord<unknown>): void {
  const raw = unwrap(record.current)
  if (!Array.isArray(raw)) {
    record.rootArrayRefs = undefined
    return
  }
  const refs = new Map<object, number>()
  let length = 0
  try { length = raw.length } catch { record.rootArrayRefs = undefined; return }
  for (let index = 0; index < length; index += 1) {
    let descriptor: PropertyDescriptor | undefined
    try { descriptor = Object.getOwnPropertyDescriptor(raw, String(index)) } catch { continue }
    if (!descriptor || !("value" in descriptor)) continue
    const value = unwrap(descriptor.value)
    if (!reactiveContainer(value)) continue
    refs.set(value, (refs.get(value) ?? 0) + 1)
  }
  record.rootArrayRefs = refs
}

function reconcile(record: StateRecord<unknown>): void {
  detach(record)
  attachGraph(record, record.current)
  buildRootArrayRefs(record)
}

function shallowReactiveLeaf(value: unknown): value is object {
  const raw = unwrap(value)
  if (!reactiveContainer(raw)) return false
  let properties: readonly PropertyKey[]
  try { properties = Reflect.ownKeys(raw) } catch { return false }
  for (const property of properties) {
    let descriptor: PropertyDescriptor | undefined
    try { descriptor = Object.getOwnPropertyDescriptor(raw, property) } catch { return false }
    if (!descriptor) continue
    if (!("value" in descriptor)) return false
    if (reactiveContainer(unwrap(descriptor.value))) return false
  }
  return true
}

function detachReactiveLeaf(record: StateRecord<unknown>, value: unknown): void {
  const raw = unwrap(value)
  if (!reactiveContainer(raw)) return
  const owner = owners.get(raw)
  if (!owner) return
  owner.records.delete(record)
  record.owners.delete(owner)
}

function updateRootArrayReference(
  record: StateRecord<unknown>,
  arrayOwner: ReactiveOwner,
  previous: unknown,
  next: unknown,
): boolean {
  if (!record.rootArrayRefs || unwrap(record.current) !== arrayOwner.raw) return false
  const previousRaw = unwrap(previous)
  const nextRaw = unwrap(next)
  const previousReactive = reactiveContainer(previousRaw)
  const nextReactive = reactiveContainer(nextRaw)

  if (previousReactive && !Object.is(previousRaw, nextRaw)) {
    const count = record.rootArrayRefs.get(previousRaw) ?? 0
    if (count <= 1) {
      record.rootArrayRefs.delete(previousRaw)
      if (shallowReactiveLeaf(previousRaw)) detachReactiveLeaf(record, previousRaw)
      else return false
    } else {
      record.rootArrayRefs.set(previousRaw, count - 1)
    }
  }

  if (nextReactive && !Object.is(previousRaw, nextRaw)) {
    const count = record.rootArrayRefs.get(nextRaw) ?? 0
    record.rootArrayRefs.set(nextRaw, count + 1)
    if (count === 0) attachGraph(record, nextRaw)
  }
  return true
}

function notifyRootArraySlot(
  owner: ReactiveOwner,
  previous: unknown,
  next: unknown,
  mutation: StateMutation,
): void {
  reactiveMutationClock += 1
  const affected = [...owner.records]
  for (const record of affected) {
    if (!updateRootArrayReference(record, owner, previous, next)) {
      const change = ownershipChange(previous, next)
      updateOwnership(record, change, change === "add" ? next : undefined)
    }
  }
  let failed = false
  let failure: unknown
  for (const record of affected) {
    try { notify(record, mutation) } catch (error) {
      if (!failed) { failed = true; failure = error }
    }
  }
  if (failed) throw failure
}

function notifyRootArrayRemoval(owner: ReactiveOwner, removed: unknown, mutation: StateMutation): void {
  reactiveMutationClock += 1
  const affected = [...owner.records]
  for (const record of affected) {
    if (!record.rootArrayRefs || unwrap(record.current) !== owner.raw || !reactiveContainer(unwrap(removed))) {
      updateOwnership(record, reactiveContainer(unwrap(removed)) ? "reconcile" : "none")
      continue
    }
    const raw = unwrap(removed)
    const count = record.rootArrayRefs.get(raw) ?? 0
    if (count <= 1) {
      record.rootArrayRefs.delete(raw)
      if (shallowReactiveLeaf(raw)) detachReactiveLeaf(record, raw)
      else requestReconcile(record)
    } else {
      record.rootArrayRefs.set(raw, count - 1)
    }
  }
  let failed = false
  let failure: unknown
  for (const record of affected) {
    try { notify(record, mutation) } catch (error) {
      if (!failed) { failed = true; failure = error }
    }
  }
  if (failed) throw failure
}`)

// Keep root-array reference counts coherent for append operations.
patch(statePath,
`function notifyOwnerAdditions(
  owner: ReactiveOwner,
  additions: readonly unknown[],
  mutation: StateMutation = { kind: "invalidate", target: owner.raw },
): void {
  reactiveMutationClock += 1
  const affected = [...owner.records]
  for (const record of affected) {
    if (record.listeners.size === 0) continue
    for (const addition of additions) {
      if (reactiveContainer(unwrap(addition))) attachGraph(record, addition)
    }
  }`,
`function notifyOwnerAdditions(
  owner: ReactiveOwner,
  additions: readonly unknown[],
  mutation: StateMutation = { kind: "invalidate", target: owner.raw },
): void {
  reactiveMutationClock += 1
  const affected = [...owner.records]
  for (const record of affected) {
    if (record.listeners.size === 0) continue
    for (const addition of additions) {
      const raw = unwrap(addition)
      if (!reactiveContainer(raw)) continue
      if (record.rootArrayRefs && unwrap(record.current) === owner.raw) {
        const count = record.rootArrayRefs.get(raw) ?? 0
        record.rootArrayRefs.set(raw, count + 1)
        if (count === 0) attachGraph(record, raw)
      } else {
        attachGraph(record, raw)
      }
    }
  }`)

// Root array index replacements can update ownership without rescanning the
// other 24,999 rows.
patch(statePath,
`      const updated = Reflect.set(target, property, normalized, target)
      if (updated && changed) notifyOwner(owner, change, change === "add" ? normalized : undefined, {
        kind: "set",
        target,
        property,
        previous,
        value: normalized,
      })
      return updated`,
`      const updated = Reflect.set(target, property, normalized, target)
      if (updated && changed) {
        const mutation: StateMutation = { kind: "set", target, property, previous, value: normalized }
        const index = Array.isArray(target) && typeof property !== "symbol" ? Number(property) : Number.NaN
        if (Array.isArray(target) && Number.isSafeInteger(index) && index >= 0 && String(index) === String(property)) {
          notifyRootArraySlot(owner, previous, normalized, mutation)
        } else {
          notifyOwner(owner, change, change === "add" ? normalized : undefined, mutation)
        }
      }
      return updated`)

// Pop can detach a shallow last row in O(row width). Shift is left on the full
// reconcile path because every array index changes.
patch(statePath,
`              } else if ((property === "pop" || property === "shift") && !reactiveContainer(unwrap(result))) {
                notifyOwner(owner, "none", undefined, mutation)
              } else {
                notifyOwner(owner, "reconcile", undefined, mutation)
              }`,
`              } else if (property === "pop" && reactiveContainer(unwrap(result))) {
                notifyRootArrayRemoval(owner, result, mutation)
              } else if ((property === "pop" || property === "shift") && !reactiveContainer(unwrap(result))) {
                notifyOwner(owner, "none", undefined, mutation)
              } else {
                notifyOwner(owner, "reconcile", undefined, mutation)
              }`)

fs.writeFileSync(statePath, fs.readFileSync(statePath, "utf8"))

// Regression: replacing/removing a shallow row detaches stale owners without
// scanning unrelated row proxies; duplicates and nested rows preserve semantics.
const testsPath = "tests/core.test.mjs"
let tests = fs.readFileSync(testsPath, "utf8")
tests += `

test("State updates shallow root-array ownership without rescanning unrelated rows", () => {
  let ownKeysCalls = 0
  const rows = Array.from({ length: 256 }, (_, index) => new Proxy({ id: index, value: String(index) }, {
    ownKeys(target) { ownKeysCalls += 1; return Reflect.ownKeys(target) },
  }))
  const state = State(rows)
  let notifications = 0
  const unsubscribe = subscribeState(state, () => { notifications += 1 })
  const stale = state.value[128]
  ownKeysCalls = 0

  state.value[128] = { id: 128, value: "changed" }
  assert.equal(notifications, 1)
  assert.ok(ownKeysCalls <= 2)
  notifications = 0
  stale.value = "stale"
  assert.equal(notifications, 0)

  const removed = state.value.at(-1)
  ownKeysCalls = 0
  state.value.pop()
  assert.equal(ownKeysCalls, 0)
  notifications = 0
  removed.value = "removed"
  assert.equal(notifications, 0)
  unsubscribe()
})

test("State shallow array ownership keeps duplicate object references live", () => {
  const shared = { value: 0 }
  const state = State([shared, shared])
  let notifications = 0
  const unsubscribe = subscribeState(state, () => { notifications += 1 })
  const proxy = state.value[0]
  state.value.pop()
  notifications = 0
  proxy.value += 1
  assert.equal(notifications, 1)
  unsubscribe()
})
`
fs.writeFileSync(testsPath, tests)
