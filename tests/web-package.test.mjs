import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import {
  Animation,
  Element,
  ForEach,
  GeometryReader,
  LazyVStack,
  defineBuiltinView,
  defineView,
  initializer,
  initializerKinds,
  SafeArea,
  ScrollView,
  State,
  compiledTemplate,
  compiledCollectionContent,
  defineCompiledTemplate,
  viewElement,
  viewFragment,
  withAnimation,
} from "../packages/core/dist/index.js"
import { mount, renderToHTML } from "../packages/web/dist/index.js"

const Text = defineBuiltinView(
  "Text",
  [initializer("Text(value)", args => args.length === 1, args => ({ value: args[0] }), [initializerKinds.value()])],
  ({ value }) => viewElement("span", null, [value]),
)

test("@vune-ui/web renders the same core graph without React", () => {
  assert.equal(renderToHTML(Text("Hello").padding(4)), '<span style="padding:4px">Hello</span>')
  assert.equal(renderToHTML(Text("Styled").className(["card", false, "active"])), '<span class="card active">Styled</span>')
  const independentTransforms = renderToHTML(Text("Motion").scaleEffect(1.2).rotationEffect(15).offset(4, 8))
  assert.match(independentTransforms, /scale:1\.2/)
  assert.match(independentTransforms, /rotate:15deg/)
  assert.match(independentTransforms, /translate:4px 8px/)
  assert.doesNotMatch(independentTransforms, /transform:/)
})

test("@vune-ui/web materializes compiled templates in SSR and DOM modes", () => {
  const template = defineCompiledTemplate({
    kind: "element", type: "div", props: { class: "compiled" }, children: [
      { kind: "element", type: "span", props: null, children: ["Static"] },
      { kind: "element", type: "span", props: null, children: [{ kind: "slot", index: 0, identity: ["element", 1, "element", 0] }] },
    ],
  }, 1)
  const value = compiledTemplate(template, ["Web template"])
  assert.equal(renderToHTML(value), '<div class="compiled"><span>Static</span><span>Web template</span></div>')

  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const unmount = mount(value, container)
  assert.equal(container.innerHTML, '<div class="compiled"><span>Static</span><span>Web template</span></div>')
  unmount()
  dom.window.close()
})

test("@vune-ui/web direct-patches compiler-proven text slots without rebuilding static DOM", async () => {
  const value = State(0)
  const template = defineCompiledTemplate({
    kind: "element", type: "span", props: { class: "compiled-text" },
    children: [{ kind: "slot", index: 0, identity: ["element", 0] }],
  }, 1, ["text"])
  const App = defineView("CompiledTextPatch", {
    initializers: [initializer("CompiledTextPatch()", args => args.length === 0)],
    body: () => compiledTemplate(template, [value.value]),
  })
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const unmount = mount(App(), container)
  const element = container.firstChild
  const text = element?.firstChild
  assert.equal(text?.nodeValue, "0")

  const originalCreateTextNode = dom.window.document.createTextNode.bind(dom.window.document)
  let updateTextAllocations = 0
  dom.window.document.createTextNode = value => {
    updateTextAllocations += 1
    return originalCreateTextNode(value)
  }
  value.value = 42
  await Promise.resolve()
  await Promise.resolve()
  assert.strictEqual(container.firstChild, element)
  assert.strictEqual(container.firstChild?.firstChild, text)
  assert.equal(text?.nodeValue, "42")
  assert.equal(updateTextAllocations, 0)

  unmount()
  dom.window.close()
})

test("@vune-ui/web bypasses exhaustive compiled View bodies on State-only text updates", async () => {
  let count
  let bodyRuns = 0
  let slotRuns = 0
  const template = defineCompiledTemplate({
    kind: "element", type: "span", props: { class: "compiled-boundary" },
    children: [{ kind: "slot", index: 0, identity: ["element", 0] }],
  }, 1, ["text"])
  const App = defineView("CompiledBoundaryPatch", {
    initializers: [initializer("CompiledBoundaryPatch()", args => args.length === 0)],
    state: () => ({ count: count = State(0) }),
    dependencies: ({ count }) => [count],
    dependenciesComplete: true,
    compiledBody: {
      template,
      evaluate: ({ count }) => {
        slotRuns += 1
        return { slots: [String(count.value)] }
      },
    },
    body: ({ count }) => {
      bodyRuns += 1
      return compiledTemplate(template, [String(count.value)])
    },
  })

  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const unmount = mount(App(), container)
  const element = container.firstChild
  const text = element?.firstChild
  assert.equal(bodyRuns, 1)
  assert.equal(slotRuns, 0)
  assert.equal(text?.nodeValue, "0")

  count.value = 7
  await Promise.resolve()
  await Promise.resolve()
  assert.strictEqual(container.firstChild, element)
  assert.strictEqual(container.firstChild?.firstChild, text)
  assert.equal(text?.nodeValue, "7")
  assert.equal(bodyRuns, 1)
  assert.equal(slotRuns, 1)

  count.value = 11
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(text?.nodeValue, "11")
  assert.equal(bodyRuns, 1)
  assert.equal(slotRuns, 2)

  unmount()
  dom.window.close()
})

test("@vune-ui/web direct-patches compiled State modifiers without rerunning the View body", async () => {
  let count
  let bodyRuns = 0
  let planRuns = 0
  const template = defineCompiledTemplate({
    kind: "element", type: "span", props: { class: "base" },
    children: [{ kind: "slot", index: 0, identity: ["element", 0] }],
  }, 1, ["text"])
  const App = defineView("CompiledModifierBoundary", {
    initializers: [initializer("CompiledModifierBoundary()", args => args.length === 0)],
    state: () => ({ count: count = State(0) }),
    dependencies: ({ count }) => [count],
    dependenciesComplete: true,
    compiledBody: {
      template,
      patchesModifiers: true,
      evaluate: ({ count }) => {
        planRuns += 1
        return {
          slots: [String(count.value)],
          modifiers: [
            ["opacity", [count.value > 0 ? 1 : 0.25]],
            ["className", [count.value > 1 ? "hot" : "cold"]],
          ],
        }
      },
    },
    body: ({ count }) => {
      bodyRuns += 1
      return compiledTemplate(template, [String(count.value)])
        .opacity(count.value > 0 ? 1 : 0.25)
        .className(count.value > 1 ? "hot" : "cold")
    },
  })

  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const unmount = mount(App(), container)
  const element = container.firstChild
  const text = element?.firstChild
  assert.equal(bodyRuns, 1)
  assert.equal(element?.getAttribute("class"), "base cold")
  assert.equal(element?.style.opacity, "0.25")

  const originalCreateElementNS = dom.window.document.createElementNS.bind(dom.window.document)
  let elementAllocations = 0
  dom.window.document.createElementNS = (...args) => {
    elementAllocations += 1
    return originalCreateElementNS(...args)
  }
  count.value = 2
  await Promise.resolve()
  await Promise.resolve()
  assert.strictEqual(container.firstChild, element)
  assert.strictEqual(container.firstChild?.firstChild, text)
  assert.equal(text?.nodeValue, "2")
  assert.equal(element?.getAttribute("class"), "base hot")
  assert.equal(element?.style.opacity, "1")
  assert.equal(bodyRuns, 1)
  assert.equal(planRuns, 1)
  assert.equal(elementAllocations, 0)

  unmount()
  dom.window.close()
})

test("@vune-ui/web preserves animation transactions on direct compiled modifier patches", async () => {
  let opacity
  const template = defineCompiledTemplate({
    kind: "element", type: "span", props: null, children: ["Motion"],
  }, 0, [])
  const App = defineView("CompiledAnimatedModifier", {
    initializers: [initializer("CompiledAnimatedModifier()", args => args.length === 0)],
    state: () => ({ opacity: opacity = State(0) }),
    dependencies: ({ opacity }) => [opacity],
    dependenciesComplete: true,
    compiledBody: {
      template,
      patchesModifiers: true,
      evaluate: ({ opacity }) => ({ slots: [], modifiers: [["opacity", [opacity.value]]] }),
    },
    body: ({ opacity }) => compiledTemplate(template).opacity(opacity.value),
  })
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const unmount = mount(App(), container)
  const element = container.firstElementChild
  assert.equal(element?.style.opacity, "0")

  withAnimation(Animation.linear(0.05), () => { opacity.value = 1 })
  await Promise.resolve()
  await Promise.resolve()
  const early = Number(element?.style.opacity)
  assert.ok(Number.isFinite(early) && early < 1)
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(element?.style.opacity, "1")

  unmount()
  dom.window.close()
})

test("@vune-ui/web keeps property-scoped animation domains independent on the direct compiled path", async () => {
  let opacity
  let scale
  let bodyRuns = 0
  const opacityAnimation = Animation.linear(0.09)
  const scaleAnimation = Animation.spring(0.05, 0.78)
  const template = defineCompiledTemplate({
    kind: "element", type: "span", props: null,
    children: [{ kind: "slot", index: 0, identity: ["element", 0] }],
  }, 1, ["text"])
  const App = defineView("CompiledIndependentMotionDomains", {
    initializers: [initializer("CompiledIndependentMotionDomains()", args => args.length === 0)],
    state: () => ({ opacity: opacity = State(0), scale: scale = State(1) }),
    dependencies: ({ opacity, scale }) => [opacity, scale],
    dependenciesComplete: true,
    compiledBody: {
      template,
      patchesModifiers: true,
      evaluate: ({ opacity, scale }) => ({
        slots: ["Motion"],
        modifiers: [
          ["opacity", [opacity.value]],
          ["animation", [opacityAnimation, opacity.value]],
          ["scaleEffect", [scale.value]],
          ["animation", [scaleAnimation, scale.value]],
        ],
      }),
    },
    body: ({ opacity, scale }) => {
      bodyRuns += 1
      return compiledTemplate(template, ["Motion"])
        .opacity(opacity.value)
        .animation(opacityAnimation, opacity.value)
        .scaleEffect(scale.value)
        .animation(scaleAnimation, scale.value)
    },
  })

  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const unmount = mount(App(), container)
  const element = container.firstElementChild
  assert.ok(element)
  assert.equal(bodyRuns, 1)
  assert.equal(element.style.opacity, "0")
  assert.equal(element.style.getPropertyValue("scale"), "1")

  opacity.value = 1
  scale.value = 1.8
  await Promise.resolve()
  await Promise.resolve()
  const earlyOpacity = Number(element.style.opacity)
  const earlyScale = Number(element.style.getPropertyValue("scale"))
  assert.ok(earlyOpacity < 1, `opacity jumped instead of animating: ${earlyOpacity}`)
  assert.ok(earlyScale < 1.8, `scale jumped instead of animating: ${earlyScale}`)
  assert.equal(bodyRuns, 1)

  // Retarget only the scale domain. The opacity domain must keep its own
  // timeline and complete independently.
  scale.value = 0.75
  await Promise.resolve()
  await Promise.resolve()
  await new Promise(resolve => setTimeout(resolve, 180))
  assert.equal(Number(element.style.opacity), 1)
  assert.ok(Math.abs(Number(element.style.getPropertyValue("scale")) - 0.75) < 1e-6)
  assert.equal(bodyRuns, 1)

  unmount()
  dom.window.close()
})

