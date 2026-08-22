import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Button, Text, VStack, namedArguments, overloadClosure, render, resolveInitializer } from "../packages/react/dist/index.js"

test("Button selects every declaration-defined initializer form", () => {
  const calls = []
  const forms = [
    Button(overloadClosure(() => [Text("Save")], () => { calls.push(1) })),
    Button("Save", () => { calls.push(2) }),
    Button(namedArguments({ label: () => [Text("Save")], action: () => { calls.push(3) } })),
    Button(namedArguments({ action: () => { calls.push(4) } }), () => [Text("Save")]),
  ]
  for (const button of forms) {
    const element = render(button)
    const html = renderToStaticMarkup(element)
    assert.match(html, /<button/)
    element.props.onClick()
  }
  assert.deepEqual(calls, [1, 2, 3, 4])
  assert.match(resolveInitializer(Button, [namedArguments({ action: () => undefined }), () => Text("Save")]).initializer.signature, /@ViewBuilder label/)
})

test("custom views and ViewBuilder composition use the same graph boundary", () => {
  const html = renderToStaticMarkup(render(VStack(() => [Text("Header"), Text("Body")])) )
  assert.match(html, /Header/)
  assert.match(html, /Body/)
})
