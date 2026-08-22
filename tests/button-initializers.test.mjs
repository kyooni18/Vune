import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Button, Text, VStack, defineView, initializer, initializerKinds, namedArguments, overloadClosure, render, resolveBuilderClosure, resolveInitializer } from "../packages/react/dist/index.js"

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

test("initializer metadata maps mixed positional, labeled, and trailing closures independent of carrier position", () => {
  const MixedCard = defineView("MixedCard", {
    initializers: [initializer(
      "MixedCard(_ title: string, @Action action, @ViewBuilder label)",
      args => args.length === 3 && typeof args[0] === "string" && typeof args[1] === "function" && typeof args[2] === "function",
      args => ({ title: args[0], action: args[1], label: resolveBuilderClosure(args[2]) }),
      [
        initializerKinds.value(true, undefined, undefined, "string"),
        initializerKinds.action(true, "action"),
        initializerKinds.viewBuilder(true, "label"),
      ],
    )],
    body: props => Button(props.action, () => [Text(props.title), ...props.label]),
  })
  const action = () => undefined
  const label = () => Text("Body")
  const afterPositional = resolveInitializer(MixedCard, ["Title", namedArguments({ action }), label])
  const beforePositional = resolveInitializer(MixedCard, [namedArguments({ label, action }), "Title"])
  assert.deepEqual(afterPositional.args.slice(0, 1), ["Title"])
  assert.equal(afterPositional.args[1](), undefined)
  assert.equal(beforePositional.args[0], "Title")
  assert.match(renderToStaticMarkup(render(MixedCard("Title", namedArguments({ action }), label))), /Title.*Body/)
  assert.match(renderToStaticMarkup(render(MixedCard(namedArguments({ label, action }), "Title"))), /Title.*Body/)
})
