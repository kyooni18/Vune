import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import { ForEach, GeometryReader, State, Text, defineView, initializer, viewElement } from "../packages/core/dist/index.js"

test("Vue consumes core keyed View identity for reorder and remount State semantics", async () => {
  const dom = new JSDOM("<!doctype html><div id=app></div>")
  const previous = { window: globalThis.window, document: globalThis.document, Element: globalThis.Element, SVGElement: globalThis.SVGElement, Node: globalThis.Node }
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.Element = dom.window.Element
  globalThis.SVGElement = dom.window.SVGElement
  globalThis.Node = dom.window.Node
  try {
    const { createApp, nextTick } = await import("vue")
    const { MuseView } = await import("../packages/vue/dist/index.js")
    const items = State([{ id: "a" }, { id: "b" }])
    const Row = defineView("VueIdentityRow", {
      initializers: [initializer("Row(id)", args => args.length === 1, args => ({ id: args[0] }))],
      state: () => ({ count: State(0) }),
      body: ({ id, count }) => viewElement("button", { "data-row": id, onclick: () => { count.value += 1 } }, [`${id}:${count.value}`]),
    })
    const App = defineView("VueIdentityApp", {
      initializers: [initializer("App()", args => args.length === 0)],
      body: () => viewElement("section", null, [ForEach(items.value, item => Row(item.id))]),
    })
    const app = createApp(MuseView, { render: () => App() })
    app.mount(dom.window.document.getElementById("app"))
    dom.window.document.querySelector('[data-row="a"]')?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
    await nextTick()
    assert.equal(dom.window.document.querySelector('[data-row="a"]')?.textContent, "a:1")
    items.value = [items.value[1], items.value[0]]
    await nextTick()
    assert.deepEqual([...dom.window.document.querySelectorAll("button")].map(button => button.textContent), ["b:0", "a:1"])
    items.value = items.value.filter(item => item.id !== "a")
    await nextTick()
    items.value = [{ id: "a" }, ...items.value]
    await nextTick()
    assert.equal(dom.window.document.querySelector('[data-row="a"]')?.textContent, "a:0")
    app.unmount()
  } finally {
    globalThis.window = previous.window
    globalThis.document = previous.document
    globalThis.Element = previous.Element
    globalThis.SVGElement = previous.SVGElement
    globalThis.Node = previous.Node
    dom.window.close()
  }
})

test("Vue reevaluates a Muse body when an independently-owned State changes", async () => {
  const dom = new JSDOM("<!doctype html><div id=app></div>")
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const previousElement = globalThis.Element
  const previousHTMLElement = globalThis.HTMLElement
  const previousSVGElement = globalThis.SVGElement
  const previousNode = globalThis.Node
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.Element = dom.window.Element
  globalThis.HTMLElement = dom.window.HTMLElement
  globalThis.SVGElement = dom.window.SVGElement
  globalThis.Node = dom.window.Node
  try {
    const { createApp, nextTick } = await import("vue")
    const { MuseView } = await import("../packages/vue/dist/index.js")
    const state = State(0)
    const app = createApp(MuseView, { render: () => Text(`Count: ${state.value}`) })
    app.mount(dom.window.document.getElementById("app"))
    assert.match(dom.window.document.body.textContent ?? "", /Count: 0/)
    state.value = 1
    await nextTick()
    assert.match(dom.window.document.body.textContent ?? "", /Count: 1/)
    app.unmount()
  } finally {
    globalThis.window = previousWindow
    globalThis.document = previousDocument
    globalThis.Element = previousElement
    globalThis.HTMLElement = previousHTMLElement
    globalThis.SVGElement = previousSVGElement
    globalThis.Node = previousNode
    dom.window.close()
  }
})

