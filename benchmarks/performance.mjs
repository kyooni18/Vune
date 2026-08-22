import { performance } from "node:perf_hooks"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { JSDOM } from "jsdom"
import { compileMuseFile } from "../packages/compiler/dist/index.js"
import {
  Element,
  ForEach,
  State,
  Text,
  VStack,
  defineView,
  initializer,
  initializerKinds,
  subscribeState,
} from "../packages/core/dist/index.js"
import { render as renderReact } from "../packages/react/dist/index.js"
import { mount, renderToHTML } from "../packages/web/dist/index.js"

const ci = process.env.MUSE_BENCH_CI === "1"
const counts = (process.env.MUSE_BENCH_ITEMS ?? (ci ? "100,1000" : "100,1000,10000"))
  .split(",")
  .map(value => Number(value.trim()))
  .filter(value => Number.isFinite(value) && value > 0)
const rounds = Number(process.env.MUSE_BENCH_ROUNDS ?? (ci ? 3 : 5))
const results = []
let vueBenchmarkRuntime
const budgets = {
  construction: 8,
  forEach: 12,
  reactSSR: 10,
  vueSSR: 20,
  webSSR: 12,
  dom: 25,
  heap: 10,
  specialization: 1.25,
  state: 50,
  compiler: 1000,
  hydration: 1000,
  keyedDom: 2000,
  reactRerender: 2000,
  vueRerender: 2000,
}

function collect(factory) {
  const value = factory()
  if (typeof globalThis.gc === "function") globalThis.gc()
  return value
}

function average(samples) {
  return samples.reduce((sum, value) => sum + value, 0) / samples.length
}

function retainedHeap(factory) {
  if (typeof globalThis.gc !== "function") return undefined
  globalThis.gc()
  const before = process.memoryUsage().heapUsed
  // Amplify small allocations so V8's heap quantization does not turn a
  // valid baseline into zero and produce a meaningless ratio.
  let retained = Array.from({ length: 8 }, factory)
  globalThis.gc()
  const after = process.memoryUsage().heapUsed
  retained = undefined
  globalThis.gc()
  return Math.max(0, after - before)
}

function measure(name, factory) {
  const samples = []
  for (let round = 0; round < rounds; round += 1) {
    const start = performance.now()
    collect(factory)
    samples.push(performance.now() - start)
  }
  const value = average(samples)
  console.log(`${name}: ${value.toFixed(2)} ms (${rounds} rounds)`)
  return value
}

async function measureAsync(name, factory) {
  const samples = []
  for (let round = 0; round < rounds; round += 1) {
    const start = performance.now()
    await factory()
    samples.push(performance.now() - start)
  }
  const value = average(samples)
  console.log(`${name}: ${value.toFixed(2)} ms (${rounds} rounds)`)
  return value
}

function ratio(name, actual, baseline, budget) {
  const value = actual / Math.max(baseline, 0.001)
  results.push({ name, actual, baseline, ratio: value })
  console.log(`${name} ratio: ${value.toFixed(2)}x (budget ${budget}x)`)
  if (ci && value > budget) throw new Error(`${name} exceeded ${budget}x baseline: ${value.toFixed(2)}x`)
}

function itemViews(count) {
  return Array.from({ length: count }, (_, index) => Text(String(index)))
}

function rawReactItems(count) {
  return Array.from({ length: count }, (_, index) => createElement("span", { key: index }, String(index)))
}

function rawVueItems(count, h) {
  return Array.from({ length: count }, (_, index) => h("span", { key: index }, String(index)))
}

const PerformanceCard = defineView("PerformanceCard", {
  initializers: [
    initializer("PerformanceCard(title)", args => args.length === 1 && typeof args[0] === "string", args => ({ title: args[0] }), [initializerKinds.value(true, "title", undefined, "string")]),
    initializer("PerformanceCard(value)", args => args.length === 1 && typeof args[0] === "number", args => ({ title: String(args[0]) }), [initializerKinds.value(true, "value", undefined, "number")]),
  ],
  body: ({ title }) => Element("span", null, title),
})

