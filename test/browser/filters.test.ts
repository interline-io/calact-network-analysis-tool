import { test, expect, type Page } from '@playwright/test'
import { getRouteCounts, getStopCounts, waitForRouteCountChange, resetFilters, openFilterSubtab } from './helpers'

// These tests run against a fixed test database (testdata/gtfs/calact_tlserver.dump).
// Tests compare relative changes (before/after filter) rather than hardcoded counts,
// so they should be stable as long as the test dataset has bus routes and multiple agencies.
test.describe('Filter interactions', () => {
  let page: Page

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180000)
    page = await browser.newPage()
    // Downtown Portland bbox — known to have a mix of modes and agencies in the test data
    await page.goto('/tne?bbox=-122.69075,45.51358,-122.66809,45.53306')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Transit Network Explorer')).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: 'Run Browse Query' }).click()
    await expect(page.getByText('Browsing query data loaded successfully')).toBeVisible({ timeout: 120000 })
  })

  test.afterAll(async () => {
    await page.close()
  })

  test('baseline: all routes and stops are marked after reset', async () => {
    await resetFilters(page)
    const routes = await getRouteCounts(page)
    const stops = await getStopCounts(page)
    expect(routes.marked).toBe(routes.total)
    expect(stops.marked).toBe(stops.total)
    expect(routes.total).toBeGreaterThan(0)
    expect(stops.total).toBeGreaterThan(0)
  })

  test('deselecting Bus mode reduces marked routes and stops', async () => {
    await resetFilters(page)
    const routesBefore = await getRouteCounts(page)
    const stopsBefore = await getStopCounts(page)

    // Open Modes & Agencies, deselect Bus (target the mode checkbox specifically)
    await openFilterSubtab(page, 'Modes & Agencies')
    await page.locator('.mode-checkboxes').getByLabel('Bus').click()

    // Wait for filter to take effect
    await waitForRouteCountChange(page, routesBefore.marked)

    const routesAfter = await getRouteCounts(page)
    const stopsAfter = await getStopCounts(page)

    expect(routesAfter.marked).toBeLessThan(routesBefore.marked)
    expect(stopsAfter.marked).toBeLessThan(stopsBefore.marked)
  })

  test('selecting no agencies marks zero routes and stops', async () => {
    await resetFilters(page)

    const before = await getRouteCounts(page)

    await openFilterSubtab(page, 'Modes & Agencies')

    // force: true bypasses Playwright's visibility/scroll checks — needed because the
    // button can be outside the visible scroll area of the filter sub-panel.
    const selectNoneBtn = page.locator('.cal-filter-sub').getByRole('button', { name: 'Select None' })
    await selectNoneBtn.click({ force: true })

    await waitForRouteCountChange(page, before.marked)

    const routes = await getRouteCounts(page)
    const stops = await getStopCounts(page)

    expect(routes.marked).toBe(0)
    expect(stops.marked).toBe(0)
  })

  test('weekday "All" mode is more restrictive than "Any"', async () => {
    await resetFilters(page)
    const before = await getRouteCounts(page)

    await openFilterSubtab(page, 'Timeframes')
    // Target the weekday mode radio specifically (not "All Day" checkbox)
    await page.getByRole('radio', { name: /All of/ }).click()

    // Allow time for filter to apply, then read counts
    // "All" may or may not reduce counts depending on data, so just check it doesn't increase
    await page.waitForTimeout(500)
    const after = await getRouteCounts(page)

    expect(after.marked).toBeLessThanOrEqual(before.marked)
  })
})
