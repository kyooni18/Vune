import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import {
  Element,
  ForEach,
  GeometryReader,
  LazyVStack,
  defineBuiltinView,
  defineView,
  initializer,
  initializerKinds,
  SafeArea,
  ScrollView,
  State,
  viewElement,
} from "../packages/core/dist/index.js"
import { mount, renderToHTML } from "../packages/web/dist/index.js"

const Text = defineBuiltinView(
  "Text",
  [initializer("Text(value)", args => args.length === 1, args => ({ value: args[0] }), [initializerKinds.value()])],
  ({ value }) => viewElement("span", null, [value]),
)

test("@muse/web renders the same core graph without React", () => {
  assert.equal(renderToHTML(Text("Hello").padding(4)), '<span style="padding:4px">Hello</span>')
  assert.equal(renderToHTML(Text("Styled").className(["card", false, "active"])), '<span class="card active">Styled</span>')
})

test("@muse/web preserves raw HTML attributes and object styles", () => {
  const value = Element("label", {
    class: "card",
    htmlFor: "name",
    "aria-label": "Name",
    "data-kind": "hero",
    style: { backgroundColor: "red", "--accent": "blue" },
  }, Text("Name"))
  const html = renderToHTML(value)
  assert.match(html, /class="card"/)
  assert.match(html, /for="name"/)
  assert.match(html, /aria-label="Name"/)
  assert.match(html, /data-kind="hero"/)
  assert.match(html, /background-color:red;--accent:blue/)
  assert.match(html, />Name<\/span><\/label>$/)
  assert.equal(renderToHTML(Element("input", { disabled: true, style: "color: red", "data-field": "name" })), '<input disabled style="color: red" data-field="name">')
})

test("@muse/web merges object styles and classes supplied by withProps", () => {
  const value = Element("div", { class: "base", style: { color: "red" } }, "Card")
    .className("accent")
    .withProps({ className: "interactive", style: { backgroundColor: "blue" } })
  const html = renderToHTML(value)
  assert.match(html, /class="base accent interactive"/)
  assert.match(html, /color:red;background-color:blue/)
})

test("@muse/web serializes scroll and safe-area CSS from the core graph", () => {
  const value = SafeArea(["top", "bottom"], () => [
    ScrollView("both", () => [Element("div", null, "Content")]),
  ])
  const html = renderToHTML(value)
  assert.match(html, /data-muse="SafeArea"/)
  assert.match(html, /padding-top:env\(safe-area-inset-top\)/)
  assert.match(html, /padding-bottom:env\(safe-area-inset-bottom\)/)
  assert.match(html, /data-muse="ScrollView"/)
  assert.match(html, /overflow-x:auto/)
  assert.match(html, /overflow-y:auto/)
})

test("@muse/web exposes GeometryReader in SSR and DOM modes", () => {
  const value = GeometryReader(geometry => Element("span", null, `${geometry.size.width}x${geometry.size.height}`))
  const html = renderToHTML(value)
  assert.match(html, /data-muse="GeometryReader"/)
  assert.match(html, />0x0<\/span>/)
})

test("@muse/web measures CSS safe-area insets at the DOM boundary", async () => {
  const dom = new JSDOM("<div id=app></div>")
  dom.window.getComputedStyle = () => ({ paddingTop: "12px", paddingRight: "8px", paddingBottom: "4px", paddingLeft: "2px" })
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const value = GeometryReader(geometry => Element("span", null, `${geometry.safeAreaInsets.top}:${geometry.safeAreaInsets.right}:${geometry.safeAreaInsets.bottom}:${geometry.safeAreaInsets.left}`))
  const unmount = mount(value, container)
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(container.textContent, "12:8:4:2")
  unmount()
  dom.window.close()
})

test("@muse/web resolves renderer-independent View state", () => {
  const Counter = defineView("Counter", {
    initializers: [initializer("Counter()", args => args.length === 0)],
    state: () => ({ count: State(3) }),
    body: ({ count }) => Text(String(count.value)),
  })
  assert.equal(renderToHTML(Counter()), "<span>3</span>")
})

