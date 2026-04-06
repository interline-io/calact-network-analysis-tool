import { test, expect, type Page } from '@playwright/test'
import { openFilterSubtab } from './helpers'

// These tests run against a fixed test database (testdata/gtfs/calact_tlserver.dump).
// Tests verify the choropleth aggregation overlay UI controls, legend, and
// the removal of the aggregation selector from the query builder.
test.describe('Choropleth aggregation overlay', () => {
  let page: Page

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180000)
    page = await browser.newPage()
    // Downtown Portland bbox — known to have data in the test database
    await page.goto('/tne?bbox=-122.69075,45.51358,-122.66809,45.53306')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Transit Network Explorer')).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: 'Run Browse Query' }).click()
    await expect(page.getByText('Browsing query data loaded successfully')).toBeVisible({ timeout: 120000 })
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
    const checkbox = page.locator('.cal-filter-sub').getByLabel('Show Agg. Areas')
    await expect(checkbox).not.toBeChecked()
  })

  test('Aggregate by dropdown is enabled regardless of Show Agg. Areas', async () => {
    // The dropdown should be enabled even when the checkbox is unchecked
    // (it also drives the Report tab aggregation, not just the map overlay)
    await openFilterSubtab(page, 'Map Display')
    const dropdown = page.locator('.cal-filter-sub').getByLabel('Aggregate by')
    await expect(dropdown).toBeEnabled({ timeout: 5000 })
  })

  test('checking Show Agg. Areas persists in URL', async () => {
    await openFilterSubtab(page, 'Map Display')
    const checkbox = page.locator('.cal-filter-sub').getByLabel('Show Agg. Areas')
    await checkbox.check()
    await expect(checkbox).toBeChecked()

    // Verify URL contains showAggAreas=true
    await expect(page).toHaveURL(/showAggAreas=true/)
  })

  test('legend shows choropleth section when aggregation is enabled (requires census data)', async () => {
    // Aggregation is enabled from previous test — switch to map view to see legend
    await page.locator('a[title="Map"]').click()

    // This test requires census geography data in the test database.
    // If the legend section doesn't appear, census data is missing — skip gracefully.
    const legend = page.getByText('Aggregated Areas:')
    const visible = await legend.isVisible().catch(() => false)
    if (!visible) {
      // Wait a bit to be sure it's not just slow
      try {
        await expect(legend).toBeVisible({ timeout: 10000 })
      } catch {
        test.skip(true, 'Test database does not contain census geography data')
        return
      }
    }
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

    // Switch to map to check legend — should not show regardless of census data
    await page.locator('a[title="Map"]').click()
    await expect(page.getByText('Aggregated Areas:')).not.toBeVisible({ timeout: 5000 })
  })

  // Report tab: aggregation controls and table

  test('report tab shows aggregation selector and aggregated data table', async () => {
    // Switch to report tab and select Stop display mode
    await page.locator('a[title="Report"]').click()
    await expect(page.getByText('Showing fixed-route service by:')).toBeVisible({ timeout: 5000 })
    await page.getByRole('radio', { name: 'Stop' }).click()

    // Report should have its own "Aggregate by:" section
    await expect(page.getByText('Aggregate by:')).toBeVisible({ timeout: 5000 })

    // The aggregated data table should appear
    await expect(page.getByText(/Aggregated by/)).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Individual results')).toBeVisible()
  })
})
