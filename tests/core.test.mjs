import assert from "node:assert/strict"
import test from "node:test"
import {
  Action,
  Binding,
  BindingValue,
  Button as CoreButton,
  Element as CoreElement,
  ForEach,
  ForeignComponent,
  GeometryReader,
  SafeArea,
  ScrollView,
  State,
  Text as CoreText,
  VStack as CoreVStack,
  ViewBuilder,
  defineBuiltinView,
  createViewIdentityStore,
  defineView,
  edgeInsetsFromCss,
  initializer,
  initializerKinds,
  isForeignComponent,
  isBinding,
  LazyGrid,
  LazyHStack,
  LazyVStack,
  modifier,
  modifierGraphOf,
  modifiedContent,
  namedArguments,
  renderViewNode,
  resolveBuilderClosure,
  resolveSemanticInitializer,
  subscribeState,
  viewElement,
} from "../packages/core/dist/index.js"

const Text = defineBuiltinView(
  "Text",
  [initializer("Text(value)", args => args.length === 1, args => ({ value: args[0] }), [initializerKinds.value()])],
  ({ value }) => viewElement("span", null, [value]),
)

test("@vune-ui/core builds a renderer-independent graph with immutable modifiers", () => {
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
  assert.equal(Object.prototype.hasOwnProperty.call(original, "padding"), false)
  assert.equal(modified.modifiers.length, 2)
  assert.equal(modified.content.kind, "element")
  const batched = modifiedContent(original, [
    { name: "font", arguments: ["title"] },
    { name: "padding", arguments: [12] },
  ])
  assert.deepEqual(modifierGraphOf(batched).map(item => item.name), ["font", "padding"])
})

