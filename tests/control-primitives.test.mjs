import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Binding, Image, Link, Slider, State, TextField, Toggle, render } from "../packages/react/dist/index.js"

test("migrated controls expose native semantics and writable bindings", () => {
  const wifi = State(false)
  const name = State("Muse")
  const volume = State(0.5)
  const html = renderToStaticMarkup(render(
    Toggle("Wi-Fi", Binding(wifi)),
  )) + renderToStaticMarkup(render(TextField(Binding(name), "Name"))) + renderToStaticMarkup(render(Slider(Binding(volume), { min: 0, max: 1, step: 0.1 })))
  assert.match(html, /type="checkbox"/)
  assert.match(html, /data-muse="TextField"/)
  assert.match(html, /type="range"/)
  assert.equal(wifi.value, false)
  assert.equal(name.value, "Muse")
  assert.equal(volume.value, 0.5)

  const toggleElement = render(Toggle("Wi-Fi", Binding(wifi)))
  toggleElement.props.children[0].props.onChange({ target: { checked: true } })
  assert.equal(wifi.value, true)
  const fieldElement = render(TextField(Binding(name)))
  fieldElement.props.onInput({ target: { value: "Muse Core" } })
  assert.equal(name.value, "Muse Core")
  const sliderElement = render(Slider(Binding(volume)))
  sliderElement.props.onInput({ target: { value: "0.75" } })
  assert.equal(volume.value, 0.75)
})

test("Image and Link stay graph values until rendered", () => {
  const image = Image("/muse.png", { alt: "Muse" })
  assert.equal(image.kind, "element")
  assert.match(renderToStaticMarkup(render(Link("Docs", "/docs"))), /href="\/docs".*Docs/)
})
