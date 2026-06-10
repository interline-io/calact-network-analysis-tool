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

// The disabled run buttons must expose why they are disabled (#390): a visible
// reason below them, wired to both buttons via aria-describedby. This exercises
// only client-side state (no query run, no boundary data needed).
test.describe('Run query disabled-state explanation', () => {
  test('explains the blocker and clears it once resolved', async ({ page }) => {
    await page.goto('/tne?bbox=-122.69075,45.51358,-122.66809,45.53306')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Transit Network Explorer')).toBeVisible({ timeout: 15000 })

    const runButton = page.getByRole('button', { name: 'Run Browse Query' })
    const reason = page.locator('#cal-query-blocked-reason')

    // A valid bbox makes the query runnable: no reason shown.
    await expect(runButton).toBeEnabled()
    await expect(reason).toHaveText('')

    // Administrative boundaries with nothing selected blocks the query.
    await page.getByLabel(/Select geography by/).selectOption('adminBoundary')
    await expect(runButton).toBeDisabled()
    await expect(reason).toContainText('select at least one administrative boundary')
    await expect(runButton).toHaveAttribute('aria-describedby', 'cal-query-blocked-reason')

    // Switching back to the bounding box clears the blocker.
    await page.getByLabel(/Select geography by/).selectOption('bbox')
    await expect(runButton).toBeEnabled()
    await expect(reason).toHaveText('')
  })
})
