import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import { BindingValue, Element, ForEach, ForeignComponent, State, Toggle, defineView, initializer } from "../packages/core/dist/index.js"

function installDOM() {
  const dom = new JSDOM("<!doctype html><html><body><main id=app></main></body></html>", { url: "http://localhost/" })
  const previous = new Map()
  for (const name of ["window", "document", "Element", "HTMLElement", "SVGElement", "Node", "MutationObserver", "getComputedStyle"]) {
    previous.set(name, globalThis[name])
    globalThis[name] = name === "getComputedStyle" ? dom.window.getComputedStyle : dom.window[name]
  }
  previous.set("navigator", globalThis.navigator)
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator })
  previous.set("IS_REACT_ACT_ENVIRONMENT", globalThis.IS_REACT_ACT_ENVIRONMENT)
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  return () => {
    dom.window.close()
    for (const [name, value] of previous) {
      if (name === "navigator") Object.defineProperty(globalThis, name, { configurable: true, value })
      else if (value === undefined) delete globalThis[name]
      else globalThis[name] = value
    }
  }
}

function interactiveFixture() {
  const count = State(0)
  let reference
  const Counter = defineView("ConformanceInteractive", {
    initializers: [initializer("Counter()", args => args.length === 0)],
    body: () => Element("button", {
      "data-role": "counter",
      onclick: () => { count.value += 1 },
      ref: value => { reference = value },
    }, `Count: ${count.value}`),
  })
  return { value: Counter(), get count() { return count.value }, get reference() { return reference } }
}

async function mountLiveValue(renderer, value) {
  if (renderer === "react") {
    const { act } = await import("react")
    const { createRoot } = await import("react-dom/client")
    const { render } = await import("../packages/react/dist/index.js")
    const root = createRoot(document.getElementById("app"))
    await act(async () => { root.render(render(value)) })
    return {
      dispatch: async action => act(async () => { action() }),
      unmount: async () => act(async () => { root.unmount() }),
    }
  }
  if (renderer === "vue") {
    const { createApp, nextTick } = await import("vue")
    const { render } = await import("../packages/vue/dist/index.js")
    const app = createApp({ render: () => render(value) })
    app.mount(document.getElementById("app"))
    return {
      dispatch: async action => { action(); await nextTick() },
      unmount: async () => app.unmount(),
    }
  }
  const { mount } = await import("../packages/web/dist/index.js")
  const unmount = mount(value, document.getElementById("app"))
  return {
    dispatch: async action => { action(); await Promise.resolve(); await Promise.resolve() },
    unmount: async () => unmount(),
  }
}

test("the same live state, event, ref, and DOM identity contract holds in React, Vue, and Web", async () => {
  for (const renderer of ["react", "vue", "web"]) {
    const restore = installDOM()
    try {
      const fixture = interactiveFixture()
      const mounted = await mountLiveValue(renderer, fixture.value)

      const button = document.querySelector("[data-role=counter]")
      assert.ok(button)
      assert.equal(button.textContent, "Count: 0")
      assert.equal(fixture.reference, button)
      await mounted.dispatch(() => button.dispatchEvent(new window.MouseEvent("click", { bubbles: true })))
      assert.equal(fixture.count, 1)
      assert.equal(document.querySelector("[data-role=counter]"), button)
      assert.equal(button.textContent, "Count: 1")
      await mounted.unmount()
      assert.equal(fixture.reference, null)
    } finally {
      restore()
    }
  }
})

function foreignFixture() {
  const count = State(0)
  let reference
  const Host = defineView("ConformanceForeignHost", {
    initializers: [initializer("Host()", args => args.length === 0)],
    body: () => ForeignComponent("button", {
      name: "ConformanceForeignButton",
      props: { "data-role": "foreign", "aria-label": "foreign" },
      events: { onClick: () => { count.value += 1 } },
      ref: value => { reference = value },
    }, `Foreign: ${count.value}`),
  })
  return { value: Host(), get count() { return count.value }, get reference() { return reference } }
}

test("the same foreign component event, ref, state, and identity contract holds in React, Vue, and Web", async () => {
  for (const renderer of ["react", "vue", "web"]) {
    const restore = installDOM()
    try {
      const fixture = foreignFixture()
      const mounted = await mountLiveValue(renderer, fixture.value)
      const button = document.querySelector("[data-role=foreign]")
      assert.ok(button)
      assert.equal(fixture.reference, button)
      assert.equal(button.textContent, "Foreign: 0")
      await mounted.dispatch(() => button.dispatchEvent(new window.MouseEvent("click", { bubbles: true })))
      assert.equal(fixture.count, 1)
      assert.equal(document.querySelector("[data-role=foreign]"), button)
      assert.equal(button.textContent, "Foreign: 1")
      await mounted.unmount()
      assert.equal(fixture.reference, null)
    } finally {
      restore()
    }
  }
})

