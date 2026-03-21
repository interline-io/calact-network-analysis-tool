import { expect, type Page } from '@playwright/test'

// Helper to parse "X of Y routes" text into { marked, total }
export async function getRouteCounts (page: Page) {
  const el = page.locator('.cal-filter-summary-counts span', { hasText: 'routes' })
  const text = await el.textContent()
  const match = text?.match(/(\d+) of (\d+) routes/)
  if (!match) { throw new Error(`Could not parse route counts from: "${text}"`) }
  return { marked: Number(match[1]), total: Number(match[2]) }
}

export async function getStopCounts (page: Page) {
  const el = page.locator('.cal-filter-summary-counts span', { hasText: 'stops' })
  const text = await el.textContent()
  const match = text?.match(/(\d+) of (\d+) stops/)
  if (!match) { throw new Error(`Could not parse stop counts from: "${text}"`) }
  return { marked: Number(match[1]), total: Number(match[2]) }
}

// Wait for the route marked count to differ from a known value
export async function waitForRouteCountChange (page: Page, previousMarked: number) {
  await expect(async () => {
    const counts = await getRouteCounts(page)
    expect(counts.marked).not.toBe(previousMarked)
  }).toPass({ timeout: 10000 })
}

// Navigate to filter tab (if not already there) and reset all filters.
// Waits for marked counts to equal totals before returning.
export async function resetFilters (page: Page) {
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
// clicking it would close it — so we check and reopen if needed.
export async function openFilterSubtab (page: Page, label: string) {
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
