import test from "node:test"
import assert from "node:assert/strict"
import { Animation } from "../packages/core/dist/index.js"
import { animateDomLayout, animateDomStyle, animateDomStyles, cancelDomAnimations, motionSpecForAnimation } from "../packages/web/dist/motion.js"

function fakeElement(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    style: {
      setProperty(name, value) { values.set(name, String(value)) },
      getPropertyValue(name) { return values.get(name) ?? "" },
      removeProperty(name) { values.delete(name) },
    },
    value(name) { return values.get(name) },
  }
}

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

test("Vune reuses precompiled motion specs across persistent scalar retargets", async () => {
  const element = fakeElement({ opacity: "0" })
  const animation = Animation.linear(0.012)
  const spec = motionSpecForAnimation(animation)
  assert.strictEqual(motionSpecForAnimation(animation), spec)
  assert.equal(animateDomStyle(element, "opacity", "0", 1, animation), true)
  await sleep(6)
  assert.equal(animateDomStyle(element, "opacity", element.value("opacity") ?? "0", 0.25, animation), true)
  await sleep(70)
  assert.equal(Number(element.value("opacity")), 0.25)
  cancelDomAnimations(element)
})

test("Vune forwards spring blendDuration into the precompiled engine plan", () => {
  const animation = Animation.spring(0.4, 0.8, 0.12).speed(2)
  const spec = motionSpecForAnimation(animation)
  assert.equal(spec.kind, "spring")
  assert.equal(spec.blendDuration, 0.06)
})

test("Vune motion plan applies delay and finite autoreversing repeats without rebuilding the channel", async () => {
  const element = fakeElement({ opacity: "0" })
  const animation = Animation.linear(0.008).delay(0.02).repeatCount(2, true)
  assert.equal(animateDomStyle(element, "opacity", "0", 1, animation), true)
  await sleep(10)
  assert.equal(element.value("opacity"), "0")
  await sleep(180)
  assert.equal(Number(element.value("opacity")), 1)
  cancelDomAnimations(element)
})

test("interpolated motion repeats count forward passes exactly once and autoreverses", async () => {
  const history = []
  const values = new Map([["transform", "translateX(0px)"]])
  const element = {
    style: {
      setProperty(name, value) {
        values.set(name, String(value))
        if (name === "transform") history.push(String(value))
      },
    },
  }
  const animation = Animation.linear(0.008).repeatCount(2, true)
  assert.equal(animateDomStyle(element, "transform", "translateX(0px)", "translateX(10px)", animation), true)
  await sleep(160)
  assert.ok(history.some(value => value === "none" || /\b0(?:\.0+)?px\b/.test(value)), `expected an autoreverse pass: ${history.join(" -> ")}`)
  assert.match(history.at(-1) ?? "", /10(?:\.0+)?px/)
  cancelDomAnimations(element)
})

test("delayed scalar retarget keeps the current presentation motion running until handoff", async () => {
  const element = fakeElement({ opacity: "0" })
  const first = Animation.linear(0.16)
  const delayed = Animation.linear(0.04).delay(0.08)
  assert.equal(animateDomStyle(element, "opacity", "0", 1, first), true)
  await sleep(25)
  const atRetarget = Number(element.value("opacity"))
  assert.equal(animateDomStyle(element, "opacity", element.value("opacity") ?? "0", 0.25, delayed), true)
  await sleep(35)
  const duringDelay = Number(element.value("opacity"))
  assert.ok(duringDelay > atRetarget, `expected the old motion to continue during delay: ${atRetarget} -> ${duringDelay}`)
  await sleep(150)
  assert.equal(Number(element.value("opacity")), 0.25)
  cancelDomAnimations(element)
})

test("cancelling a property clears delayed writes and prevents stale commits", async () => {
  const element = fakeElement({ opacity: "0" })
  const animation = Animation.linear(0.01).delay(0.03)
  assert.equal(animateDomStyle(element, "opacity", "0", 1, animation), true)
  cancelDomAnimations(element)
  await sleep(70)
  assert.equal(element.value("opacity"), "0")
})


test("equivalent recreated Animation descriptors share one compiled motion spec", () => {
  const first = motionSpecForAnimation(Animation.easeInOut(0.123).delay(0.017))
  const second = motionSpecForAnimation(Animation.easeInOut(0.123).delay(0.017))
  assert.strictEqual(second, first)
})

test("multi-style motion launches independent channels together without cross-cancellation", async () => {
  const element = fakeElement({ opacity: "0", scale: "1", translate: "0px 0px" })
  const opacityAnimation = Animation.linear(0.09)
  const scaleAnimation = Animation.spring(0.05, 0.78)
  const positionAnimation = Animation.easeInOut(0.06)
  const started = animateDomStyles(element, [
    { property: "opacity", from: "0", to: "1", animation: opacityAnimation },
    { property: "scale", from: "1", to: "1.8", animation: scaleAnimation },
    { property: "translate", from: "0px 0px", to: "30px -12px", animation: positionAnimation },
  ])
  assert.deepEqual([...started].sort(), ["opacity", "scale", "translate"])

  await sleep(28)
  const opacityBeforeScaleRetarget = Number(element.value("opacity"))
  assert.ok(opacityBeforeScaleRetarget > 0 && opacityBeforeScaleRetarget < 1)
  // Retarget only scale with a fourth curve. The opacity and position drivers
  // must keep running because every CSS property owns an independent channel.
  assert.equal(animateDomStyle(element, "scale", element.value("scale") ?? "1", "0.75", Animation.easeOut(0.035)), true)
  await sleep(35)
  const opacityAfterScaleRetarget = Number(element.value("opacity"))
  assert.ok(opacityAfterScaleRetarget > opacityBeforeScaleRetarget, `${opacityBeforeScaleRetarget} -> ${opacityAfterScaleRetarget}`)

  await sleep(150)
  assert.equal(Number(element.value("opacity")), 1)
  assert.equal(Number(element.value("scale")), 0.75)
  assert.match(element.value("translate") ?? "", /^30(?:\.0+)?px -12(?:\.0+)?px$/)
  cancelDomAnimations(element)
})

test("layout FLIP animates real size and position deltas on its own channel", async () => {
  const element = fakeElement({ transform: "rotate(8deg)", translate: "", scale: "" })
  const before = { left: 10, top: 20, width: 100, height: 30 }
  const after = { left: 55, top: 32, width: 160, height: 54 }
  assert.equal(animateDomLayout(element, before, after, Animation.easeInOut(0.04)), true)
  assert.match(element.value("translate") ?? "", /px/)
  assert.notEqual(element.value("scale"), "")
  assert.equal(element.value("transform"), "rotate(8deg)")
  await sleep(120)
  assert.match(element.value("translate") ?? "", /^0(?:\.0+)?px 0(?:\.0+)?px$/)
  assert.match(element.value("scale") ?? "", /^1(?:\.0+)? 1(?:\.0+)?$/)
  assert.equal(element.value("transform"), "rotate(8deg)")
  cancelDomAnimations(element)
})
