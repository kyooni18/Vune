import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Divider, Element, Group, HStack, Spacer, Text, VStack, ZStack, render } from "../packages/react/dist/index.js"

test("migrated layout primitives keep the graph-first contract", () => {
  const value = HStack(Text("Left"), Spacer(24), Text("Right")).padding(8)
  assert.equal(value.kind, "modified")
  const html = renderToStaticMarkup(render(value))
  assert.match(html, /data-muse="HStack"/)
  assert.match(html, /flex-grow:1/)
  assert.match(html, /padding:8px/)
})

test("Group, ZStack, Element, and Divider compose without React elements in core", () => {
  const html = renderToStaticMarkup(render(VStack(
    Group(Text("A"), Text("B")),
    ZStack(Text("Top")),
    Element("section", { id: "native" }, Divider()),
  )))
  assert.match(html, /A.*B/)
  assert.match(html, /data-muse="ZStack"/)
  assert.match(html, /<section id="native"><hr data-muse="Divider"\/?><\/section>/)
})
