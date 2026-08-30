import { createElement, memo, useState } from "react"
import { createRoot } from "react-dom/client"
import { flushSync } from "react-dom"
import { createApp, h, nextTick, ref } from "vue"
import { Element, ForEach, State, defineView, initializer, subscribeState } from "@vune-ui/core"
import { compiledCollectionContent, mapStateArrayData } from "@vune-ui/core/internal/runtime"
import { render as renderReact } from "@vune-ui/react"
import { render as renderVue } from "@vune-ui/vue"
import { mount, renderToHTML } from "@vune-ui/web"
import { AuthoredPerformanceList, configureAuthoredPerformance } from "./authored-performance.vune.ts"

type Row = { id: number; value: string }
type Mode = "full" | "single" | "reverse"

function rows(count: number): Row[] {
  return Array.from({ length: count }, (_, id) => ({ id, value: String(id) }))
}

function updated(items: readonly Row[], mode: Mode): Row[] {
  if (mode === "reverse") return [...items].reverse()
  if (mode === "single") {
    const next = [...items]
    const index = Math.floor(next.length / 2)
    next[index] = { ...next[index], value: `next-${index}` }
    return next
  }
  return items.map((item, index) => ({ ...item, value: `next-${index}` }))
}

function host(): HTMLDivElement {
  const element = document.createElement("div")
  document.getElementById("benchmark-root")!.appendChild(element)
  return element
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((a, b) => a - b)
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle]
}

async function measured(rounds: number, warmups: number, factory: () => Promise<number>): Promise<number> {
  for (let warmup = 0; warmup < warmups; warmup += 1) await factory()
  const samples: number[] = []
  for (let round = 0; round < rounds; round += 1) samples.push(await factory())
  return median(samples)
}

function verifyRows(target: ParentNode, count: number, mode: Mode): void {
  const values = target.querySelectorAll("span")
  if (values.length !== count) throw new Error(`benchmark rendered ${values.length} rows; expected ${count}`)
  const middle = Math.floor(count / 2)
  if (mode === "reverse") {
    if (values[0]?.textContent !== String(count - 1) || values[count - 1]?.textContent !== "0") {
      throw new Error("reverse benchmark did not commit the expected row order")
    }
    return
  }
  const expectedMiddle = `next-${middle}`
  if (values[middle]?.textContent !== expectedMiddle) throw new Error(`${mode} benchmark did not commit the middle row`)
  if (mode === "full" && (values[0]?.textContent !== "next-0" || values[count - 1]?.textContent !== `next-${count - 1}`)) {
    throw new Error("full benchmark did not commit the complete row update")
  }
}

async function rawDom(count: number, mode: Mode): Promise<number> {
  const target = host()
  const container = document.createElement("div")
  target.appendChild(container)
  const elements = rows(count).map(row => {
    const element = document.createElement("span")
    element.appendChild(document.createTextNode(row.value))
    container.appendChild(element)
    return element
  })
  const start = performance.now()
  if (mode === "single") {
    const middle = Math.floor(count / 2)
    elements[middle]!.firstChild!.nodeValue = `next-${middle}`
  } else if (mode === "full") {
    for (let index = 0; index < count; index += 1) elements[index]!.firstChild!.nodeValue = `next-${index}`
  } else {
    const fragment = document.createDocumentFragment()
    for (let index = count - 1; index >= 0; index -= 1) fragment.appendChild(elements[index]!)
    container.appendChild(fragment)
  }
  const elapsed = performance.now() - start
  verifyRows(target, count, mode)
  target.remove()
  return elapsed
}

async function rawArray(count: number, mode: Mode): Promise<number> {
  const initial = rows(count)
  const start = performance.now()
  const next = updated(initial, mode)
  const elapsed = performance.now() - start
  if (mode === "reverse" ? next[0]?.id !== count - 1 : next[Math.floor(count / 2)]?.value !== `next-${Math.floor(count / 2)}`) {
    throw new Error("raw array benchmark did not produce the expected update")
  }
  return elapsed
}

async function vuneState(count: number, mode: Mode): Promise<number> {
  const items = State(rows(count))
  const stop = subscribeState(items, () => undefined)
  const start = performance.now()
  if (mode === "reverse") items.value.reverse()
  else items.value = updated(items.value as readonly Row[], mode)
  const elapsed = performance.now() - start
  stop()
  return elapsed
}