test("@vune-ui/web infers intrinsic text-size motion from real geometry changes", async () => {
  let label
  let bodyRuns = 0
  const animation = Animation.easeInOut(0.05)
  const template = defineCompiledTemplate({
    kind: "element", type: "span", props: null,
    children: [{ kind: "slot", index: 0, identity: ["element", 0] }],
  }, 1, ["text"])
  const App = defineView("CompiledIntrinsicLayoutMotion", {
    initializers: [initializer("CompiledIntrinsicLayoutMotion()", args => args.length === 0)],
    state: () => ({ label: label = State("A") }),
    dependencies: ({ label }) => [label],
    dependenciesComplete: true,
    compiledBody: {
      template,
      patchesModifiers: true,
      evaluate: ({ label }) => ({
        slots: [label.value],
        // No width/height modifier exists. The changed animation trigger owns
        // the intrinsic geometry change discovered from the actual DOM box.
        modifiers: [["animation", [animation, label.value]]],
      }),
    },
    body: ({ label }) => {
      bodyRuns += 1
      return compiledTemplate(template, [label.value]).animation(animation, label.value)
    },
  })

  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const unmount = mount(App(), container)
  const element = container.firstElementChild
  assert.ok(element)
  element.getBoundingClientRect = () => {
    const width = Math.max(10, (element.textContent ?? "").length * 10)
    return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: 20, width, height: 20, toJSON() { return this } }
  }

  label.value = "A considerably longer label"
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(bodyRuns, 1)
  assert.equal(element.textContent, "A considerably longer label")
  assert.match(element.style.transform, /scale\(/, "intrinsic width delta should produce a FLIP scale channel")
  await new Promise(resolve => setTimeout(resolve, 130))
  assert.equal(element.style.transform, "none")

  unmount()
  dom.window.close()
})

test("@vune-ui/web direct-patches safe outer modifiers after compiled body modifiers", async () => {
  let count
  let bodyRuns = 0
  const template = defineCompiledTemplate({
    kind: "element", type: "span", props: { class: "base" },
    children: [{ kind: "slot", index: 0, identity: ["element", 0] }],
  }, 1, ["text"])
  const App = defineView("CompiledOuterModifierFallback", {
    initializers: [initializer("CompiledOuterModifierFallback()", args => args.length === 0)],
    state: () => ({ count: count = State(0) }),
    dependencies: ({ count }) => [count],
    dependenciesComplete: true,
    compiledBody: {
      template,
      patchesModifiers: true,
      evaluate: ({ count }) => ({
        slots: [String(count.value)],
        modifiers: [["className", [count.value > 0 ? "inner-on" : "inner-off"]]],
      }),
    },
    body: ({ count }) => {
      bodyRuns += 1
      return compiledTemplate(template, [String(count.value)]).className(count.value > 0 ? "inner-on" : "inner-off")
    },
  })
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const unmount = mount(App().className("outer"), container)
  const element = container.firstElementChild
  assert.equal(element?.getAttribute("class"), "base inner-off outer")
  assert.equal(bodyRuns, 1)

  count.value = 1
  await Promise.resolve()
  await Promise.resolve()
  assert.strictEqual(container.firstElementChild, element)
  assert.equal(element?.getAttribute("class"), "base inner-on outer")
  assert.equal(bodyRuns, 1)

  unmount()
  dom.window.close()
})

test("@vune-ui/web falls back for effectful outer modifiers on compiled body patches", async () => {
  let count
  let bodyRuns = 0
  const template = defineCompiledTemplate({
    kind: "element", type: "span", props: { class: "base" },
    children: [{ kind: "slot", index: 0, identity: ["element", 0] }],
  }, 1, ["text"])
  const App = defineView("CompiledUnsafeOuterModifierFallback", {
    initializers: [initializer("CompiledUnsafeOuterModifierFallback()", args => args.length === 0)],
    state: () => ({ count: count = State(0) }),
    dependencies: ({ count }) => [count],
    dependenciesComplete: true,
    compiledBody: {
      template,
      patchesModifiers: true,
      evaluate: ({ count }) => ({
        slots: [String(count.value)],
        modifiers: [["className", [count.value > 0 ? "inner-on" : "inner-off"]]],
      }),
    },
    body: ({ count }) => {
      bodyRuns += 1
      return compiledTemplate(template, [String(count.value)]).className(count.value > 0 ? "inner-on" : "inner-off")
    },
  })
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const unmount = mount(App().withProps({ title: "outer" }), container)
  const element = container.firstElementChild
  assert.equal(element?.getAttribute("class"), "base inner-off")
  assert.equal(element?.getAttribute("title"), "outer")
  assert.equal(bodyRuns, 1)

  count.value = 1
  await Promise.resolve()
  await Promise.resolve()
  assert.strictEqual(container.firstElementChild, element)
  assert.equal(element?.getAttribute("class"), "base inner-on")
  assert.equal(element?.getAttribute("title"), "outer")
  assert.equal(bodyRuns, 2)

  unmount()
  dom.window.close()
})

test("@vune-ui/web reuses zero-slot compiled DOM roots across dynamic modifier updates", async () => {
  const opacity = State(0.25)
  const template = defineCompiledTemplate({
    kind: "element", type: "span", props: { class: "compiled-static" }, children: ["Static"],
  }, 0, [])
  const App = defineView("CompiledStaticPatch", {
    initializers: [initializer("CompiledStaticPatch()", args => args.length === 0)],
    body: () => compiledTemplate(template, []).opacity(opacity.value),
  })
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const unmount = mount(App(), container)
  const element = container.firstChild
  assert.equal(element?.nodeName, "SPAN")
  assert.equal(element?.textContent, "Static")
  assert.equal(element?.style.opacity, "0.25")

  const originalCreateElementNS = dom.window.document.createElementNS.bind(dom.window.document)
  let updateElementAllocations = 0
  dom.window.document.createElementNS = (...args) => {
    updateElementAllocations += 1
    return originalCreateElementNS(...args)
  }
  opacity.value = 0.75
  await Promise.resolve()
  await Promise.resolve()
  assert.strictEqual(container.firstChild, element)
  assert.equal(element?.textContent, "Static")
  assert.equal(element?.style.opacity, "0.75")
  assert.equal(updateElementAllocations, 0)

  unmount()
  dom.window.close()
})

test("@vune-ui/web composes static and dynamic classes without cloning reusable roots", async () => {
  const active = State(false)
  const template = defineCompiledTemplate({
    kind: "element", type: "span", props: { class: "base" }, children: ["Static"],
  }, 0, [])
  const App = defineView("CompiledClassPatch", {
    initializers: [initializer("CompiledClassPatch()", args => args.length === 0)],
    body: () => compiledTemplate(template, []).className(active.value ? "hot" : "cold"),
  })
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const unmount = mount(App(), container)
  const element = container.firstChild
  assert.equal(element?.getAttribute("class"), "base cold")

  const originalCreateElementNS = dom.window.document.createElementNS.bind(dom.window.document)
  let updateElementAllocations = 0
  dom.window.document.createElementNS = (...args) => {
    updateElementAllocations += 1
    return originalCreateElementNS(...args)
  }
  active.value = true
  await Promise.resolve()
  await Promise.resolve()
  assert.strictEqual(container.firstChild, element)
  assert.equal(element?.getAttribute("class"), "base hot")
  assert.equal(updateElementAllocations, 0)

  unmount()
  dom.window.close()
})

test("@vune-ui/web clears stale outer modifiers when a zero-slot template is reused", async () => {
  const enabled = State(true)
  const template = defineCompiledTemplate({
    kind: "element", type: "span", props: { class: "base" }, children: ["Static"],
  }, 0, [])
  const App = defineView("CompiledModifierRemoval", {
    initializers: [initializer("CompiledModifierRemoval()", args => args.length === 0)],
    body: () => enabled.value ? compiledTemplate(template, []).opacity(0.2) : compiledTemplate(template, []),
  })
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const unmount = mount(App(), container)
  const element = container.firstChild
  assert.equal(element?.style.opacity, "0.2")

  enabled.value = false
  await Promise.resolve()
  await Promise.resolve()
  assert.strictEqual(container.firstChild, element)
  assert.equal(element?.getAttribute("class"), "base")
  assert.equal(element?.style.opacity, "")

  unmount()
  dom.window.close()
})

test("@vune-ui/web preserves text-slot patching when reusable roots receive modifiers", async () => {
  const value = State("A")
  const opacity = State(0.3)
  const template = defineCompiledTemplate({
    kind: "element", type: "span", props: { class: "compiled-text-modifier" },
    children: [{ kind: "slot", index: 0, identity: ["element", 0] }],
  }, 1, ["text"])
  const App = defineView("CompiledTextModifierPatch", {
    initializers: [initializer("CompiledTextModifierPatch()", args => args.length === 0)],
    body: () => compiledTemplate(template, [value.value]).opacity(opacity.value),
  })
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const unmount = mount(App(), container)
  const element = container.firstChild
  const text = element?.firstChild
  assert.equal(text?.nodeValue, "A")

  value.value = "B"
  opacity.value = 0.8
  await Promise.resolve()
  await Promise.resolve()
  assert.strictEqual(container.firstChild, element)
  assert.strictEqual(container.firstChild?.firstChild, text)
  assert.equal(text?.nodeValue, "B")
  assert.equal(element?.style.opacity, "0.8")

  unmount()
  dom.window.close()
})

test("@vune-ui/web preserves raw HTML attributes and object styles", () => {
  const value = Element("label", {
    class: "card",
    htmlFor: "name",
    "aria-label": "Name",
    "data-kind": "hero",
    style: { backgroundColor: "red", "--accent": "blue" },
  }, Text("Name"))
  const html = renderToHTML(value)
  assert.match(html, /class="card"/)
  assert.match(html, /for="name"/)
  assert.match(html, /aria-label="Name"/)
  assert.match(html, /data-kind="hero"/)
  assert.match(html, /background-color:red;--accent:blue/)
  assert.match(html, />Name<\/span><\/label>$/)
  assert.equal(renderToHTML(Element("input", { disabled: true, style: "color: red", "data-field": "name" })), '<input disabled style="color: red" data-field="name">')
})

test("@vune-ui/web ignores children of void elements in SSR and DOM modes", () => {
  const value = Element("input", { "data-field": "name" }, "Ignored")
  assert.equal(renderToHTML(value), '<input data-field="name">')

  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const unmount = mount(value, container)
  const input = container.querySelector("input")
  assert.ok(input)
  assert.equal(input.childNodes.length, 0)
  unmount()
  dom.window.close()
})