test("@muse/web mount reevaluates State reads and cleans up", async () => {
  const state = State(1)
  const Counter = defineView("MountedCounter", {
    initializers: [initializer("MountedCounter()", args => args.length === 0)],
    body: () => Text(String(state.value)),
  })
  const container = { innerHTML: "" }
  const unmount = (await import("../packages/web/dist/index.js")).mount(Counter(), container)
  assert.equal(container.innerHTML, "<span>1</span>")
  state.value = 2
  await Promise.resolve()
  assert.equal(container.innerHTML, "<span>2</span>")
  unmount()
  state.value = 3
  await Promise.resolve()
  assert.equal(container.innerHTML, "")
})

test("@muse/web DOM mount preserves events, refs, and State invalidation", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const count = State(0)
  const reference = { current: null }
  const Counter = defineView("InteractiveCounter", {
    initializers: [initializer("InteractiveCounter()", args => args.length === 0)],
    body: () => Element("section", null,
      Element("span", { "data-count": true }, String(count.value)),
      Element("button", { onclick: () => { count.value += 1 }, ref: reference }, "Increment"),
    ),
  })
  const unmount = (await import("../packages/web/dist/index.js")).mount(Counter(), container)
  assert.equal(container.querySelector("[data-count]")?.textContent, "0")
  assert.equal(reference.current, container.querySelector("button"))
  container.querySelector("button")?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  await Promise.resolve()
  assert.equal(container.querySelector("[data-count]")?.textContent, "1")
  unmount()
  assert.equal(reference.current, null)
  assert.equal(container.innerHTML, "")
})

test("@muse/web patches text, attributes, and events without replacing the DOM node", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const label = State("one")
  let clicks = 0
  const Counter = defineView("PatchCounter", {
    initializers: [initializer("PatchCounter()", args => args.length === 0)],
    body: () => Element("button", {
      title: label.value,
      onclick: () => { clicks += 1 },
    }, label.value),
  })
  const value = Counter()
  const unmount = mount(value, container)
  const button = container.firstElementChild
  assert.ok(button)
  assert.equal(button.getAttribute("title"), "one")
  label.value = "two"
  await Promise.resolve()
  assert.equal(container.firstElementChild, button)
  assert.equal(button.getAttribute("title"), "two")
  assert.equal(button.textContent, "two")
  button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  assert.equal(clicks, 1)
  unmount()
  dom.window.close()
})

test("@muse/web windows lazy children and responds to scroll without rebuilding the boundary", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  container.style.overflowY = "auto"
  Object.defineProperty(container, "clientHeight", { configurable: true, value: 100 })
  const children = Array.from({ length: 100 }, (_, index) => Element("span", { "data-item": String(index) }, String(index)))
  const value = LazyVStack({ estimatedItemSize: 20, overscan: 0 }, ...children)
  const unmount = mount(value, container)
  await Promise.resolve()
  await Promise.resolve()
  const boundary = container.querySelector("[data-muse-lazy]")
  assert.ok(boundary)
  assert.ok(boundary.querySelectorAll("[data-item]").length < children.length)
  assert.ok(boundary.querySelector("[data-muse-lazy-spacer=after]"))

  const before = boundary.querySelector("[data-item=0]")
  container.scrollTop = 400
  container.dispatchEvent(new dom.window.Event("scroll"))
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(container.scrollTop, 400)
  assert.equal(boundary.querySelector("[data-item=0]"), null)
  assert.ok(boundary.querySelector("[data-item=20]"))
  assert.equal(boundary, container.querySelector("[data-muse-lazy]"))
  assert.equal(before?.isConnected, false)
  unmount()
  dom.window.close()
})

