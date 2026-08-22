import assert from "node:assert/strict"
import test from "node:test"
import {
  Action,
  Binding,
  Button as CoreButton,
  Element as CoreElement,
  ForEach,
  GeometryReader,
  SafeArea,
  ScrollView,
  State,
  Text as CoreText,
  VStack as CoreVStack,
  defineBuiltinView,
  createViewIdentityStore,
  defineView,
  edgeInsetsFromCss,
  initializer,
  initializerKinds,
  modifier,
  modifierGraphOf,
  renderViewNode,
  resolveBuilderClosure,
  subscribeState,
  viewElement,
} from "../packages/core/dist/index.js"

const Text = defineBuiltinView(
  "Text",
  [initializer("Text(value)", args => args.length === 1, args => ({ value: args[0] }), [initializerKinds.value()])],
  ({ value }) => viewElement("span", null, [value]),
)

test("@muse/core builds a renderer-independent graph with immutable modifiers", () => {
  const original = Text("Hello")
  const modified = original.font("title").padding(12)
  assert.notEqual(original, modified)
  assert.deepEqual(modifierGraphOf(modified).map(item => item.name), ["font", "padding"])
  const rendered = renderViewNode(modified, {
    element(type, props, ...children) { return { type, props, children } },
    fragment(children) { return { fragment: children } },
    modifier(content, modifier) { return { modifier: modifier.name, content } },
    value(value) { return value },
  })
  assert.equal(rendered.modifier, "padding")
  assert.equal(rendered.content.modifier, "font")
  assert.equal(modifier(original, "test", 1).modifier.name, "test")
})

test("@muse/core state and Binding stay independent from a renderer", () => {
  const state = State(1)
  const binding = Binding(state)
  let notifications = 0
  const unsubscribe = subscribeState(state, () => { notifications += 1 })
  binding.value = 2
  assert.equal(state.value, 2)
  assert.equal(notifications, 1)
  Action(state.value += 1)()
  assert.equal(state.value, 3)
  unsubscribe()
})

test("@muse/core keeps View identity storage renderer-independent", () => {
  const store = createViewIdentityStore()
  const identity = {}
  let creations = 0
  assert.equal(store.getOrCreate(identity, () => ++creations), 1)
  assert.equal(store.getOrCreate(identity, () => ++creations), 1)
  store.delete(identity)
  assert.equal(store.getOrCreate(identity, () => ++creations), 2)
})

test("@muse/core owns built-in and custom View graphs without a renderer", () => {
  const card = defineView("Card", {
    initializers: [initializer(
      "Card(@ViewBuilder content)",
      args => args.length === 1 && typeof args[0] === "function",
      args => ({ content: resolveBuilderClosure(args[0]) }),
      [initializerKinds.viewBuilder(true, "content")],
    )],
    body: ({ content }) => CoreVStack(() => content),
  })
  const action = () => undefined
  const button = CoreButton("Save", action)
  const value = card(() => [CoreElement("section", { class: "card", "aria-label": "Card" }, CoreText("Hello")), button])
  assert.equal(Object.isFrozen(value), true)
  assert.equal(CoreText("Hello").kind, "element")
  assert.equal(CoreVStack(() => [CoreText("A"), CoreText("B")]).kind, "element")
  const graph = renderViewNode(value, {
    element(type, props, ...children) { return { type, props, children } },
    fragment(children) { return { fragment: children } },
    value(value) { return value },
    modifier(content) { return content },
  })
  assert.equal(graph.type, "div")
  assert.equal(graph.children[0].type, "section")
  assert.equal(graph.children[0].props.class, "card")
})

test("@muse/core gives ForEach children stable identity keys", () => {
  const value = ForEach([{ id: "a", label: "A" }, { id: "b", label: "B" }], item => CoreText(item.label))
  assert.deepEqual(modifierGraphOf(value.children[0]).map(item => item.arguments), [["a:0"]])
  assert.deepEqual(modifierGraphOf(value.children[1]).map(item => item.arguments), [["b:0"]])
})

test("@muse/core exposes renderer-independent scroll and safe-area semantics", () => {
  const scroll = ScrollView("both", () => [CoreText("Scrollable")])
  const safe = SafeArea(["top", "bottom"], () => [scroll])
  assert.equal(safe.kind, "element")
  assert.equal(safe.props["data-muse"], "SafeArea")
  assert.deepEqual(safe.props.style, {
    paddingTop: "env(safe-area-inset-top)",
    paddingRight: undefined,
    paddingBottom: "env(safe-area-inset-bottom)",
    paddingLeft: undefined,
    boxSizing: "border-box",
  })
  assert.equal(safe.children[0].props["data-muse"], "ScrollView")
})

test("@muse/core falls back to a deterministic zero GeometryProxy without a renderer", () => {
  const value = GeometryReader(geometry => CoreText(`${geometry.size.width}x${geometry.size.height}`))
  const rendered = renderViewNode(value, {
    element(type, props, ...children) { return { type, props, children } },
    fragment(children) { return { fragment: children } },
    value(value) { return value },
    modifier(content) { return content },
  })
  assert.equal(rendered.type, "span")
  assert.equal(rendered.children[0], "0x0")
})

test("@muse/core normalizes measured CSS safe-area values", () => {
  assert.deepEqual(edgeInsetsFromCss({ top: "12px", right: "8.5px", bottom: "env(safe-area-inset-bottom)", left: 4 }), {
    top: 12,
    right: 8.5,
    bottom: 0,
    left: 4,
  })
})

test("@muse/core applies declared generic View constraints during initializer resolution", () => {
  const GenericCard = defineView("GenericCard", {
    genericParameters: "Content: View",
    initializers: [initializer(
      "GenericCard(content)",
      args => args.length === 1,
      args => ({ content: args[0] }),
      [initializerKinds.value(true, "content", undefined, "Content")],
    )],
    body: ({ content }) => content,
  })
  assert.doesNotThrow(() => GenericCard(CoreText("View content")))
  assert.throws(() => GenericCard("not a View"), /No matching initializer for GenericCard/)
})

test("@muse/core resolves declared union value types without overload-order bias", () => {
  assert.doesNotThrow(() => CoreText(42))
  assert.doesNotThrow(() => CoreButton(42, () => undefined))
})

test("@muse/core applies Content: View constraints to built-in stack builders", () => {
  assert.doesNotThrow(() => CoreVStack(() => [CoreText("valid")]))
  assert.throws(() => CoreVStack(() => ["not a View"]), /No matching initializer for VStack/)
})