test("@vune-ui/web serializes, hydrates, and patches controlled textarea values as text content", async () => {
  const initial = 'A < B & "quoted"'
  const value = Element("textarea", { value: initial, "aria-label": "Notes" })
  const html = renderToHTML(value)
  assert.equal(html, '<textarea aria-label="Notes">A &lt; B &amp; &quot;quoted&quot;</textarea>')
  assert.equal(renderToHTML(Element("textarea", { value: "base" }).withProps({ value: "override" })), '<textarea>override</textarea>')
  assert.equal(renderToHTML(Element("textarea", { value: "base" }).withProps({ value: "$&" })), '<textarea>$&amp;</textarea>')

  const multiline = "\nLine 1\r\nLine 2\rLine 3"
  const multilineHTML = renderToHTML(Element("textarea", { value: multiline }))
  const parsedMultiline = new JSDOM(multilineHTML)
  assert.equal(parsedMultiline.window.document.querySelector("textarea")?.value, "\nLine 1\nLine 2\nLine 3")
  parsedMultiline.window.close()

  const dom = new JSDOM(`<div id=app>${html}</div>`)
  const container = dom.window.document.querySelector("#app")
  const server = container?.querySelector("textarea")
  assert.ok(container)
  assert.ok(server)
  assert.equal(server.value, initial)
  server.value = "typed before hydration"

  const unmount = mount(value, container, { hydrate: true })
  const hydrated = container.querySelector("textarea")
  assert.equal(hydrated, server)
  assert.equal(hydrated?.value, initial)
  assert.equal(hydrated?.textContent, initial)
  assert.equal(hydrated?.hasAttribute("value"), false)
  unmount()

  const current = State("first")
  const App = defineView("ControlledTextArea", {
    initializers: [initializer("ControlledTextArea()", args => args.length === 0)],
    body: () => Element("textarea", { value: current.value }),
  })
  const patchContainer = dom.window.document.createElement("div")
  dom.window.document.body.appendChild(patchContainer)
  const unmountPatched = mount(App(), patchContainer)
  const patched = patchContainer.querySelector("textarea")
  assert.equal(patched?.value, "first")
  current.value = "second\nline"
  await Promise.resolve()
  assert.equal(patchContainer.querySelector("textarea"), patched)
  assert.equal(patched?.value, "second\nline")
  assert.equal(patched?.textContent, "second\nline")
  assert.equal(patched?.hasAttribute("value"), false)
  unmountPatched()
  dom.window.close()
})

test("@vune-ui/web applies controlled select values after options exist in SSR, mount, and hydration", async () => {
  const selection = State("b")
  const Select = () => Element("select", { value: selection.value },
    Element("option", { value: "a", selected: true }, "A"),
    Element("option", { value: "b" }, "B"),
    Element("option", null, "C"),
  )
  const App = defineView("ControlledSelect", {
    initializers: [initializer("ControlledSelect()", args => args.length === 0)],
    body: Select,
  })
  const html = renderToHTML(App())
  assert.equal(html, '<select><option value="a">A</option><option value="b" selected>B</option><option>C</option></select>')
  assert.equal(
    renderToHTML(Select().withProps({ value: "C" })),
    '<select><option value="a">A</option><option value="b">B</option><option selected>C</option></select>',
  )
  assert.equal(
    renderToHTML(Element("select", { value: "C's" }, Element("option", null, "C's"))),
    "<select><option selected>C's</option></select>",
  )

  const parsed = new JSDOM(`<div id=app>${html}</div>`)
  const container = parsed.window.document.querySelector("#app")
  const server = container?.querySelector("select")
  assert.ok(container)
  assert.ok(server)
  assert.equal(server.value, "b")
  server.value = "a"

  const unmount = mount(App(), container, { hydrate: true })
  assert.equal(container.querySelector("select"), server)
  assert.equal(server.value, "b")
  assert.equal(server.hasAttribute("value"), false)
  selection.value = "a"
  await Promise.resolve()
  assert.equal(server.value, "a")
  assert.equal(server.selectedIndex, 0)
  assert.equal(server.hasAttribute("value"), false)
  unmount()

  const mountedContainer = parsed.window.document.createElement("div")
  const unmountMounted = mount(Element("select", { value: "b" },
    Element("option", { value: "a" }, "A"),
    Element("option", { value: "b" }, "B"),
  ), mountedContainer)
  assert.equal(mountedContainer.querySelector("select")?.value, "b")
  assert.equal(mountedContainer.querySelector("select")?.hasAttribute("value"), false)
  unmountMounted()
  parsed.window.close()
})

test("@vune-ui/web keeps raw-text SSR parsing aligned with DOM mount and blocks closing-tag escapes", () => {
  const values = [
    ["style", '.x::before { content: "<&"; }\r\n.x { color: red; }\0'],
    ["script", 'globalThis.__vuneText = "<&"\r\n\0'],
  ]
  for (const [tag, source] of values) {
    const normalized = source.replace(/\r\n?/g, "\n").replaceAll("\0", "\uFFFD")
    const view = Element(tag, null, source)
    const html = renderToHTML(view)
    const parsed = new JSDOM(`<div id=parsed>${html}</div>`)
    const mounted = new JSDOM("<div id=mounted></div>")
    const container = mounted.window.document.querySelector("#mounted")
    assert.ok(container)
    const unmount = mount(view, container)
    assert.equal(parsed.window.document.querySelector(tag)?.textContent, normalized)
    assert.equal(container.querySelector(tag)?.textContent, normalized)
    assert.equal(container.querySelector(tag)?.textContent, parsed.window.document.querySelector(tag)?.textContent)
    unmount()
    parsed.window.close()
    mounted.window.close()
  }

  assert.throws(
    () => renderToHTML(Element("style", null, ".x { content: '</style>'; }")),
    /closing-tag sequence/,
  )
  assert.throws(
    () => renderToHTML(Element("script", null, Element("span", null, "invalid"))),
    /only accepts text children/,
  )
  const rejected = new JSDOM("<div id=app></div>")
  const rejectedContainer = rejected.window.document.querySelector("#app")
  assert.ok(rejectedContainer)
  assert.throws(
    () => mount(Element("style", null, ".x { content: '</style>'; }"), rejectedContainer),
    /closing-tag sequence/,
  )
  assert.throws(
    () => mount(Element("script", null, Element("span", null, "invalid")), rejectedContainer),
    /only accepts text children/,
  )
  rejected.window.close()
})

test("@vune-ui/web mounts, hydrates, patches, and cleans up template content fragments", async () => {
  const current = State("Hello")
  let clicks = 0
  const refs = []
  const reference = node => refs.push(node)
  const App = defineView("TemplateContent", {
    initializers: [initializer("TemplateContent()", args => args.length === 0)],
    body: () => Element("template", { id: "card" },
      Element("button", { class: "value", ref: reference, onclick: () => { clicks += 1 } }, current.value),
    ),
  })
  const value = App()
  const html = renderToHTML(value)
  const dom = new JSDOM(`<div id=app>${html}</div>`)
  const container = dom.window.document.querySelector("#app")
  const serverTemplate = container?.querySelector("template")
  const serverButton = serverTemplate?.content.querySelector("button")
  assert.ok(container)
  assert.ok(serverTemplate)
  assert.ok(serverButton)
  assert.equal(serverTemplate.childNodes.length, 0)
  assert.equal(serverTemplate.content.textContent, "Hello")

  const unmount = mount(value, container, { hydrate: true })
  const hydratedTemplate = container.querySelector("template")
  assert.equal(hydratedTemplate, serverTemplate)
  assert.equal(hydratedTemplate?.content.querySelector("button"), serverButton)
  assert.equal(hydratedTemplate?.childNodes.length, 0)
  assert.deepEqual(refs, [serverButton])
  serverButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  assert.equal(clicks, 1)

  current.value = "Updated"
  await Promise.resolve()
  assert.equal(hydratedTemplate?.content.querySelector("button"), serverButton)
  assert.equal(serverButton.textContent, "Updated")
  assert.equal(hydratedTemplate?.outerHTML, '<template id="card"><button class="value">Updated</button></template>')
  unmount()
  assert.deepEqual(refs, [serverButton, null])
  serverButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  assert.equal(clicks, 1)
  dom.window.close()

  const mounted = new JSDOM("<div id=app></div>")
  const mountedContainer = mounted.window.document.querySelector("#app")
  assert.ok(mountedContainer)
  const unmountMounted = mount(Element("template", null, Element("span", null, "Live")), mountedContainer)
  const mountedTemplate = mountedContainer.querySelector("template")
  assert.equal(mountedTemplate?.childNodes.length, 0)
  assert.equal(mountedTemplate?.content.textContent, "Live")
  assert.equal(mountedTemplate?.outerHTML, "<template><span>Live</span></template>")
  unmountMounted()
  mounted.window.close()
})

test("@vune-ui/web normalizes direct table rows for stable SSR, mount, hydration, and patching", async () => {
  const current = State("A")
  const App = defineView("ImplicitTableBody", {
    initializers: [initializer("ImplicitTableBody()", args => args.length === 0)],
    body: () => Element("table", { id: "grid" },
      Element("tr", { id: "row" }, Element("td", null, current.value)),
    ),
  })
  const value = App()
  const html = renderToHTML(value)
  assert.equal(html, '<table id="grid"><tbody><tr id="row"><td>A</td></tr></tbody></table>')
  assert.equal(
    renderToHTML(Element("table", null,
      Element("tr", null, Element("td", null, "A")),
      Element("tr", null, Element("td", null, "B")),
    )),
    "<table><tbody><tr><td>A</td></tr><tr><td>B</td></tr></tbody></table>",
  )
  assert.equal(
    renderToHTML(Element("table", null,
      Element("col", { span: 2 }),
      Element("td", null, "Loose cell"),
    )),
    '<table><colgroup><col span="2"></colgroup><tbody><tr><td>Loose cell</td></tr></tbody></table>',
  )
  assert.throws(
    () => renderToHTML(Element("table", null, "fostered text")),
    /only accepts table sections/,
  )
  assert.throws(
    () => renderToHTML(Element("table", null, Element("div", null, "fostered element"))),
    /only accepts table sections/,
  )

  const dom = new JSDOM(`<div id=app>${html}</div>`)
  const container = dom.window.document.querySelector("#app")
  const serverTable = container?.querySelector("table")
  const serverBody = serverTable?.tBodies[0]
  const serverRow = serverTable?.rows[0]
  assert.ok(container)
  assert.ok(serverTable)
  assert.ok(serverBody)
  assert.ok(serverRow)
  const unmount = mount(value, container, { hydrate: true })
  assert.equal(container.querySelector("table"), serverTable)
  assert.equal(serverTable.tBodies[0], serverBody)
  assert.equal(serverTable.rows[0], serverRow)
  current.value = "Updated"
  await Promise.resolve()
  assert.equal(serverTable.rows[0], serverRow)
  assert.equal(serverRow.textContent, "Updated")
  unmount()
  dom.window.close()

  const mounted = new JSDOM("<div id=app></div>")
  const mountedContainer = mounted.window.document.querySelector("#app")
  assert.ok(mountedContainer)
  const unmountMounted = mount(value, mountedContainer)
  const mountedTable = mountedContainer.querySelector("table")
  assert.equal(mountedTable?.children[0]?.tagName, "TBODY")
  assert.equal(mountedTable?.tBodies.length, 1)
  assert.equal(mountedTable?.rows[0]?.textContent, "Updated")
  unmountMounted()

  const normalizedContainer = mounted.window.document.createElement("div")
  const unmountNormalized = mount(Element("table", null,
    Element("col", { span: 2 }),
    Element("td", null, "Loose cell"),
  ), normalizedContainer)
  const normalizedTable = normalizedContainer.querySelector("table")
  assert.equal(normalizedTable?.children[0]?.tagName, "COLGROUP")
  assert.equal(normalizedTable?.children[1]?.tagName, "TBODY")
  assert.equal(normalizedTable?.rows[0]?.cells[0]?.textContent, "Loose cell")
  unmountNormalized()
  assert.throws(
    () => mount(Element("table", null, "fostered text"), normalizedContainer),
    /only accepts table sections/,
  )
  assert.throws(
    () => mount(Element("table", null, Element("div", null, "fostered element")), normalizedContainer),
    /only accepts table sections/,
  )
  mounted.window.close()
})

