import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Binding, Box, ElementRef, Grid, Key, Picker, ProgressView, State, Stepper, TextArea, render } from "../packages/react/dist/index.js"

test("remaining built-in elements and controls use the new graph adapter", () => {
  const value = State("one")
  const count = State(1)
  const html = renderToStaticMarkup(render(Box(
    Grid({ columns: 2 }, ProgressView(0.5, { label: "Load" })),
    TextArea(Binding(value), "Notes"),
    Picker(Binding(value), [{ label: "One", value: "one" }]),
    Stepper(Binding(count)),
  )))
  assert.match(html, /data-muse="Grid"/)
  assert.match(html, /data-muse="ProgressView"/)
  assert.match(html, /data-muse="TextArea"/)
  assert.match(html, /data-muse="Picker"/)
  assert.match(html, /data-muse="Stepper"/)
})

test("Key and ElementRef are immutable graph modifiers", () => {
  const value = TextArea(Binding(State("value")))
  const keyed = Key("field", value)
  const referenced = ElementRef(() => undefined, keyed)
  assert.notEqual(value, keyed)
  assert.notEqual(keyed, referenced)
  assert.equal(referenced.kind, "modified")
})