test("@muse/web refines lazy ranges from measured child sizes", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  container.style.overflowY = "auto"
  Object.defineProperty(container, "clientHeight", { configurable: true, value: 100 })
  const originalRect = dom.window.HTMLElement.prototype.getBoundingClientRect
  Object.defineProperty(dom.window.HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value() {
      if (this.hasAttribute("data-item")) return { x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 40, width: 100, height: 40 }
      return originalRect.call(this)
    },
  })
  const children = Array.from({ length: 100 }, (_, index) => Element("span", { "data-item": String(index) }, String(index)))
  const unmount = mount(LazyVStack({ estimatedItemSize: 20, overscan: 0 }, ...children), container)
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  const boundary = container.querySelector("[data-muse-lazy]")
  assert.ok(boundary)
  assert.equal(boundary.querySelectorAll("[data-item]").length, 3)
  unmount()
  Object.defineProperty(dom.window.HTMLElement.prototype, "getBoundingClientRect", { configurable: true, value: originalRect })
  dom.window.close()
})

test("@muse/web preserves keyed child State across reorder and resets it after remount", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const items = State([{ id: "a" }, { id: "b" }])
  const Row = defineView("IdentityRow", {
    initializers: [initializer("IdentityRow(id)", args => args.length === 1, args => ({ id: args[0] }))],
    state: () => ({ count: State(0) }),
    body: ({ id, count }) => Element("button", {
      "data-row": id,
      onclick: () => { count.value += 1 },
    }, `${id}:${count.value}`),
  })
  const App = defineView("IdentityApp", {
    initializers: [initializer("IdentityApp()", args => args.length === 0)],
    body: () => Element("section", null, ForEach(items.value, item => item.id, item => Row(item.id))),
  })
  const unmount = mount(App(), container)
  container.querySelector('[data-row="a"]')?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  await Promise.resolve()
  assert.equal(container.querySelector('[data-row="a"]')?.textContent, "a:1")
  items.value = [items.value[1], items.value[0]]
  await Promise.resolve()
  assert.deepEqual([...container.querySelectorAll("button")].map(button => button.textContent), ["b:0", "a:1"])
  items.value = items.value.filter(item => item.id !== "a")
  await Promise.resolve()
  items.value = [{ id: "a" }, ...items.value]
  await Promise.resolve()
  assert.equal(container.querySelector('[data-row="a"]')?.textContent, "a:0")
  unmount()
  dom.window.close()
})

test("@muse/web hydrates existing SSR markup and wires the live DOM boundary", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const Counter = defineView("HydratedCounter", {
    initializers: [initializer("HydratedCounter()", args => args.length === 0)],
    state: () => ({ count: State(0) }),
    body: ({ count }) => Element("button", { onclick: () => { count.value += 1 } }, Element("span", null, String(count.value))),
  })
  const value = Counter()
  container.innerHTML = renderToHTML(value)
  const serverNode = container.firstElementChild
  const unmount = mount(value, container, { hydrate: true })
  assert.equal(container.firstElementChild, serverNode)
  container.querySelector("button")?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  await Promise.resolve()
  assert.equal(container.textContent, "1")
  unmount()
  dom.window.close()
})

test("@muse/web keeps explicit ForEach identity through SSR hydration and reorder", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const items = State([{ id: "a" }, { id: "b" }])
  const Row = defineView("HydratedIdentityRow", {
    initializers: [initializer("Row(id)", args => args.length === 1, args => ({ id: args[0] }))],
    state: () => ({ count: State(0) }),
    body: ({ id, count }) => Element("button", { "data-row": id, onclick: () => { count.value += 1 } }, `${id}:${count.value}`),
  })
  const App = defineView("HydratedIdentityApp", {
    initializers: [initializer("App()", args => args.length === 0)],
    body: () => Element("section", null, ForEach(items.value, item => item.id, item => Row(item.id))),
  })
  const value = App()
  container.innerHTML = renderToHTML(value)
  const serverA = container.querySelector('[data-row="a"]')
  const unmount = mount(value, container, { hydrate: true })
  serverA?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  await Promise.resolve()
  assert.equal(serverA?.textContent, "a:1")
  items.value = [items.value[1], items.value[0]]
  await Promise.resolve()
  assert.equal(container.querySelector('[data-row="a"]'), serverA)
  assert.deepEqual([...container.querySelectorAll("button")].map(button => button.textContent), ["b:0", "a:1"])
  unmount()
  dom.window.close()
})

