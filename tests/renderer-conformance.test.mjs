import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { createSSRApp } from "vue"
import { renderToString } from "@vue/server-renderer"
import { BindingValue, Button, Element, ForeignComponent, LazyVStack, SafeArea, State, Text, Toggle, VStack, defineView, initializer } from "../packages/core/dist/index.js"
import { render as renderReact } from "../packages/react/dist/index.js"
import { render as renderVue } from "../packages/vue/dist/index.js"
import { renderToHTML } from "../packages/web/dist/index.js"

const Card = defineView("Card", {
  initializers: [initializer("Card()", args => args.length === 0)],
  body: () => Element("article", { "data-card": "root" }, Text("Card body")),
})

test("the shared Text/VStack/Button/Card graph has renderer-conformant SSR semantics", async () => {
  const value = VStack(
    Text("Title"),
    Button("Save", () => {}),
    Card(),
  ).padding(8)
  const outputs = [
    renderToStaticMarkup(renderReact(value)),
    await renderToString(createSSRApp({ render: () => renderVue(value) })),
    renderToHTML(value),
  ]

  for (const html of outputs) {
    assert.match(html, /data-vune="VStack"/)
    assert.match(html, /padding:8px/)
    assert.match(html, /<span>Title<\/span>/)
    assert.match(html, /<button type="button"><span>Save<\/span><\/button>/)
    assert.match(html, /<article data-card="root"><span>Card body<\/span><\/article>/)
  }
})

test("raw HTML, foreign boundaries, and CSS environment semantics stay renderer-conformant", async () => {
  const value = Element("section", { class: "raw-card", "data-raw": "yes", "aria-label": "raw" },
    Element("strong", null, "Raw"),
    ForeignComponent("button", { name: "ConformanceForeign", props: { "data-foreign": "yes", title: "foreign" } }, Text("Foreign")),
  )
  const safe = SafeArea(["top"], () => Text("Inset"))
  const outputs = [
    renderToStaticMarkup(renderReact(value)),
    await renderToString(createSSRApp({ render: () => renderVue(value) })),
    renderToHTML(value),
    renderToStaticMarkup(renderReact(safe)),
    await renderToString(createSSRApp({ render: () => renderVue(safe) })),
    renderToHTML(safe),
  ]

  for (const html of outputs.slice(0, 3)) {
    assert.match(html, /data-raw="yes"/)
    assert.match(html, /Raw/)
    assert.match(html, /data-foreign="yes"/)
    assert.match(html, /Foreign/)
  }
  for (const html of outputs.slice(3)) assert.match(html, /safe-area-inset-top/)
})

test("BindingValue has the same writable control semantics in React, Vue, and Web", async () => {
  const state = State(false)
  const value = Toggle("Enabled", BindingValue(state))
  const outputs = [
    renderToStaticMarkup(renderReact(value)),
    await renderToString(createSSRApp({ render: () => renderVue(value) })),
    renderToHTML(value),
  ]
  for (const html of outputs) assert.match(html, /type="checkbox"/)
  state.value = true
  assert.equal(BindingValue(state).value, true)
})

test("lazy graph boundaries keep renderer-conformant SSR fallback markup", async () => {
  const value = LazyVStack({ estimatedItemSize: 40 }, Text("One"), Text("Two"))
  const outputs = [
    renderToStaticMarkup(renderReact(value)),
    await renderToString(createSSRApp({ render: () => renderVue(value) })),
    renderToHTML(value),
  ]
  for (const html of outputs) {
    assert.match(html, /data-vune="LazyVStack"/)
    assert.match(html, /data-vune-lazy="vertical"/)
    assert.match(html, /<span>One<\/span><span>Two<\/span>/)
  }
})
