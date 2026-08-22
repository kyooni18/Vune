import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Alert, Binding, Menu, NavigationLink, NavigationStack, Sheet, State, Text, render } from "../packages/react/dist/index.js"

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
