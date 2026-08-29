import fs from "node:fs"

const path = "packages/web/src/dom.ts"
let source = fs.readFileSync(path, "utf8")
const replace = (before, after) => {
  if (!source.includes(before)) throw new Error(`marker missing: ${before.slice(0, 100)}`)
  source = source.replace(before, after)
}

replace(
`  rowsByItem: Map<object, Set<DomCollectionRow>>
  pendingTransaction?: Transaction`,
`  rowsByItem: Map<object, Set<DomCollectionRow>>
  actualKeys: Set<string | number>
  pendingTransaction?: Transaction`,
)

replace(
`    rowsByItem: indexCollectionRowsByItem(order),
    pendingMutations: [],`,
`    rowsByItem: indexCollectionRowsByItem(order),
    actualKeys: new Set(order.map(row => row.key)),
    pendingMutations: [],`,
)

replace(
`    instance.rows.delete(row.entryKey)
    removeCollectionRowFromItemIndex(instance, row)`,
`    instance.rows.delete(row.entryKey)
    instance.actualKeys.delete(row.key)
    removeCollectionRowFromItemIndex(instance, row)`,
)

replace(
`    const staged: Array<{ readonly entry: KeyedCollectionEntry; readonly plan: FlatKeyedHostRow; readonly item: unknown }> = []
    const actualKeys = new Set(instance.order.map(row => row.key))`,
`    const staged: Array<{ readonly entry: KeyedCollectionEntry; readonly plan: FlatKeyedHostRow; readonly item: unknown }> = []
    const stagedKeys = new Set<string | number>()`,
)

replace(
`      if (!plan || actualKeys.has(plan.key)) return false
      actualKeys.add(plan.key)`,
`      if (!plan || instance.actualKeys.has(plan.key) || stagedKeys.has(plan.key)) return false
      stagedKeys.add(plan.key)`,
)

replace(
`      applyDomProps(element, plan.props, context)
      domContentContainer(element)?.appendChild(textNode)`,
`      patchDomProps(element, plan.props, context)
      domContentContainer(element)?.appendChild(textNode)`,
)

replace(
`      instance.order.push(row)
      instance.rows.set(row.entryKey, row)
      appendCollectionRowToItemIndex(instance, row)`,
`      instance.order.push(row)
      instance.rows.set(row.entryKey, row)
      instance.actualKeys.add(row.key)
      appendCollectionRowToItemIndex(instance, row)`,
)

replace(
`  instance.rows = nextRows
  instance.order = order
  instance.rowsByItem = indexCollectionRowsByItem(order)
  return true`,
`  instance.rows = nextRows
  instance.order = order
  instance.rowsByItem = indexCollectionRowsByItem(order)
  instance.actualKeys = new Set(order.map(row => row.key))
  return true`,
)

fs.writeFileSync(path, source)

const benchmarkPath = "benchmarks/collection-runtime.mjs"
let benchmark = fs.readFileSync(benchmarkPath, "utf8")
benchmark = benchmark.replace(
`assert.equal(keyRuns, 1)
assert.equal(container.querySelector("[data-row=row-extra]")?.textContent, "Extra")`,
`assert.equal(keyRuns, 1)
const section = container.querySelector("section")
assert.ok(section)
const appended = section.lastElementChild
assert.ok(appended)
assert.equal(appended.getAttribute("data-row"), "row-extra")
assert.equal(appended.textContent, "Extra")`,
)
fs.writeFileSync(benchmarkPath, benchmark)
