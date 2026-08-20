import assert from 'node:assert/strict'
import test from 'node:test'

const baseURL = process.env.RUI_BROWSER_URL

test('Rui demo is interactive in a real browser', { skip: !baseURL }, async () => {
  const { chromium } = await import('@playwright/test')
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error))
    await page.goto(baseURL, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Add' }).click()
    assert.ok(await page.getByText('Rui Tasks').isVisible())
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
  }
})
