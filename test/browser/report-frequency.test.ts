import { test, expect, type Page } from '@playwright/test'
import {
  PORTLAND_BBOX,
  waitForScenarioLoad,
  enableAllDay,
  disableAllDay,
} from './helpers'

// Tests for the #239 frequency/visits report columns.
//
// Runs against the local tlserver test database using the same Portland bbox
// as the existing browse-query and filter tests. Numeric values are checked
// for SHAPE (present, well-formed) rather than exact magnitude, so the suite
// stays stable as long as the test feed has fixed-route service in this bbox.
// Exact-value assertions live in unit tests (route-headway / scenario-filter).

const ROUTE_COLUMNS_ALL_DAY = [
  'Route ID', 'Route Name', 'Mode', 'Agency',
  'Average Trips per Day',
  'Average Frequency', 'Fastest Frequency', 'Slowest Frequency',
  'Earliest Trip Start', 'Earliest Trip End',
  'Latest Trip Start', 'Latest Trip End',
]

const ROUTE_COLUMNS_SPECIFIC_HOURS = [
  'Route ID', 'Route Name', 'Mode', 'Agency',
  'Average Trips per Hour',
  'Average Frequency', 'Fastest Frequency', 'Slowest Frequency',
  'Earliest Trip Start', 'Earliest Trip End',
  'Latest Trip Start', 'Latest Trip End',
]

const STOP_COLUMNS = [
  'Stop ID', 'Stop Name', 'Modes',
  'Routes Served', 'Agencies Served',
  'Total Visits During Time Period',
]

// Frequency cell renderer (formatDuration) emits "MM:SS" or "HH:MM:SS"
const DURATION_REGEX = /^(\d{2}:)?\d{2}:\d{2}$/

// GTFS time renderer (formatGtfsTime) emits "HH:MM" — no wrap at 24h
const GTFS_TIME_REGEX = /^\d{2}:\d{2}$/

async function openReportTab (page: Page) {
  await page.locator('a[title="Report"]').click()
  await expect(page.locator('.cal-report-table')).toBeVisible({ timeout: 10000 })
}

async function selectReportTab (page: Page, label: string) {
  await page.locator('.cal-report .cat-tabs').getByText(label, { exact: true }).click()
  await expect(page.locator('.cal-report-table thead th').first()).toBeVisible({ timeout: 5000 })
}

async function getColumnHeaders (page: Page): Promise<string[]> {
  const headers = await page.locator('.cal-report-table thead th').allTextContents()
  // Strip whitespace + the trailing info-icon glyph that comes from <cat-icon>
  return headers.map(h => h.replace(/\s+/g, ' ').trim())
}

async function getColumnTooltip (page: Page, label: string): Promise<string | null> {
  // cat-tooltip renders as <span class="cat-tooltip" data-tooltip="...">
  const tooltipSpan = page
    .locator('.cal-report-table thead th .cat-tooltip')
    .filter({ hasText: label })
  await expect(tooltipSpan).toBeVisible({ timeout: 5000 })
  return tooltipSpan.getAttribute('data-tooltip')
}

async function getRowCells (page: Page, rowIndex: number): Promise<string[]> {
  const cells = page.locator('.cal-report-table tbody tr').nth(rowIndex).locator('td')
  return cells.allTextContents()
}

// Scan up to `maxRows` for the first row where the column at `colIndex` is
// non-empty. Returns { rowIndex, cells } or null if nothing found.
//
// Frequency and trip-time cells legitimately render empty for routes with
// insufficient data (e.g. <2 departures). We want to validate cell shape
// from the first populated row we find; asserting on row 0 can false-pass
// silently when row 0 has no data.
async function findRowWithPopulated (
  page: Page,
  colIndex: number,
  maxRows = 20
): Promise<{ rowIndex: number, cells: string[] } | null> {
  const rowCount = await page.locator('.cal-report-table tbody tr').count()
  for (let i = 0; i < Math.min(rowCount, maxRows); i++) {
    const cells = await getRowCells(page, i)
    if ((cells[colIndex]?.trim() ?? '') !== '') {
      return { rowIndex: i, cells }
    }
  }
  return null
}

