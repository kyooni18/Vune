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
  compiledTemplate,
  defineCompiledTemplate,
  viewElement,
} from "../packages/core/dist/index.js"
import { mount, renderToHTML } from "../packages/web/dist/index.js"

const Text = defineBuiltinView(
  "Text",
  [initializer("Text(value)", args => args.length === 1, args => ({ value: args[0] }), [initializerKinds.value()])],
  ({ value }) => viewElement("span", null, [value]),
)

test("@vune-ui/web renders the same core graph without React", () => {
  assert.equal(renderToHTML(Text("Hello").padding(4)), '<span style="padding:4px">Hello</span>')
  assert.equal(renderToHTML(Text("Styled").className(["card", false, "active"])), '<span class="card active">Styled</span>')
})

test("@vune-ui/web materializes compiled templates in SSR and DOM modes", () => {
  const template = defineCompiledTemplate({
    kind: "element", type: "div", props: { class: "compiled" }, children: [
      { kind: "element", type: "span", props: null, children: ["Static"] },
      { kind: "element", type: "span", props: null, children: [{ kind: "slot", index: 0, identity: ["element", 1, "element", 0] }] },
    ],
  }, 1)
  const value = compiledTemplate(template, ["Web template"])
  assert.equal(renderToHTML(value), '<div class="compiled"><span>Static</span><span>Web template</span></div>')

  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const unmount = mount(value, container)
  assert.equal(container.innerHTML, '<div class="compiled"><span>Static</span><span>Web template</span></div>')
  unmount()
  dom.window.close()
})

