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
    assert.ok(await page.getByText('DEMO').isVisible())
    const textField = page.getByRole('textbox', { name: 'Demo text field' })
    await textField.fill('Muse UI')
    assert.equal(await textField.inputValue(), 'Muse UI')

    const slider = page.getByRole('slider', { name: 'Demo slider' })
    await slider.fill('80')
    assert.equal(await slider.inputValue(), '80')

    const checkbox = page.getByRole('checkbox', { name: 'Demo checkbox' })
    assert.equal(await checkbox.isChecked(), true)
    await checkbox.click()
    assert.equal(await checkbox.isChecked(), false)
    await page.getByRole('button', { name: 'Button' }).click()
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
  }
})