async function rawReact(count: number, mode: Mode, memoized = false): Promise<number> {
  const target = host()
  let setRows!: React.Dispatch<React.SetStateAction<Row[]>>
  const RowView = memo(function RowView({ row }: { row: Row }) {
    return createElement("span", null, row.value)
  })
  function App() {
    const [items, setItems] = useState(() => rows(count))
    setRows = setItems
    return createElement("div", null, items.map(row => memoized
      ? createElement(RowView, { key: row.id, row })
      : createElement("span", { key: row.id }, row.value)))
  }
  const root = createRoot(target)
  flushSync(() => root.render(createElement(App)))
  const start = performance.now()
  flushSync(() => setRows(previous => updated(previous, mode)))
  const elapsed = performance.now() - start
  verifyRows(target, count, mode)
  root.unmount()
  target.remove()
  return elapsed
}

async function rawReactEvent(count: number, mode: "single" | "full"): Promise<number> {
  const target = host()
  const RowView = memo(function RowView({ row }: { row: Row }) {
    return createElement("span", null, row.value)
  })
  function App() {
    const [items, setItems] = useState(() => rows(count))
    return createElement("div", null,
      createElement("button", { onClick: () => setItems(previous => updated(previous, mode)) }, "Update"),
      ...items.map(row => createElement(RowView, { key: row.id, row })),
    )
  }
  const root = createRoot(target)
  flushSync(() => root.render(createElement(App)))
  const button = target.querySelector("button")
  if (!button) throw new Error("raw React event benchmark button missing")
  const start = performance.now()
  flushSync(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })))
  const elapsed = performance.now() - start
  verifyRows(target, count, mode)
  root.unmount()
  target.remove()
  return elapsed
}

async function vuneReact(count: number, mode: Mode, compiled: boolean, owned = false, compilerMap = false): Promise<number> {
  const target = host()
  const items = State(rows(count))
  let graph
  if (compiled) {
    const content = compiledCollectionContent(
      row => Element("span", null, row.value),
      {
        kind: "flat-text-host",
        indexIndependent: true,
        evaluateKey: row => row.id,
        hostType: "span",
        staticProps: null,
        evaluateText: row => row.value,
        evaluate: row => ({ type: "span", props: null, text: row.value }),
      },
    )
    const App = defineView(`BrowserCompiledReact${count}${mode}`, {
      initializers: [initializer("App()", args => args.length === 0)],
      body: () => Element("div", null, ForEach.viewType.createNodeCompiled(1, [items, row => row.id, content])),
    })
    graph = App()
  } else {
    const App = defineView(`BrowserReact${count}${mode}`, {
      initializers: [initializer("App()", args => args.length === 0)],
      body: () => Element("div", null, items.value.map(row => Element("span", { key: row.id }, row.value))),
    })
    graph = App()
  }
  const root = createRoot(target)
  flushSync(() => root.render(renderReact(graph)))
  const start = performance.now()
  flushSync(() => {
    if (owned && mode === "single") {
      const index = Math.floor(items.value.length / 2)
      items.value[index] = { ...items.value[index], value: `next-${index}` }
    } else if (owned && mode === "reverse") {
      items.value.reverse()
    } else if (compilerMap && mode === "full") {
      mapStateArrayData(items, (row, index) => ({ ...row, value: `next-${index}` }))
    } else if (compilerMap && mode === "single") {
      const middle = Math.floor(count / 2)
      mapStateArrayData(items, (row, index) => index === middle ? ({ ...row, value: `next-${index}` }) : row)
    } else {
      items.value = updated(items.value as readonly Row[], mode)
    }
  })
  const elapsed = performance.now() - start
  verifyRows(target, count, mode)
  root.unmount()
  target.remove()
  return elapsed
}

async function rawVue(count: number, mode: Mode, owned = false): Promise<number> {
  const target = host()
  const items = ref(rows(count))
  const app = createApp({
    render: () => h("div", null, items.value.map(row => h("span", { key: row.id }, row.value))),
  })
  app.mount(target)
  const start = performance.now()
  if (owned && mode === "single") {
    const index = Math.floor(items.value.length / 2)
    items.value[index].value = `next-${index}`
  } else if (owned && mode === "reverse") {
    items.value.reverse()
  } else {
    items.value = updated(items.value, mode)
  }
  await nextTick()
  const elapsed = performance.now() - start
  verifyRows(target, count, mode)
  app.unmount()
  target.remove()
  return elapsed
}