test("Vue materialization preserves Muse events and refs at the live DOM boundary", async () => {
  const dom = new JSDOM("<!doctype html><div id=app></div>")
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const previousElement = globalThis.Element
  const previousSVGElement = globalThis.SVGElement
  const previousNode = globalThis.Node
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.Element = dom.window.Element
  globalThis.SVGElement = dom.window.SVGElement
  globalThis.Node = dom.window.Node
  try {
    const { createApp, nextTick, ref } = await import("vue")
    const { MuseView } = await import("../packages/vue/dist/index.js")
    const state = State(0)
    const buttonRef = ref(null)
    const app = createApp(MuseView, {
      render: () => viewElement("button", { onclick: () => { state.value += 1 }, ref: buttonRef }, [`Count: ${state.value}`]),
    })
    app.mount(dom.window.document.getElementById("app"))
    assert.equal(buttonRef.value, dom.window.document.querySelector("button"))
    buttonRef.value.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
    await nextTick()
    assert.match(dom.window.document.body.textContent ?? "", /Count: 1/)
    app.unmount()
  } finally {
    globalThis.window = previousWindow
    globalThis.document = previousDocument
    globalThis.Element = previousElement
    globalThis.SVGElement = previousSVGElement
    globalThis.Node = previousNode
    dom.window.close()
  }
})

test("Vue GeometryReader measures CSS safe-area insets at the DOM boundary", async () => {
  const dom = new JSDOM("<!doctype html><div id=app></div>")
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const previousElement = globalThis.Element
  const previousSVGElement = globalThis.SVGElement
  const previousNode = globalThis.Node
  const previousResizeObserver = globalThis.ResizeObserver
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.Element = dom.window.Element
  globalThis.SVGElement = dom.window.SVGElement
  globalThis.Node = dom.window.Node
  dom.window.getComputedStyle = () => ({ paddingTop: "12px", paddingRight: "8px", paddingBottom: "4px", paddingLeft: "2px" })
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback }
    observe(element) {
      element.getBoundingClientRect = () => ({ x: 0, y: 0, width: 320, height: 48, top: 0, right: 320, bottom: 48, left: 0 })
      this.callback([])
    }
    disconnect() {}
  }
  try {
    const { createApp, nextTick } = await import("vue")
    const { MuseView } = await import("../packages/vue/dist/index.js")
    const app = createApp(MuseView, { render: () => GeometryReader(geometry => Text(String(geometry.safeAreaInsets.top))) })
    app.mount(dom.window.document.getElementById("app"))
    await nextTick()
    await nextTick()
    assert.match(dom.window.document.body.textContent ?? "", /12/)
    app.unmount()
  } finally {
    globalThis.window = previousWindow
    globalThis.document = previousDocument
    globalThis.Element = previousElement
    globalThis.SVGElement = previousSVGElement
    globalThis.Node = previousNode
    if (previousResizeObserver === undefined) delete globalThis.ResizeObserver
    else globalThis.ResizeObserver = previousResizeObserver
    dom.window.close()
  }
})

test("Vue component lifecycle remains Vue-owned inside a Muse graph", async () => {
  const dom = new JSDOM("<!doctype html><div id=app></div>")
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const previousElement = globalThis.Element
  const previousSVGElement = globalThis.SVGElement
  const previousNode = globalThis.Node
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.Element = dom.window.Element
  globalThis.SVGElement = dom.window.SVGElement
  globalThis.Node = dom.window.Node
  try {
    const { createApp, defineComponent, h, nextTick, onBeforeUnmount, onMounted } = await import("vue")
    const { Component, MuseView } = await import("../packages/vue/dist/index.js")
    let mounted = 0
    let unmounted = 0
    const Child = defineComponent({
      setup() {
        onMounted(() => { mounted += 1 })
        onBeforeUnmount(() => { unmounted += 1 })
        return () => h("strong", null, "Vue child")
      },
    })
    const app = createApp(MuseView, { value: Component(Child) })
    app.mount(dom.window.document.getElementById("app"))
    await nextTick()
    assert.equal(mounted, 1)
    app.unmount()
    assert.equal(unmounted, 1)
  } finally {
    globalThis.window = previousWindow
    globalThis.document = previousDocument
    globalThis.Element = previousElement
    globalThis.SVGElement = previousSVGElement
    globalThis.Node = previousNode
    dom.window.close()
  }
})

