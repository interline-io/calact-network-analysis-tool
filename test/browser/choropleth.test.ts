import { test, expect, type Page } from '@playwright/test'

// Helper: open a filter subtab by its label text.
// Handles the toggle behavior: if the requested subtab is already active,
// clicking it would close it — so we check and reopen if needed.
async function openFilterSubtab (page: Page, label: string) {
  const menuItem = page.locator('.cal-filter-main .menu-list a', { hasText: label })
  await menuItem.click()
  const subPanel = page.locator('.cal-filter-sub')
  const isVisible = await subPanel.isVisible()
  if (!isVisible) {
    await menuItem.click()
  }
  await expect(subPanel).toBeVisible({ timeout: 5000 })
}

// These tests run against a fixed test database (testdata/gtfs/calact_tlserver.dump).
// Tests verify the choropleth aggregation overlay UI controls, legend, and
// the removal of the aggregation selector from the query builder.
test.describe('Choropleth aggregation overlay', () => {
  let page: Page

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage()
    // Downtown Portland bbox — known to have data in the test database
    await page.goto('/tne?bbox=-122.69075,45.51358,-122.66809,45.53306')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Transit Network Explorer')).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: 'Run Browse Query' }).click()
    await expect(page.getByText('Browsing query data loaded successfully')).toBeVisible({ timeout: 60000 })
  })

  test.afterAll(async () => {
    await page.close()
  })

  // Query builder: aggregation selector removed

  test('query builder Advanced Settings does not contain aggregation selector', async () => {
    await page.locator('a[title="Query"]').click()
    await expect(page.getByText('Advanced Settings')).toBeVisible({ timeout: 5000 })
    // Expand Advanced Settings
    await page.getByText('Advanced Settings').click()
    await expect(page.getByText('Data to Load')).toBeVisible({ timeout: 5000 })
    // The old aggregation selector should not be present
    await expect(page.getByText('Aggregate by Census geographic hierarchy level')).not.toBeVisible()
  })

  // Data Display sub-panel: aggregation controls

  test('Data Display sub-panel shows aggregation controls', async () => {
    await page.locator('a[title="Filter"]').click()
    await expect(page.locator('.cal-filter-summary-counts')).toBeVisible({ timeout: 5000 })
    await openFilterSubtab(page, 'Map Display')

    // "Aggregation" section should be visible
    await expect(page.getByText('Aggregation')).toBeVisible()
    await expect(page.getByText('Show Agg. Areas')).toBeVisible()
    await expect(page.getByText('Aggregate by')).toBeVisible()
  })

  test('Show Agg. Areas checkbox is unchecked by default', async () => {
    // Should already be on Data Display subtab from previous test
    const checkbox = page.locator('.cal-filter-sub').getByLabel('Show Agg. Areas')
    await expect(checkbox).not.toBeChecked()
  })

  test('Aggregate by dropdown is disabled when Show Agg. Areas is unchecked', async () => {
    const dropdown = page.locator('.cal-filter-sub select').filter({ has: page.locator('option') }).last()
    await expect(dropdown).toBeDisabled()
  })

  test('checking Show Agg. Areas enables the Aggregate by dropdown', async () => {
    const checkbox = page.locator('.cal-filter-sub').getByLabel('Show Agg. Areas')
    await checkbox.check()
    await expect(checkbox).toBeChecked()

    // The dropdown should now be enabled
    const dropdown = page.locator('.cal-filter-sub select').filter({ has: page.locator('option') }).last()
    await expect(dropdown).toBeEnabled()
  })

  test('legend shows choropleth section when aggregation is enabled', async () => {
    // Aggregation is enabled from previous test — switch to map view to see legend
    // Close the filter subtab first so the map/legend is more visible
    await page.locator('a[title="Map"]').click()

    // Wait for the legend to show the aggregation section
    // The legend should show "Aggregated Areas:" and the gradient
    await expect(page.getByText('Aggregated Areas:')).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('Avg. visits/day')).toBeVisible()
  })

  test('unchecking Show Agg. Areas hides choropleth legend', async () => {
    // Go back to filter > Data Display and uncheck
    await page.locator('a[title="Filter"]').click()
    await expect(page.locator('.cal-filter-summary-counts')).toBeVisible({ timeout: 5000 })
    await openFilterSubtab(page, 'Map Display')

    const checkbox = page.locator('.cal-filter-sub').getByLabel('Show Agg. Areas')
    await checkbox.uncheck()
    await expect(checkbox).not.toBeChecked()

    // Switch to map to check legend
    await page.locator('a[title="Map"]').click()
    await expect(page.getByText('Aggregated Areas:')).not.toBeVisible({ timeout: 5000 })
  })

  // Report tab: aggregation table still works

  test('report tab still shows aggregated data table', async () => {
    // Enable aggregation again for this test
    await page.locator('a[title="Filter"]').click()
    await expect(page.locator('.cal-filter-summary-counts')).toBeVisible({ timeout: 5000 })
    await openFilterSubtab(page, 'Map Display')
    const checkbox = page.locator('.cal-filter-sub').getByLabel('Show Agg. Areas')
    await checkbox.check()

    // Switch to report tab and select Stop display mode
    await page.locator('a[title="Report"]').click()
    await expect(page.getByText('Showing fixed-route service by:')).toBeVisible({ timeout: 5000 })
    await page.getByRole('radio', { name: 'Stop' }).click()

    // The aggregated data table should appear
    await expect(page.getByText(/Aggregated by/)).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Individual results')).toBeVisible()
  })
})