async function rawVueEvent(count: number, mode: "single" | "full"): Promise<number> {
  const target = host()
  const items = ref(rows(count))
  const app = createApp({
    render: () => h("div", null, [
      h("button", { onClick: () => { items.value = updated(items.value, mode) } }, "Update"),
      ...items.value.map(row => h("span", { key: row.id }, row.value)),
    ]),
  })
  app.mount(target)
  const button = target.querySelector("button")
  if (!button) throw new Error("raw Vue event benchmark button missing")
  const start = performance.now()
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  await nextTick()
  const elapsed = performance.now() - start
  verifyRows(target, count, mode)
  app.unmount()
  target.remove()
  return elapsed
}

async function vuneVue(count: number, mode: Mode, compiled: boolean, owned = false, compilerMap = false): Promise<number> {
  const target = host()
  const items = State(rows(count))
  let graph
  if (compiled) {
    const content = compiledCollectionContent(
      row => Element("span", null, row.value),
      {
        kind: "flat-text-host",
        indexIndependent: true,
        evaluateKey: row => row.id,
        hostType: "span",
        staticProps: null,
        evaluateText: row => row.value,
        evaluate: row => ({ type: "span", props: null, text: row.value }),
      },
    )
    const App = defineView(`BrowserCompiledVue${count}${mode}`, {
      initializers: [initializer("App()", args => args.length === 0)],
      body: () => Element("div", null, ForEach.viewType.createNodeCompiled(1, [items, row => row.id, content])),
    })
    graph = App()
  } else {
    const App = defineView(`BrowserVue${count}${mode}`, {
      initializers: [initializer("App()", args => args.length === 0)],
      body: () => Element("div", null, items.value.map(row => Element("span", { key: row.id }, row.value))),
    })
    graph = App()
  }
  const app = createApp({ render: () => renderVue(graph) })
  app.mount(target)
  const start = performance.now()
  if (owned && mode === "single") {
    const index = Math.floor(items.value.length / 2)
    items.value[index] = { ...items.value[index], value: `next-${index}` }
  } else if (owned && mode === "reverse") {
    items.value.reverse()
  } else if (compilerMap && mode === "full") {
    mapStateArrayData(items, (row, index) => ({ ...row, value: `next-${index}` }))
  } else if (compilerMap && mode === "single") {
    const middle = Math.floor(count / 2)
    mapStateArrayData(items, (row, index) => index === middle ? ({ ...row, value: `next-${index}` }) : row)
  } else {
    items.value = updated(items.value as readonly Row[], mode)
  }
  await nextTick()
  const elapsed = performance.now() - start
  verifyRows(target, count, mode)
  app.unmount()
  target.remove()
  return elapsed
}

async function vuneWeb(count: number, mode: Mode, compiled: boolean, owned = false, compilerMap = false): Promise<number> {
  const target = host()
  const items = State(rows(count))
  let graph
  if (compiled) {
    const content = compiledCollectionContent(
      row => Element("span", null, row.value),
      {
        kind: "flat-text-host",
        indexIndependent: true,
        evaluateKey: row => row.id,
        hostType: "span",
        staticProps: null,
        evaluateText: row => row.value,
        evaluate: row => ({ type: "span", props: null, text: row.value }),
      },
    )
    const App = defineView(`BrowserCompiledWeb${count}${mode}`, {
      initializers: [initializer("App()", args => args.length === 0)],
      body: () => Element("div", null, ForEach.viewType.createNodeCompiled(1, [items, row => row.id, content])),
    })
    graph = App()
  } else {
    const App = defineView(`BrowserWeb${count}${mode}`, {
      initializers: [initializer("App()", args => args.length === 0)],
      body: () => Element("div", null, items.value.map(row => Element("span", { key: row.id }, row.value))),
    })
    graph = App()
  }
  const unmount = mount(graph, target)
  const start = performance.now()
  if (owned && mode === "single") {
    const index = Math.floor(items.value.length / 2)
    items.value[index] = { ...items.value[index], value: `next-${index}` }
  } else if (owned && mode === "reverse") {
    items.value.reverse()
  } else if (compilerMap && mode === "full") {
    mapStateArrayData(items, (row, index) => ({ ...row, value: `next-${index}` }))
  } else if (compilerMap && mode === "single") {
    const middle = Math.floor(count / 2)
    mapStateArrayData(items, (row, index) => index === middle ? ({ ...row, value: `next-${index}` }) : row)
  } else {
    items.value = updated(items.value as readonly Row[], mode)
  }
  await Promise.resolve()
  await Promise.resolve()
  const elapsed = performance.now() - start
  verifyRows(target, count, mode)
  unmount()
  target.remove()
  return elapsed
}