const specializationCount = Number(process.env.MUSE_BENCH_SPECIALIZATION_ITEMS ?? (ci ? 1000 : 10000))
const dynamicInitializer = measure(`dynamic initializer resolution ${specializationCount}`, () => Array.from({ length: specializationCount }, () => PerformanceCard("static")))
const specializedInitializer = measure(`specialized initializer construction ${specializationCount}`, () => Array.from({ length: specializationCount }, () => PerformanceCard.viewType.createNodeSpecialized(0, ["static"])))
ratio("specialized initializer construction", specializedInitializer, dynamicInitializer, budgets.specialization)

const compilerSource = `import { Text, VStack } from "muse"
struct BenchCard: View {
  let title: string
  init(title: string) { self.title = title }
  var body: some View { VStack { Text(title).padding(4) } }
}
export const bench = BenchCard(title: "benchmark")`
const compilerTransform = measure(".muse.ts compiler transform", () => compileMuseFile(compilerSource, "benchmark.muse.ts"))
if (!Number.isFinite(compilerTransform)) throw new Error("Compiler benchmark produced a non-finite measurement")
console.log(`compiler transform budget: ${budgets.compiler} ms ceiling for one fixture`)
if (ci && compilerTransform > budgets.compiler) throw new Error(`Compiler transform exceeded ${budgets.compiler} ms: ${compilerTransform.toFixed(2)} ms`)

for (const count of counts) {
  const views = itemViews(count)
  const items = Array.from({ length: count }, (_, index) => ({ id: index, value: String(index) }))

  const rawConstruction = measure(`raw React construction ${count}`, () => rawReactItems(count))
  const museConstruction = measure(`Muse View construction ${count}`, () => VStack(...itemViews(count)))
  ratio(`View construction ${count}`, museConstruction, rawConstruction, budgets.construction)
  const rawHeap = retainedHeap(() => rawReactItems(count))
  const museHeap = retainedHeap(() => VStack(...itemViews(count)))
  if (rawHeap !== undefined && museHeap !== undefined) {
    console.log(`retained heap ${count}: raw ${(rawHeap / 1024).toFixed(1)} KiB, Muse ${(museHeap / 1024).toFixed(1)} KiB`)
    if (rawHeap > 0) ratio(`retained heap ${count}`, museHeap, rawHeap, budgets.heap)
    else console.log(`retained heap ${count} ratio skipped: baseline below measurable heap resolution`)
  }

  const rawForEach = measure(`raw React list construction ${count}`, () => rawReactItems(count))
  const museForEach = measure(`Muse ForEach construction ${count}`, () => ForEach(items, item => Text(item.value)))
  ratio(`ForEach construction ${count}`, museForEach, rawForEach, budgets.forEach)

  const tree = VStack(...views)
  const rawSSR = measure(`raw React SSR ${count}`, () => renderToStaticMarkup(createElement("div", null, ...rawReactItems(count))))
  const reactSSR = measure(`Muse React SSR ${count}`, () => renderToStaticMarkup(renderReact(tree)))
  ratio(`React SSR ${count}`, reactSSR, rawSSR, budgets.reactSSR)

  const webSSR = measure(`Muse Web SSR ${count}`, () => renderToHTML(tree))
  ratio(`Web SSR ${count}`, webSSR, rawSSR, budgets.webSSR)

  const { runtime: vue, museRenderer, serverRenderer } = await getVueRuntime()
  const vueSSR = await measureAsync(`Muse Vue SSR ${count}`, async () => {
    await serverRenderer.renderToString(vue.createSSRApp({ render: () => museRenderer.render(tree) }))
  })
  const rawVueSSR = await measureAsync(`raw Vue SSR ${count}`, async () => {
    await serverRenderer.renderToString(vue.createSSRApp({ render: () => vue.h("div", null, rawVueItems(count, vue.h)) }))
  })
  ratio(`Vue SSR ${count}`, vueSSR, rawVueSSR, budgets.vueSSR)
}

async function rawDomUpdate(count) {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  const nodes = rawReactItems(count).map(node => {
    const element = dom.window.document.createElement("span")
    element.textContent = node.props.children
    return element
  })
  container.replaceChildren(...nodes)
  const start = performance.now()
  nodes.forEach((node, index) => { node.textContent = `next-${index}` })
  const elapsed = performance.now() - start
  dom.window.close()
  return elapsed
}

