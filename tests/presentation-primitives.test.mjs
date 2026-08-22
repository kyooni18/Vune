import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import { renderToStaticMarkup } from "react-dom/server"
import { Alert, Binding, Menu, NavigationLink, NavigationStack, Sheet, State, Text } from "../packages/core/dist/index.js"
import { Sheet as ReactSheet, render } from "../packages/react/dist/index.js"
import { mount } from "../packages/web/dist/index.js"

test("presentation primitives keep visibility and navigation state in graph props", () => {
  const presented = State(true)
  const html = renderToStaticMarkup(render(NavigationStack(() => [
    NavigationLink("/settings", "Settings"),
    Sheet(Binding(presented), () => Text("Sheet")),
    Alert(Binding(presented), "Notice", "Message"),
    Menu("More", () => Text("Action")),
  ])))
  assert.match(html, /data-muse="NavigationStack"/)
  assert.match(html, /href="\/settings".*Settings/)
  assert.match(html, /role="dialog".*Sheet/)
  assert.match(html, /role="alertdialog".*Notice/)
  assert.match(html, /data-muse="Menu"/)
  presented.value = false
  assert.equal(renderToStaticMarkup(render(Sheet(Binding(presented), () => Text("Hidden")))), "")
})

test("top-level presentation Views reevaluate Binding state through the core ViewHost", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const target = dom.window.document.querySelector("#app")
  const presented = State(false)
  const value = Sheet(Binding(presented), () => Text("Live sheet"))
  assert.equal(value.kind, "view")
  const unmount = mount(value, target)
  assert.equal(target.textContent, "")
  presented.value = true
  await Promise.resolve()
  assert.equal(target.textContent, "Live sheet")
  presented.value = false
  await Promise.resolve()
  assert.equal(target.textContent, "")
  unmount()
  dom.window.close()
})

test("@muse/react presentation Views are compatibility aliases of core Views", () => {
  assert.equal(ReactSheet, Sheet)
})
