import assert from "node:assert/strict"
import test from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import {
  defineBuiltinView,
  Element,
  initializer,
  initializerKinds,
  GeometryReader,
  SafeArea,
  ScrollView,
  viewElement,
} from "../packages/core/dist/index.js"
import { State, render, view } from "../packages/react/dist/index.js"

const Text = defineBuiltinView(
  "Text",
  [initializer("Text(value)", args => args.length === 1, args => ({ value: args[0] }), [initializerKinds.value()])],
  ({ value }) => viewElement("span", null, [value]),
)

test("@muse/react renders the core graph at the React boundary", () => {
  const html = renderToStaticMarkup(render(Text("Hello").padding(8)))
  assert.match(html, /<span style="padding:8px">Hello<\/span>/)
  assert.equal(renderToStaticMarkup(render(Text("Styled").className(["card", false, "active"]))), '<span class="card active">Styled</span>')
})

test("@muse/react view keeps props at the renderer boundary", () => {
  const Greeting = view(({ name }) => Text(`Hello, ${name}`))
  const html = renderToStaticMarkup(createElement(Greeting, { name: "Muse" }))
  assert.equal(html, "<span>Hello, Muse</span>")
})

test("@muse/react stateful view scopes State creation to each mounted identity", () => {
  let factories = 0
  const Counter = view({
    state: () => { factories += 1; return { count: State(2) } },
    body: ({ count }) => Text(String(count.value)),
  })
  const html = renderToStaticMarkup(createElement("div", null, createElement(Counter), createElement(Counter)))
  assert.equal(html, "<div><span>2</span><span>2</span></div>")
  assert.equal(factories, 2)
})

test("@muse/react adapts raw HTML names to native React props at the boundary", () => {
  const save = () => undefined
  const element = render(Element("button", { class: "card", for: "name", onclick: save }, "Save"))
  assert.equal(element.props.className, "card")
  assert.equal(element.props.htmlFor, "name")
  assert.equal(element.props.onClick, save)
})

test("@muse/react shares core scroll and safe-area Views", () => {
  const value = SafeArea(() => [ScrollView("horizontal", () => [Element("span", null, "Items")])])
  const html = renderToStaticMarkup(render(value))
  assert.match(html, /data-muse="SafeArea"/)
  assert.match(html, /data-muse="ScrollView"/)
  assert.match(html, /overflow-x:auto/)
  assert.match(html, /overflow-y:hidden/)
})

test("@muse/react materializes GeometryReader with a renderer-owned boundary", () => {
  const value = GeometryReader(geometry => Element("span", null, `${geometry.size.width}x${geometry.size.height}`))
  const html = renderToStaticMarkup(render(value))
  assert.match(html, /data-muse="GeometryReader"/)
  assert.match(html, />0x0<\/span>/)
})
