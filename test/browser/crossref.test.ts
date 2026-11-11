import { test, expect, type Page } from '@playwright/test'
import { PORTLAND_BBOX } from './helpers'

// Cross-referencing the map and the Reports tables (#44): "See on map" from a
// table row, and "See in data table" from the map popup, against the local
// tlserver test database.

// As waitForScenarioLoad, without waiting for the network to go idle: the
// map's basemap requests keep it busy where no tiles key is set.
async function loadScenario (page: Page) {
  await page.goto(`/tne?bbox=${PORTLAND_BBOX}`)
  await expect(page.getByText('Transit Network Explorer')).toBeVisible({ timeout: 30000 })
  await page.getByRole('button', { name: 'Run Browse Query' }).click()
  await expect(page.getByText('Browsing query data loaded successfully'))
    .toBeVisible({ timeout: 120000 })
}

// The rail's buttons toggle: a second click on the open tab closes it.
async function openRail (page: Page, label: 'Map' | 'Report') {
  const reportOpen = await page.locator('.cal-report').isVisible()
  if ((label === 'Report') !== reportOpen) {
    await page.getByRole('button', { name: label, exact: true }).click()
  }
}

async function openReportTab (page: Page, label: string) {
  await openRail(page, 'Report')
  await page.locator('.cal-report .cat-tabs').getByText(label, { exact: true }).click()
  await expect(page.locator('.cal-report-table tbody tr').nth(1)).toBeVisible({ timeout: 10000 })
}

test.describe('Map and table cross-referencing', () => {
  let page: Page

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180000)
    page = await browser.newPage()
    await loadScenario(page)
  })

  test.afterAll(async () => {
    await page.close()
  })

  test('a stop row opens on the map, and its popup leads back to the row', async () => {
    await openReportTab(page, 'Stops (Individual)')

    // Sort by name, descending, and go to page 2: both survive the round trip.
    const sortButton = page.locator('.cal-report-table thead').getByRole('button', { name: 'Stop Name' })
    await sortButton.click()
    await sortButton.click()
    await page.getByRole('button', { name: 'Page 2' }).click()
    await expect(page.getByText(/Showing 21-40 of \d+ results/)).toBeVisible()

    const row = page.locator('.cal-report-table tbody tr:not(.cal-datagrid-shim)').nth(2)
    const stopName = (await row.locator('td').nth(1).innerText()).trim()

    // The row's menu, from a click on a plain cell.
    await row.locator('td').nth(1).click()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    // What the map popup offers for a stop, too.
    await expect(menu.getByRole('menuitem')).toHaveText(['See on map', 'Show trip information', 'Enter Transfer Analyst'])
    await menu.getByRole('menuitem', { name: 'See on map' }).click()

    // The map, with the stop's popup.
    const popup = page.locator('.maplibregl-popup')
    await expect(popup).toContainText(stopName, { timeout: 10000 })
    await expect(popup.getByRole('button', { name: 'See in data table' })).toBeVisible()

    // Back by the rail: the table as it was left, the row highlighted.
    await openRail(page, 'Report')
    await expect(page.getByText(/Showing 21-40 of \d+ results/)).toBeVisible()
    await expect(page.locator('.cal-datagrid-row-highlighted')).toContainText(stopName)
    await expect(page.locator('.cal-report-table thead th[aria-sort="descending"]')).toContainText('Stop Name')

    // A filter that hides the row is cleared by "See in data table".
    await page.getByRole('searchbox').fill('zzzz-no-match')
    await openRail(page, 'Map')
    await popup.getByRole('button', { name: 'See in data table' }).click()
    await expect(page.locator('.cal-datagrid-row-highlighted')).toContainText(stopName)
    await expect(page.locator('.cal-datagrid-row-highlighted')).toBeInViewport()
    await expect(page.getByRole('searchbox')).toHaveValue('')

    // The highlighted row's menu removes the highlight; other rows' menus
    // don't offer it.
    await page.locator('.cal-report-table tbody tr:not(.cal-datagrid-shim):not(.cal-datagrid-row-highlighted)')
      .first().locator('.cal-datagrid-row-menu-trigger').click()
    await expect(page.getByRole('menuitem', { name: 'Remove highlight' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.locator('.cal-datagrid-row-highlighted .cal-datagrid-row-menu-trigger').click()
    await page.getByRole('menuitem', { name: 'Remove highlight' }).click()
    await expect(page.locator('.cal-datagrid-row-highlighted')).toHaveCount(0)
  })

  test('the row menu opens from its button by keyboard and closes with Escape', async () => {
    await openReportTab(page, 'Routes')
    const trigger = page.locator('.cal-datagrid-row-menu-trigger').first()
    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menuitem', { name: 'See on map' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toBeHidden()
    await expect(trigger).toBeFocused()
  })

  test('agency rows have no menu, nor the space for one', async () => {
    await openReportTab(page, 'Agencies')
    await expect(page.locator('.cal-report-table .cal-datagrid-row-menu-trigger')).toHaveCount(0)
    await expect(page.locator('.cal-report-table .cal-datagrid-row-menu-spacer')).toHaveCount(0)
  })

  test('a route row\'s menu opens its trip information', async () => {
    await openReportTab(page, 'Routes')
    const row = page.locator('.cal-report-table tbody tr:not(.cal-datagrid-shim)').first()
    await row.locator('.cal-datagrid-row-menu-trigger').click()
    await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText(['See on map', 'Show trip information'])
    await page.getByRole('menuitem', { name: 'Show trip information' }).click()
    await expect(page.getByText(/^Trips for: /)).toBeVisible({ timeout: 10000 })
    await page.keyboard.press('Escape')
    await expect(page.getByText(/^Trips for: /)).toBeHidden()
  })

  test('an aggregated row\'s menu opens its census details', async () => {
    await openReportTab(page, 'Stops (Aggregated)')
    const row = page.locator('.cal-report-table tbody tr:not(.cal-datagrid-shim)').first()
    const name = (await row.locator('td').first().innerText()).trim()
    await row.locator('.cal-datagrid-row-menu-trigger').click()
    await page.getByRole('menuitem', { name: 'View census details' }).click()
    // Filtered to the row's area, as from its census panel.
    const notice = page.getByText('Filtered to a single geography')
    await expect(notice).toBeVisible({ timeout: 10000 })
    await expect(notice).toContainText(name)
    await page.keyboard.press('Escape')
    await expect(notice).toBeHidden()
  })

  test('an aggregated row turns on the aggregation areas and opens its census panel', async () => {
    await openReportTab(page, 'Stops (Aggregated)')
    const row = page.locator('.cal-report-table tbody tr:not(.cal-datagrid-shim)').first()
    const name = (await row.locator('td').first().innerText()).trim()
    await row.locator('.cal-datagrid-row-menu-trigger').click()
    await page.getByRole('menuitem', { name: 'See on map' }).click()

    await expect(page).toHaveURL(/showAggAreas=true/)
    const panel = page.locator('.cal-map-census-panel')
    await expect(panel).toContainText(name, { timeout: 15000 })

    await panel.getByText('See in data table').click()
    await expect(page.locator('.cal-datagrid-row-highlighted')).toContainText(name)
  })
})
