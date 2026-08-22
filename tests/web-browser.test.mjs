import assert from "node:assert/strict"
import test from "node:test"

const baseURL = process.env.MUSE_WEB_BROWSER_URL

test("Muse Web adapter example is interactive in a real browser", { skip: !baseURL }, async () => {
  const { chromium } = await import("@playwright/test")
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    const errors = []
    page.on("pageerror", error => errors.push(error))
    await page.goto(baseURL, { waitUntil: "networkidle" })
    await assert.doesNotReject(() => page.getByText("Count: 0", { exact: false }).waitFor())
    await page.getByRole("button", { name: "Increment" }).click()
    await assert.doesNotReject(() => page.getByText("Count: 1", { exact: false }).waitFor())
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
  }
})
