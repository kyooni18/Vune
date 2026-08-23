import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import * as core from "../dist/core.js"
import * as vune from "../dist/vune.js"
import * as legacy from "../dist/legacy.js"
import * as canonical from "../dist/index.js"

test("vune-ui exposes the canonical core and Vune renderer subpaths", () => {
  const state = core.State(1)
  const value = vune.Text(`Value: ${state.value}`).padding(4)
  assert.equal(value.kind, "modified")
  assert.match(renderToStaticMarkup(vune.render(value)), /Value: 1/)
})

test("the vune-ui package is renderer-independent at its canonical entry point", () => {
  assert.equal(typeof canonical.Text, "function")
  assert.equal(typeof canonical.VStack, "function")
  assert.equal(typeof canonical.Button, "function")
  assert.equal(typeof canonical.GeometryReader, "function")
  assert.equal(typeof canonical.Grid, "function")
  assert.equal(typeof canonical.Picker, "function")
  assert.equal(typeof canonical.ProgressView, "function")
  assert.equal(typeof canonical.NavigationStack, "function")
  assert.equal(typeof canonical.Sheet, "function")
  assert.equal(typeof canonical.State, "function")
  assert.equal(canonical.Text("Hello").kind, "element")
})

test("the explicit legacy subpath exposes React compatibility APIs", () => {
  assert.equal(typeof legacy.Text, "function")
  assert.equal(typeof legacy.Button, "function")
  assert.equal(typeof legacy.view, "function")
})
