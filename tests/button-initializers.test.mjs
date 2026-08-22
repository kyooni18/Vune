import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Button, Text, VStack, defineView, initializer, initializerKinds, namedArguments, render, resolveBuilderClosure, resolveInitializer } from "../packages/react/dist/index.js"

test("Button exposes exactly the two canonical initializer forms", () => {
  const calls = []
  const forms = [
    Button("Save", () => { calls.push(2) }),
    Button(namedArguments({ action: () => { calls.push(3) }, label: () => [Text("Save")] })),
  ]
  for (const button of forms) {
    const element = render(button)
    const html = renderToStaticMarkup(element)
    assert.match(html, /<button/)
    element.props.onClick()
  }
  assert.deepEqual(calls, [2, 3])
  assert.deepEqual(Button.viewType.initializers.map(initializer => initializer.signature), [
    "Button(_ title: string | number, @Action action)",
    "Button(@Action action, @ViewBuilder label)",
  ])
  assert.equal(resolveInitializer(Button, ["Save", () => undefined]).initializer.signature, "Button(_ title: string | number, @Action action)")
  assert.equal(resolveInitializer(Button, [namedArguments({ action: () => undefined, label: () => Text("Save") })]).initializer.signature, "Button(@Action action, @ViewBuilder label)")
})

test("Button rejects legacy closure ordering and unlabeled custom labels", () => {
  const action = () => undefined
  const label = () => [Text("Save")]
  for (const args of [[action], [action, label], [label, action], [namedArguments({ label, action })]]) {
    assert.throws(() => Button(...args), error => error.name === "MuseInitializerError" || error.name === "MuseInitializerAmbiguityError")
  }
  assert.throws(() => resolveInitializer(Button, [namedArguments({ label, action })]), /No matching initializer/)
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
    body: props => Button(namedArguments({ action: props.action, label: () => [Text(props.title), ...props.label] })),
  })
  const action = () => undefined
  const label = () => Text("Body")
  const afterPositional = resolveInitializer(MixedCard, ["Title", action, label])
  assert.deepEqual(afterPositional.args.slice(0, 1), ["Title"])
  assert.equal(afterPositional.args[1](), undefined)
  assert.match(renderToStaticMarkup(render(MixedCard("Title", action, label))), /Title.*Body/)
  assert.throws(() => resolveInitializer(MixedCard, [namedArguments({ label, action }), "Title"]), /No matching initializer/)
})

test("initializer ties are an error and do not use declaration order as a fallback", () => {
  const make = (name, initializers) => defineView(name, {
    initializers,
    body: ({ value }) => Text(value),
  })
  const first = initializer(
    "Ambiguous(value: string)",
    args => args.length === 1 && typeof args[0] === "string",
    args => ({ value: args[0] }),
    [initializerKinds.value(true, "value", undefined, "string")],
  )
  const second = initializer(
    "Ambiguous(value: string) [duplicate]",
    args => args.length === 1 && typeof args[0] === "string",
    args => ({ value: args[0] }),
    [initializerKinds.value(true, "value", undefined, "string")],
  )
  const forward = make("Ambiguous", [first, second])
  const reverse = make("AmbiguousReverse", [second, first])
  for (const View of [forward, reverse]) {
    assert.throws(() => View("value"), error => {
      assert.equal(error.name, "MuseInitializerAmbiguityError")
      assert.match(error.message, /Ambiguous initializer for/)
      assert.match(error.message, /Candidates:/)
      return true
    })
  }
})
