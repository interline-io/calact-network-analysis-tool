import { test, expect, type Page } from '@playwright/test'

// Helper to parse "X of Y routes" text into { marked, total }
async function getRouteCounts (page: Page) {
  const el = page.locator('.cal-filter-summary-counts span', { hasText: 'routes' })
  const text = await el.textContent()
  const match = text?.match(/(\d+) of (\d+) routes/)
  return { marked: Number(match?.[1]), total: Number(match?.[2]) }
}

async function getStopCounts (page: Page) {
  const el = page.locator('.cal-filter-summary-counts span', { hasText: 'stops' })
  const text = await el.textContent()
  const match = text?.match(/(\d+) of (\d+) stops/)
  return { marked: Number(match?.[1]), total: Number(match?.[2]) }
}

// Wait for the route marked count to differ from a known value
async function waitForRouteCountChange (page: Page, previousMarked: number) {
  await expect(async () => {
    const counts = await getRouteCounts(page)
    expect(counts.marked).not.toBe(previousMarked)
  }).toPass({ timeout: 10000 })
}

// Navigate to filter tab (if not already there) and reset all filters.
// Waits for marked counts to equal totals before returning.
async function resetFilters (page: Page) {
  // Ensure filter tab is open — if the summary counts aren't visible, click the tab
  const countsVisible = await page.locator('.cal-filter-summary-counts').isVisible()
  if (!countsVisible) {
    await page.locator('a[title="Filter"]').click()
    await expect(page.locator('.cal-filter-summary-counts')).toBeVisible({ timeout: 5000 })
  }
  await page.getByRole('button', { name: 'Clear all' }).click()
  // Wait for counts to stabilize — after reset, marked should equal total
  await expect(async () => {
    const routes = await getRouteCounts(page)
    expect(routes.marked).toBe(routes.total)
  }).toPass({ timeout: 10000 })
}

// Open a filter subtab by its label text.
// Handles the toggle behavior: if the requested subtab is already active,
// clicking it would close it — so we skip the click in that case.
// If a different subtab is active, clicking the new one switches to it.
async function openFilterSubtab (page: Page, label: string) {
  const menuItem = page.locator('.cal-filter-main .menu-list a', { hasText: label })
  await menuItem.click()
  // If clicking toggled it closed (was already active), click again to reopen
  const subPanel = page.locator('.cal-filter-sub')
  const isVisible = await subPanel.isVisible()
  if (!isVisible) {
    await menuItem.click()
  }
  await expect(subPanel).toBeVisible({ timeout: 5000 })
}

test.describe('Filter interactions', () => {
  let page: Page

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage()
    await page.goto('/tne?bbox=-122.69075,45.51358,-122.66809,45.53306')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Transit Network Explorer')).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: 'Run Browse Query' }).click()
    await expect(page.getByText('Browsing query data loaded successfully')).toBeVisible({ timeout: 60000 })
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

    // Click Select None — use force since the button may be in a scrollable container
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