test("@vune-ui/core state and Binding stay independent from a renderer", () => {
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

test("BindingValue converts StateRef to a real writable BindingRef", () => {
  const state = State("before")
  const binding = BindingValue(state)
  assert.equal(isBinding(binding), true)
  binding.value = "after"
  assert.equal(state.value, "after")
  assert.equal(BindingValue(binding), binding)
})

test("State and Binding preserve derived, nested, and writable-lens semantics", () => {
  const state = State({ nested: { count: 1 } })
  const binding = BindingValue(state)
  binding.value.nested.count = 2
  assert.equal(state.value.nested.count, 2)

  const base = State(3)
  const derived = Binding(() => base.value * 2, value => { base.value = value / 2 })
  assert.equal(BindingValue(derived), derived)
  assert.equal(derived.value, 6)
  derived.value = 10
  assert.equal(base.value, 5)
})

test("@vune-ui/core keeps View identity storage renderer-independent", () => {
  const store = createViewIdentityStore()
  const identity = {}
  let creations = 0
  assert.equal(store.getOrCreate(identity, () => ++creations), 1)
  assert.equal(store.getOrCreate(identity, () => ++creations), 1)
  store.delete(identity)
  assert.equal(store.getOrCreate(identity, () => ++creations), 2)
})

test("@vune-ui/core makes View type changes explicit remount boundaries", () => {
  const First = defineView("FirstBranch", { initializers: [initializer("FirstBranch()", args => args.length === 0)], body: () => CoreText("first") })
  const Second = defineView("SecondBranch", { initializers: [initializer("SecondBranch()", args => args.length === 0)], body: () => CoreText("second") })
  const identities = []
  const renderer = {
    element(type, props, ...children) { return { type, props, children } },
    fragment(children) { return { children } },
    value(value) { return value },
    modifier(content) { return content },
    view(_node, _render, identity) { identities.push(identity); return identity },
  }
  renderViewNode(First(), renderer)
  renderViewNode(First(), renderer)
  renderViewNode(Second(), renderer)
  renderViewNode(First().keyed("row"), renderer)
  assert.deepEqual(identities[0], identities[1])
  assert.notDeepEqual(identities[0], identities[2])
  assert.match(identities[0].join("/"), /view\/FirstBranch$/)
  assert.match(identities[3].join("/"), /key\/row\/view-type\/host:\d+\/view\/FirstBranch$/)

  const SameNameA = defineView("SameName", { name: "SameName", initializers: [initializer("SameName()", args => args.length === 0)], body: () => CoreText("a") })
  const SameNameB = defineView("SameName", { name: "SameName", initializers: [initializer("SameName()", args => args.length === 0)], body: () => CoreText("b") })
  renderViewNode(SameNameA(), renderer)
  renderViewNode(SameNameB(), renderer)
  assert.notDeepEqual(identities.at(-2), identities.at(-1))
})

test("@vune-ui/core owns built-in and custom View graphs without a renderer", () => {
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

test("@vune-ui/core represents foreign components as explicit graph descriptors", () => {
  const reference = { current: null }
  const component = function ProfileCard() { return null }
  const value = ForeignComponent(component, {
    props: { label: "Vune" },
    events: { onSave: () => undefined },
    slots: { header: () => CoreText("Header") },
    ref: reference,
    key: "profile",
    adapter: "vue",
    schema: { props: { label: "string" }, events: { onSave: "() => void" }, slots: { header: "View" } },
  }, CoreText("Body"))
  assert.equal(value.kind, "element")
  assert.equal(isForeignComponent(value.type), true)
  assert.equal(value.type.component, component)
  assert.deepEqual(value.type.props, { label: "Vune" })
  assert.deepEqual(Object.keys(value.type.events), ["onSave"])
  assert.equal(value.type.key, "profile")
  assert.equal(value.type.adapter, "vue")
  assert.deepEqual(value.type.schema, { props: { label: "string" }, events: { onSave: "() => void" }, slots: { header: "View" } })
  assert.equal(value.props.ref, reference)
})

test("@vune-ui/core normalizes boolean leaves and rejects arbitrary object leaves before renderers", () => {
  const values = []
  const renderer = {
    element(type, props, ...children) { return { type, props, children } },
    fragment(children) { return children },
    value(value) { values.push(value); return value },
    modifier(content) { return content },
  }
  assert.equal(renderViewNode(true, renderer), null)
  assert.equal(renderViewNode(false, renderer), null)
  assert.deepEqual(values, [null, null])
  assert.throws(
    () => renderViewNode({ arbitrary: true }, renderer),
    /renderable primitives or View nodes/,
  )
})

test("@vune-ui/core gives ForEach children stable identity keys", () => {
  const value = ForEach([{ id: "a", label: "A" }, { id: "b", label: "B" }], item => CoreText(item.label))
  assert.deepEqual(modifierGraphOf(value.children[0]).map(item => item.arguments), [["string:1:a|occurrence:0|child:0"]])
  assert.deepEqual(modifierGraphOf(value.children[1]).map(item => item.arguments), [["string:1:b|occurrence:0|child:0"]])
})

test("ForEach accepts an explicit deterministic key selector and preserves it across reorder", () => {
  const renderItems = items => ForEach(items, item => item.id, item => CoreText(item.label))
  const first = renderItems([{ id: "a", label: "A" }, { id: "b", label: "B" }])
  const reordered = renderItems([{ id: "b", label: "B" }, { id: "a", label: "A" }])
  assert.deepEqual(first.children.map(child => modifierGraphOf(child)[0].arguments), [["string:1:a|occurrence:0|child:0"], ["string:1:b|occurrence:0|child:0"]])
  assert.deepEqual(reordered.children.map(child => modifierGraphOf(child)[0].arguments), [["string:1:b|occurrence:0|child:0"], ["string:1:a|occurrence:0|child:0"]])

  const named = ForEach(
    [{ id: "named" }],
    namedArguments({ key: item => item.id }),
    item => CoreText(item.id),
  )
  assert.deepEqual(modifierGraphOf(named.children[0])[0].arguments, ["string:5:named|occurrence:0|child:0"])
})

test("ForEach preserves key type and cannot collide with its duplicate-key encoding", () => {
  const typed = ForEach([1, "1"], item => item, item => CoreText(String(item)))
  const typedKeys = typed.children.map(child => modifierGraphOf(child)[0].arguments[0])
  assert.notEqual(typedKeys[0], typedKeys[1])

  const values = ["a", "a", "a:duplicate:1"]
  const duplicates = ForEach(values, item => item, item => CoreText(item))
  const duplicateKeys = duplicates.children.map(child => modifierGraphOf(child)[0].arguments[0])
  assert.equal(new Set(duplicateKeys).size, duplicateKeys.length)
})

test("ForEach warns for inferred object identity and duplicate keys without process-local IDs", () => {
  const warnings = []
  const originalWarn = console.warn
  console.warn = message => warnings.push(String(message))
  try {
    const first = ForEach([{ label: "same" }, { label: "same" }], item => CoreText(item.label))
    const second = ForEach([{ label: "same" }], item => CoreText(item.label))
    const firstKey = modifierGraphOf(first.children[0])[0].arguments[0]
    const secondKey = modifierGraphOf(second.children[0])[0].arguments[0]
    assert.equal(firstKey, secondKey)
    assert.match(String(firstKey), /object:/)
    assert.ok(warnings.some(message => message.includes("no id/key")))
    assert.ok(warnings.some(message => message.includes("duplicate key")))
  } finally {
    console.warn = originalWarn
  }
})

test("lazy containers are distinct graph constructors with browser lazy metadata", () => {
  assert.notEqual(LazyVStack, CoreVStack)
  assert.notEqual(LazyHStack, CoreVStack)
  assert.equal(LazyVStack.viewType.name, "LazyVStack")
  assert.equal(LazyGrid.viewType.name, "LazyGrid")
  const renderer = {
    element(type, props, ...children) { return { type, props, children } },
    fragment(children) { return { children } },
    value(value) { return value },
    modifier(content) { return content },
  }
  const rendered = renderViewNode(LazyVStack({ estimatedItemSize: 56, overscan: 3 }, CoreText("A")), renderer)
  assert.equal(rendered.props["data-vune-lazy"], "vertical")
  assert.equal(rendered.props["data-vune-lazy-overscan"], 3)
})

test("@vune-ui/core exposes renderer-independent scroll and safe-area semantics", () => {
  const scroll = ScrollView("both", () => [CoreText("Scrollable")])
  const safe = SafeArea(["top", "bottom"], () => [scroll])
  assert.equal(safe.kind, "element")
  assert.equal(safe.props["data-vune"], "SafeArea")
  assert.deepEqual(safe.props.style, {
    paddingTop: "env(safe-area-inset-top)",
    paddingRight: undefined,
    paddingBottom: "env(safe-area-inset-bottom)",
    paddingLeft: undefined,
    boxSizing: "border-box",
  })
  assert.equal(safe.children[0].props["data-vune"], "ScrollView")
})

test("@vune-ui/core falls back to a deterministic zero GeometryProxy without a renderer", () => {
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

test("@vune-ui/core normalizes measured CSS safe-area values", () => {
  assert.deepEqual(edgeInsetsFromCss({ top: "12px", right: "8.5px", bottom: "env(safe-area-inset-bottom)", left: 4 }), {
    top: 12,
    right: 8.5,
    bottom: 0,
    left: 4,
  })
})

test("@vune-ui/core applies declared generic View constraints during initializer resolution", () => {
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

test("@vune-ui/core resolves declared union value types without overload-order bias", () => {
  assert.doesNotThrow(() => CoreText(42))
  assert.doesNotThrow(() => CoreButton(42, () => undefined))
})

test("@vune-ui/core routes a trailing closure past omitted optional parameters", () => {
  const result = resolveSemanticInitializer([
    {
      kind: "initializer",
      index: 0,
      signature: "OptionalBuilder(options?, @ViewBuilder content)",
      parameters: [
        { kind: "value", label: "options", required: false, type: "object" },
        { kind: "viewBuilder", label: "content", required: true, trailing: true, type: "function" },
      ],
    },
  ], [{ type: "function", trailing: true }])
  assert.equal(result.ok, true)
  assert.equal(result.ok && result.resolution.arguments[1]?.trailing, true)
})

test("@vune-ui/core applies Content: View constraints to built-in stack builders", () => {
  assert.doesNotThrow(() => CoreVStack(() => [CoreText("valid")]))
  assert.throws(() => CoreVStack(() => ["not a View"]), /No matching initializer for VStack/)
})

test("@vune-ui/core exposes the same View symbol consumed by compiler adapters", () => {
  assert.equal(CoreText.viewType.semanticSymbol.kind, "view")
  assert.equal(CoreText.viewType.semanticSymbol.name, "Text")
  assert.equal(CoreText.viewType.semanticSymbol.initializers[0].parameters[0].type, "string | number")
  assert.deepEqual(ViewBuilder.semanticSymbol.operations, ["buildBlock", "buildOptional", "buildEither", "buildArray"])
})

test("the shared semantic resolver applies labels, roles, types, and ambiguity as one contract", () => {
  const symbols = [
    { kind: "initializer", index: 0, signature: "Probe(value: string)", parameters: [{ kind: "value", label: "value", required: true, type: "string" }] },
    { kind: "initializer", index: 1, signature: "Probe(@Action action)", parameters: [{ kind: "action", label: "action", required: true, type: "() => void" }] },
  ]
  const stringResult = resolveSemanticInitializer(symbols, [{ label: "value", type: "string" }])
  assert.equal(stringResult.ok, true)
  assert.equal(stringResult.ok && stringResult.resolution.initializerIndex, 0)
  const actionResult = resolveSemanticInitializer(symbols, [{ label: "action", type: "function", closureRole: "action" }])
  assert.equal(actionResult.ok, true)
  assert.equal(actionResult.ok && actionResult.resolution.initializerIndex, 1)

  const ambiguous = resolveSemanticInitializer([
    symbols[0],
    { ...symbols[0], index: 2, signature: "Probe(value: string) [duplicate]" },
  ], [{ type: "string" }])
  assert.equal(ambiguous.ok, false)
  assert.equal(!ambiguous.ok && ambiguous.failure.kind, "ambiguous")
})
