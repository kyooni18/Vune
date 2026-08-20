import assert from 'node:assert/strict'
import test from 'node:test'

const baseURL = process.env.MUSE_BROWSER_URL

test('Muse demo is interactive in a real browser', { skip: !baseURL }, async () => {
  const { chromium } = await import('@playwright/test')
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error))
    await page.goto(baseURL, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Add' }).click()
    assert.ok(await page.getByText('Muse Tasks').isVisible())
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('dialog', { name: 'Settings' }).waitFor()
    await page.keyboard.press('Escape')
    await assert.rejects(() => page.getByRole('dialog', { name: 'Settings' }).waitFor({ state: 'visible', timeout: 250 }))
    await page.getByRole('button', { name: 'Clear done' }).click()
    const alert = page.getByRole('alertdialog')
    await alert.waitFor()
    await alert.getByRole('button', { name: 'Cancel' }).click()
    await assert.rejects(() => alert.waitFor({ state: 'visible', timeout: 250 }))
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
  }
})