test("@muse/web hydrates the frame host without replacing its child", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const Counter = defineView("HydratedFrameCounter", {
    initializers: [initializer("HydratedFrameCounter()", args => args.length === 0)],
    state: () => ({ count: State(0) }),
    body: ({ count }) => Element("button", { onclick: () => { count.value += 1 } }, String(count.value)).frame({
      width: 120,
      height: 48,
      alignment: "center",
    }),
  })
  const value = Counter()
  container.innerHTML = renderToHTML(value)
  const serverFrame = container.firstElementChild
  const serverButton = container.querySelector("button")
  const unmount = mount(value, container, { hydrate: true })
  assert.equal(container.firstElementChild, serverFrame)
  assert.equal(container.querySelector("button"), serverButton)
  serverButton?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  await Promise.resolve()
  assert.equal(container.textContent, "1")
  unmount()
  dom.window.close()
})

test("@muse/web falls back to a fresh client tree when hydration structure mismatches", async () => {
  const dom = new JSDOM("<div id=app><div data-stale>stale</div></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  let reference = null
  const count = State(0)
  const Counter = defineView("HydrationMismatchCounter", {
    initializers: [initializer("Counter()", args => args.length === 0)],
    body: () => Element("button", {
      ref: node => { reference = node },
      onclick: () => { count.value += 1 },
    }, String(count.value)),
  })
  const unmount = mount(Counter(), container, { hydrate: true })
  const button = container.querySelector("button")
  assert.ok(button)
  assert.equal(reference, button)
  button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  await Promise.resolve()
  assert.equal(container.textContent, "1")
  unmount()
  assert.equal(reference, null)
  dom.window.close()
})

test("@muse/web commits refs only after live DOM reconciliation and keeps stable refs stable", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const value = State("one")
  const calls = []
  const reference = node => calls.push(node ? { node, connected: node.isConnected } : null)
  const App = defineView("CommittedRef", {
    initializers: [initializer("CommittedRef()", args => args.length === 0)],
    body: () => Element("button", { ref: reference }, value.value),
  })
  const unmount = mount(App(), container)
  const button = container.querySelector("button")
  assert.ok(button)
  assert.deepEqual(calls, [{ node: button, connected: true }])
  value.value = "two"
  await Promise.resolve()
  assert.equal(container.querySelector("button"), button)
  assert.deepEqual(calls, [{ node: button, connected: true }])
  unmount()
  assert.deepEqual(calls, [{ node: button, connected: true }, null])
  dom.window.close()
})

test("@muse/web normalizes DOM event names and boolean, ARIA, and enumerated attributes", () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  let doubleClicks = 0
  const value = Element("button", {
    onDoubleClick: () => { doubleClicks += 1 },
    disabled: false,
    "aria-expanded": false,
    draggable: false,
    contentEditable: false,
  }, "Open")
  const unmount = mount(value, container)
  const button = container.querySelector("button")
  assert.ok(button)
  button.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true }))
  assert.equal(doubleClicks, 1)
  assert.equal(button.hasAttribute("disabled"), false)
  assert.equal(button.getAttribute("aria-expanded"), "false")
  assert.equal(button.getAttribute("draggable"), "false")
  assert.equal(button.getAttribute("contenteditable"), "false")
  const html = renderToHTML(value)
  assert.doesNotMatch(html, /\sdisabled(?:[= >])/)
  assert.match(html, /aria-expanded="false"/)
  assert.match(html, /draggable="false"/)
  assert.match(html, /contenteditable="false"/)
  unmount()
  dom.window.close()
})

test("@muse/web hydration reconciles stale server attributes without replacing matching nodes", () => {
  const dom = new JSDOM('<div id=app><div class="server" title="old" style="width:10px" data-stale="yes">server</div></div>')
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const server = container.firstElementChild
  const value = Element("div", { class: "client", title: "new", style: { width: "20px" } }, "client")
  const unmount = mount(value, container, { hydrate: true })
  assert.equal(container.firstElementChild, server)
  assert.equal(server.getAttribute("class"), "client")
  assert.equal(server.getAttribute("title"), "new")
  assert.equal(server.getAttribute("style"), "width: 20px;")
  assert.equal(server.hasAttribute("data-stale"), false)
  assert.equal(server.textContent, "client")
  unmount()
  dom.window.close()
})