test("@vune-ui/web merges object styles and classes supplied by withProps", () => {
  const value = Element("div", { class: "base", style: { color: "red" } }, "Card")
    .className("accent")
    .withProps({ className: "interactive", style: { backgroundColor: "blue" } })
  const html = renderToHTML(value)
  assert.match(html, /class="base accent interactive"/)
  assert.match(html, /color:red;background-color:blue/)
})

test("@vune-ui/web omits coercible withProps values in SSR and DOM modes", () => {
  let coercionCalls = 0
  const value = Text("Safe").withProps({
    title: { toString() { coercionCalls += 1; return "coerced" } },
    "data-safe": "yes",
  })
  const html = renderToHTML(value)
  assert.match(html, /data-safe="yes"/)
  assert.doesNotMatch(html, /title=|coerced/)

  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const unmount = mount(value, container)
  assert.equal(container.firstElementChild?.getAttribute("data-safe"), "yes")
  assert.equal(container.firstElementChild?.hasAttribute("title"), false)
  assert.equal(coercionCalls, 0)
  unmount()
  dom.window.close()
})

test("@vune-ui/web passes custom element objects as DOM properties without SSR coercion", async () => {
  let coercionCalls = 0
  const payload = { toString() { coercionCalls += 1; return "coerced" } }
  const value = Element("vune-card", { payload, label: "safe" })
  const html = renderToHTML(value)
  assert.match(html, /label="safe"/)
  assert.doesNotMatch(html, /payload=|coerced/)

  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const unmount = mount(value, container)
  const element = container.firstElementChild
  assert.ok(element)
  assert.strictEqual(element.payload, payload)
  assert.equal(element.hasAttribute("payload"), false)
  assert.equal(coercionCalls, 0)
  unmount()

  const current = State(payload)
  const DynamicCustomElement = defineView("DynamicCustomElement", {
    initializers: [initializer("DynamicCustomElement()", args => args.length === 0)],
    body: () => Element("vune-card", { payload: current.value }),
  })
  const unmountDynamic = mount(DynamicCustomElement(), container)
  const dynamicElement = container.firstElementChild
  assert.ok(dynamicElement)
  assert.strictEqual(dynamicElement.payload, current.value)
  current.value = undefined
  await Promise.resolve()
  assert.equal(dynamicElement.payload, undefined)
  assert.equal(dynamicElement.hasAttribute("payload"), false)
  assert.equal(coercionCalls, 0)
  unmountDynamic()
  dom.window.close()
})

test("@vune-ui/web normalizes modifier CSS names and omits nullish style values", () => {
  const value = Element("div", {
    style: { backgroundColor: "red", color: null },
  }, "Styled").style({ borderTopColor: "blue", outlineColor: undefined })
  const html = renderToHTML(value)
  assert.match(html, /background-color:red;border-top-color:blue/)
  assert.doesNotMatch(html, /backgroundColor|borderTopColor|null|undefined/)

  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const unmount = mount(value, container)
  const element = container.firstElementChild
  assert.ok(element)
  assert.equal(element.style.backgroundColor, "red")
  assert.equal(element.style.borderTopColor, "blue")
  assert.doesNotMatch(element.getAttribute("style") ?? "", /null|undefined/)
  unmount()
  dom.window.close()
})

test("@vune-ui/web safely merges escaped class and style modifier values", () => {
  const value = Element("div", {
    class: "base&one",
    style: { color: "red" },
  }, "Safe")
    .className('next"two')
    .style({ backgroundImage: 'url("quoted.png?x=1&y=2")' })
  const html = renderToHTML(value)
  assert.match(html, /class="base&amp;one next&quot;two"/)
  assert.doesNotMatch(html, /base&amp;amp;one/)
  assert.match(html, /style="color:red;background-image:url\(&quot;quoted\.png\?x=1&amp;y=2&quot;\)"/)
})

test("@vune-ui/web serializes scroll and safe-area CSS from the core graph", () => {
  const value = SafeArea(["top", "bottom"], () => [
    ScrollView("both", () => [Element("div", null, "Content")]),
  ])
  const html = renderToHTML(value)
  assert.match(html, /data-vune="SafeArea"/)
  assert.match(html, /padding-top:env\(safe-area-inset-top\)/)
  assert.match(html, /padding-bottom:env\(safe-area-inset-bottom\)/)
  assert.match(html, /data-vune="ScrollView"/)
  assert.match(html, /overflow-x:auto/)
  assert.match(html, /overflow-y:auto/)
})

test("@vune-ui/web exposes GeometryReader in SSR and DOM modes", () => {
  const value = GeometryReader(geometry => Element("span", null, `${geometry.size.width}x${geometry.size.height}`))
  const html = renderToHTML(value)
  assert.match(html, /data-vune="GeometryReader"/)
  assert.match(html, />0x0<\/span>/)
})

test("@vune-ui/web measures CSS safe-area insets at the DOM boundary", async () => {
  const dom = new JSDOM("<div id=app></div>")
  dom.window.getComputedStyle = () => ({ paddingTop: "12px", paddingRight: "8px", paddingBottom: "4px", paddingLeft: "2px" })
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const value = GeometryReader(geometry => Element("span", null, `${geometry.safeAreaInsets.top}:${geometry.safeAreaInsets.right}:${geometry.safeAreaInsets.bottom}:${geometry.safeAreaInsets.left}`))
  const unmount = mount(value, container)
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(container.textContent, "12:8:4:2")
  unmount()
  dom.window.close()
})

test("@vune-ui/web GeometryReader survives unavailable CSSOM and cleans its probe", async () => {
  const dom = new JSDOM("<div id=app></div>")
  dom.window.getComputedStyle = () => { throw new Error("CSSOM unavailable") }
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const initialChildren = dom.window.document.body.children.length
  const unmount = mount(GeometryReader(geometry => Element("span", null, String(geometry.safeAreaInsets.top))), container)
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(container.textContent, "0")
  assert.equal(dom.window.document.body.children.length, initialChildren)
  unmount()
  dom.window.close()
})

test("@vune-ui/web resolves renderer-independent View state", () => {
  const Counter = defineView("Counter", {
    initializers: [initializer("Counter()", args => args.length === 0)],
    state: () => ({ count: State(3) }),
    body: ({ count }) => Text(String(count.value)),
  })
  assert.equal(renderToHTML(Counter()), "<span>3</span>")
})

test("@vune-ui/web mount reevaluates State reads and cleans up", async () => {
  const state = State(1)
  const Counter = defineView("MountedCounter", {
    initializers: [initializer("MountedCounter()", args => args.length === 0)],
    body: () => Text(String(state.value)),
  })
  const container = { innerHTML: "" }
  const unmount = (await import("../packages/web/dist/index.js")).mount(Counter(), container)
  assert.equal(container.innerHTML, "<span>1</span>")
  state.value = 2
  await Promise.resolve()
  assert.equal(container.innerHTML, "<span>2</span>")
  unmount()
  state.value = 3
  await Promise.resolve()
  assert.equal(container.innerHTML, "")
})

test("@vune-ui/web DOM mount preserves events, refs, and State invalidation", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const count = State(0)
  const reference = { current: null }
  const Counter = defineView("InteractiveCounter", {
    initializers: [initializer("InteractiveCounter()", args => args.length === 0)],
    body: () => Element("section", null,
      Element("span", { "data-count": true }, String(count.value)),
      Element("button", { onclick: () => { count.value += 1 }, ref: reference }, "Increment"),
    ),
  })
  const unmount = (await import("../packages/web/dist/index.js")).mount(Counter(), container)
  assert.equal(container.querySelector("[data-count]")?.textContent, "0")
  assert.equal(reference.current, container.querySelector("button"))
  container.querySelector("button")?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  await Promise.resolve()
  assert.equal(container.querySelector("[data-count]")?.textContent, "1")
  unmount()
  assert.equal(reference.current, null)
  assert.equal(container.innerHTML, "")
})

test("@vune-ui/web patches text, attributes, and events without replacing the DOM node", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const label = State("one")
  let clicks = 0
  const Counter = defineView("PatchCounter", {
    initializers: [initializer("PatchCounter()", args => args.length === 0)],
    body: () => Element("button", {
      title: label.value,
      onclick: () => { clicks += 1 },
    }, label.value),
  })
  const value = Counter()
  const unmount = mount(value, container)
  const button = container.firstElementChild
  assert.ok(button)
  assert.equal(button.getAttribute("title"), "one")
  label.value = "two"
  await Promise.resolve()
  assert.equal(container.firstElementChild, button)
  assert.equal(button.getAttribute("title"), "two")
  assert.equal(button.textContent, "two")
  button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  assert.equal(clicks, 1)
  unmount()
  dom.window.close()
})

test("@vune-ui/web removes event listeners when a live prop becomes null", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const enabled = State(true)
  let clicks = 0
  const Toggle = defineView("EventToggle", {
    initializers: [initializer("EventToggle()", args => args.length === 0)],
    body: () => Element("button", {
      onclick: enabled.value ? () => { clicks += 1 } : null,
    }, enabled.value ? "Enabled" : "Disabled"),
  })
  const unmount = mount(Toggle(), container)
  const button = container.querySelector("button")
  assert.ok(button)

  button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  assert.equal(clicks, 1)
  enabled.value = false
  await Promise.resolve()
  assert.equal(container.querySelector("button"), button)
  button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  assert.equal(clicks, 1)

  enabled.value = true
  await Promise.resolve()
  button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  assert.equal(clicks, 2)
  unmount()
  dom.window.close()
})

test("@vune-ui/web preserves capture phase event semantics and removal", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const captureEnabled = State(true)
  const calls = []
  const App = defineView("CaptureEvents", {
    initializers: [initializer("CaptureEvents()", args => args.length === 0)],
    body: () => Element("div", {
      onClickCapture: captureEnabled.value ? () => calls.push("capture") : null,
      onclick: () => calls.push("bubble"),
    }, Element("button", { onclick: () => calls.push("target") }, "Run")),
  })
  const unmount = mount(App(), container)
  const button = container.querySelector("button")
  assert.ok(button)
  button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  assert.deepEqual(calls, ["capture", "target", "bubble"])

  calls.length = 0
  captureEnabled.value = false
  await Promise.resolve()
  button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  assert.deepEqual(calls, ["target", "bubble"])
  unmount()
  dom.window.close()
})

test("@vune-ui/web preserves pointer-capture event names ending in Capture", () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const calls = []
  const value = Element("div", {
    onGotPointerCapture: () => calls.push("got"),
    onLostPointerCapture: () => calls.push("lost"),
  }, "Target")
  const unmount = mount(value, container)
  const target = container.firstElementChild
  assert.ok(target)
  target.dispatchEvent(new dom.window.Event("gotpointercapture", { bubbles: true }))
  target.dispatchEvent(new dom.window.Event("lostpointercapture", { bubbles: true }))
  assert.deepEqual(calls, ["got", "lost"])
  unmount()
  dom.window.close()
})