async function vuneWebHydration(count: number, stateOwned: boolean): Promise<number> {
  const target = host()
  const raw = rows(count)
  const items = stateOwned ? State(raw) : raw
  const content = compiledCollectionContent(
    row => Element("span", { "data-key": row.id }, row.value),
    {
      kind: "flat-text-host",
      indexIndependent: true,
      evaluateKey: row => row.id,
      hostType: "span",
      evaluateProps: row => ({ "data-key": row.id }),
      evaluateText: row => row.value,
      evaluate: row => ({ type: "span", props: { "data-key": row.id }, text: row.value }),
    },
  )
  const App = defineView(`BrowserHydration${count}${stateOwned ? "State" : "Static"}`, {
    initializers: [initializer("App()", args => args.length === 0)],
    body: () => Element("div", null, ForEach.viewType.createNodeCompiled(1, [items, row => row.id, content])),
  })
  const graph = App()
  target.innerHTML = renderToHTML(graph)
  const start = performance.now()
  const unmount = mount(graph, target, { hydrate: true })
  const elapsed = performance.now() - start
  if (target.querySelectorAll("span").length !== count) throw new Error("hydration benchmark lost collection rows")
  unmount()
  target.remove()
  return elapsed
}

function prepareAuthoredBenchmark(count: number): void {
  configureAuthoredPerformance(count)
}

function authoredButton(target: ParentNode, mode: "single" | "full"): HTMLButtonElement {
  const button = target.querySelectorAll("button")[mode === "single" ? 0 : 1]
  if (!(button instanceof HTMLButtonElement)) throw new Error(`authored ${mode} benchmark button missing`)
  return button
}

function verifyAuthoredRows(target: ParentNode, count: number, mode: "single" | "full"): void {
  const values = target.querySelectorAll("[data-row]")
  if (values.length !== count) throw new Error(`authored benchmark rendered ${values.length} rows; expected ${count}`)
  const middle = Math.floor(count / 2)
  if (values[middle]?.textContent !== `next-${middle}`) throw new Error(`authored ${mode} benchmark did not commit the middle row`)
  if (mode === "full" && (values[0]?.textContent !== "next-0" || values[count - 1]?.textContent !== `next-${count - 1}`)) {
    throw new Error("authored full benchmark did not commit the complete row update")
  }
}

async function authoredWeb(count: number, mode: "single" | "full"): Promise<number> {
  prepareAuthoredBenchmark(count)
  const target = host()
  const unmount = mount(AuthoredPerformanceList(), target)
  const button = authoredButton(target, mode)
  const start = performance.now()
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  await Promise.resolve(); await Promise.resolve()
  const elapsed = performance.now() - start
  verifyAuthoredRows(target, count, mode)
  unmount()
  target.remove()
  return elapsed
}

async function authoredReact(count: number, mode: "single" | "full"): Promise<number> {
  prepareAuthoredBenchmark(count)
  const target = host()
  const root = createRoot(target)
  flushSync(() => root.render(renderReact(AuthoredPerformanceList())))
  const button = authoredButton(target, mode)
  const start = performance.now()
  flushSync(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })))
  const elapsed = performance.now() - start
  verifyAuthoredRows(target, count, mode)
  root.unmount()
  target.remove()
  return elapsed
}

async function authoredVue(count: number, mode: "single" | "full"): Promise<number> {
  prepareAuthoredBenchmark(count)
  const target = host()
  const graph = AuthoredPerformanceList()
  const app = createApp({ render: () => renderVue(graph) })
  app.mount(target)
  const button = authoredButton(target, mode)
  const start = performance.now()
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  await nextTick()
  const elapsed = performance.now() - start
  verifyAuthoredRows(target, count, mode)
  app.unmount()
  target.remove()
  return elapsed
}

