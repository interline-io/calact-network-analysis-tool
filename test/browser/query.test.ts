import { test, expect, type Page } from '@playwright/test'

// These tests run against a fixed test database (testdata/gtfs/calact_tlserver.dump).
test.describe('Browse query results', () => {
  let page: Page

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180000)
    page = await browser.newPage()
    // Downtown Portland bbox — known to have data in the test database
    await page.goto('/tne?bbox=-122.69075,45.51358,-122.66809,45.53306')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Transit Network Explorer')).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: 'Run Browse Query' }).click()
    await expect(page.getByText('Loading', { exact: true })).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Browsing query data loaded successfully')).toBeVisible({ timeout: 120000 })
  })

  test.afterAll(async () => {
    await page.close()
  })

  // Map tab (active after query completes)

  test('map shows legend and share button', async () => {
    await expect(page.getByText('Legend')).toBeVisible()
    await expect(page.getByRole('button', { name: /Share/ })).toBeVisible()
  })

  // Query tab

  test('query tab shows loaded state', async () => {
    await page.locator('a[title="Query"]').click()
    await expect(page.getByText('A browse query is currently loaded')).toBeVisible()
  })

  // Report tab

  test('report tab shows fixed-route service options', async () => {
    await page.locator('a[title="Report"]').click()
    await expect(page.getByText('Showing fixed-route service by:')).toBeVisible({ timeout: 5000 })
  })

  test('report defaults to Route display mode', async () => {
    const routeRadio = page.locator('input[type="radio"][value="Route"]')
    await expect(routeRadio).toBeChecked()
  })

  test('report shows individual results', async () => {
    await expect(page.getByText('Individual results')).toBeVisible()
    await expect(page.getByText(/\d+ results found/)).toBeVisible()
  })

  // Filter tab

  test('filter tab loads with controls', async () => {
    await page.locator('a[title="Filter"]').click()
    await expect(page.getByText('Display')).toBeVisible({ timeout: 5000 })
  })
})
