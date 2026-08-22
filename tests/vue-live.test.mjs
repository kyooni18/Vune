import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import { GeometryReader, State, Text, defineView, initializer, viewElement } from "../packages/core/dist/index.js"

test("Vue reevaluates a Muse body when an independently-owned State changes", async () => {
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

test("Vue mount can hydrate SSR Muse markup and keep State updates live", async () => {
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
    const { createSSRApp, h, nextTick } = await import("vue")
    const { renderToString } = await import("@vue/server-renderer")
    const { MuseView, mount } = await import("../packages/vue/dist/index.js")
    const state = State(0)
    const Counter = defineView("HydrateCounter", {
      initializers: [initializer("HydrateCounter()", args => args.length === 0)],
      body: () => Text(`Hydrate ${state.value}`),
    })
    const value = Counter()
    const markup = await renderToString(createSSRApp({ render: () => h(MuseView, { value }) }))
    const target = dom.window.document.getElementById("app")
    target.innerHTML = markup
    const unmount = mount(value, target, { hydrate: true })
    assert.match(target.textContent ?? "", /Hydrate 0/)
    state.value = 1
    await nextTick()
    assert.match(target.textContent ?? "", /Hydrate 1/)
    unmount()
  } finally {
    globalThis.window = previousWindow
    globalThis.document = previousDocument
    globalThis.Element = previousElement
    globalThis.SVGElement = previousSVGElement
    globalThis.Node = previousNode
    dom.window.close()
  }
})
