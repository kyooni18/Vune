import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import * as core from "../dist/core.js"
import * as muse from "../dist/muse.js"
import * as legacy from "@muse/react/legacy"
import * as canonical from "../packages/muse/dist/index.js"

test("react-muse-ui exposes the canonical core and Muse renderer subpaths", () => {
  const state = core.State(1)
  const value = muse.Text(`Value: ${state.value}`).padding(4)
  assert.equal(value.kind, "modified")
  assert.match(renderToStaticMarkup(muse.render(value)), /Value: 1/)
})

test("the muse package is renderer-independent at its canonical entry point", () => {
  assert.equal(typeof canonical.Text, "function")
  assert.equal(typeof canonical.VStack, "function")
  assert.equal(typeof canonical.Button, "function")
  assert.equal(typeof canonical.GeometryReader, "function")
  assert.equal(typeof canonical.State, "function")
  assert.equal(canonical.Text("Hello").kind, "element")
})

test("the root compatibility package delegates to the legacy React subpath", () => {
  assert.equal(typeof legacy.Text, "function")
  assert.equal(typeof legacy.Button, "function")
  assert.equal(typeof legacy.view, "function")
})