test("@vune-ui/web detaches listeners from replaced and unmounted DOM nodes", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const visible = State(true)
  let clicks = 0
  const App = defineView("EventLifetime", {
    initializers: [initializer("EventLifetime()", args => args.length === 0)],
    body: () => visible.value
      ? Element("button", { onclick: () => { clicks += 1 } }, "Active")
      : Element("span", null, "Inactive"),
  })
  const unmount = mount(App(), container)
  const replacedButton = container.querySelector("button")
  assert.ok(replacedButton)
  replacedButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  assert.equal(clicks, 1)

  visible.value = false
  await Promise.resolve()
  assert.equal(replacedButton.isConnected, false)
  replacedButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  assert.equal(clicks, 1)

  visible.value = true
  await Promise.resolve()
  const unmountedButton = container.querySelector("button")
  assert.ok(unmountedButton)
  unmount()
  unmountedButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  assert.equal(clicks, 1)
  dom.window.close()
})

test("@vune-ui/web detaches nested listeners when a whole child batch is removed", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const visible = State(true)
  let clicks = 0
  const App = defineView("BatchEventLifetime", {
    initializers: [initializer("BatchEventLifetime()", args => args.length === 0)],
    body: () => Element("section", null, ...(visible.value ? [
      ...Array.from({ length: 32 }, (_, index) => Element("span", { "data-index": index }, String(index))),
      Element("button", { "data-listener": "a", onclick: () => { clicks += 1 } }, "Nested A"),
      Element("button", { "data-listener": "b", onclick: () => { clicks += 1 } }, "Nested B"),
    ] : [])),
  })
  const unmount = mount(App(), container)
  const removedButtons = [...container.querySelectorAll("button")]
  assert.equal(removedButtons.length, 2)
  for (const button of removedButtons) button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  assert.equal(clicks, 2)

  visible.value = false
  await Promise.resolve()
  assert.equal(container.querySelector("section")?.childNodes.length, 0)
  for (const button of removedButtons) {
    assert.equal(button.isConnected, false)
    button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  }
  assert.equal(clicks, 2)

  unmount()
  dom.window.close()
})

test("@vune-ui/web windows lazy children and responds to scroll without rebuilding the boundary", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  container.style.overflowY = "auto"
  Object.defineProperty(container, "clientHeight", { configurable: true, value: 100 })
  const children = Array.from({ length: 100 }, (_, index) => Element("span", { "data-item": String(index) }, String(index)))
  const value = LazyVStack({ estimatedItemSize: 20, overscan: 0 }, ...children)
  const unmount = mount(value, container)
  await Promise.resolve()
  await Promise.resolve()
  const boundary = container.querySelector("[data-vune-lazy]")
  assert.ok(boundary)
  assert.ok(boundary.querySelectorAll("[data-item]").length < children.length)
  assert.ok(boundary.querySelector("[data-vune-lazy-spacer=after]"))

  const before = boundary.querySelector("[data-item=0]")
  container.scrollTop = 400
  container.dispatchEvent(new dom.window.Event("scroll"))
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(container.scrollTop, 400)
  assert.equal(boundary.querySelector("[data-item=0]"), null)
  assert.ok(boundary.querySelector("[data-item=20]"))
  assert.equal(boundary, container.querySelector("[data-vune-lazy]"))
  assert.equal(before?.isConnected, false)
  unmount()
  dom.window.close()
})

test("@vune-ui/web keeps LazyVStack usable when CSSOM and layout measurement are unavailable", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  container.style.overflowY = "auto"
  Object.defineProperty(container, "clientHeight", { configurable: true, value: 100 })
  dom.window.getComputedStyle = () => { throw new Error("CSSOM unavailable") }
  const originalRect = dom.window.HTMLElement.prototype.getBoundingClientRect
  Object.defineProperty(dom.window.HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value() { throw new Error("layout unavailable") },
  })
  try {
    const children = Array.from({ length: 100 }, (_, index) => Element("span", { "data-item": String(index) }, String(index)))
    const unmount = mount(LazyVStack({ estimatedItemSize: 20, overscan: 0 }, ...children), container)
    await Promise.resolve()
    await Promise.resolve()
    const boundary = container.querySelector("[data-vune-lazy]")
    assert.ok(boundary)
    assert.ok(boundary.querySelectorAll("[data-item]").length < children.length)

    container.scrollTop = 400
    container.dispatchEvent(new dom.window.Event("scroll"))
    await Promise.resolve()
    await Promise.resolve()
    assert.ok(boundary.querySelector("[data-item=20]"))
    unmount()
  } finally {
    Object.defineProperty(dom.window.HTMLElement.prototype, "getBoundingClientRect", { configurable: true, value: originalRect })
    dom.window.close()
  }
})

test("@vune-ui/web refines lazy ranges from measured child sizes", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  container.style.overflowY = "auto"
  Object.defineProperty(container, "clientHeight", { configurable: true, value: 100 })
  const originalRect = dom.window.HTMLElement.prototype.getBoundingClientRect
  Object.defineProperty(dom.window.HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value() {
      if (this.hasAttribute("data-item")) return { x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 40, width: 100, height: 40 }
      return originalRect.call(this)
    },
  })
  const children = Array.from({ length: 100 }, (_, index) => Element("span", { "data-item": String(index) }, String(index)))
  const unmount = mount(LazyVStack({ estimatedItemSize: 20, overscan: 0 }, ...children), container)
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  const boundary = container.querySelector("[data-vune-lazy]")
  assert.ok(boundary)
  assert.equal(boundary.querySelectorAll("[data-item]").length, 3)
  unmount()
  Object.defineProperty(dom.window.HTMLElement.prototype, "getBoundingClientRect", { configurable: true, value: originalRect })
  dom.window.close()
})

test("@vune-ui/web preserves keyed child State across reorder and resets it after remount", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const items = State([{ id: "a" }, { id: "b" }])
  const Row = defineView("IdentityRow", {
    initializers: [initializer("IdentityRow(id)", args => args.length === 1, args => ({ id: args[0] }))],
    state: () => ({ count: State(0) }),
    body: ({ id, count }) => Element("button", {
      "data-row": id,
      onclick: () => { count.value += 1 },
    }, `${id}:${count.value}`),
  })
  const App = defineView("IdentityApp", {
    initializers: [initializer("IdentityApp()", args => args.length === 0)],
    body: () => Element("section", null, ForEach(items.value, item => item.id, item => Row(item.id))),
  })
  const unmount = mount(App(), container)
  container.querySelector('[data-row="a"]')?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  await Promise.resolve()
  assert.equal(container.querySelector('[data-row="a"]')?.textContent, "a:1")
  items.value = [items.value[1], items.value[0]]
  await Promise.resolve()
  assert.deepEqual([...container.querySelectorAll("button")].map(button => button.textContent), ["b:0", "a:1"])
  items.value = items.value.filter(item => item.id !== "a")
  await Promise.resolve()
  items.value = [{ id: "a" }, ...items.value]
  await Promise.resolve()
  assert.equal(container.querySelector('[data-row="a"]')?.textContent, "a:0")
  unmount()
  dom.window.close()
})

test("@vune-ui/web batches synchronous State writes into one View reevaluation", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const count = State(0)
  let bodyRuns = 0
  const App = defineView("BatchedStateWriteApp", {
    initializers: [initializer("App()", args => args.length === 0)],
    body: () => {
      bodyRuns += 1
      return Element("span", { "data-count": true }, String(count.value))
    },
  })

  const unmount = mount(App(), container)
  assert.equal(bodyRuns, 1)
  bodyRuns = 0
  for (let index = 0; index < 1000; index += 1) count.value += 1
  await Promise.resolve()
  assert.equal(bodyRuns, 1)
  assert.equal(container.querySelector("[data-count]")?.textContent, "1000")

  unmount()
  dom.window.close()
})

test("@vune-ui/web isolates row-local invalidation and reuses unchanged keyed View bodies", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const items = State([{ id: "a" }, { id: "b" }, { id: "c" }])
  let appRuns = 0
  let rowRuns = 0
  const Row = defineView("BoundaryPerfRow", {
    initializers: [initializer("Row(id)", args => args.length === 1, args => ({ id: args[0] }))],
    state: () => ({ count: State(0) }),
    body: ({ id, count }) => {
      rowRuns += 1
      return Element("button", {
        "data-row": id,
        onclick: () => { count.value += 1 },
      }, `${id}:${count.value}`)
    },
  })
  const App = defineView("BoundaryPerfApp", {
    initializers: [initializer("App()", args => args.length === 0)],
    body: () => {
      appRuns += 1
      return Element("section", null, ForEach(items.value, item => item.id, item => Row(item.id).foreground("red")))
    },
  })

  const unmount = mount(App(), container)
  assert.equal(appRuns, 1)
  assert.equal(rowRuns, 3)
  const originalA = container.querySelector('[data-row="a"]')
  const originalB = container.querySelector('[data-row="b"]')
  assert.ok(originalA)
  assert.ok(originalB)

  appRuns = 0
  rowRuns = 0
  originalA.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  await Promise.resolve()
  assert.equal(appRuns, 0)
  assert.equal(rowRuns, 1)
  assert.equal(container.querySelector('[data-row="a"]'), originalA)
  assert.equal(originalA.textContent, "a:1")
  assert.equal(originalA.style.color, "red")

  appRuns = 0
  rowRuns = 0
  items.value = [...items.value].reverse()
  await Promise.resolve()
  assert.equal(appRuns, 1)
  assert.equal(rowRuns, 0)
  assert.equal(container.querySelector('[data-row="a"]'), originalA)
  assert.equal(container.querySelector('[data-row="b"]'), originalB)
  assert.deepEqual([...container.querySelectorAll("button")].map(button => button.dataset.row), ["c", "b", "a"])

  appRuns = 0
  rowRuns = 0
  items.value = [...items.value, { id: "d" }]
  await Promise.resolve()
  assert.equal(appRuns, 1)
  assert.equal(rowRuns, 1)
  assert.equal(container.querySelector('[data-row="a"]'), originalA)
  assert.equal(container.querySelector('[data-row="d"]')?.textContent, "d:0")

  unmount()
  dom.window.close()
})

