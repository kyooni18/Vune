import assert from "node:assert/strict"
import test from "node:test"
import {
  Action,
  assertInitializerCall,
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
  classNameOf,
  collectLogicalViewIdentities,
  compiledTemplate,
  closureForKind,
  closureKindOf,
  closureVariantsOf,
  createViewNode,
  defineBuiltinView,
  createViewIdentityStore,
  defineCompiledTemplate,
  defineView,
  edgeInsetsFromCss,
  frameStyle,
  initializer,
  initializerKinds,
  initializersOf,
  isForeignComponent,
  isBinding,
  isViewNode,
  LazyGrid,
  LazyHStack,
  LazyVStack,
  lazyView,
  modifier,
  modifierGraphOf,
  markVuneClosure,
  modifiedContent,
  modifiedContentCompiled,
  namedArguments,
  overloadClosure,
  registerInitializers,
  renderViewNode,
  resolveBuilderClosure,
  resolveBuilderInput,
  resolveInitializer,
  resolveSemanticInitializer,
  subscribeState,
  viewElement,
  vuneClosureKind,
  vuneClosureVariants,
  vuneInitializers,
  vuneView,
  viewFragment,
  viewHost,
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

test("@vune-ui/core trusted compiled paths skip redundant initializer and modifier shape work", () => {
  const CompiledProbe = defineBuiltinView(
    "CompiledProbe",
    [initializer("CompiledProbe(value)", args => args.length === 1 && typeof args[0] === "string", args => ({ value: args[0] }), [initializerKinds.value(true, undefined, undefined, "string")])],
    ({ value }) => viewElement("span", null, [value]),
  )

  assert.throws(() => CompiledProbe.viewType.createNodeSpecialized(0, [42]), /No matching initializer/)
  const compiled = CompiledProbe.viewType.createNodeCompiled(0, [42])
  assert.equal(compiled.kind, "element")
  assert.equal(compiled.children[0], 42)

  const children = [CoreText("A"), CoreText("B")]
  assert.deepEqual(resolveBuilderInput(children), children)
  assert.deepEqual(resolveBuilderInput(() => children), children)

  const style = { opacity: 0.5 }
  const modified = modifiedContentCompiled(CoreText("value"), [["style", [style]]])
  style.opacity = 1
  assert.deepEqual(modifierGraphOf(modified)[0].arguments[0], { opacity: 0.5 })
})

test("@vune-ui/core compiled templates preserve generic rendering, native fast paths, immutability, and View identity", () => {
  const root = {
    kind: "element",
    type: "div",
    props: { className: "card", style: { display: "flex" } },
    children: [
      { kind: "element", type: "span", props: null, children: ["Static"] },
      { kind: "element", type: "span", props: null, children: [{ kind: "slot", index: 0, identity: ["element", 1, "element", 0] }] },
    ],
  }
  const template = defineCompiledTemplate(root, 1)
  root.props.className = "changed"
  root.props.style.display = "block"
  const value = compiledTemplate(template, ["Dynamic"])

  assert.equal(Object.isFrozen(template), true)
  assert.equal(Object.isFrozen(template.root), true)
  assert.equal(Object.isFrozen(template.root.children), true)
  assert.deepEqual(template.root.props, { className: "card", style: { display: "flex" } })
  assert.equal(Object.isFrozen(value.slots), true)
  assert.deepEqual(template.slotIdentities, [["element", 1, "element", 0]])
  assert.throws(() => compiledTemplate(template, []), /expected 1 slots/i)
  assert.throws(() => defineCompiledTemplate({
    kind: "fragment",
    children: [
      { kind: "slot", index: 0, identity: ["fragment", 0] },
      { kind: "slot", index: 0, identity: ["fragment", 1] },
    ],
  }, 1), /appears more than once/)
  assert.throws(() => defineCompiledTemplate({ kind: "fragment", children: [] }, 1), /declared but never referenced/)

  const generic = renderViewNode(value, {
    element(type, props, ...children) { return { type, props, children } },
    fragment(children) { return { fragment: children } },
    modifier(content) { return content },
    value(value) { return value },
  })
  assert.equal(generic.type, "div")
  assert.equal(generic.children[0].children[0], "Static")
  assert.equal(generic.children[1].children[0], "Dynamic")

  let staticElementCalls = 0
  const native = renderViewNode(value, {
    element() { staticElementCalls += 1; throw new Error("native template path must bypass generic host traversal") },
    fragment(children) { return children },
    modifier(content) { return content },
    value(value) { return value },
    template(node, renderSlot, identity) {
      assert.equal(node.template, template)
      return { identity, slot: renderSlot(0) }
    },
  })
  assert.equal(staticElementCalls, 0)
  assert.deepEqual(native.identity, ["root"])
  assert.equal(native.slot, "Dynamic")

  const Child = defineView("TemplateIdentityChild", {
    initializers: [initializer("TemplateIdentityChild()", args => args.length === 0)],
    body: () => CoreText("child"),
  })
  const normal = viewElement("div", null, [Child()])
  const identityTemplate = compiledTemplate(defineCompiledTemplate({
    kind: "element",
    type: "div",
    props: null,
    children: [{ kind: "slot", index: 0, identity: ["element", 0] }],
  }, 1), [Child()])
  assert.deepEqual(collectLogicalViewIdentities(identityTemplate), collectLogicalViewIdentities(normal))
})

test("modifier graphs snapshot mutable style, frame, class, and props inputs", () => {
  const style = { color: "red" }
  const frame = { width: 120, alignment: "center" }
  const classes = ["card", ["active"]]
  const props = { title: "before", style: { backgroundColor: "blue" } }
  const graph = Text("Snapshot").style(style).frame(frame).className(classes).withProps(props)
  style.color = "green"
  frame.width = 240
  classes[0] = "changed"
  classes[1][0] = "changed-nested"
  props.title = "after"
  props.style.backgroundColor = "black"

  const [styleModifier, frameModifier, classModifier, propsModifier] = modifierGraphOf(graph)
  assert.deepEqual(styleModifier.arguments[0], { color: "red" })
  assert.deepEqual(frameModifier.arguments[0], { width: 120, alignment: "center" })
  assert.deepEqual(classModifier.arguments[0], ["card", ["active"]])
  assert.deepEqual(propsModifier.arguments[0], { title: "before", style: { backgroundColor: "blue" } })
  assert.ok([styleModifier, frameModifier, classModifier, propsModifier].every(item => Object.isFrozen(item.arguments[0])))

  const compatibilityProps = { title: "compat-before", style: { color: "purple" } }
  const compatibilityGraph = modifiedContent(Text("Compatibility"), {
    name: "compatibility",
    arguments: [],
    props: compatibilityProps,
  })
  compatibilityProps.title = "compat-after"
  compatibilityProps.style.color = "orange"
  const compatibilityModifier = modifierGraphOf(compatibilityGraph)[0]
  assert.deepEqual(compatibilityModifier.props, { title: "compat-before", style: { color: "purple" } })
  assert.equal(Object.isFrozen(compatibilityModifier.props), true)
})

test("modifier graphs snapshot arrays and records without executing accessors", () => {
  let getterCalls = 0
  const arguments_ = []
  Object.defineProperty(arguments_, "0", {
    configurable: true,
    enumerable: true,
    get() {
      getterCalls += 1
      return 12
    },
  })
  arguments_.length = 1

  const direct = modifiedContent(Text("Arguments"), { name: "padding", arguments: arguments_ })
  assert.deepEqual(modifierGraphOf(direct)[0].arguments, [undefined])

  const batch = []
  Object.defineProperty(batch, "0", {
    configurable: true,
    enumerable: true,
    get() {
      getterCalls += 1
      return { name: "padding", arguments: [12] }
    },
  })
  batch.length = 1
  const omittedBatch = modifiedContent(Text("Batch"), batch)
  assert.deepEqual(modifierGraphOf(omittedBatch), [])

  const hostile = { arguments: [] }
  Object.defineProperty(hostile, "name", {
    enumerable: true,
    get() {
      getterCalls += 1
      return "padding"
    },
  })
  assert.deepEqual(modifierGraphOf(modifiedContent(Text("Record"), [hostile])), [])
  assert.equal(getterCalls, 0)
})

test("element graphs snapshot mutable native props and styles", () => {
  const props = { title: "before", style: { color: "red" } }
  const graph = CoreElement("div", props, CoreText("Snapshot"))
  props.title = "after"
  props.style.color = "blue"

  assert.deepEqual(graph.props, { title: "before", style: { color: "red" } })
  assert.equal(Object.isFrozen(graph.props), true)
  assert.equal(Object.isFrozen(graph.props.style), true)
})

test("element and modifier style snapshots keep only inert CSS values", () => {
  let getterCalls = 0
  let coercionCalls = 0
  const style = {
    color: { toString() { coercionCalls += 1; return "red" } },
    display: "grid",
    opacity: Number.NaN,
    zIndex: 2,
    optional: undefined,
  }
  Object.defineProperty(style, "background", {
    enumerable: true,
    get() {
      getterCalls += 1
      return "blue"
    },
  })

  const elementStyle = CoreElement("div", { style }).props.style
  const modifierStyle = modifierGraphOf(CoreText("Style").style(style))[0].arguments[0]

  for (const snapshot of [elementStyle, modifierStyle]) {
    assert.deepEqual(snapshot, { display: "grid", zIndex: 2, optional: undefined })
    assert.equal(Object.isFrozen(snapshot), true)
  }
  assert.equal(getterCalls, 0)
  assert.equal(coercionCalls, 0)
})

test("native element props omit coercible objects while custom elements preserve them", () => {
  let coercionCalls = 0
  const value = { toString() { coercionCalls += 1; return "coerced" } }
  const reference = { current: null }
  const onclick = () => undefined
  const native = CoreElement("div", {
    title: value,
    count: Number.POSITIVE_INFINITY,
    "data-safe": true,
    onclick,
    ref: reference,
    style: { display: "block" },
  })
  const custom = CoreElement("vune-card", { payload: value })

  assert.deepEqual(native.props, {
    "data-safe": true,
    onclick,
    ref: reference,
    style: { display: "block" },
  })
  assert.strictEqual(custom.props.payload, value)
  assert.equal(coercionCalls, 0)
})

test("element, fragment, and lazy graph children arrays are immutable snapshots", () => {
  const source = [CoreText("A")]
  const element = viewElement("div", null, source)
  const fragment = viewFragment(source)
  const lazy = LazyVStack(...source)
  source.push(CoreText("B"))

  for (const graph of [element, fragment, lazy]) {
    assert.equal(graph.children.length, 1)
    assert.equal(Object.isFrozen(graph.children), true)
    assert.throws(() => graph.children.push(CoreText("C")), TypeError)
  }
})

test("graph children and ViewBuilder arrays omit indexed accessors", () => {
  let getterCalls = 0
  const source = [CoreText("A")]
  Object.defineProperty(source, "1", {
    configurable: true,
    enumerable: true,
    get() {
      getterCalls += 1
      throw new Error("child getters must not run")
    },
  })
  source.length = 2
  source.push(CoreText("B"))

  const element = viewElement("div", null, source)
  const fragment = viewFragment(source)
  const lazy = lazyView("SafeLazy", "vertical", {}, source)
  for (const graph of [element, fragment, lazy]) {
    assert.equal(graph.children.length, 3)
    assert.equal(graph.children[1], undefined)
    assert.equal(Object.isFrozen(graph.children), true)
  }
  const built = ViewBuilder.buildArray(source)
  assert.deepEqual(built.map(child => child.children?.[0]), ["A", "B"])
  const rendered = renderViewNode(source, {
    element(type, _props, ...children) { return { type, children } },
    fragment(children) { return children },
    value(value) { return value },
    modifier(content) { return content },
  })
  assert.equal(rendered.length, 3)
  assert.equal(rendered[1], null)
  assert.deepEqual(rendered.filter(Boolean).map(child => child.children[0]), ["A", "B"])
  assert.equal(getterCalls, 0)
})

test("lazy and host graph nodes snapshot mutable props", () => {
  const lazyProps = { title: "lazy-before", style: { color: "red" } }
  const hostProps = { title: "host-before", style: { color: "blue" } }
  const lazy = lazyView("SnapshotLazy", "vertical", lazyProps)
  const host = viewHost("SnapshotHost", {}, hostProps, props => CoreText(String(props.title)))
  lazyProps.title = "lazy-after"
  lazyProps.style.color = "black"
  hostProps.title = "host-after"
  hostProps.style.color = "black"

  assert.deepEqual(lazy.props, { title: "lazy-before", style: { color: "red" } })
  assert.deepEqual(host.props, { title: "host-before", style: { color: "blue" } })
  assert.equal(Object.isFrozen(lazy.props), true)
  assert.equal(Object.isFrozen(lazy.props.style), true)
  assert.equal(Object.isFrozen(host.props), true)
  assert.equal(Object.isFrozen(host.props.style), true)
})

test("view host state factories return frozen data-only records", () => {
  let getterCalls = 0
  const stateValue = { safe: "state" }
  Object.defineProperty(stateValue, "hostile", {
    enumerable: true,
    get() {
      getterCalls += 1
      throw new Error("state getters must not run")
    },
  })
  const host = viewHost("StateSnapshot", {}, {}, props => CoreText(String(props.safe)), () => stateValue)
  const state = host.state(host.props)
  stateValue.safe = "changed"
  assert.deepEqual(state, { safe: "state" })
  assert.equal(Object.isFrozen(state), true)
  assert.equal(getterCalls, 0)

  const hostile = new Proxy({}, {
    getPrototypeOf() {
      throw new Error("hostile state prototype")
    },
  })
  const isolated = viewHost("HostileState", {}, {}, () => CoreText("safe"), () => hostile)
  assert.deepEqual(isolated.state(isolated.props), {})
})

test("class values ignore circular branches without losing sibling classes", () => {
  const classes = ["base"]
  classes.push(classes, "active")
  assert.equal(classNameOf(classes), "base active")
  const graph = Text("Circular").className(classes)
  const snapshot = modifierGraphOf(graph)[0].arguments[0]
  assert.equal(classNameOf(snapshot), "base active")
  assert.equal(Object.isFrozen(snapshot), true)
})

test("class values omit array accessors without executing them", () => {
  let getterCalls = 0
  const classes = ["base"]
  Object.defineProperty(classes, "1", {
    configurable: true,
    enumerable: true,
    get() {
      getterCalls += 1
      throw new Error("class getters must not run")
    },
  })
  classes.length = 2
  classes.push("active")

  assert.equal(classNameOf(classes), "base active")
  const snapshot = modifierGraphOf(Text("Safe").className(classes))[0].arguments[0]
  assert.equal(classNameOf(snapshot), "base active")
  assert.deepEqual(snapshot, ["base", "active"])
  assert.equal(getterCalls, 0)
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

test("State preserves reflection-hostile proxies as opaque values", () => {
  const value = new Proxy({}, {
    getPrototypeOf() { throw new Error("prototype unavailable") },
  })
  const state = State(value)
  assert.equal(state.value, value)
  const unsubscribe = subscribeState(state, () => undefined)
  assert.equal(state.value, value)
  unsubscribe()
})

test("State tracks defineProperty and newly defined nested values", () => {
  const state = State({})
  let notifications = 0
  const unsubscribe = subscribeState(state, () => { notifications += 1 })
  Object.defineProperty(state.value, "nested", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: { count: 0 },
  })
  assert.equal(notifications, 1)
  Object.defineProperty(state.value, "nested", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: state.value.nested,
  })
  assert.equal(notifications, 1)
  state.value.nested.count = 1
  assert.equal(notifications, 2)
  unsubscribe()
})

test("State assignments do not read accessor properties before setting", () => {
  let getterCalls = 0
  let setterValue
  const value = {}
  Object.defineProperty(value, "entry", {
    configurable: true,
    enumerable: true,
    get() {
      getterCalls += 1
      throw new Error("setter must not require a getter read")
    },
    set(next) { setterValue = next },
  })
  const state = State(value)
  let notifications = 0
  const unsubscribe = subscribeState(state, () => { notifications += 1 })
  state.value.entry = 42
  assert.equal(getterCalls, 0)
  assert.equal(setterValue, 42)
  assert.equal(notifications, 1)
  unsubscribe()
})

test("State deletion notifies only for own properties", () => {
  const state = State({ own: true })
  let notifications = 0
  const unsubscribe = subscribeState(state, () => { notifications += 1 })
  assert.equal(delete state.value.toString, true)
  assert.equal(notifications, 0)
  assert.equal(delete state.value.own, true)
  assert.equal(notifications, 1)
  unsubscribe()
})

test("State tracks prototype and extensibility changes without losing ownership", () => {
  const state = State({ count: 0 })
  let notifications = 0
  const unsubscribe = subscribeState(state, () => { notifications += 1 })
  const prototype = { inherited: true }

  assert.equal(Object.setPrototypeOf(state.value, prototype), state.value)
  assert.equal(notifications, 1)
  assert.equal(state.value.inherited, true)
  Object.setPrototypeOf(state.value, prototype)
  assert.equal(notifications, 1)

  state.value.count = 1
  assert.equal(notifications, 2)
  Object.preventExtensions(state.value)
  assert.equal(notifications, 3)
  Object.preventExtensions(state.value)
  assert.equal(notifications, 3)
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

test("ForeignComponent snapshots option records without executing getters", () => {
  let getterCalls = 0
  const props = { style: { color: "red" } }
  Object.defineProperty(props, "label", {
    enumerable: true,
    get() {
      getterCalls += 1
      return "Vune"
    },
  })

  const value = ForeignComponent(() => null, { props })
  props.style.color = "blue"
  assert.equal(getterCalls, 0)
  assert.equal(Object.isFrozen(value.type.props), true)
  assert.equal(Object.isFrozen(value.type.props.style), true)
  assert.deepEqual(value.type.props.style, { color: "red" })
  assert.equal(Object.hasOwn(value.type.props, "label"), false)
})

test("ForeignComponent omits top-level option and component-name accessors", () => {
  let getterCalls = 0
  const component = () => null
  Object.defineProperty(component, "name", {
    configurable: true,
    get() {
      getterCalls += 1
      throw new Error("component name getter must not run")
    },
  })
  const options = {}
  for (const key of ["props", "events", "slots", "schema", "name"]) {
    Object.defineProperty(options, key, {
      enumerable: true,
      get() {
        getterCalls += 1
        throw new Error(`ForeignComponent ${key} getter must not run`)
      },
    })
  }
  const value = ForeignComponent(component, options)
  assert.equal(value.type.name, "ForeignComponent")
  assert.deepEqual(value.type.props, {})
  assert.deepEqual(value.type.events, {})
  assert.deepEqual(value.type.slots, {})
  assert.equal(value.type.schema, undefined)
  assert.equal(getterCalls, 0)
})

test("element and modifier snapshots omit accessors before renderers can execute them", () => {
  let getterCalls = 0
  const props = {}
  const style = {}
  const extraProps = {}
  for (const [record, key] of [[props, "title"], [style, "color"], [extraProps, "aria-label"]]) {
    Object.defineProperty(record, key, {
      enumerable: true,
      get() {
        getterCalls += 1
        throw new Error("graph accessors must not reach renderers")
      },
    })
  }
  const graph = CoreElement("div", props, CoreText("Safe")).style(style).withProps(extraProps)
  assert.equal(getterCalls, 0)
  assert.equal(Object.hasOwn(graph.content.props, "title"), false)
  assert.equal(Object.hasOwn(graph.modifiers[0].arguments[0], "color"), false)
  assert.equal(Object.hasOwn(graph.modifiers[1].arguments[0], "aria-label"), false)
})

test("record snapshot failures do not leak hostile proxies to renderers", () => {
  let trapCalls = 0
  const hostile = new Proxy({}, {
    getPrototypeOf() {
      trapCalls += 1
      throw new Error("prototype inspection refused")
    },
    ownKeys() {
      trapCalls += 1
      throw new Error("renderer must not inspect the original proxy")
    },
  })
  const graph = CoreElement("div", hostile, CoreText("Safe"))
  assert.deepEqual(graph.props, {})
  assert.equal(Object.isFrozen(graph.props), true)
  assert.equal(trapCalls, 1)
})

test("revoked proxies do not leak native Array.isArray errors across graph boundaries", () => {
  const revoked = target => {
    const pair = Proxy.revocable(target, {})
    pair.revoke()
    return pair.proxy
  }

  const element = CoreElement("div", revoked({}), CoreText("Safe"))
  assert.deepEqual(element.props, {})
  assert.deepEqual(modifierGraphOf(CoreText("Style").style(revoked({})))[0].arguments[0], {})
  assert.deepEqual(modifierGraphOf(modifiedContent(CoreText("Batch"), revoked([]))), [])
  assert.equal(classNameOf(revoked([])), "")
  assert.throws(
    () => renderViewNode(revoked([]), { fragment: children => children, value: value => value }),
    /View graph leaves must be renderable primitives/,
  )
})

test("ForeignComponent snapshots nested schema records", () => {
  const schema = {
    props: { label: "string" },
    events: { onSave: "() => void" },
    slots: { header: "View" },
  }
  const value = ForeignComponent(() => null, { schema })
  schema.props.label = "number"
  schema.events.onSave = "unknown"
  schema.slots.header = "string"

  assert.deepEqual(value.type.schema, {
    props: { label: "string" },
    events: { onSave: "() => void" },
    slots: { header: "View" },
  })
  assert.equal(Object.isFrozen(value.type.schema), true)
  assert.equal(Object.isFrozen(value.type.schema.props), true)
  assert.equal(Object.isFrozen(value.type.schema.events), true)
  assert.equal(Object.isFrozen(value.type.schema.slots), true)
})

test("@vune-ui/core normalizes boolean leaves and rejects unsupported leaves before renderers", () => {
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
  for (const value of [{ arbitrary: true }, () => undefined, Symbol("unsupported")]) {
    assert.throws(
      () => renderViewNode(value, renderer),
      /renderable primitives or View nodes/,
    )
  }
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

test("ForEach inferred primitive keys cannot collide with lookalike strings", () => {
  const values = [true, "boolean:true", 1n, "bigint:1", null, "object:null", undefined, "undefined:undefined"]
  const renderValues = items => ForEach(items, item => CoreText(String(item)))
  const first = renderValues(values)
  const reordered = renderValues([...values].reverse())
  const firstKeys = new Map(values.map((value, index) => [value, modifierGraphOf(first.children[index])[0].arguments[0]]))
  const reorderedKeys = new Map([...values].reverse().map((value, index) => [value, modifierGraphOf(reordered.children[index])[0].arguments[0]]))
  for (const value of values) assert.equal(firstKeys.get(value), reorderedKeys.get(value))
  assert.equal(new Set(firstKeys.values()).size, values.length)
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

test("ForEach treats shared nested references as deterministic acyclic values", () => {
  const shared = { category: "shared" }
  const firstItem = { label: "A", primary: shared, secondary: shared }
  const secondItem = { label: "B", primary: shared, secondary: shared }
  const renderItems = items => ForEach(items, item => CoreText(item.label))
  const first = renderItems([firstItem, secondItem])
  const reordered = renderItems([secondItem, firstItem])
  const firstKeys = first.children.map(child => modifierGraphOf(child)[0].arguments[0])
  const reorderedKeys = reordered.children.map(child => modifierGraphOf(child)[0].arguments[0])
  assert.equal(firstKeys[0], reorderedKeys[1])
  assert.equal(firstKeys[1], reorderedKeys[0])
  assert.match(String(firstKeys[0]), /object:/)
})

test("ForEach inferred object identity distinguishes signed zero", () => {
  const negative = { value: -0 }
  const positive = { value: 0 }
  const renderItems = items => ForEach(items, item => CoreText(Object.is(item.value, -0) ? "negative" : "positive"))
  const first = renderItems([negative, positive])
  const reordered = renderItems([positive, negative])
  const firstKeys = first.children.map(child => modifierGraphOf(child)[0].arguments[0])
  const reorderedKeys = reordered.children.map(child => modifierGraphOf(child)[0].arguments[0])
  assert.equal(firstKeys[0], reorderedKeys[1])
  assert.equal(firstKeys[1], reorderedKeys[0])
  assert.notEqual(firstKeys[0], firstKeys[1])
})

test("ForEach does not claim deterministic identity for identity-bearing object values", () => {
  const values = [{ value: Symbol("same") }, { value: new Date(0) }]
  const graph = ForEach(values, (_item, index) => CoreText(String(index)))
  const keys = graph.children.map(child => modifierGraphOf(child)[0].arguments[0])
  assert.ok(keys.every(key => String(key).includes("unstable:object:")))
})

test("ForEach identity inference does not execute object getters", () => {
  let getterCalls = 0
  const item = { label: "Safe" }
  Object.defineProperty(item, "id", {
    enumerable: true,
    get() {
      getterCalls += 1
      throw new Error("identity getter must not run")
    },
  })
  const graph = ForEach([item], value => CoreText(value.label))
  assert.equal(getterCalls, 0)
  assert.match(String(modifierGraphOf(graph.children[0])[0].arguments[0]), /unstable:object:/)
})

test("ForEach identity inference does not execute nested array getters", () => {
  let getterCalls = 0
  const item = ["safe"]
  Object.defineProperty(item, "1", {
    enumerable: true,
    get() {
      getterCalls += 1
      throw new Error("nested identity getters must not run")
    },
  })
  item.length = 2
  const graph = ForEach([item], (_value, index) => CoreText(String(index)))
  assert.match(String(modifierGraphOf(graph.children[0])[0].arguments[0]), /unstable:object:/)
  assert.equal(getterCalls, 0)
})

test("ForEach snapshots array indices without executing accessors", () => {
  const items = ["first"]
  const graph = ForEach(items, item => CoreText(item))
  items.push("late")
  assert.equal(graph.children.length, 1)

  let getterCalls = 0
  const hostile = []
  Object.defineProperty(hostile, "0", {
    enumerable: true,
    get() {
      getterCalls += 1
      throw new Error("ForEach item getter must not run")
    },
  })
  hostile.length = 1
  assert.throws(() => ForEach(hostile, item => CoreText(item)), /ForEach items must be a data-only array/)
  assert.equal(getterCalls, 0)
})

test("collection and edge initializers reject revoked arrays without native reflection errors", () => {
  const revoked = () => {
    const pair = Proxy.revocable([], {})
    pair.revoke()
    return pair.proxy
  }
  assert.throws(() => SafeArea(revoked(), () => CoreText("Safe")), /SafeArea edges must be a data-only edge or edge array/)
  assert.throws(() => ForEach(revoked(), item => CoreText(item)), /No matching initializer for ForEach/)
})

test("initializer specialization does not execute array element getters", () => {
  let getterCalls = 0
  const values = []
  Object.defineProperty(values, 0, {
    enumerable: true,
    get() {
      getterCalls += 1
      throw new Error("array getter must not run while caching")
    },
  })
  values.length = 1
  const Probe = defineView("ArraySpecializationProbe", {
    initializers: [initializer(
      "ArraySpecializationProbe(items)",
      args => args.length === 1 && Array.isArray(args[0]),
      args => ({ count: args[0].length }),
      [initializerKinds.value(true, "items", undefined, "array")],
    )],
    body: ({ count }) => CoreText(count),
  })
  const graph = Probe(values)
  assert.equal(graph.props.count, 1)
  assert.equal(getterCalls, 0)
})

test("initializer array element type checks do not execute getters", () => {
  let getterCalls = 0
  const values = []
  Object.defineProperty(values, "0", {
    enumerable: true,
    get() {
      getterCalls += 1
      throw new Error("array type getters must not run")
    },
  })
  values.length = 1
  const Strings = defineView("Strings", {
    initializers: [initializer(
      "Strings(values: string[])",
      args => args.length === 1,
      args => ({ values: args[0] }),
      [initializerKinds.value(true, "values", undefined, "string[]")],
    )],
    body: () => CoreText("strings"),
  })
  assert.throws(() => Strings(values), /No matching initializer/)
  assert.equal(getterCalls, 0)
})

test("isViewNode does not execute arbitrary kind getters", () => {
  let getterCalls = 0
  const value = {}
  Object.defineProperty(value, "kind", {
    enumerable: true,
    get() {
      getterCalls += 1
      throw new Error("kind getter must not run")
    },
  })
  assert.equal(isViewNode(value), false)
  assert.equal(getterCalls, 0)
})

test("isForeignComponent does not execute arbitrary marker getters", () => {
  const foreign = ForeignComponent(() => null)
  const marker = Reflect.ownKeys(foreign.type).find(key => typeof key === "symbol")
  assert.ok(marker)
  let getterCalls = 0
  const value = {}
  Object.defineProperty(value, marker, {
    get() {
      getterCalls += 1
      throw new Error("foreign marker getter must not run")
    },
  })
  assert.equal(isForeignComponent(value), false)
  assert.equal(getterCalls, 0)
})

test("closure role inspection snapshots data metadata without executing accessors", () => {
  const builder = () => CoreText("builder")
  const action = () => undefined
  const overloaded = overloadClosure(builder, action)
  const variants = closureVariantsOf(overloaded)
  assert.ok(variants)
  assert.equal(Object.isFrozen(variants), true)
  assert.equal(variants.viewBuilder, builder)
  assert.equal(variants.action, action)
  assert.equal(closureForKind(overloaded, "viewBuilder"), builder)
  assert.equal(closureForKind(overloaded, "action"), action)

  let getterCalls = 0
  const hostile = () => undefined
  Object.defineProperties(hostile, {
    [vuneClosureKind]: {
      configurable: false,
      get() {
        getterCalls += 1
        throw new Error("closure kind getter must not run")
      },
    },
    [vuneClosureVariants]: {
      configurable: false,
      get() {
        getterCalls += 1
        throw new Error("closure variants getter must not run")
      },
    },
  })
  assert.equal(closureKindOf(hostile), undefined)
  assert.equal(closureVariantsOf(hostile), undefined)
  assert.equal(closureForKind(hostile, "action"), hostile)
  const marked = markVuneClosure(hostile, "action")
  assert.notEqual(marked, hostile)
  assert.equal(closureKindOf(marked), "action")
  assert.equal(getterCalls, 0)
})

test("initializer target inspection does not execute metadata or display-name accessors", () => {
  let getterCalls = 0
  const hostile = () => undefined
  const viewNodeFactory = Symbol.for("vune.view.node.factory")
  for (const key of [vuneInitializers, vuneView, viewNodeFactory, "viewType", "displayName", "name"]) {
    Object.defineProperty(hostile, key, {
      configurable: false,
      get() {
        getterCalls += 1
        throw new Error("initializer target metadata getter must not run")
      },
    })
  }
  assert.deepEqual(initializersOf(hostile), [])
  assert.doesNotThrow(() => assertInitializerCall(hostile, []))
  assert.throws(() => resolveInitializer(hostile, []), /No matching initializer for View/)
  assert.throws(() => createViewNode(hostile), /Target View is not a Vune View constructor/)

  const RequiresView = defineBuiltinView(
    "RequiresView",
    [initializer("RequiresView(content)", args => args.length === 1, args => ({ content: args[0] }), [initializerKinds.value(true, "content", undefined, "View")])],
    ({ content }) => content,
  )
  assert.throws(() => RequiresView(hostile), /No matching initializer for RequiresView/)

  const registrable = () => undefined
  Object.defineProperty(registrable, vuneView, {
    configurable: true,
    get() {
      getterCalls += 1
      throw new Error("registration must not read marker getters")
    },
  })
  const candidate = initializer("registrable()", args => args.length === 0)
  registerInitializers(registrable, [candidate])
  assert.deepEqual(initializersOf(registrable), [candidate])
  assert.equal(getterCalls, 0)
})

test("initializer resolution treats reflection-hostile objects as opaque positional values", () => {
  let trapCalls = 0
  const opaque = new Proxy({ payload: true }, {
    getOwnPropertyDescriptor() {
      trapCalls += 1
      throw new Error("opaque value refuses property descriptors")
    },
    ownKeys() {
      trapCalls += 1
      throw new Error("opaque value refuses key enumeration")
    },
  })
  let captured
  const OpaqueValue = defineBuiltinView(
    "OpaqueValue",
    [initializer(
      "OpaqueValue(value)",
      args => args.length === 1,
      args => {
        captured = args[0]
        return {}
      },
      [initializerKinds.value(true, undefined, undefined, "object")],
    )],
    () => CoreText("opaque"),
  )
  assert.doesNotThrow(() => OpaqueValue(opaque))
  assert.equal(captured, opaque)
  assert.ok(trapCalls > 0)
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

  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) {
    const stack = renderViewNode(LazyVStack({ overscan: value }, CoreText("A")), renderer)
    const grid = renderViewNode(LazyGrid({ overscan: value }, CoreText("A")), renderer)
    assert.equal(stack.props["data-vune-lazy-overscan"], undefined)
    assert.equal(grid.props["data-vune-lazy-overscan"], undefined)
  }
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

test("layout normalization utilities do not execute option accessors", () => {
  let getterCalls = 0
  const frame = {}
  const insets = {}
  for (const [record, keys] of [[frame, ["width", "alignment"]], [insets, ["top", "right", "bottom", "left"]]]) {
    for (const key of keys) {
      Object.defineProperty(record, key, {
        enumerable: true,
        get() {
          getterCalls += 1
          throw new Error("layout accessors must not run")
        },
      })
    }
  }
  assert.deepEqual(frameStyle(frame), {
    boxSizing: "border-box",
    display: "grid",
    placeItems: "center",
    width: undefined,
    height: undefined,
    minWidth: undefined,
    maxWidth: undefined,
    minHeight: undefined,
    maxHeight: undefined,
  })
  assert.deepEqual(edgeInsetsFromCss(insets), { top: 0, right: 0, bottom: 0, left: 0 })
  assert.equal(getterCalls, 0)
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