test("@vune-ui/web preserves raw HTML attributes and object styles", () => {
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

test("@vune-ui/web ignores children of void elements in SSR and DOM modes", () => {
  const value = Element("input", { "data-field": "name" }, "Ignored")
  assert.equal(renderToHTML(value), '<input data-field="name">')

  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const unmount = mount(value, container)
  const input = container.querySelector("input")
  assert.ok(input)
  assert.equal(input.childNodes.length, 0)
  unmount()
  dom.window.close()
})

test("@vune-ui/web serializes, hydrates, and patches controlled textarea values as text content", async () => {
  const initial = 'A < B & "quoted"'
  const value = Element("textarea", { value: initial, "aria-label": "Notes" })
  const html = renderToHTML(value)
  assert.equal(html, '<textarea aria-label="Notes">A &lt; B &amp; &quot;quoted&quot;</textarea>')
  assert.equal(renderToHTML(Element("textarea", { value: "base" }).withProps({ value: "override" })), '<textarea>override</textarea>')
  assert.equal(renderToHTML(Element("textarea", { value: "base" }).withProps({ value: "$&" })), '<textarea>$&amp;</textarea>')

  const multiline = "\nLine 1\r\nLine 2\rLine 3"
  const multilineHTML = renderToHTML(Element("textarea", { value: multiline }))
  const parsedMultiline = new JSDOM(multilineHTML)
  assert.equal(parsedMultiline.window.document.querySelector("textarea")?.value, "\nLine 1\nLine 2\nLine 3")
  parsedMultiline.window.close()

  const dom = new JSDOM(`<div id=app>${html}</div>`)
  const container = dom.window.document.querySelector("#app")
  const server = container?.querySelector("textarea")
  assert.ok(container)
  assert.ok(server)
  assert.equal(server.value, initial)
  server.value = "typed before hydration"

  const unmount = mount(value, container, { hydrate: true })
  const hydrated = container.querySelector("textarea")
  assert.equal(hydrated, server)
  assert.equal(hydrated?.value, initial)
  assert.equal(hydrated?.textContent, initial)
  assert.equal(hydrated?.hasAttribute("value"), false)
  unmount()

  const current = State("first")
  const App = defineView("ControlledTextArea", {
    initializers: [initializer("ControlledTextArea()", args => args.length === 0)],
    body: () => Element("textarea", { value: current.value }),
  })
  const patchContainer = dom.window.document.createElement("div")
  dom.window.document.body.appendChild(patchContainer)
  const unmountPatched = mount(App(), patchContainer)
  const patched = patchContainer.querySelector("textarea")
  assert.equal(patched?.value, "first")
  current.value = "second\nline"
  await Promise.resolve()
  assert.equal(patchContainer.querySelector("textarea"), patched)
  assert.equal(patched?.value, "second\nline")
  assert.equal(patched?.textContent, "second\nline")
  assert.equal(patched?.hasAttribute("value"), false)
  unmountPatched()
  dom.window.close()
})

test("@vune-ui/web applies controlled select values after options exist in SSR, mount, and hydration", async () => {
  const selection = State("b")
  const Select = () => Element("select", { value: selection.value },
    Element("option", { value: "a", selected: true }, "A"),
    Element("option", { value: "b" }, "B"),
    Element("option", null, "C"),
  )
  const App = defineView("ControlledSelect", {
    initializers: [initializer("ControlledSelect()", args => args.length === 0)],
    body: Select,
  })
  const html = renderToHTML(App())
  assert.equal(html, '<select><option value="a">A</option><option value="b" selected>B</option><option>C</option></select>')
  assert.equal(
    renderToHTML(Select().withProps({ value: "C" })),
    '<select><option value="a">A</option><option value="b">B</option><option selected>C</option></select>',
  )
  assert.equal(
    renderToHTML(Element("select", { value: "C's" }, Element("option", null, "C's"))),
    "<select><option selected>C's</option></select>",
  )

  const parsed = new JSDOM(`<div id=app>${html}</div>`)
  const container = parsed.window.document.querySelector("#app")
  const server = container?.querySelector("select")
  assert.ok(container)
  assert.ok(server)
  assert.equal(server.value, "b")
  server.value = "a"

  const unmount = mount(App(), container, { hydrate: true })
  assert.equal(container.querySelector("select"), server)
  assert.equal(server.value, "b")
  assert.equal(server.hasAttribute("value"), false)
  selection.value = "a"
  await Promise.resolve()
  assert.equal(server.value, "a")
  assert.equal(server.selectedIndex, 0)
  assert.equal(server.hasAttribute("value"), false)
  unmount()

  const mountedContainer = parsed.window.document.createElement("div")
  const unmountMounted = mount(Element("select", { value: "b" },
    Element("option", { value: "a" }, "A"),
    Element("option", { value: "b" }, "B"),
  ), mountedContainer)
  assert.equal(mountedContainer.querySelector("select")?.value, "b")
  assert.equal(mountedContainer.querySelector("select")?.hasAttribute("value"), false)
  unmountMounted()
  parsed.window.close()
})

test("@vune-ui/web keeps raw-text SSR parsing aligned with DOM mount and blocks closing-tag escapes", () => {
  const values = [
    ["style", '.x::before { content: "<&"; }\r\n.x { color: red; }\0'],
    ["script", 'globalThis.__vuneText = "<&"\r\n\0'],
  ]
  for (const [tag, source] of values) {
    const normalized = source.replace(/\r\n?/g, "\n").replaceAll("\0", "\uFFFD")
    const view = Element(tag, null, source)
    const html = renderToHTML(view)
    const parsed = new JSDOM(`<div id=parsed>${html}</div>`)
    const mounted = new JSDOM("<div id=mounted></div>")
    const container = mounted.window.document.querySelector("#mounted")
    assert.ok(container)
    const unmount = mount(view, container)
    assert.equal(parsed.window.document.querySelector(tag)?.textContent, normalized)
    assert.equal(container.querySelector(tag)?.textContent, normalized)
    assert.equal(container.querySelector(tag)?.textContent, parsed.window.document.querySelector(tag)?.textContent)
    unmount()
    parsed.window.close()
    mounted.window.close()
  }

  assert.throws(
    () => renderToHTML(Element("style", null, ".x { content: '</style>'; }")),
    /closing-tag sequence/,
  )
  assert.throws(
    () => renderToHTML(Element("script", null, Element("span", null, "invalid"))),
    /only accepts text children/,
  )
  const rejected = new JSDOM("<div id=app></div>")
  const rejectedContainer = rejected.window.document.querySelector("#app")
  assert.ok(rejectedContainer)
  assert.throws(
    () => mount(Element("style", null, ".x { content: '</style>'; }"), rejectedContainer),
    /closing-tag sequence/,
  )
  assert.throws(
    () => mount(Element("script", null, Element("span", null, "invalid")), rejectedContainer),
    /only accepts text children/,
  )
  rejected.window.close()
})

test("@vune-ui/web mounts, hydrates, patches, and cleans up template content fragments", async () => {
  const current = State("Hello")
  let clicks = 0
  const refs = []
  const reference = node => refs.push(node)
  const App = defineView("TemplateContent", {
    initializers: [initializer("TemplateContent()", args => args.length === 0)],
    body: () => Element("template", { id: "card" },
      Element("button", { class: "value", ref: reference, onclick: () => { clicks += 1 } }, current.value),
    ),
  })
  const value = App()
  const html = renderToHTML(value)
  const dom = new JSDOM(`<div id=app>${html}</div>`)
  const container = dom.window.document.querySelector("#app")
  const serverTemplate = container?.querySelector("template")
  const serverButton = serverTemplate?.content.querySelector("button")
  assert.ok(container)
  assert.ok(serverTemplate)
  assert.ok(serverButton)
  assert.equal(serverTemplate.childNodes.length, 0)
  assert.equal(serverTemplate.content.textContent, "Hello")

  const unmount = mount(value, container, { hydrate: true })
  const hydratedTemplate = container.querySelector("template")
  assert.equal(hydratedTemplate, serverTemplate)
  assert.equal(hydratedTemplate?.content.querySelector("button"), serverButton)
  assert.equal(hydratedTemplate?.childNodes.length, 0)
  assert.deepEqual(refs, [serverButton])
  serverButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  assert.equal(clicks, 1)

  current.value = "Updated"
  await Promise.resolve()
  assert.equal(hydratedTemplate?.content.querySelector("button"), serverButton)
  assert.equal(serverButton.textContent, "Updated")
  assert.equal(hydratedTemplate?.outerHTML, '<template id="card"><button class="value">Updated</button></template>')
  unmount()
  assert.deepEqual(refs, [serverButton, null])
  serverButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  assert.equal(clicks, 1)
  dom.window.close()

  const mounted = new JSDOM("<div id=app></div>")
  const mountedContainer = mounted.window.document.querySelector("#app")
  assert.ok(mountedContainer)
  const unmountMounted = mount(Element("template", null, Element("span", null, "Live")), mountedContainer)
  const mountedTemplate = mountedContainer.querySelector("template")
  assert.equal(mountedTemplate?.childNodes.length, 0)
  assert.equal(mountedTemplate?.content.textContent, "Live")
  assert.equal(mountedTemplate?.outerHTML, "<template><span>Live</span></template>")
  unmountMounted()
  mounted.window.close()
})

test("@vune-ui/web normalizes direct table rows for stable SSR, mount, hydration, and patching", async () => {
  const current = State("A")
  const App = defineView("ImplicitTableBody", {
    initializers: [initializer("ImplicitTableBody()", args => args.length === 0)],
    body: () => Element("table", { id: "grid" },
      Element("tr", { id: "row" }, Element("td", null, current.value)),
    ),
  })
  const value = App()
  const html = renderToHTML(value)
  assert.equal(html, '<table id="grid"><tbody><tr id="row"><td>A</td></tr></tbody></table>')
  assert.equal(
    renderToHTML(Element("table", null,
      Element("tr", null, Element("td", null, "A")),
      Element("tr", null, Element("td", null, "B")),
    )),
    "<table><tbody><tr><td>A</td></tr><tr><td>B</td></tr></tbody></table>",
  )
  assert.equal(
    renderToHTML(Element("table", null,
      Element("col", { span: 2 }),
      Element("td", null, "Loose cell"),
    )),
    '<table><colgroup><col span="2"></colgroup><tbody><tr><td>Loose cell</td></tr></tbody></table>',
  )
  assert.throws(
    () => renderToHTML(Element("table", null, "fostered text")),
    /only accepts table sections/,
  )
  assert.throws(
    () => renderToHTML(Element("table", null, Element("div", null, "fostered element"))),
    /only accepts table sections/,
  )

  const dom = new JSDOM(`<div id=app>${html}</div>`)
  const container = dom.window.document.querySelector("#app")
  const serverTable = container?.querySelector("table")
  const serverBody = serverTable?.tBodies[0]
  const serverRow = serverTable?.rows[0]
  assert.ok(container)
  assert.ok(serverTable)
  assert.ok(serverBody)
  assert.ok(serverRow)
  const unmount = mount(value, container, { hydrate: true })
  assert.equal(container.querySelector("table"), serverTable)
  assert.equal(serverTable.tBodies[0], serverBody)
  assert.equal(serverTable.rows[0], serverRow)
  current.value = "Updated"
  await Promise.resolve()
  assert.equal(serverTable.rows[0], serverRow)
  assert.equal(serverRow.textContent, "Updated")
  unmount()
  dom.window.close()

  const mounted = new JSDOM("<div id=app></div>")
  const mountedContainer = mounted.window.document.querySelector("#app")
  assert.ok(mountedContainer)
  const unmountMounted = mount(value, mountedContainer)
  const mountedTable = mountedContainer.querySelector("table")
  assert.equal(mountedTable?.children[0]?.tagName, "TBODY")
  assert.equal(mountedTable?.tBodies.length, 1)
  assert.equal(mountedTable?.rows[0]?.textContent, "Updated")
  unmountMounted()

  const normalizedContainer = mounted.window.document.createElement("div")
  const unmountNormalized = mount(Element("table", null,
    Element("col", { span: 2 }),
    Element("td", null, "Loose cell"),
  ), normalizedContainer)
  const normalizedTable = normalizedContainer.querySelector("table")
  assert.equal(normalizedTable?.children[0]?.tagName, "COLGROUP")
  assert.equal(normalizedTable?.children[1]?.tagName, "TBODY")
  assert.equal(normalizedTable?.rows[0]?.cells[0]?.textContent, "Loose cell")
  unmountNormalized()
  assert.throws(
    () => mount(Element("table", null, "fostered text"), normalizedContainer),
    /only accepts table sections/,
  )
  assert.throws(
    () => mount(Element("table", null, Element("div", null, "fostered element")), normalizedContainer),
    /only accepts table sections/,
  )
  mounted.window.close()
})

test("@vune-ui/web merges object styles and classes supplied by withProps", () => {
  const value = Element("div", { class: "base", style: { color: "red" } }, "Card")
    .className("accent")
    .withProps({ className: "interactive", style: { backgroundColor: "blue" } })
  const html = renderToHTML(value)
  assert.match(html, /class="base accent interactive"/)
  assert.match(html, /color:red;background-color:blue/)
})

test("@vune-ui/web omits coercible withProps values in SSR and DOM modes", () => {
  let coercionCalls = 0
  const value = Text("Safe").withProps({
    title: { toString() { coercionCalls += 1; return "coerced" } },
    "data-safe": "yes",
  })
  const html = renderToHTML(value)
  assert.match(html, /data-safe="yes"/)
  assert.doesNotMatch(html, /title=|coerced/)

  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const unmount = mount(value, container)
  assert.equal(container.firstElementChild?.getAttribute("data-safe"), "yes")
  assert.equal(container.firstElementChild?.hasAttribute("title"), false)
  assert.equal(coercionCalls, 0)
  unmount()
  dom.window.close()
})

test("@vune-ui/web passes custom element objects as DOM properties without SSR coercion", async () => {
  let coercionCalls = 0
  const payload = { toString() { coercionCalls += 1; return "coerced" } }
  const value = Element("vune-card", { payload, label: "safe" })
  const html = renderToHTML(value)
  assert.match(html, /label="safe"/)
  assert.doesNotMatch(html, /payload=|coerced/)

  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const unmount = mount(value, container)
  const element = container.firstElementChild
  assert.ok(element)
  assert.strictEqual(element.payload, payload)
  assert.equal(element.hasAttribute("payload"), false)
  assert.equal(coercionCalls, 0)
  unmount()

  const current = State(payload)
  const DynamicCustomElement = defineView("DynamicCustomElement", {
    initializers: [initializer("DynamicCustomElement()", args => args.length === 0)],
    body: () => Element("vune-card", { payload: current.value }),
  })
  const unmountDynamic = mount(DynamicCustomElement(), container)
  const dynamicElement = container.firstElementChild
  assert.ok(dynamicElement)
  assert.strictEqual(dynamicElement.payload, current.value)
  current.value = undefined
  await Promise.resolve()
  assert.equal(dynamicElement.payload, undefined)
  assert.equal(dynamicElement.hasAttribute("payload"), false)
  assert.equal(coercionCalls, 0)
  unmountDynamic()
  dom.window.close()
})

test("@vune-ui/web normalizes modifier CSS names and omits nullish style values", () => {
  const value = Element("div", {
    style: { backgroundColor: "red", color: null },
  }, "Styled").style({ borderTopColor: "blue", outlineColor: undefined })
  const html = renderToHTML(value)
  assert.match(html, /background-color:red;border-top-color:blue/)
  assert.doesNotMatch(html, /backgroundColor|borderTopColor|null|undefined/)

  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const unmount = mount(value, container)
  const element = container.firstElementChild
  assert.ok(element)
  assert.equal(element.style.backgroundColor, "red")
  assert.equal(element.style.borderTopColor, "blue")
  assert.doesNotMatch(element.getAttribute("style") ?? "", /null|undefined/)
  unmount()
  dom.window.close()
})

test("@vune-ui/web safely merges escaped class and style modifier values", () => {
  const value = Element("div", {
    class: "base&one",
    style: { color: "red" },
  }, "Safe")
    .className('next"two')
    .style({ backgroundImage: 'url("quoted.png?x=1&y=2")' })
  const html = renderToHTML(value)
  assert.match(html, /class="base&amp;one next&quot;two"/)
  assert.doesNotMatch(html, /base&amp;amp;one/)
  assert.match(html, /style="color:red;background-image:url\(&quot;quoted\.png\?x=1&amp;y=2&quot;\)"/)
})

test("@vune-ui/web serializes scroll and safe-area CSS from the core graph", () => {
  const value = SafeArea(["top", "bottom"], () => [
    ScrollView("both", () => [Element("div", null, "Content")]),
  ])
  const html = renderToHTML(value)
  assert.match(html, /data-vune="SafeArea"/)
  assert.match(html, /padding-top:env\(safe-area-inset-top\)/)
  assert.match(html, /padding-bottom:env\(safe-area-inset-bottom\)/)
  assert.match(html, /data-vune="ScrollView"/)
  assert.match(html, /overflow-x:auto/)
  assert.match(html, /overflow-y:auto/)
})

test("@vune-ui/web exposes GeometryReader in SSR and DOM modes", () => {
  const value = GeometryReader(geometry => Element("span", null, `${geometry.size.width}x${geometry.size.height}`))
  const html = renderToHTML(value)
  assert.match(html, /data-vune="GeometryReader"/)
  assert.match(html, />0x0<\/span>/)
})

test("@vune-ui/web measures CSS safe-area insets at the DOM boundary", async () => {
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

test("@vune-ui/web resolves renderer-independent View state", () => {
  const Counter = defineView("Counter", {
    initializers: [initializer("Counter()", args => args.length === 0)],
    state: () => ({ count: State(3) }),
    body: ({ count }) => Text(String(count.value)),
  })
  assert.equal(renderToHTML(Counter()), "<span>3</span>")
})

test("@vune-ui/web mount reevaluates State reads and cleans up", async () => {
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

test("@vune-ui/web DOM mount preserves events, refs, and State invalidation", async () => {
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

test("@vune-ui/web patches text, attributes, and events without replacing the DOM node", async () => {
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

test("@vune-ui/web removes event listeners when a live prop becomes null", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const enabled = State(true)
  let clicks = 0
  const Toggle = defineView("EventToggle", {
    initializers: [initializer("EventToggle()", args => args.length === 0)],
    body: () => Element("button", {
      onclick: enabled.value ? () => { clicks += 1 } : null,
    }, enabled.value ? "Enabled" : "Disabled"),
  })
  const unmount = mount(Toggle(), container)
  const button = container.querySelector("button")
  assert.ok(button)

  button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  assert.equal(clicks, 1)
  enabled.value = false
  await Promise.resolve()
  assert.equal(container.querySelector("button"), button)
  button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  assert.equal(clicks, 1)

  enabled.value = true
  await Promise.resolve()
  button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  assert.equal(clicks, 2)
  unmount()
  dom.window.close()
})

test("@vune-ui/web preserves capture phase event semantics and removal", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const captureEnabled = State(true)
  const calls = []
  const App = defineView("CaptureEvents", {
    initializers: [initializer("CaptureEvents()", args => args.length === 0)],
    body: () => Element("div", {
      onClickCapture: captureEnabled.value ? () => calls.push("capture") : null,
      onclick: () => calls.push("bubble"),
    }, Element("button", { onclick: () => calls.push("target") }, "Run")),
  })
  const unmount = mount(App(), container)
  const button = container.querySelector("button")
  assert.ok(button)
  button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  assert.deepEqual(calls, ["capture", "target", "bubble"])

  calls.length = 0
  captureEnabled.value = false
  await Promise.resolve()
  button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  assert.deepEqual(calls, ["target", "bubble"])
  unmount()
  dom.window.close()
})

test("@vune-ui/web preserves pointer-capture event names ending in Capture", () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const calls = []
  const value = Element("div", {
    onGotPointerCapture: () => calls.push("got"),
    onLostPointerCapture: () => calls.push("lost"),
  }, "Target")
  const unmount = mount(value, container)
  const target = container.firstElementChild
  assert.ok(target)
  target.dispatchEvent(new dom.window.Event("gotpointercapture", { bubbles: true }))
  target.dispatchEvent(new dom.window.Event("lostpointercapture", { bubbles: true }))
  assert.deepEqual(calls, ["got", "lost"])
  unmount()
  dom.window.close()
})

test("@vune-ui/web detaches listeners from replaced and unmounted DOM nodes", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const visible = State(true)
  let clicks = 0
  const App = defineView("EventLifetime", {
    initializers: [initializer("EventLifetime()", args => args.length === 0)],
    body: () => visible.value
      ? Element("button", { onclick: () => { clicks += 1 } }, "Active")
      : Element("span", null, "Inactive"),
  })
  const unmount = mount(App(), container)
  const replacedButton = container.querySelector("button")
  assert.ok(replacedButton)
  replacedButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  assert.equal(clicks, 1)

  visible.value = false
  await Promise.resolve()
  assert.equal(replacedButton.isConnected, false)
  replacedButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  assert.equal(clicks, 1)

  visible.value = true
  await Promise.resolve()
  const unmountedButton = container.querySelector("button")
  assert.ok(unmountedButton)
  unmount()
  unmountedButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  assert.equal(clicks, 1)
  dom.window.close()
})

test("@vune-ui/web windows lazy children and responds to scroll without rebuilding the boundary", async () => {
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
  const boundary = container.querySelector("[data-vune-lazy]")
  assert.ok(boundary)
  assert.ok(boundary.querySelectorAll("[data-item]").length < children.length)
  assert.ok(boundary.querySelector("[data-vune-lazy-spacer=after]"))

  const before = boundary.querySelector("[data-item=0]")
  container.scrollTop = 400
  container.dispatchEvent(new dom.window.Event("scroll"))
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(container.scrollTop, 400)
  assert.equal(boundary.querySelector("[data-item=0]"), null)
  assert.ok(boundary.querySelector("[data-item=20]"))
  assert.equal(boundary, container.querySelector("[data-vune-lazy]"))
  assert.equal(before?.isConnected, false)
  unmount()
  dom.window.close()
})

test("@vune-ui/web refines lazy ranges from measured child sizes", async () => {
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
  const boundary = container.querySelector("[data-vune-lazy]")
  assert.ok(boundary)
  assert.equal(boundary.querySelectorAll("[data-item]").length, 3)
  unmount()
  Object.defineProperty(dom.window.HTMLElement.prototype, "getBoundingClientRect", { configurable: true, value: originalRect })
  dom.window.close()
})

test("@vune-ui/web preserves keyed child State across reorder and resets it after remount", async () => {
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

test("@vune-ui/web hydrates existing SSR markup and wires the live DOM boundary", async () => {
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

test("@vune-ui/web keeps explicit ForEach identity through SSR hydration and reorder", async () => {
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

test("@vune-ui/web hydrates the frame host without replacing its child", async () => {
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

test("@vune-ui/web falls back to a fresh client tree when hydration structure mismatches", async () => {
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

test("@vune-ui/web commits refs only after live DOM reconciliation and keeps stable refs stable", async () => {
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

test("@vune-ui/web object refs do not execute has or accessor traps", () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  let hasCalls = 0
  const reference = new Proxy({ current: null }, {
    has() {
      hasCalls += 1
      throw new Error("object ref has trap must not run")
    },
  })
  const unmount = mount(Element("button", { ref: reference }, "Safe"), container)
  const button = container.querySelector("button")
  assert.ok(button)
  assert.strictEqual(reference.current, button)
  assert.equal(hasCalls, 0)
  unmount()
  assert.equal(reference.current, null)
  assert.equal(hasCalls, 0)

  let accessorCalls = 0
  const accessorReference = {}
  Object.defineProperty(accessorReference, "current", {
    configurable: true,
    get() { accessorCalls += 1; return null },
    set() { accessorCalls += 1 },
  })
  const unmountAccessor = mount(Element("button", { ref: accessorReference }, "Ignored"), container)
  assert.equal(accessorCalls, 0)
  unmountAccessor()
  assert.equal(accessorCalls, 0)
  dom.window.close()
})

test("@vune-ui/web normalizes DOM event names and boolean, ARIA, and enumerated attributes", () => {
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

test("@vune-ui/web never serializes non-function event props into SSR HTML", () => {
  const value = Element("button", {
    onclick: "globalThis.__unexpectedInlineEvent = true",
    onClickCapture: false,
    "aria-pressed": false,
  }, "Safe")
  const html = renderToHTML(value)
  assert.doesNotMatch(html, /\sonclick(?:capture)?=/i)
  assert.match(html, /aria-pressed="false"/)
})

test("@vune-ui/web rejects invalid programmatic HTML names during SSR", () => {
  assert.throws(
    () => renderToHTML(Element('div><script data-owned="yes"', null, "Safe")),
    /Invalid HTML tag name/,
  )
  assert.throws(
    () => renderToHTML(Element("div", { 'title" data-owned': "yes" }, "Safe")),
    /Invalid HTML attribute name/,
  )
  assert.equal(
    renderToHTML(Element("vune-chart", { "data-series": "revenue", xlinkHref: "#chart" })),
    '<vune-chart data-series="revenue" xlink:href="#chart"></vune-chart>',
  )
  assert.equal(
    renderToHTML(Element("élement", { "資料": "값", "a·b": "ok", ":kind": "custom" }, "Safe")),
    '<élement 資料="값" a·b="ok" :kind="custom">Safe</élement>',
  )
})

test("@vune-ui/web hydration reconciles stale server attributes without replacing matching nodes", () => {
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

test("@vune-ui/web creates contextual SVG namespaces and returns to HTML inside foreignObject", () => {
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

test("@vune-ui/web preserves State for logically present offscreen lazy rows and drops removed rows", async () => {
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