test("@vune-ui/web patches flat keyed host rows in place and preserves generic fallback behavior", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const items = State([
    { id: "a", value: "A", title: "one" },
    { id: "b", value: "B", title: "two" },
    { id: "c", value: "C", title: "three" },
  ])
  const attachRefs = State(false)
  const clicks = []
  const App = defineView("FlatKeyedHostPatchApp", {
    initializers: [initializer("App()", args => args.length === 0)],
    body: () => Element("section", { class: items.value[0].title },
      items.value.map(item => Element("span", {
        key: item.id,
        "data-row": item.id,
        title: item.title,
        onclick: () => clicks.push(item.value),
        ...(attachRefs.value ? { ref: () => {} } : {}),
      }, item.value)),
    ),
  })

  const unmount = mount(App(), container)
  const original = Object.fromEntries([...container.querySelectorAll("span")].map(node => [node.dataset.row, node]))
  const createElement = dom.window.document.createElement.bind(dom.window.document)
  const createTextNode = dom.window.document.createTextNode.bind(dom.window.document)
  let candidateNodes = 0
  dom.window.document.createElement = (...args) => {
    candidateNodes += 1
    return createElement(...args)
  }
  dom.window.document.createTextNode = (...args) => {
    candidateNodes += 1
    return createTextNode(...args)
  }

  items.value = items.value.map(item => ({ ...item, value: `${item.value}1`, title: `${item.title}-next` }))
  await Promise.resolve()
  assert.equal(candidateNodes, 0)
  assert.deepEqual([...container.querySelectorAll("span")].map(node => `${node.dataset.row}:${node.textContent}:${node.title}`), [
    "a:A1:one-next", "b:B1:two-next", "c:C1:three-next",
  ])
  assert.ok([...container.querySelectorAll("span")].every(node => node === original[node.dataset.row]))
  assert.equal(container.querySelector("section")?.className, "one-next")
  assert.ok([...container.querySelectorAll("span")].every(node => !node.hasAttribute("key")))
  container.querySelector('[data-row="b"]')?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  assert.deepEqual(clicks, ["B1"])

  candidateNodes = 0
  items.value = [...items.value].reverse()
  await Promise.resolve()
  assert.equal(candidateNodes, 0)
  assert.deepEqual([...container.querySelectorAll("span")].map(node => node.dataset.row), ["c", "b", "a"])
  assert.ok([...container.querySelectorAll("span")].every(node => node === original[node.dataset.row]))

  candidateNodes = 0
  items.value = [...items.value, { id: "d", value: "D", title: "four" }]
  await Promise.resolve()
  assert.equal(candidateNodes, 2)
  assert.equal(container.querySelector('[data-row="a"]'), original.a)
  assert.equal(container.querySelector('[data-row="c"]'), original.c)
  const appended = container.querySelector('[data-row="d"]')
  assert.equal(appended?.textContent, "D")

  candidateNodes = 0
  items.value = items.value.filter(item => item.id !== "b")
  await Promise.resolve()
  assert.equal(candidateNodes, 0)
  assert.deepEqual([...container.querySelectorAll("span")].map(node => node.dataset.row), ["c", "a", "d"])
  assert.equal(container.querySelector('[data-row="c"]'), original.c)
  assert.equal(container.querySelector('[data-row="a"]'), original.a)
  assert.equal(container.querySelector('[data-row="d"]'), appended)

  candidateNodes = 0
  attachRefs.value = true
  await Promise.resolve()
  assert.ok(candidateNodes > 0)
  assert.deepEqual([...container.querySelectorAll("span")].map(node => node.dataset.row), ["c", "a", "d"])

  dom.window.document.createElement = createElement
  dom.window.document.createTextNode = createTextNode
  unmount()
  dom.window.close()
})

test("@vune-ui/web executes ForEach host rows persistently and invalidates only changed entries", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const items = State([
    { id: "a", value: "A" },
    { id: "b", value: "B" },
    { id: "c", value: "C" },
  ])
  let rowRuns = 0
  const App = defineView("PersistentForEachHostApp", {
    initializers: [initializer("PersistentForEachHostApp()", args => args.length === 0)],
    body: () => Element("section", null, ForEach(items.value, item => {
      rowRuns += 1
      return Element("span", { "data-row": item.id, title: item.value }, item.value)
    })),
  })

  const unmount = mount(App(), container)
  assert.equal(rowRuns, 3)
  const original = Object.fromEntries([...container.querySelectorAll("span")].map(node => [node.dataset.row, node]))
  const createElement = dom.window.document.createElement.bind(dom.window.document)
  const createTextNode = dom.window.document.createTextNode.bind(dom.window.document)
  let allocations = 0
  dom.window.document.createElement = (...args) => {
    allocations += 1
    return createElement(...args)
  }
  dom.window.document.createTextNode = (...args) => {
    allocations += 1
    return createTextNode(...args)
  }

  rowRuns = 0
  const changed = [...items.value]
  changed[1] = { ...changed[1], value: "B1" }
  items.value = changed
  await Promise.resolve()
  assert.equal(rowRuns, 1)
  assert.equal(allocations, 0)
  assert.equal(container.querySelector('[data-row="a"]'), original.a)
  assert.equal(container.querySelector('[data-row="b"]'), original.b)
  assert.equal(container.querySelector('[data-row="b"]')?.textContent, "B1")
  assert.equal(container.querySelector('[data-row="b"]')?.title, "B1")

  rowRuns = 0
  allocations = 0
  items.value = [...items.value].reverse()
  await Promise.resolve()
  assert.equal(rowRuns, 2)
  assert.equal(allocations, 0)
  assert.deepEqual([...container.querySelectorAll("span")].map(node => node.dataset.row), ["c", "b", "a"])

  rowRuns = 0
  allocations = 0
  items.value = [...items.value, { id: "d", value: "D" }]
  await Promise.resolve()
  assert.equal(rowRuns, 1)
  assert.equal(allocations, 2)
  const appended = container.querySelector('[data-row="d"]')
  assert.equal(appended?.textContent, "D")

  rowRuns = 0
  allocations = 0
  items.value = items.value.filter(item => item.id !== "b")
  await Promise.resolve()
  assert.equal(rowRuns, 2)
  assert.equal(allocations, 0)
  assert.equal(container.querySelector('[data-row="a"]'), original.a)
  assert.equal(container.querySelector('[data-row="c"]'), original.c)
  assert.equal(container.querySelector('[data-row="d"]'), appended)

  dom.window.document.createElement = createElement
  dom.window.document.createTextNode = createTextNode
  unmount()
  dom.window.close()
})

test("@vune-ui/web reevaluates moved generic ForEach rows when content observes the index", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const items = State([{ id: "a" }, { id: "b" }, { id: "c" }])
  let rowRuns = 0
  const App = defineView("IndexedPersistentForEachHostApp", {
    initializers: [initializer("IndexedPersistentForEachHostApp()", args => args.length === 0)],
    body: () => Element("section", null, ForEach(items.value, (item, index) => {
      rowRuns += 1
      return Element("span", { "data-row": item.id }, String(index) + ":" + item.id)
    })),
  })

  const unmount = mount(App(), container)
  assert.equal(rowRuns, 3)
  rowRuns = 0
  items.value = [...items.value].reverse()
  await Promise.resolve()
  assert.equal(rowRuns, 2)
  assert.deepEqual([...container.querySelectorAll("span")].map(node => node.textContent), ["0:c", "1:b", "2:a"])
  unmount()
  dom.window.close()
})

test("@vune-ui/web batches in-place ForEach mutations and preserves keyed row identity", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const items = State([{ id: "a" }, { id: "b" }, { id: "c" }])
  let appRuns = 0
  let rowRuns = 0
  const Row = defineView("InPlaceMutationRow", {
    initializers: [initializer("Row(id)", args => args.length === 1, args => ({ id: args[0] }))],
    state: () => ({ count: State(0) }),
    body: ({ id, count }) => {
      rowRuns += 1
      return Element("button", { "data-row": id, onclick: () => { count.value += 1 } }, `${id}:${count.value}`)
    },
  })
  const App = defineView("InPlaceMutationApp", {
    initializers: [initializer("App()", args => args.length === 0)],
    body: () => {
      appRuns += 1
      return Element("section", null, ForEach(items, item => item.id, item => Row(item.id)))
    },
  })

  const unmount = mount(App(), container)
  const originalA = container.querySelector('[data-row="a"]')
  const originalB = container.querySelector('[data-row="b"]')
  assert.ok(originalA)
  assert.ok(originalB)
  originalA.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  await Promise.resolve()
  assert.equal(originalA.textContent, "a:1")

  appRuns = 0
  rowRuns = 0
  items.value.reverse()
  await Promise.resolve()
  assert.equal(appRuns, 1)
  assert.equal(rowRuns, 0)
  assert.deepEqual([...container.querySelectorAll("button")].map(button => button.dataset.row), ["c", "b", "a"])
  assert.equal(container.querySelector('[data-row="a"]'), originalA)
  assert.equal(container.querySelector('[data-row="b"]'), originalB)
  assert.equal(originalA.textContent, "a:1")

  appRuns = 0
  rowRuns = 0
  items.value.push({ id: "d" })
  await Promise.resolve()
  assert.equal(appRuns, 1)
  assert.equal(rowRuns, 1)
  assert.equal(container.querySelector('[data-row="a"]'), originalA)
  assert.equal(container.querySelector('[data-row="d"]')?.textContent, "d:0")

  unmount()
  dom.window.close()
})

test("@vune-ui/web wakes nested empty View boundaries in one scheduler turn", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const visible = State(false)
  let parentRuns = 0
  let childRuns = 0
  const Child = defineView("NestedEmptyBoundaryChild", {
    initializers: [initializer("Child()", args => args.length === 0)],
    body: () => {
      childRuns += 1
      return visible.value ? Element("span", { "data-visible": true }, "visible") : viewFragment([])
    },
  })
  const Parent = defineView("NestedEmptyBoundaryParent", {
    initializers: [initializer("Parent()", args => args.length === 0)],
    body: () => {
      parentRuns += 1
      return Element("section", null, Child())
    },
  })

  const unmount = mount(Parent(), container)
  assert.equal(container.querySelector("[data-visible]"), null)
  assert.equal(parentRuns, 1)
  assert.equal(childRuns, 1)

  visible.value = true
  await Promise.resolve()
  assert.equal(container.querySelector("[data-visible]")?.textContent, "visible")

  const parentRunsAfterShow = parentRuns
  visible.value = false
  await Promise.resolve()
  assert.equal(container.querySelector("[data-visible]"), null)
  assert.equal(parentRuns, parentRunsAfterShow)

  visible.value = true
  await Promise.resolve()
  assert.equal(container.querySelector("[data-visible]")?.textContent, "visible")

  unmount()
  dom.window.close()
})

test("@vune-ui/web reuses live View subtrees across ancestor replacement and outer modifier changes", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const wrapper = State("section")
  const color = State("red")
  let rowRuns = 0
  const Row = defineView("ReuseAcrossAncestorRow", {
    initializers: [initializer("Row()", args => args.length === 0)],
    state: () => ({ count: State(0) }),
    body: ({ count }) => {
      rowRuns += 1
      return Element("button", { onclick: () => { count.value += 1 } }, `count:${count.value}`)
    },
  })
  const App = defineView("ReuseAcrossAncestorApp", {
    initializers: [initializer("App()", args => args.length === 0)],
    body: () => Element(wrapper.value, null, Row().foreground(color.value)),
  })

  const unmount = mount(App(), container)
  const button = container.querySelector("button")
  assert.ok(button)
  assert.equal(rowRuns, 1)
  assert.equal(button.style.color, "red")

  rowRuns = 0
  color.value = "blue"
  await Promise.resolve()
  assert.equal(rowRuns, 0)
  assert.equal(container.querySelector("button"), button)
  assert.equal(button.style.color, "blue")

  wrapper.value = "div"
  await Promise.resolve()
  assert.equal(rowRuns, 0)
  assert.equal(container.firstElementChild?.localName, "div")
  assert.equal(container.querySelector("button"), button)
  assert.equal(button.textContent, "count:0")

  button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  await Promise.resolve()
  assert.equal(button.textContent, "count:1")

  unmount()
  dom.window.close()
})

test("@vune-ui/web hydrates existing SSR markup and wires the live DOM boundary", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const Counter = defineView("HydratedCounter", {
    initializers: [initializer("HydratedCounter()", args => args.length === 0)],
    state: () => ({ count: State(0) }),
    body: ({ count }) => Element("button", { onclick: () => { count.value += 1 } }, Element("span", null, String(count.value))),
  })
  const value = Counter()
  container.innerHTML = renderToHTML(value)
  const serverNode = container.firstElementChild
  const unmount = mount(value, container, { hydrate: true })
  assert.equal(container.firstElementChild, serverNode)
  container.querySelector("button")?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  await Promise.resolve()
  assert.equal(container.textContent, "1")
  unmount()
  dom.window.close()
})

