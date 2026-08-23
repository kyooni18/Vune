import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Binding, Image, Link, Slider, State, TextField, Toggle } from "../packages/core/dist/index.js"
import { Image as ReactImage, Toggle as ReactToggle, render } from "../packages/react/dist/index.js"

test("migrated controls expose native semantics and writable bindings", () => {
  const wifi = State(false)
  const name = State("Vune")
  const volume = State(0.5)
  const html = renderToStaticMarkup(render(
    Toggle("Wi-Fi", Binding(wifi)),
  )) + renderToStaticMarkup(render(TextField(Binding(name), "Name"))) + renderToStaticMarkup(render(Slider(Binding(volume), { min: 0, max: 1, step: 0.1 })))
  assert.match(html, /type="checkbox"/)
  assert.match(html, /data-vune="TextField"/)
  assert.match(html, /type="range"/)
  assert.equal(wifi.value, false)
  assert.equal(name.value, "Vune")
  assert.equal(volume.value, 0.5)

  const toggleElement = render(Toggle("Wi-Fi", Binding(wifi)))
  toggleElement.props.children[0].props.onChange({ target: { checked: true } })
  assert.equal(wifi.value, true)
  const fieldElement = render(TextField(Binding(name)))
  fieldElement.props.onInput({ target: { value: "Vune Core" } })
  assert.equal(name.value, "Vune Core")
  const sliderElement = render(Slider(Binding(volume)))
  sliderElement.props.onInput({ target: { value: "0.75" } })
  assert.equal(volume.value, 0.75)
})

test("Slider normalizes non-finite native numeric attributes", () => {
  const value = State(Number.NaN)
  const html = renderToStaticMarkup(render(Slider(Binding(value), {
    min: Number.NaN,
    max: Number.POSITIVE_INFINITY,
    step: Number.NEGATIVE_INFINITY,
  })))
  assert.doesNotMatch(html, /NaN|Infinity/)
  assert.match(html, /value="0"/)
  assert.match(html, /min="0"/)
  assert.match(html, /max="1"/)
  assert.doesNotMatch(html, /step=/)
})

test("control options cannot override positional props or execute unknown getters", () => {
  let getterCalls = 0
  const sliderOptions = { value: { value: 99 }, min: 0, max: 1 }
  Object.defineProperty(sliderOptions, "unknown", {
    enumerable: true,
    get() {
      getterCalls += 1
      throw new Error("unknown Slider options must not be read")
    },
  })
  const sliderGraph = Slider(Binding(State(0.25)), sliderOptions)
  sliderOptions.min = -10
  sliderOptions.max = 10
  const slider = renderToStaticMarkup(render(sliderGraph))
  assert.match(slider, /type="range"/)
  assert.match(slider, /value="0.25"/)
  assert.match(slider, /min="0"/)
  assert.match(slider, /max="1"/)

  const imageOptions = { source: "/override.png", alt: "Vune" }
  Object.defineProperty(imageOptions, "unknown", {
    enumerable: true,
    get() {
      getterCalls += 1
      throw new Error("unknown Image options must not be read")
    },
  })
  const imageGraph = Image("/original.png", imageOptions)
  imageOptions.alt = "Changed"
  const image = renderToStaticMarkup(render(imageGraph))
  assert.match(image, /src="\/original\.png"/)
  assert.match(image, /alt="Vune"/)
  assert.doesNotMatch(image, /override/)
  assert.equal(getterCalls, 0)

  const sliderAccessor = {}
  Object.defineProperty(sliderAccessor, "min", { get() { getterCalls += 1; throw new Error("min getter must not run") } })
  const imageAccessor = {}
  Object.defineProperty(imageAccessor, "alt", { get() { getterCalls += 1; throw new Error("alt getter must not run") } })
  assert.throws(() => Slider(Binding(State(0.5)), sliderAccessor), /Slider options must be a data-only record/)
  assert.throws(() => Image("/image.png", imageAccessor), /Image options must be a data-only record/)
  assert.equal(getterCalls, 0)
})

test("Image ignores non-string alt values without coercing them", () => {
  let getterCalls = 0
  const hostile = {}
  Object.defineProperty(hostile, "toString", {
    get() {
      getterCalls += 1
      throw new Error("alt values must not be coerced")
    },
  })
  const html = renderToStaticMarkup(render(Image("/image.png", { alt: hostile })))
  assert.doesNotMatch(html, /alt=/)
  assert.equal(getterCalls, 0)
})

test("Image and Link stay graph values until rendered", () => {
  const image = Image("/vune.png", { alt: "Vune" })
  assert.equal(image.kind, "element")
  assert.match(renderToStaticMarkup(render(Link("Docs", "/docs"))), /href="\/docs".*Docs/)
})

test("@vune-ui/react controls are compatibility aliases of core controls", () => {
  assert.equal(ReactImage, Image)
  assert.equal(ReactToggle, Toggle)
})