test("Vue Transition and Teleport remain native boundaries inside a Muse graph", async () => {
  const dom = new JSDOM("<!doctype html><div id=app></div><div id=portal></div>")
  const previous = { window: globalThis.window, document: globalThis.document, Element: globalThis.Element, SVGElement: globalThis.SVGElement, Node: globalThis.Node }
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.Element = dom.window.Element
  globalThis.SVGElement = dom.window.SVGElement
  globalThis.Node = dom.window.Node
  try {
    const { Teleport, Transition, createApp, nextTick } = await import("vue")
    const { Component, MuseView } = await import("../packages/vue/dist/index.js")
    const value = viewElement("main", null, [
      Component(Transition, { name: "fade" }, Component("span", { "data-transition": true }, "Transitioned")),
      Component(Teleport, { to: dom.window.document.getElementById("portal") }, Component("strong", { "data-teleport": true }, "Teleported")),
    ])
    const app = createApp(MuseView, { value })
    app.mount(dom.window.document.getElementById("app"))
    await nextTick()
    assert.equal(dom.window.document.querySelector('[data-transition]')?.textContent, "Transitioned")
    assert.equal(dom.window.document.querySelector('#portal [data-teleport]')?.textContent, "Teleported")
    assert.equal(dom.window.document.querySelector('#app [data-teleport]'), null)
    app.unmount()
  } finally {
    globalThis.window = previous.window
    globalThis.document = previous.document
    globalThis.Element = previous.Element
    globalThis.SVGElement = previous.SVGElement
    globalThis.Node = previous.Node
    dom.window.close()
  }
})

test("Vue mount can hydrate SSR Muse markup and keep State updates live", async () => {
  const dom = new JSDOM("<!doctype html><div id=app></div>")
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const previousElement = globalThis.Element
  const previousHTMLElement = globalThis.HTMLElement
  const previousSVGElement = globalThis.SVGElement
  const previousNode = globalThis.Node
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.Element = dom.window.Element
  globalThis.HTMLElement = dom.window.HTMLElement
  globalThis.SVGElement = dom.window.SVGElement
  globalThis.Node = dom.window.Node
  try {
    const { createSSRApp, h, nextTick } = await import("vue")
    const { renderToString } = await import("@vue/server-renderer")
    const { MuseView, mount } = await import("../packages/vue/dist/index.js")
    const Counter = defineView("HydrateCounter", {
      initializers: [initializer("HydrateCounter()", args => args.length === 0)],
      state: () => ({ count: State(0) }),
      body: ({ count }) => viewElement("button", {
        "data-counter": "vue",
        onclick: () => { count.value += 1 },
      }, [Text(`Hydrate ${count.value}`)]),
    })
    const value = Counter()
    const markup = await renderToString(createSSRApp({ render: () => h(MuseView, { value }) }))
    const target = dom.window.document.getElementById("app")
    target.innerHTML = markup
    const serverButton = target.querySelector("button")
    const unmount = mount(value, target, { hydrate: true })
    assert.equal(target.querySelector("button"), serverButton)
    assert.match(target.textContent ?? "", /Hydrate 0/)
    serverButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
    await nextTick()
    assert.match(target.textContent ?? "", /Hydrate 1/)
    unmount()
  } finally {
    globalThis.window = previousWindow
    globalThis.document = previousDocument
    globalThis.Element = previousElement
    globalThis.HTMLElement = previousHTMLElement
    globalThis.SVGElement = previousSVGElement
    globalThis.Node = previousNode
    dom.window.close()
  }
})