async function run({ count = 5000, rounds = 7, warmups = 3, only }: { count?: number; rounds?: number; warmups?: number; only?: readonly string[] } = {}) {
  const result: Record<string, number> = {}
  const selected = only && only.length > 0 ? new Set(only) : undefined
  const add = async (name: string, factory: () => Promise<number>) => {
    if (selected && !selected.has(name)) return
    result[name] = await measured(rounds, warmups, factory)
  }
  await add("array.single", () => rawArray(count, "single"))
  await add("state.single", () => vuneState(count, "single"))
  await add("dom.single", () => rawDom(count, "single"))
  await add("react.single", () => rawReact(count, "single"))
  await add("react.memo.single", () => rawReact(count, "single", true))
  await add("react.event.single", () => rawReactEvent(count, "single"))
  await add("vune.react.single", () => vuneReact(count, "single", false))
  await add("vune.react.compiled.single", () => vuneReact(count, "single", true))
  await add("vune.react.compiler-map.single", () => vuneReact(count, "single", true, false, true))
  await add("vune.react.owned.single", () => vuneReact(count, "single", true, true))
  await add("vue.single", () => rawVue(count, "single"))
  await add("vue.owned.single", () => rawVue(count, "single", true))
  await add("vue.event.single", () => rawVueEvent(count, "single"))
  await add("vune.vue.single", () => vuneVue(count, "single", false))
  await add("vune.vue.compiled.single", () => vuneVue(count, "single", true))
  await add("vune.vue.compiler-map.single", () => vuneVue(count, "single", true, false, true))
  await add("vune.vue.owned.single", () => vuneVue(count, "single", true, true))
  await add("vune.web.single", () => vuneWeb(count, "single", false))
  await add("vune.web.compiled.single", () => vuneWeb(count, "single", true))
  await add("vune.web.compiler-map.single", () => vuneWeb(count, "single", true, false, true))
  await add("vune.web.owned.single", () => vuneWeb(count, "single", true, true))
  await add("authored.web.single", () => authoredWeb(count, "single"))
  await add("authored.react.single", () => authoredReact(count, "single"))
  await add("authored.vue.single", () => authoredVue(count, "single"))
  await add("array.full", () => rawArray(count, "full"))
  await add("state.full", () => vuneState(count, "full"))
  await add("dom.full", () => rawDom(count, "full"))
  await add("react.full", () => rawReact(count, "full"))
  await add("react.event.full", () => rawReactEvent(count, "full"))
  await add("vune.react.full", () => vuneReact(count, "full", false))
  await add("vune.react.compiled.full", () => vuneReact(count, "full", true))
  await add("vune.react.compiler-map.full", () => vuneReact(count, "full", true, false, true))
  await add("vue.full", () => rawVue(count, "full"))
  await add("vue.event.full", () => rawVueEvent(count, "full"))
  await add("vune.vue.full", () => vuneVue(count, "full", false))
  await add("vune.vue.compiled.full", () => vuneVue(count, "full", true))
  await add("vune.vue.compiler-map.full", () => vuneVue(count, "full", true, false, true))
  await add("vune.web.full", () => vuneWeb(count, "full", false))
  await add("vune.web.compiled.full", () => vuneWeb(count, "full", true))
  await add("vune.web.compiler-map.full", () => vuneWeb(count, "full", true, false, true))
  await add("authored.web.full", () => authoredWeb(count, "full"))
  await add("authored.react.full", () => authoredReact(count, "full"))
  await add("authored.vue.full", () => authoredVue(count, "full"))
  await add("array.reverse", () => rawArray(count, "reverse"))
  await add("state.reverse", () => vuneState(count, "reverse"))
  await add("dom.reverse", () => rawDom(count, "reverse"))
  await add("react.reverse", () => rawReact(count, "reverse"))
  await add("vune.react.reverse", () => vuneReact(count, "reverse", false))
  await add("vune.react.compiled.reverse", () => vuneReact(count, "reverse", true, true))
  await add("vue.reverse", () => rawVue(count, "reverse"))
  await add("vune.vue.reverse", () => vuneVue(count, "reverse", false))
  await add("vune.vue.compiled.reverse", () => vuneVue(count, "reverse", true, true))
  await add("vune.web.reverse", () => vuneWeb(count, "reverse", false))
  await add("vune.web.compiled.reverse", () => vuneWeb(count, "reverse", true, true))
  await add("vune.web.hydration.static", () => vuneWebHydration(count, false))
  await add("vune.web.hydration.state", () => vuneWebHydration(count, true))
  return result
}

declare global {
  interface Window {
    __vuneBenchmark: { run: typeof run }
  }
}

window.__vuneBenchmark = { run }