test("@vune-ui/web keeps explicit ForEach identity through SSR hydration and reorder", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const items = State([{ id: "a" }, { id: "b" }])
  const Row = defineView("HydratedIdentityRow", {
    initializers: [initializer("Row(id)", args => args.length === 1, args => ({ id: args[0] }))],
    state: () => ({ count: State(0) }),
    body: ({ id, count }) => Element("button", { "data-row": id, onclick: () => { count.value += 1 } }, `${id}:${count.value}`),
  })
  const App = defineView("HydratedIdentityApp", {
    initializers: [initializer("App()", args => args.length === 0)],
    body: () => Element("section", null, ForEach(items.value, item => item.id, item => Row(item.id))),
  })
  const value = App()
  container.innerHTML = renderToHTML(value)
  const serverA = container.querySelector('[data-row="a"]')
  const unmount = mount(value, container, { hydrate: true })
  serverA?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  await Promise.resolve()
  assert.equal(serverA?.textContent, "a:1")
  items.value = [items.value[1], items.value[0]]
  await Promise.resolve()
  assert.equal(container.querySelector('[data-row="a"]'), serverA)
  assert.deepEqual([...container.querySelectorAll("button")].map(button => button.textContent), ["b:0", "a:1"])
  unmount()
  dom.window.close()
})

test("@vune-ui/web hydrates the frame host without replacing its child", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const Counter = defineView("HydratedFrameCounter", {
    initializers: [initializer("HydratedFrameCounter()", args => args.length === 0)],
    state: () => ({ count: State(0) }),
    body: ({ count }) => Element("button", { onclick: () => { count.value += 1 } }, String(count.value)).frame({
      width: 120,
      height: 48,
      alignment: "center",
    }),
  })
  const value = Counter()
  container.innerHTML = renderToHTML(value)
  const serverFrame = container.firstElementChild
  const serverButton = container.querySelector("button")
  const unmount = mount(value, container, { hydrate: true })
  assert.equal(container.firstElementChild, serverFrame)
  assert.equal(container.querySelector("button"), serverButton)
  serverButton?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  await Promise.resolve()
  assert.equal(container.textContent, "1")
  unmount()
  dom.window.close()
})

test("@vune-ui/web falls back to a fresh client tree when hydration structure mismatches", async () => {
  const dom = new JSDOM("<div id=app><div data-stale>stale</div></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  let reference = null
  const count = State(0)
  const Counter = defineView("HydrationMismatchCounter", {
    initializers: [initializer("Counter()", args => args.length === 0)],
    body: () => Element("button", {
      ref: node => { reference = node },
      onclick: () => { count.value += 1 },
    }, String(count.value)),
  })
  const unmount = mount(Counter(), container, { hydrate: true })
  const button = container.querySelector("button")
  assert.ok(button)
  assert.equal(reference, button)
  button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  await Promise.resolve()
  assert.equal(container.textContent, "1")
  unmount()
  assert.equal(reference, null)
  dom.window.close()
})

test("@vune-ui/web commits refs only after live DOM reconciliation and keeps stable refs stable", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const value = State("one")
  const calls = []
  const reference = node => calls.push(node ? { node, connected: node.isConnected } : null)
  const App = defineView("CommittedRef", {
    initializers: [initializer("CommittedRef()", args => args.length === 0)],
    body: () => Element("button", { ref: reference }, value.value),
  })
  const unmount = mount(App(), container)
  const button = container.querySelector("button")
  assert.ok(button)
  assert.deepEqual(calls, [{ node: button, connected: true }])
  value.value = "two"
  await Promise.resolve()
  assert.equal(container.querySelector("button"), button)
  assert.deepEqual(calls, [{ node: button, connected: true }])
  unmount()
  assert.deepEqual(calls, [{ node: button, connected: true }, null])
  dom.window.close()
})

test("@vune-ui/web unmount finishes cleanup when one ref callback throws", () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  let secondCleaned = false
  const value = Element("div", null,
    Element("button", { ref: node => { if (node === null) throw new Error("ref cleanup failed") } }, "first"),
    Element("button", { ref: node => { if (node === null) secondCleaned = true } }, "second"),
  )
  const unmount = mount(value, container)

  assert.throws(() => unmount(), /ref cleanup failed/)
  assert.equal(secondCleaned, true)
  assert.equal(container.childNodes.length, 0)
  assert.doesNotThrow(() => unmount())
  dom.window.close()
})

test("@vune-ui/web object refs do not execute has or accessor traps", () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  let hasCalls = 0
  const reference = new Proxy({ current: null }, {
    has() {
      hasCalls += 1
      throw new Error("object ref has trap must not run")
    },
  })
  const unmount = mount(Element("button", { ref: reference }, "Safe"), container)
  const button = container.querySelector("button")
  assert.ok(button)
  assert.strictEqual(reference.current, button)
  assert.equal(hasCalls, 0)
  unmount()
  assert.equal(reference.current, null)
  assert.equal(hasCalls, 0)

  let accessorCalls = 0
  const accessorReference = {}
  Object.defineProperty(accessorReference, "current", {
    configurable: true,
    get() { accessorCalls += 1; return null },
    set() { accessorCalls += 1 },
  })
  const unmountAccessor = mount(Element("button", { ref: accessorReference }, "Ignored"), container)
  assert.equal(accessorCalls, 0)
  unmountAccessor()
  assert.equal(accessorCalls, 0)
  dom.window.close()
})

test("@vune-ui/web normalizes DOM event names and boolean, ARIA, and enumerated attributes", () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  let doubleClicks = 0
  const value = Element("button", {
    onDoubleClick: () => { doubleClicks += 1 },
    disabled: false,
    "aria-expanded": false,
    draggable: false,
    contentEditable: false,
  }, "Open")
  const unmount = mount(value, container)
  const button = container.querySelector("button")
  assert.ok(button)
  button.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true }))
  assert.equal(doubleClicks, 1)
  assert.equal(button.hasAttribute("disabled"), false)
  assert.equal(button.getAttribute("aria-expanded"), "false")
  assert.equal(button.getAttribute("draggable"), "false")
  assert.equal(button.getAttribute("contenteditable"), "false")
  const html = renderToHTML(value)
  assert.doesNotMatch(html, /\sdisabled(?:[= >])/)
  assert.match(html, /aria-expanded="false"/)
  assert.match(html, /draggable="false"/)
  assert.match(html, /contenteditable="false"/)
  unmount()
  dom.window.close()
})

test("@vune-ui/web never serializes non-function event props into SSR HTML", () => {
  const value = Element("button", {
    onclick: "globalThis.__unexpectedInlineEvent = true",
    onClickCapture: false,
    "aria-pressed": false,
  }, "Safe")
  const html = renderToHTML(value)
  assert.doesNotMatch(html, /\sonclick(?:capture)?=/i)
  assert.match(html, /aria-pressed="false"/)
})

test("@vune-ui/web rejects invalid programmatic HTML names during SSR", () => {
  assert.throws(
    () => renderToHTML(Element('div><script data-owned="yes"', null, "Safe")),
    /Invalid HTML tag name/,
  )
  assert.throws(
    () => renderToHTML(Element("div", { 'title" data-owned': "yes" }, "Safe")),
    /Invalid HTML attribute name/,
  )
  assert.equal(
    renderToHTML(Element("vune-chart", { "data-series": "revenue", xlinkHref: "#chart" })),
    '<vune-chart data-series="revenue" xlink:href="#chart"></vune-chart>',
  )
  assert.equal(
    renderToHTML(Element("élement", { "資料": "값", "a·b": "ok", ":kind": "custom" }, "Safe")),
    '<élement 資料="값" a·b="ok" :kind="custom">Safe</élement>',
  )
})

test("@vune-ui/web replaces every unkeyed sibling when multiple node types change together", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const alternate = State(false)
  const App = defineView("UnkeyedSiblingReplacement", {
    initializers: [initializer("UnkeyedSiblingReplacement()", args => args.length === 0)],
    body: () => Element("div", null, ...(alternate.value
      ? [Element("span", null, "A"), Element("em", null, "B")]
      : [Element("i", null, "X"), Element("b", null, "Y")])),
  })
  const unmount = mount(App(), container)
  assert.deepEqual([...container.querySelector("div").children].map(element => element.localName), ["i", "b"])
  alternate.value = true
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual([...container.querySelector("div").children].map(element => element.localName), ["span", "em"])
  assert.equal(container.textContent, "AB")
  unmount()
  dom.window.close()
})

test("@vune-ui/web hydration fallback drops unvisited stale descendants and attributes", async () => {
  const value = Element("strong", { class: "root" }, "lead", Element("span", { class: "tail" }, "tail"))
  const dom = new JSDOM('<div id=app><strong class="root"><span class="tail">tail</span><i data-stale="true">bogus</i></strong></div>')
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const serverRoot = container.firstElementChild
  const unmount = mount(value, container, { hydrate: true })
  await Promise.resolve()
  await Promise.resolve()
  assert.notEqual(container.firstElementChild, serverRoot)
  assert.equal(container.innerHTML, '<strong class="root">lead<span class="tail">tail</span></strong>')
  unmount()
  dom.window.close()
})

test("@vune-ui/web hydration fallback detaches listeners from partially hydrated server nodes", () => {
  const dom = new JSDOM('<div id=app><section><button>go</button><i>stale</i></section></div>')
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const serverButton = container.querySelector("button")
  assert.ok(serverButton)
  let clicks = 0
  const value = Element("section", null,
    Element("button", { onclick: () => { clicks += 1 } }, "go"),
    Element("span", null, "fresh"),
  )
  const unmount = mount(value, container, { hydrate: true })
  const clientButton = container.querySelector("button")
  assert.ok(clientButton)
  assert.notEqual(clientButton, serverButton)

  serverButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  assert.equal(clicks, 0)
  clientButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  assert.equal(clicks, 1)

  unmount()
  clientButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  assert.equal(clicks, 1)
  dom.window.close()
})

test("@vune-ui/web hydration reconciles stale server attributes without replacing matching nodes", () => {
  const dom = new JSDOM('<div id=app><div class="server" title="old" style="width:10px" data-stale="yes">server</div></div>')
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const server = container.firstElementChild
  const value = Element("div", { class: "client", title: "new", style: { width: "20px" } }, "client")
  const unmount = mount(value, container, { hydrate: true })
  assert.equal(container.firstElementChild, server)
  assert.equal(server.getAttribute("class"), "client")
  assert.equal(server.getAttribute("title"), "new")
  assert.equal(server.getAttribute("style"), "width: 20px;")
  assert.equal(server.hasAttribute("data-stale"), false)
  assert.equal(server.textContent, "client")
  unmount()
  dom.window.close()
})

