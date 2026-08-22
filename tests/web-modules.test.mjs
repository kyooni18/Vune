import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import * as web from "../packages/web/dist/index.js"
import * as ssr from "../packages/web/dist/ssr.js"
import * as dom from "../packages/web/dist/dom.js"
import * as hydration from "../packages/web/dist/hydration.js"
import * as props from "../packages/web/dist/props.js"

test("the Web adapter keeps its public barrel aligned with focused SSR and DOM modules", () => {
  assert.strictEqual(web.renderToHTML, ssr.renderToHTML)
  assert.strictEqual(web.mount, dom.mount)
  assert.equal(typeof hydration.hydrateNode, "function")
  assert.equal(typeof props.applyDomProps, "function")
  assert.equal(typeof props.patchDomProps, "function")
})

test("Web SSR, DOM, and hydration internals remain renderer-neutral", () => {
  for (const name of ["shared.js", "ssr.js", "props.js", "hydration.js", "dom.js"]) {
    const source = readFileSync(new URL(`../packages/web/dist/${name}`, import.meta.url), "utf8")
    assert.doesNotMatch(source, /(?:^|[\\"'])react(?:[-/][^\\"']*)?[\\"']/i, name)
  }
})
