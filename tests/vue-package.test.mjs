import assert from "node:assert/strict"
import test from "node:test"
import { Suspense, createSSRApp, defineAsyncComponent, defineComponent, h, inject, provide, ref } from "vue"
import { renderToString } from "@vue/server-renderer"
import {
  Button,
  GeometryReader,
  State,
  Text,
  VStack,
} from "../packages/core/dist/index.js"
import { initializersOf, namedArguments } from "../packages/core/dist/index.js"
import {
  Component,
  MuseView,
  createVueView,
  fromVueRef,
  render,
  toVueRef,
  vueComponent,
} from "../packages/vue/dist/index.js"

test("@muse/vue renders the renderer-independent graph as Vue VNodes", async () => {
  const value = VStack(() => [Text("Hello Vue"), Button("Save", () => undefined)])
  const html = await renderToString(createSSRApp({ render: () => h(MuseView, { value }) }))
  assert.match(html, /Hello Vue/)
  assert.match(html, /<button[^>]*><span>Save<\/span><\/button>/)
  assert.match(html, /data-muse="VStack"/)
  const styled = await renderToString(createSSRApp({ render: () => render(Text("Styled").className(["card", false, "active"])) }))
  assert.match(styled, /class="card active"/)
})

test("Vue components enter Muse before Vue materialization and Muse Views enter Vue SFCs", async () => {
  const Badge = defineComponent({
    props: { label: { type: String, required: true } },
    setup(props) { return () => h("strong", null, props.label) },
  })
  const value = VStack(Component(Badge, { label: "Vue component" }))
  const html = await renderToString(createSSRApp({ render: () => render(value) }))
  assert.match(html, /<strong>Vue component<\/strong>/)
  const MuseBadge = vueComponent(Badge)
  assert.equal(MuseBadge({ label: "Graph Vue" }).kind, "element")
  const adaptedHtml = await renderToString(createSSRApp({ render: () => render(MuseBadge({ label: "Adapted Vue" })) }))
  assert.match(adaptedHtml, /<strong>Adapted Vue<\/strong>/)
  assert.equal(initializersOf(MuseBadge).length, 1)
  const namedHtml = await renderToString(createSSRApp({ render: () => render(MuseBadge(namedArguments({ label: "Named Vue" }))) }))
  assert.match(namedHtml, /<strong>Named Vue<\/strong>/)

  const Panel = defineComponent({
    setup(_props, { slots }) {
      return () => h("article", null, [h("header", null, slots.header?.()), slots.default?.()])
    },
  })
  const panel = VStack(Component(Panel, { slots: { header: () => Text("Header") } }, Text("Body")))
  const panelHtml = await renderToString(createSSRApp({ render: () => render(panel) }))
  assert.match(panelHtml, /<header><span>Header<\/span><\/header>/)
  assert.match(panelHtml, /<span>Body<\/span>/)

  const Greeting = createVueView(props => Text(`Hello ${props.name}`))
  const greetingHtml = await renderToString(createSSRApp({ render: () => h(Greeting, { name: "Muse" }) }))
  assert.match(greetingHtml, /Hello Muse/)
})

test("Vue scoped slots and provide/inject cross the Muse graph without losing Vue ownership", async () => {
  const key = Symbol("muse-context")
  const Provider = defineComponent({
    setup(_props, { slots }) {
      provide(key, "provided")
      return () => h("section", null, slots.default?.())
    },
  })
  const Consumer = defineComponent({ setup: () => () => h("strong", null, inject(key, "missing")) })
  const Scoped = defineComponent({
    setup(_props, { slots }) { return () => h("article", null, slots.row?.({ label: "Scoped" })) },
  })
  const value = Component(Provider, null,
    Component(Consumer),
    Component(Scoped, { slots: { row: ({ label }) => Text(`${label} slot`) } }),
  )
  const html = await renderToString(createSSRApp({ render: () => render(value) }))
  assert.match(html, /<strong>provided<\/strong>/)
  assert.match(html, /Scoped slot/)
})

test("Vue async components and Suspense retain native slot semantics inside Muse", async () => {
  const AsyncBadge = defineAsyncComponent(async () => defineComponent({
    setup: () => () => h("strong", null, "Async Vue"),
  }))
  const value = Component(Suspense, { slots: {
    default: () => Component(AsyncBadge),
    fallback: () => Text("Loading"),
  } })
  const html = await renderToString(createSSRApp({ render: () => render(value) }))
  assert.match(html, /<strong>Async Vue<\/strong>/)
})

test("@muse/vue preserves component events, refs, and graph keys", () => {
  const save = () => undefined
  const reference = ref(null)
  const vnode = render(Component("button", { onclick: save, ref: reference }, Text("Save")).keyed("save"))
  assert.equal(vnode.key, "save")
  assert.equal(vnode.props?.onClick, save)
  assert.equal(vnode.props?.ref, reference)
})

test("Vue and Muse reactivity cross only through explicit ref bridges", () => {
  const state = State(1)
  const vueState = toVueRef(state)
  vueState.value = 2
  assert.equal(state.value, 2)

  const vueValue = ref("before")
  const binding = fromVueRef(vueValue)
  binding.value = "after"
  assert.equal(vueValue.value, "after")
})

test("@muse/vue materializes GeometryReader through a measured host boundary", async () => {
  const value = GeometryReader(geometry => Text(`${geometry.size.width}x${geometry.size.height}`))
  const html = await renderToString(createSSRApp({ render: () => render(value) }))
  assert.match(html, /data-muse="GeometryReader"/)
  assert.match(html, /0x0/)
})