async function museDomUpdate(count) {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  const values = State(Array.from({ length: count }, (_, index) => String(index)))
  const App = defineView(`PerformanceApp${count}`, {
    initializers: [initializer(`PerformanceApp${count}()`, args => args.length === 0)],
    body: () => Element("div", null, values.value.map(value => Element("span", null, value))),
  })
  const unmount = mount(App(), container)
  await Promise.resolve()
  const start = performance.now()
  values.value = values.value.map((_, index) => `next-${index}`)
  await Promise.resolve()
  await Promise.resolve()
  const elapsed = performance.now() - start
  unmount()
  dom.window.close()
  return elapsed
}

async function keyedDomUpdate(count) {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  const items = State(Array.from({ length: count }, (_, index) => ({ id: index, value: String(index) })))
  const App = defineView(`KeyedPerformanceApp${count}`, {
    initializers: [initializer(`KeyedPerformanceApp${count}()`, args => args.length === 0)],
    body: () => Element("div", null, ForEach(items.value, item => Element("span", { "data-key": item.id }, item.value))),
  })
  const unmount = mount(App(), container)
  await Promise.resolve()
  const start = performance.now()
  items.value = [...items.value].reverse()
  await Promise.resolve()
  await Promise.resolve()
  const elapsed = performance.now() - start
  unmount()
  dom.window.close()
  return elapsed
}

async function webHydration(count) {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  const items = Array.from({ length: count }, (_, index) => ({ id: index, value: String(index) }))
  const App = defineView(`HydrationPerformanceApp${count}`, {
    initializers: [initializer(`HydrationPerformanceApp${count}()`, args => args.length === 0)],
    body: () => Element("div", null, ForEach(items, item => Element("span", { "data-key": item.id }, item.value))),
  })
  const value = App()
  container.innerHTML = renderToHTML(value)
  const start = performance.now()
  const unmount = mount(value, container, { hydrate: true })
  const elapsed = performance.now() - start
  unmount()
  dom.window.close()
  return elapsed
}

function installRendererDOM(dom) {
  const previous = new Map()
  for (const name of ["window", "document", "Element", "HTMLElement", "SVGElement", "Node", "MutationObserver", "getComputedStyle"]) {
    previous.set(name, globalThis[name])
    globalThis[name] = name === "getComputedStyle" ? dom.window.getComputedStyle : dom.window[name]
  }
  previous.set("navigator", globalThis.navigator)
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator })
  previous.set("IS_REACT_ACT_ENVIRONMENT", globalThis.IS_REACT_ACT_ENVIRONMENT)
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  return () => {
    for (const [name, value] of previous) {
      if (name === "navigator") Object.defineProperty(globalThis, name, { configurable: true, value })
      else if (value === undefined) delete globalThis[name]
      else globalThis[name] = value
    }
    dom.window.close()
  }
}

async function getVueRuntime() {
  if (!vueBenchmarkRuntime) {
    const dom = new JSDOM("<div id=vue-benchmark-app></div>")
    const restore = installRendererDOM(dom)
    const runtime = await import("vue")
    const museRenderer = await import("../packages/vue/dist/index.js")
    const serverRenderer = await import("@vue/server-renderer")
    vueBenchmarkRuntime = { dom, restore, runtime, museRenderer, serverRenderer }
  }
  return vueBenchmarkRuntime
}

async function reactRerender(count) {
  const dom = new JSDOM("<div id=app></div>")
  const restore = installRendererDOM(dom)
  try {
    const { act } = await import("react")
    const { createRoot } = await import("react-dom/client")
    const values = State(Array.from({ length: count }, (_, index) => String(index)))
    const App = defineView(`ReactPerformanceApp${count}`, {
      initializers: [initializer(`ReactPerformanceApp${count}()`, args => args.length === 0)],
      body: () => Element("div", null, values.value.map(value => Element("span", null, value))),
    })
    const root = createRoot(dom.window.document.querySelector("#app"))
    await act(async () => { root.render(renderReact(App())) })
    let elapsed = 0
    await act(async () => {
      const start = performance.now()
      values.value = values.value.map((_, index) => `next-${index}`)
      await Promise.resolve()
      elapsed = performance.now() - start
    })
    await act(async () => { root.unmount() })
    return elapsed
  } finally {
    restore()
  }
}