test("@vune-ui/web creates contextual SVG namespaces and returns to HTML inside foreignObject", () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const value = [
    Element("a", { "data-html-link": true }, "html"),
    Element("svg", { viewBox: "0 0 10 10" },
      Element("a", { "data-svg-link": true, xlinkHref: "#target" },
        Element("title", null, "svg title"),
      ),
      Element("path", { d: "M0 0L10 10" }),
      Element("foreignObject", null, Element("div", { "data-html-child": true }, "html child")),
    ),
  ]
  const unmount = mount(value, container)
  const HTML_NS = "http://www.w3.org/1999/xhtml"
  const SVG_NS = "http://www.w3.org/2000/svg"
  const XLINK_NS = "http://www.w3.org/1999/xlink"
  assert.equal(container.querySelector("[data-html-link]").namespaceURI, HTML_NS)
  const svg = container.querySelector("svg")
  assert.equal(svg.namespaceURI, SVG_NS)
  assert.equal(svg.querySelector("[data-svg-link]").namespaceURI, SVG_NS)
  assert.equal(svg.querySelector("title").namespaceURI, SVG_NS)
  assert.equal(svg.querySelector("path").namespaceURI, SVG_NS)
  assert.equal(svg.querySelector("foreignObject").namespaceURI, SVG_NS)
  assert.equal(svg.querySelector("[data-html-child]").namespaceURI, HTML_NS)
  assert.equal(svg.querySelector("[data-svg-link]").getAttributeNS(XLINK_NS, "href"), "#target")
  unmount()
  dom.window.close()
})

test("@vune-ui/web preserves State for logically present offscreen lazy rows and drops removed rows", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  container.style.overflowY = "auto"
  Object.defineProperty(container, "clientHeight", { configurable: true, value: 100 })
  const items = State(Array.from({ length: 50 }, (_, index) => `row-${index}`))
  const Row = defineView("LazyStateRow", {
    initializers: [initializer("Row(id)", args => args.length === 1, args => ({ id: args[0] }))],
    state: () => ({ count: State(0) }),
    body: ({ id, count }) => Element("button", {
      "data-row": id,
      onclick: () => { count.value += 1 },
    }, `${id}:${count.value}`),
  })
  const App = defineView("LazyStateApp", {
    initializers: [initializer("App()", args => args.length === 0)],
    body: () => LazyVStack(
      { estimatedItemSize: 20, overscan: 0 },
      ...items.value.map(id => Row(id).keyed(id)),
    ),
  })
  const unmount = mount(App(), container)
  container.querySelector('[data-row="row-0"]')?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  await Promise.resolve()
  assert.equal(container.querySelector('[data-row="row-0"]')?.textContent, "row-0:1")

  container.scrollTop = 400
  container.dispatchEvent(new dom.window.Event("scroll"))
  await Promise.resolve(); await Promise.resolve()
  assert.equal(container.querySelector('[data-row="row-0"]'), null)
  container.scrollTop = 0
  container.dispatchEvent(new dom.window.Event("scroll"))
  await Promise.resolve(); await Promise.resolve()
  assert.equal(container.querySelector('[data-row="row-0"]')?.textContent, "row-0:1")

  container.scrollTop = 400
  container.dispatchEvent(new dom.window.Event("scroll"))
  await Promise.resolve(); await Promise.resolve()
  items.value = items.value.filter(id => id !== "row-0")
  await Promise.resolve(); await Promise.resolve()
  items.value = ["row-0", ...items.value]
  await Promise.resolve(); await Promise.resolve()
  container.scrollTop = 0
  container.dispatchEvent(new dom.window.Event("scroll"))
  await Promise.resolve(); await Promise.resolve()
  assert.equal(container.querySelector('[data-row="row-0"]')?.textContent, "row-0:0")
  unmount()
  dom.window.close()
})


test("@vune-ui/web lets a compiled keyed collection own its State subscription", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const items = State([{ id: "a", value: "A" }, { id: "b", value: "B" }, { id: "c", value: "C" }])
  let parentRuns = 0
  let rowRuns = 0
  let keyRuns = 0
  const content = compiledCollectionContent(item => Element("span", { "data-row": item.id }, item.value), {
    kind: "flat-text-host",
    indexIndependent: true,
    evaluateKey: item => { keyRuns += 1; return item.id },
    evaluate: item => { rowRuns += 1; return { type: "span", props: { "data-row": item.id }, text: item.value } },
  })
  const App = defineView("OwnedCompiledCollectionApp", {
    initializers: [initializer("OwnedCompiledCollectionApp()", args => args.length === 0)],
    body: () => { parentRuns += 1; return Element("section", null, ForEach.viewType.createNodeCompiled(1, [items, item => item.id, content])) },
  })
  const unmount = mount(App(), container)
  assert.equal(parentRuns, 1)
  assert.equal(rowRuns, 3)

  rowRuns = 0
  keyRuns = 0
  const before = container.querySelector("[data-row=b]")
  items.value[1] = { id: "b", value: "B1" }
  await Promise.resolve(); await Promise.resolve()
  assert.equal(parentRuns, 1)
  assert.equal(rowRuns, 1)
  assert.equal(keyRuns, 1)
  assert.strictEqual(container.querySelector("[data-row=b]"), before)
  assert.equal(container.querySelector("[data-row=b]")?.textContent, "B1")

  rowRuns = 0
  keyRuns = 0
  items.value[1].value = "B2"
  await Promise.resolve(); await Promise.resolve()
  assert.equal(parentRuns, 1)
  assert.equal(rowRuns, 1)
  assert.equal(keyRuns, 1)
  assert.strictEqual(container.querySelector("[data-row=b]"), before)
  assert.equal(container.querySelector("[data-row=b]")?.textContent, "B2")

  unmount()
  dom.window.close()
})

test("@vune-ui/web keeps eventful compiled collection rows on the generic renderer path", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const items = State([{ id: "a", value: "A", calls: 0 }])
  let parentRuns = 0
  let genericRows = 0
  const content = compiledCollectionContent(item => {
    genericRows += 1
    return Element("button", { "data-row": item.id, onClick: () => { item.calls += 1 } }, item.value)
  }, {
    kind: "flat-text-host",
    indexIndependent: true,
    evaluateKey: item => item.id,
    evaluate: item => ({ type: "button", props: { "data-row": item.id, onClick: () => { item.calls += 1 } }, text: item.value }),
  })
  const App = defineView("EventfulCompiledCollectionFallbackApp", {
    initializers: [initializer("EventfulCompiledCollectionFallbackApp()", args => args.length === 0)],
    body: () => { parentRuns += 1; return Element("section", null, ForEach.viewType.createNodeCompiled(1, [items, item => item.id, content])) },
  })
  const unmount = mount(App(), container)
  assert.equal(genericRows, 1)
  container.querySelector("button")?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  await Promise.resolve(); await Promise.resolve()
  assert.equal(items.value[0].calls, 1)
  assert.equal(parentRuns, 2)
  assert.equal(genericRows, 2)

  items.value[0].value = "A2"
  await Promise.resolve(); await Promise.resolve()
  assert.equal(container.querySelector("button")?.textContent, "A2")
  assert.equal(parentRuns, 3)
  assert.equal(genericRows, 3)
  unmount()
  dom.window.close()
})


test("@vune-ui/web executes push pop and reverse without reevaluating stable compiled rows", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const items = State([{ id: "a", value: "A" }, { id: "b", value: "B" }, { id: "c", value: "C" }])
  let parentRuns = 0
  let rowRuns = 0
  let keyRuns = 0
  const content = compiledCollectionContent(item => Element("span", { "data-row": item.id }, item.value), {
    kind: "flat-text-host",
    indexIndependent: true,
    evaluateKey: item => { keyRuns += 1; return item.id },
    evaluate: item => { rowRuns += 1; return { type: "span", props: { "data-row": item.id }, text: item.value } },
  })
  const App = defineView("StructuralCompiledCollectionApp", {
    initializers: [initializer("StructuralCompiledCollectionApp()", args => args.length === 0)],
    body: () => { parentRuns += 1; return Element("section", null, ForEach.viewType.createNodeCompiled(1, [items, item => item.id, content])) },
  })
  const unmount = mount(App(), container)
  const a = container.querySelector("[data-row=a]")
  const b = container.querySelector("[data-row=b]")
  const c = container.querySelector("[data-row=c]")
  assert.equal(parentRuns, 1)

  rowRuns = 0
  keyRuns = 0
  items.value.push({ id: "d", value: "D" })
  await Promise.resolve(); await Promise.resolve()
  assert.equal(parentRuns, 1)
  assert.equal(rowRuns, 1)
  assert.equal(keyRuns, 1)
  assert.deepEqual([...container.querySelectorAll("span")].map(node => node.textContent), ["A", "B", "C", "D"])
  assert.strictEqual(container.querySelector("[data-row=a]"), a)

  rowRuns = 0
  keyRuns = 0
  items.value.pop()
  await Promise.resolve(); await Promise.resolve()
  assert.equal(parentRuns, 1)
  assert.equal(rowRuns, 0)
  assert.equal(keyRuns, 0)
  assert.equal(container.querySelector("[data-row=d]"), null)

  rowRuns = 0
  keyRuns = 0
  items.value.reverse()
  await Promise.resolve(); await Promise.resolve()
  assert.equal(parentRuns, 1)
  assert.equal(rowRuns, 0)
  assert.equal(keyRuns, 0)
  assert.deepEqual([...container.querySelectorAll("span")].map(node => node.textContent), ["C", "B", "A"])
  assert.strictEqual(container.querySelector("[data-row=a]"), a)
  assert.strictEqual(container.querySelector("[data-row=b]"), b)
  assert.strictEqual(container.querySelector("[data-row=c]"), c)

  unmount()
  dom.window.close()
})

test("@vune-ui/web preserves duplicate occurrence identity after append falls back to generic reconcile", async () => {
  const dom = new JSDOM("<div id=app></div>")
  const container = dom.window.document.querySelector("#app")
  assert.ok(container)
  const items = State([{ id: "a", value: "A0" }])
  let parentRuns = 0
  let rowRuns = 0
  let keyRuns = 0
  const content = compiledCollectionContent(item => Element("span", { "data-row": item.id }, item.value), {
    kind: "flat-text-host",
    indexIndependent: true,
    evaluateKey: item => { keyRuns += 1; return item.id },
    evaluate: item => { rowRuns += 1; return { type: "span", props: { "data-row": item.id }, text: item.value } },
  })
  const App = defineView("DuplicateAppendCompiledCollectionApp", {
    initializers: [initializer("DuplicateAppendCompiledCollectionApp()", args => args.length === 0)],
    body: () => { parentRuns += 1; return Element("section", null, ForEach.viewType.createNodeCompiled(1, [items, item => item.id, content])) },
  })
  const unmount = mount(App(), container)

  rowRuns = 0
  keyRuns = 0
  items.value.push({ id: "a", value: "A1" })
  await Promise.resolve(); await Promise.resolve()
  assert.equal(parentRuns, 1)
  assert.equal(rowRuns, 1)
  assert.equal(keyRuns, 1)
  const appended = container.querySelectorAll('[data-row="a"]')[1]
  assert.ok(appended)

  rowRuns = 0
  keyRuns = 0
  items.value.splice(0, 0, { id: "z", value: "Z" })
  await Promise.resolve(); await Promise.resolve()
  assert.equal(parentRuns, 1)
  assert.equal(rowRuns, 1)
  assert.equal(keyRuns, 3)
  assert.deepEqual([...container.querySelectorAll("span")].map(node => node.textContent), ["Z", "A0", "A1"])
  assert.strictEqual(container.querySelectorAll('[data-row="a"]')[1], appended)

  unmount()
  dom.window.close()
})
