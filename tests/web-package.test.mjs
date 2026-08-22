import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import {
  Element,
  ForEach,
  GeometryReader,
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
    body: () => Element("section", null, ForEach(items.value, item => Row(item.id))),
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