test("@muse/web creates contextual SVG namespaces and returns to HTML inside foreignObject", () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const value = [
    Element("a", { "data-html-link": true }, "html"),
    Element("svg", { viewBox: "0 0 10 10" },
      Element("a", { "data-svg-link": true, xlinkHref: "#target" },
        Element("title", null, "svg title"),
      ),
      Element("path", { d: "M0 0L10 10" }),
      Element("foreignObject", null, Element("div", { "data-html-child": true }, "html child")),
    ),
  ]
  const unmount = mount(value, container)
  const HTML_NS = "http://www.w3.org/1999/xhtml"
  const SVG_NS = "http://www.w3.org/2000/svg"
  const XLINK_NS = "http://www.w3.org/1999/xlink"
  assert.equal(container.querySelector("[data-html-link]").namespaceURI, HTML_NS)
  const svg = container.querySelector("svg")
  assert.equal(svg.namespaceURI, SVG_NS)
  assert.equal(svg.querySelector("[data-svg-link]").namespaceURI, SVG_NS)
  assert.equal(svg.querySelector("title").namespaceURI, SVG_NS)
  assert.equal(svg.querySelector("path").namespaceURI, SVG_NS)
  assert.equal(svg.querySelector("foreignObject").namespaceURI, SVG_NS)
  assert.equal(svg.querySelector("[data-html-child]").namespaceURI, HTML_NS)
  assert.equal(svg.querySelector("[data-svg-link]").getAttributeNS(XLINK_NS, "href"), "#target")
  unmount()
  dom.window.close()
})

test("@muse/web preserves State for logically present offscreen lazy rows and drops removed rows", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  container.style.overflowY = "auto"
  Object.defineProperty(container, "clientHeight", { configurable: true, value: 100 })
  const items = State(Array.from({ length: 50 }, (_, index) => `row-${index}`))
  const Row = defineView("LazyStateRow", {
    initializers: [initializer("Row(id)", args => args.length === 1, args => ({ id: args[0] }))],
    state: () => ({ count: State(0) }),
    body: ({ id, count }) => Element("button", {
      "data-row": id,
      onclick: () => { count.value += 1 },
    }, `${id}:${count.value}`),
  })
  const App = defineView("LazyStateApp", {
    initializers: [initializer("App()", args => args.length === 0)],
    body: () => LazyVStack(
      { estimatedItemSize: 20, overscan: 0 },
      ...items.value.map(id => Row(id).keyed(id)),
    ),
  })
  const unmount = mount(App(), container)
  container.querySelector('[data-row="row-0"]')?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  await Promise.resolve()
  assert.equal(container.querySelector('[data-row="row-0"]')?.textContent, "row-0:1")

  container.scrollTop = 400
  container.dispatchEvent(new dom.window.Event("scroll"))
  await Promise.resolve(); await Promise.resolve()
  assert.equal(container.querySelector('[data-row="row-0"]'), null)
  container.scrollTop = 0
  container.dispatchEvent(new dom.window.Event("scroll"))
  await Promise.resolve(); await Promise.resolve()
  assert.equal(container.querySelector('[data-row="row-0"]')?.textContent, "row-0:1")

  container.scrollTop = 400
  container.dispatchEvent(new dom.window.Event("scroll"))
  await Promise.resolve(); await Promise.resolve()
  items.value = items.value.filter(id => id !== "row-0")
  await Promise.resolve(); await Promise.resolve()
  items.value = ["row-0", ...items.value]
  await Promise.resolve(); await Promise.resolve()
  container.scrollTop = 0
  container.dispatchEvent(new dom.window.Event("scroll"))
  await Promise.resolve(); await Promise.resolve()
  assert.equal(container.querySelector('[data-row="row-0"]')?.textContent, "row-0:0")
  unmount()
  dom.window.close()
})