async function vueRerender(count) {
  const { dom, runtime: vue, museRenderer } = await getVueRuntime()
  const container = dom.window.document.querySelector("#vue-benchmark-app")
  container.replaceChildren()
  try {
    const values = State(Array.from({ length: count }, (_, index) => String(index)))
    const App = defineView(`VuePerformanceApp${count}`, {
      initializers: [initializer(`VuePerformanceApp${count}()`, args => args.length === 0)],
      body: () => Element("div", null, values.value.map(value => Element("span", null, value))),
    })
    const app = vue.createApp({ render: () => museRenderer.render(App()) })
    app.mount(container)
    const start = performance.now()
    values.value = values.value.map((_, index) => `next-${index}`)
    await vue.nextTick()
    const elapsed = performance.now() - start
    app.unmount()
    return elapsed
  } finally {
    container.replaceChildren()
  }
}

function rawStateUpdate(count) {
  let value = 0
  for (let index = 0; index < count; index += 1) value = index
  return value
}

function museStateUpdate(count) {
  const state = State(0)
  const unsubscribe = subscribeState(state, () => {})
  for (let index = 0; index < count; index += 1) state.value = index
  unsubscribe()
  return state.value
}

async function measureRounds(factory) {
  const samples = []
  for (let round = 0; round < rounds; round += 1) samples.push(await factory())
  return average(samples)
}

for (const count of counts.slice(0, ci ? 2 : counts.length)) {
  const rawState = measure(`raw state update ${count}`, () => rawStateUpdate(count))
  const museState = measure(`Muse State update ${count}`, () => museStateUpdate(count))
  ratio(`State update ${count}`, museState, rawState, budgets.state)

  const raw = average(await Promise.all(Array.from({ length: rounds }, () => rawDomUpdate(count))))
  const muse = average(await Promise.all(Array.from({ length: rounds }, () => museDomUpdate(count))))
  const keyed = average(await Promise.all(Array.from({ length: rounds }, () => keyedDomUpdate(count))))
  const hydration = average(await Promise.all(Array.from({ length: rounds }, () => webHydration(count))))
  console.log(`raw DOM update ${count}: ${raw.toFixed(2)} ms`)
  console.log(`Muse DOM reconciliation ${count}: ${muse.toFixed(2)} ms`)
  console.log(`Muse keyed DOM update ${count}: ${keyed.toFixed(2)} ms`)
  console.log(`Muse Web hydration ${count}: ${hydration.toFixed(2)} ms`)
  const reactRerenderTime = await measureRounds(() => reactRerender(count))
  const vueRerenderTime = await measureRounds(() => vueRerender(count))
  console.log(`Muse React rerender ${count}: ${reactRerenderTime.toFixed(2)} ms`)
  console.log(`Muse Vue rerender ${count}: ${vueRerenderTime.toFixed(2)} ms`)
  ratio(`DOM reconciliation ${count}`, muse, raw, budgets.dom)
  if (!Number.isFinite(keyed) || !Number.isFinite(hydration) || !Number.isFinite(reactRerenderTime) || !Number.isFinite(vueRerenderTime)) throw new Error(`DOM, renderer rerender, or hydration benchmark produced a non-finite measurement for ${count}`)
  if (ci && keyed > budgets.keyedDom) throw new Error(`Keyed DOM update exceeded ${budgets.keyedDom} ms for ${count}: ${keyed.toFixed(2)} ms`)
  if (ci && hydration > budgets.hydration) throw new Error(`Hydration exceeded ${budgets.hydration} ms for ${count}: ${hydration.toFixed(2)} ms`)
  if (ci && reactRerenderTime > budgets.reactRerender) throw new Error(`React rerender exceeded ${budgets.reactRerender} ms for ${count}: ${reactRerenderTime.toFixed(2)} ms`)
  if (ci && vueRerenderTime > budgets.vueRerender) throw new Error(`Vue rerender exceeded ${budgets.vueRerender} ms for ${count}: ${vueRerenderTime.toFixed(2)} ms`)
}

if (results.some(result => !Number.isFinite(result.actual) || !Number.isFinite(result.ratio))) {
  throw new Error("Performance benchmark produced a non-finite measurement")
}

console.log(`Performance benchmark completed: ${results.length} guarded comparisons`)
if (vueBenchmarkRuntime) vueBenchmarkRuntime.restore()
