import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import { renderToStaticMarkup } from "react-dom/server"
import { createSSRApp } from "vue"
import { renderToString } from "@vue/server-renderer"
import { Divider, Element, Group, HStack, SafeArea, ScrollView, Spacer, Text, VStack, ZStack, defineView, initializer } from "../packages/core/dist/index.js"
import { render as renderReact } from "../packages/react/dist/index.js"
import { render as renderVue } from "../packages/vue/dist/index.js"
import { renderToHTML } from "../packages/web/dist/index.js"

test("migrated layout primitives keep the graph-first contract", () => {
  const value = HStack(Text("Left"), Spacer(24), Text("Right")).padding(8)
  assert.equal(value.kind, "modified")
  const html = renderToStaticMarkup(renderReact(value))
  assert.match(html, /data-vune="HStack"/)
  assert.match(html, /flex-grow:1/)
  assert.match(html, /padding:8px/)
})

test("Group, ZStack, Element, and Divider compose without React elements in core", () => {
  const html = renderToStaticMarkup(renderReact(VStack(
    Group(Text("A"), Text("B")),
    ZStack(Text("Top")),
    Element("section", { id: "native" }, Divider()),
  )))
  assert.match(html, /A.*B/)
  assert.match(html, /data-vune="ZStack"/)
  assert.match(html, /<section id="native"><hr data-vune="Divider"\/?><\/section>/)
})

test("layout semantics stay aligned across React, Vue, and Web renderers", async () => {
  const value = SafeArea(["top", "left"], () => ScrollView("both", () =>
    ZStack({ alignment: "topTrailing" },
      HStack({ alignment: "bottom", spacing: 6 }, Text("A"), Spacer(12), Text("B")),
    ).frame({ minWidth: 120, maxWidth: "infinity", height: 48 }),
  ))
  const outputs = [
    renderToStaticMarkup(renderReact(value)),
    await renderToString(createSSRApp({ render: () => renderVue(value) })),
    renderToHTML(value),
  ]

  for (const html of outputs) {
    assert.match(html, /place-items:\s*start end/)
    assert.match(html, /flex-basis:\s*12px/)
    assert.match(html, /flex-shrink:\s*0/)
    assert.match(html, /max-width:\s*100%/)
    assert.match(html, /min-width:\s*120px/)
    assert.match(html, /height:\s*48px/)
    assert.match(html, /overflow-x:\s*auto/)
    assert.match(html, /overflow-y:\s*auto/)
    assert.match(html, /padding-top:\s*env\(safe-area-inset-top\)/)
    assert.match(html, /padding-left:\s*env\(safe-area-inset-left\)/)
  }
})

test("frame creates the same alignment host across React, Vue, and Web renderers", async () => {
  const value = Text("Aligned").frame({ width: 120, height: 48, alignment: "topTrailing" })
  const outputs = [
    renderToStaticMarkup(renderReact(value)),
    await renderToString(createSSRApp({ render: () => renderVue(value) })),
    renderToHTML(value),
  ]

  for (const html of outputs) {
    const document = new JSDOM(html).window.document
    const frame = document.body.firstElementChild
    assert.ok(frame)
    assert.equal(frame?.tagName, "DIV")
    assert.equal(frame?.style.display, "grid")
    assert.equal(frame?.style.placeItems, "start end")
    assert.equal(frame?.style.width, "120px")
    assert.equal(frame?.style.height, "48px")
    assert.equal(frame?.firstElementChild?.tagName, "SPAN")
    assert.equal(frame?.firstElementChild?.textContent, "Aligned")
    assert.equal(frame?.firstElementChild?.style.display, "")
  }
})

test("custom View modifiers reach the rendered root in every renderer", async () => {
  const Card = defineView("ModifierCard", {
    initializers: [initializer("ModifierCard()", args => args.length === 0)],
    body: () => Element("article", { "data-card": "root" }, Text("Card")),
  })
  const value = Card().padding(7).className("custom-card")
  const outputs = [
    renderToStaticMarkup(renderReact(value)),
    await renderToString(createSSRApp({ render: () => renderVue(value) })),
    renderToHTML(value),
  ]
  for (const html of outputs) {
    assert.match(html, /class="custom-card"/)
    assert.match(html, /padding:\s*7px/)
    assert.match(html, /data-card="root"/)
  }
})
