import { test, expect, type Page } from '@playwright/test'
import {
  PORTLAND_BBOX,
  waitForScenarioLoad,
  ensureFilterPanelOpen,
  enableAllDay,
  disableAllDay,
  openFilterSubtab,
} from './helpers'

// Tests for the #239 map-legend mode-aware visit label.
//
// When dataDisplayMode is "Stop visits" the legend heading switches:
//   - all-day:        "Total visits:"
//   - specific-hours: "Total visits in window:"
// The "Color by:" radio group that sets dataDisplayMode lives under Filter >
// Fixed-Route Services, not Map Display.

test.describe('Map legend — #239 mode-aware visit label', () => {
  let page: Page

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180000)
    page = await browser.newPage()
    await waitForScenarioLoad(page, PORTLAND_BBOX)

    // Switch to Stop visits display mode so the legend renders the visit heading.
    await ensureFilterPanelOpen(page)
    await openFilterSubtab(page, 'Fixed-Route Services')
    await page.locator('.cal-filter-sub').getByLabel('Stop visits').check()
  })

  test.afterAll(async () => {
    await page.close()
  })

  test('legend reads "Total visits" in all-day mode', async () => {
    await enableAllDay(page)
    await page.locator('a[title="Map"]').click()
    // Match exactly to avoid colliding with the "in window" variant.
    await expect(page.getByText('Total visits:', { exact: true })).toBeVisible({ timeout: 10000 })
  })

  test('legend reads "Total visits in window" in specific-hours mode', async () => {
    await disableAllDay(page)
    await page.locator('a[title="Map"]').click()
    await expect(page.getByText('Total visits in window:', { exact: true })).toBeVisible({ timeout: 10000 })
  })
})