// Setup: enable the requested time-of-day mode, open the Report tab, and
// select the named internal tab. Each test calls this so it is independent
// of whatever state earlier tests left behind — matching the filters.test.ts
// convention of calling `resetFilters(page)` at the start of every test.
async function setupReport (page: Page, mode: 'allDay' | 'specificHours', reportTab: string) {
  if (mode === 'allDay') {
    await enableAllDay(page)
  } else {
    await disableAllDay(page)
  }
  await openReportTab(page)
  await selectReportTab(page, reportTab)
}

test.describe('Report tab — #239 frequency/visits columns', () => {
  let page: Page

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180000)
    page = await browser.newPage()
    await waitForScenarioLoad(page, PORTLAND_BBOX)
  })

  test.afterAll(async () => {
    await page.close()
  })

  // --- Routes table: all-day mode -------------------------------------------

  test('Routes (all-day) shows the 12 expected column headers in order', async () => {
    await setupReport(page, 'allDay', 'Routes')
    const headers = await getColumnHeaders(page)
    expect(headers).toEqual(ROUTE_COLUMNS_ALL_DAY)
  })

  test('Routes (all-day) "Average Trips per Day" tooltip references calendar days', async () => {
    await setupReport(page, 'allDay', 'Routes')
    const tooltip = await getColumnTooltip(page, 'Average Trips per Day')
    expect(tooltip).toContain('calendar days')
  })

  test('Routes (all-day) frequency tooltips describe the representative-stop method', async () => {
    await setupReport(page, 'allDay', 'Routes')
    for (const label of ['Average Frequency', 'Fastest Frequency', 'Slowest Frequency']) {
      const tooltip = await getColumnTooltip(page, label)
      expect(tooltip, `${label} tooltip`).toMatch(/representative stop/i)
    }
  })

  test('Routes (all-day) Slowest Frequency tooltip preserves the cross-service-day exclusion', async () => {
    await setupReport(page, 'allDay', 'Routes')
    const tooltip = await getColumnTooltip(page, 'Slowest Frequency')
    expect(tooltip).toMatch(/between trips on different service days/i)
  })

  test('Routes (all-day) frequency cells render as MM:SS or HH:MM:SS', async () => {
    await setupReport(page, 'allDay', 'Routes')
    const headers = await getColumnHeaders(page)
    for (const label of ['Average Frequency', 'Fastest Frequency', 'Slowest Frequency']) {
      const idx = headers.indexOf(label)
      const found = await findRowWithPopulated(page, idx)
      expect(found, `no populated "${label}" cell in the first 20 rows`).not.toBeNull()
      expect(found!.cells[idx]!.trim(), `${label} row=${found!.rowIndex}`).toMatch(DURATION_REGEX)
    }
  })

  test('Routes (all-day) trip-time cells render as HH:MM', async () => {
    await setupReport(page, 'allDay', 'Routes')
    const headers = await getColumnHeaders(page)
    for (const label of ['Earliest Trip Start', 'Earliest Trip End', 'Latest Trip Start', 'Latest Trip End']) {
      const idx = headers.indexOf(label)
      const found = await findRowWithPopulated(page, idx)
      expect(found, `no populated "${label}" cell in the first 20 rows`).not.toBeNull()
      expect(found!.cells[idx]!.trim(), `${label} row=${found!.rowIndex}`).toMatch(GTFS_TIME_REGEX)
    }
  })

  test('Routes (all-day) "Average Trips per Day" cell parses as a finite number ≥ 0', async () => {
    await setupReport(page, 'allDay', 'Routes')
    const headers = await getColumnHeaders(page)
    const idx = headers.indexOf('Average Trips per Day')
    const found = await findRowWithPopulated(page, idx)
    expect(found, 'no populated "Average Trips per Day" cell in the first 20 rows').not.toBeNull()
    const n = Number(found!.cells[idx]!.trim())
    expect(Number.isFinite(n) && n >= 0, `value="${found!.cells[idx]}"`).toBe(true)
  })

  // --- Routes table: specific-hours mode ------------------------------------

  test('Routes (specific-hours) column 5 flips to "Average Trips per Hour"', async () => {
    await setupReport(page, 'specificHours', 'Routes')
    const headers = await getColumnHeaders(page)
    expect(headers).toEqual(ROUTE_COLUMNS_SPECIFIC_HOURS)
  })

  test('Routes (specific-hours) "Average Trips per Hour" tooltip references calendar days, not service days', async () => {
    await setupReport(page, 'specificHours', 'Routes')
    const tooltip = await getColumnTooltip(page, 'Average Trips per Hour')
    expect(tooltip).toContain('calendar days')
    expect(tooltip).not.toContain('all service days')
  })

  test('Routes (specific-hours) frequency tooltips reflect the active window wording', async () => {
    await setupReport(page, 'specificHours', 'Routes')
    const tooltip = await getColumnTooltip(page, 'Average Frequency')
    expect(tooltip).toMatch(/representative stop/i)
    expect(tooltip).toMatch(/days and times/i)
  })

  // --- Stops (Individual) table ---------------------------------------------

  test('Stops (Individual) shows the 6 expected column headers in order', async () => {
    await setupReport(page, 'allDay', 'Stops (Individual)')
    const headers = await getColumnHeaders(page)
    // Exact equality proves both the new column set AND the absence of the
    // stale "Average Visits per Day" header.
    expect(headers).toEqual(STOP_COLUMNS)
  })

  test('Stops (Individual) "Total Visits During Time Period" tooltip uses the amendment wording', async () => {
    await setupReport(page, 'allDay', 'Stops (Individual)')
    const tooltip = await getColumnTooltip(page, 'Total Visits During Time Period')
    expect(tooltip).toMatch(/sum of all visits/i)
    expect(tooltip).toMatch(/calendar days/i)
  })

  test('Stops (Individual) "Total Visits" cell is a non-negative integer', async () => {
    await setupReport(page, 'allDay', 'Stops (Individual)')
    const headers = await getColumnHeaders(page)
    const idx = headers.indexOf('Total Visits During Time Period')
    const found = await findRowWithPopulated(page, idx)
    expect(found, 'no populated "Total Visits" cell in the first 20 rows').not.toBeNull()
    const n = Number(found!.cells[idx]!.trim())
    expect(Number.isInteger(n) && n >= 0, `value="${found!.cells[idx]}"`).toBe(true)
  })

  // --- Stops (Aggregated) table ---------------------------------------------
  // Requires census geography data in the test database. Skipped gracefully
  // if the aggregated internal tab is not rendered (no aggregation layer set).

  test('Stops (Aggregated) column set matches the flat stop view', async () => {
    await enableAllDay(page)
    await openReportTab(page)
    const tab = page.locator('.cal-report .cat-tabs').getByText('Stops (Aggregated)', { exact: true })
    if (!(await tab.isVisible().catch(() => false))) {
      test.skip(true, 'No aggregation layer selected — Stops (Aggregated) tab not rendered')
      return
    }
    await tab.click()
    await expect(page.locator('.cal-report-table thead th').first()).toBeVisible({ timeout: 5000 })
    const headers = await getColumnHeaders(page)
    expect(headers).toContain('Total Visits During Time Period')
    expect(headers).toContain('Routes Served')
    expect(headers).toContain('Agencies Served')
    expect(headers.some(h => /average visits/i.test(h))).toBe(false)
  })

  // --- Filter > Time of Day default window ----------------------------------

  test('Filter > Time of Day: toggling "All Day" off populates the 06:00–10:00 default window', async () => {
    await enableAllDay(page)
    await disableAllDay(page)
    await expect(page).toHaveURL(/startTime=06:00:00/)
    await expect(page).toHaveURL(/endTime=10:00:00/)
    await enableAllDay(page)
  })
})
