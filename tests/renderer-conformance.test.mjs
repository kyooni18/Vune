import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { createSSRApp } from "vue"
import { renderToString } from "@vue/server-renderer"
import { Button, Element, Text, VStack, defineView, initializer } from "../packages/core/dist/index.js"
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
    Button(() => {}, () => Text("Save")),
    Card(),
  ).padding(8)
  const outputs = [
    renderToStaticMarkup(renderReact(value)),
    await renderToString(createSSRApp({ render: () => renderVue(value) })),
    renderToHTML(value),
  ]

  for (const html of outputs) {
    assert.match(html, /data-muse="VStack"/)
    assert.match(html, /padding:8px/)
    assert.match(html, /<span>Title<\/span>/)
    assert.match(html, /<button type="button"><span>Save<\/span><\/button>/)
    assert.match(html, /<article data-card="root"><span>Card body<\/span><\/article>/)
  }
})