test("the same writable Binding control contract holds in React, Vue, and Web", async () => {
  for (const renderer of ["react", "vue", "web"]) {
    const restore = installDOM()
    try {
      const state = State(false)
      const Host = defineView("ConformanceBindingHost", {
        initializers: [initializer("Host()", args => args.length === 0)],
        body: () => Toggle("Enabled", BindingValue(state)),
      })
      const mounted = await mountLiveValue(renderer, Host())
      const input = document.querySelector("input[type=checkbox]")
      assert.ok(input)
      assert.equal(input.checked, false)
      await mounted.dispatch(() => input.click())
      assert.equal(state.value, true, renderer)
      assert.equal(input.checked, true, renderer)
      await mounted.unmount()
    } finally {
      restore()
    }
  }
})

function keyedFixture() {
  const items = State([{ id: "a" }, { id: "b" }])
  const Row = defineView("ConformanceIdentityRow", {
    initializers: [initializer("Row(id)", args => args.length === 1, args => ({ id: args[0] }))],
    state: () => ({ count: State(0) }),
    body: ({ id, count }) => Element("button", {
      "data-row": id,
      onclick: () => { count.value += 1 },
    }, `${id}:${count.value}`),
  })
  const App = defineView("ConformanceIdentityApp", {
    initializers: [initializer("App()", args => args.length === 0)],
    body: () => Element("section", null, ForEach(items.value, item => Row(item.id))),
  })
  return { value: App(), items }
}

test("the same keyed State lifetime contract holds across all live renderers", async () => {
  for (const renderer of ["react", "vue", "web"]) {
    const restore = installDOM()
    try {
      const fixture = keyedFixture()
      const mounted = await mountLiveValue(renderer, fixture.value)
      const first = document.querySelector('[data-row="a"]')
      assert.ok(first)
      await mounted.dispatch(() => first.dispatchEvent(new window.MouseEvent("click", { bubbles: true })))
      assert.equal(first.textContent, "a:1")
      await mounted.dispatch(() => { fixture.items.value = [fixture.items.value[1], fixture.items.value[0]] })
      assert.deepEqual([...document.querySelectorAll("button")].map(button => button.textContent), ["b:0", "a:1"])
      await mounted.dispatch(() => { fixture.items.value = fixture.items.value.filter(item => item.id !== "a") })
      await mounted.dispatch(() => { fixture.items.value = [{ id: "a" }, ...fixture.items.value] })
      assert.equal(document.querySelector('[data-row="a"]')?.textContent, "a:0")
      await mounted.unmount()
    } finally {
      restore()
    }
  }
})

function conditionalFixture() {
  const mode = State(false)
  const First = defineView("ConformanceConditionalFirst", {
    initializers: [initializer("First()", args => args.length === 0)],
    state: () => ({ count: State(0) }),
    body: ({ count }) => Element("button", { "data-mode": "first", onclick: () => { count.value += 1 } }, `first:${count.value}`),
  })
  const Second = defineView("ConformanceConditionalSecond", {
    initializers: [initializer("Second()", args => args.length === 0)],
    state: () => ({ count: State(0) }),
    body: ({ count }) => Element("button", { "data-mode": "second", onclick: () => { count.value += 1 } }, `second:${count.value}`),
  })
  const App = defineView("ConformanceConditionalApp", {
    initializers: [initializer("App()", args => args.length === 0)],
    body: () => mode.value ? Second() : First(),
  })
  return { value: App(), mode }
}

test("the same conditional View type remount contract holds across all live renderers", async () => {
  for (const renderer of ["react", "vue", "web"]) {
    const restore = installDOM()
    try {
      const fixture = conditionalFixture()
      const mounted = await mountLiveValue(renderer, fixture.value)
      let button = document.querySelector("[data-mode=first]")
      assert.ok(button)
      await mounted.dispatch(() => button.dispatchEvent(new window.MouseEvent("click", { bubbles: true })))
      assert.equal(button.textContent, "first:1")
      await mounted.dispatch(() => { fixture.mode.value = true })
      button = document.querySelector("[data-mode=second]")
      assert.ok(button)
      assert.equal(button.textContent, "second:0")
      await mounted.dispatch(() => { fixture.mode.value = false })
      button = document.querySelector("[data-mode=first]")
      assert.ok(button)
      assert.equal(button.textContent, "first:0")
      await mounted.unmount()
    } finally {
      restore()
    }
  }
})
