import { test, expect, type Page } from '@playwright/test'
import { openFilterSubtab } from './helpers'

// Tests for the #239 frequency/visits report changes.
//
// Runs against the local tlserver test database (testdata/gtfs/calact_tlserver.dump)
// using the same Portland bbox as the existing query.test.ts.
//
// Numeric values are checked for SHAPE (present, well-formed) rather than exact
// magnitude, so the suite stays stable as long as the test feed has fixed-route
// service in this bbox. Exact-value assertions live in unit tests (route-headway
// and scenario-filter test files).

const PORTLAND_BBOX = '-122.69075,45.51358,-122.66809,45.53306'

const ROUTE_COLUMNS_BASE = [
  'Route ID',
  'Route Name',
  'Mode',
  'Agency',
]

const ROUTE_COLUMNS_FREQUENCY_AND_TIMES = [
  'Average Frequency',
  'Fastest Frequency',
  'Slowest Frequency',
  'Earliest Trip Start',
  'Earliest Trip End',
  'Latest Trip Start',
  'Latest Trip End',
]

const STOP_COLUMNS = [
  'Stop ID',
  'Stop Name',
  'Modes',
  'Routes Served',
  'Agencies Served',
  'Total Visits During Time Period',
]

// Frequency cell renderer (formatDuration) emits "MM:SS" or "HH:MM:SS"
const DURATION_REGEX = /^(\d{2}:)?\d{2}:\d{2}$/

// GTFS time renderer (formatGtfsTime) emits "HH:MM" — does not wrap at 24h
const GTFS_TIME_REGEX = /^\d{2}:\d{2}$/

// Switch to the report tab and wait for the data grid to render.
async function gotoReport (page: Page) {
  await page.locator('a[title="Report"]').click()
  await expect(page.locator('.cal-report-table')).toBeVisible({ timeout: 10000 })
}

// Click an internal cat-tab inside the report panel by its visible label.
async function selectReportTab (page: Page, label: string) {
  await page.locator('.cal-report .cat-tabs').getByText(label, { exact: true }).click()
  // Wait for the table to re-render with at least one header
  await expect(page.locator('.cal-report-table thead th').first()).toBeVisible({ timeout: 5000 })
}

async function getColumnHeaders (page: Page): Promise<string[]> {
  const headers = await page.locator('.cal-report-table thead th').allTextContents()
  // Strip whitespace + the trailing info-icon glyph that comes from <cat-icon icon="information">
  return headers.map(h => h.replace(/\s+/g, ' ').trim())
}

// Pull the data-tooltip attribute (cat-tooltip exposes its text there) for a
// given column header label.
async function getColumnTooltip (page: Page, label: string): Promise<string | null> {
  const tooltipSpan = page
    .locator('.cal-report-table thead th .cat-tooltip')
    .filter({ hasText: label })
  await expect(tooltipSpan).toBeVisible({ timeout: 5000 })
  return tooltipSpan.getAttribute('data-tooltip')
}

// Get the text content of every cell in a single row of the active table.
async function getRowCells (page: Page, rowIndex: number): Promise<string[]> {
  const cells = page.locator('.cal-report-table tbody tr').nth(rowIndex).locator('td')
  return cells.allTextContents()
}

// Open the Filter tab if it is not already open. The sidebar tab anchor is a
// toggle, so clicking it when the panel is already visible would close it —
// guard with the summary-counts visibility check (same pattern as resetFilters).
async function ensureFilterPanelOpen (page: Page) {
  const countsVisible = await page.locator('.cal-filter-summary-counts').isVisible()
  if (!countsVisible) {
    await page.locator('a[title="Filter"]').click()
    await expect(page.locator('.cal-filter-summary-counts')).toBeVisible({ timeout: 5000 })
  }
}

async function setAllDayMode (page: Page, value: boolean) {
  await ensureFilterPanelOpen(page)
  await openFilterSubtab(page, 'Timeframes')
  const checkbox = page.locator('.cal-filter-sub').getByLabel('All Day')
  if (value) {
    await checkbox.check()
  } else {
    await checkbox.uncheck()
  }
}

test.describe('Report tab — #239 frequency/visits columns', () => {
  let page: Page

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180000)
    page = await browser.newPage()
    await page.goto(`/tne?bbox=${PORTLAND_BBOX}`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Transit Network Explorer')).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: 'Run Browse Query' }).click()
    await expect(page.getByText('Browsing query data loaded successfully'))
      .toBeVisible({ timeout: 120000 })
  })

  test.afterAll(async () => {
    await page.close()
  })

  // --- Routes table ----------------------------------------------------------

  test.describe('Routes table (all-day mode)', () => {
    test.beforeAll(async () => {
      await setAllDayMode(page, true)
      await gotoReport(page)
      await selectReportTab(page, 'Routes')
    })

    test('shows the 12 expected column headers in order', async () => {
      const headers = await getColumnHeaders(page)
      const expected = [
        ...ROUTE_COLUMNS_BASE,
        'Average Trips per Day',
        ...ROUTE_COLUMNS_FREQUENCY_AND_TIMES,
      ]
      expect(headers).toEqual(expected)
    })

    test('"Average Trips per Day" tooltip references calendar days', async () => {
      const tooltip = await getColumnTooltip(page, 'Average Trips per Day')
      expect(tooltip).toContain('calendar days')
    })

    test('frequency tooltips describe the representative-stop method', async () => {
      for (const label of ['Average Frequency', 'Fastest Frequency', 'Slowest Frequency']) {
        const tooltip = await getColumnTooltip(page, label)
        expect(tooltip, `${label} tooltip`).toMatch(/representative stop/i)
      }
    })

    test('Slowest Frequency tooltip preserves the cross-service-day exclusion', async () => {
      const tooltip = await getColumnTooltip(page, 'Slowest Frequency')
      expect(tooltip).toMatch(/different service days|between trips on different/i)
    })

    test('first row renders frequency cells as MM:SS / HH:MM:SS', async () => {
      const headers = await getColumnHeaders(page)
      const cells = await getRowCells(page, 0)
      for (const label of ['Average Frequency', 'Fastest Frequency', 'Slowest Frequency']) {
        const idx = headers.indexOf(label)
        const cell = cells[idx]?.trim() ?? ''
        // Empty is allowed (route may have <2 departures), but if present it
        // must match the duration shape.
        if (cell !== '') {
          expect(cell, `${label} cell="${cell}"`).toMatch(DURATION_REGEX)
        }
      }
    })

    test('first row renders trip-time cells as HH:MM (allowing GTFS >24h)', async () => {
      const headers = await getColumnHeaders(page)
      const cells = await getRowCells(page, 0)
      for (const label of ['Earliest Trip Start', 'Earliest Trip End', 'Latest Trip Start', 'Latest Trip End']) {
        const idx = headers.indexOf(label)
        const cell = cells[idx]?.trim() ?? ''
        if (cell !== '') {
          expect(cell, `${label} cell="${cell}"`).toMatch(GTFS_TIME_REGEX)
        }
      }
    })

    test('"Average Trips per Day" first-row cell parses as a finite number ≥ 0', async () => {
      const headers = await getColumnHeaders(page)
      const cells = await getRowCells(page, 0)
      const idx = headers.indexOf('Average Trips per Day')
      const cell = cells[idx]?.trim() ?? ''
      const n = Number(cell)
      expect(Number.isFinite(n) && n >= 0, `cell="${cell}"`).toBe(true)
    })
  })

  // --- Routes table (specific-hours mode) ------------------------------------

  test.describe('Routes table (specific-hours mode)', () => {
    test.beforeAll(async () => {
      await setAllDayMode(page, false)
      await gotoReport(page)
      await selectReportTab(page, 'Routes')
    })

    test.afterAll(async () => {
      // Reset to all-day so other suites in the file don't inherit window state.
      await setAllDayMode(page, true)
    })

    test('column 5 swaps to "Average Trips per Hour"', async () => {
      const headers = await getColumnHeaders(page)
      expect(headers).toContain('Average Trips per Hour')
      expect(headers).not.toContain('Average Trips per Day')
    })

    test('"Average Trips per Hour" tooltip references calendar days, not service days', async () => {
      const tooltip = await getColumnTooltip(page, 'Average Trips per Hour')
      expect(tooltip).toContain('calendar days')
      expect(tooltip).not.toContain('all service days')
    })

    test('frequency tooltips reflect the active window in specific-hours wording', async () => {
      const tooltip = await getColumnTooltip(page, 'Average Frequency')
      expect(tooltip).toMatch(/representative stop/i)
      expect(tooltip).toMatch(/days and times/i)
    })
  })

  // --- Stops (Individual) table ----------------------------------------------

  test.describe('Stops (Individual) table', () => {
    test.beforeAll(async () => {
      await setAllDayMode(page, true)
      await gotoReport(page)
      await selectReportTab(page, 'Stops (Individual)')
    })

    test('shows the 6 expected column headers in order', async () => {
      const headers = await getColumnHeaders(page)
      expect(headers).toEqual(STOP_COLUMNS)
    })

    test('does NOT show the stale "Average Visits per Day" column', async () => {
      const headers = await getColumnHeaders(page)
      expect(headers.some(h => /average visits/i.test(h))).toBe(false)
    })

    test('"Total Visits During Time Period" tooltip uses the @NAT-mb amendment wording', async () => {
      const tooltip = await getColumnTooltip(page, 'Total Visits During Time Period')
      expect(tooltip).toMatch(/sum of all visits/i)
      expect(tooltip).toMatch(/calendar days/i)
    })

    test('first row "Total Visits" cell is a non-negative integer', async () => {
      const headers = await getColumnHeaders(page)
      const cells = await getRowCells(page, 0)
      const idx = headers.indexOf('Total Visits During Time Period')
      const cell = cells[idx]?.trim() ?? ''
      const n = Number(cell)
      expect(Number.isInteger(n) && n >= 0, `cell="${cell}"`).toBe(true)
    })
  })

  // --- Stops (Aggregated) table ----------------------------------------------
  // Requires census geography data in the test database. Skipped gracefully
  // if the aggregated tab never appears.

  test.describe('Stops (Aggregated) table', () => {
    test('column set matches the flat stop view (when census data is present)', async () => {
      await setAllDayMode(page, true)
      await gotoReport(page)

      // The aggregated tab is conditional on having an aggregateLayer set.
      const tab = page.locator('.cal-report .cat-tabs').getByText('Stops (Aggregated)', { exact: true })
      const visible = await tab.isVisible().catch(() => false)
      if (!visible) {
        test.skip(true, 'No aggregation layer selected — Stops (Aggregated) tab not rendered')
        return
      }
      await tab.click()
      await expect(page.locator('.cal-report-table thead th').first()).toBeVisible({ timeout: 5000 })

      const headers = await getColumnHeaders(page)
      // Must include the new "Total Visits During Time Period" header and the
      // identity columns; first column is the geography name rather than Stop ID.
      expect(headers).toContain('Total Visits During Time Period')
      expect(headers).toContain('Routes Served')
      expect(headers).toContain('Agencies Served')
      expect(headers.some(h => /average visits/i.test(h))).toBe(false)
    })
  })

  // --- Filter > Time of Day default window -----------------------------------

  test.describe('Filter > Time of Day defaults', () => {
    test('toggling "All Day" off populates the 06:00–10:00 default window', async () => {
      // Start from all-day mode, then flip off via the helper. setAllDayMode
      // already opens the filter panel + Timeframes subtab, so we don't click
      // the outer Filter tab again (it toggles).
      await setAllDayMode(page, true)
      await setAllDayMode(page, false)

      // The two time-pickers should now hold 06:00 and 10:00 respectively.
      // Read the URL — startTime/endTime are persisted there as HH:mm:ss.
      // Colons may or may not be percent-encoded depending on router behavior;
      // accept both shapes.
      await expect(page).toHaveURL(/startTime=06(:|%3A)00(:|%3A)00/)
      await expect(page).toHaveURL(/endTime=10(:|%3A)00(:|%3A)00/)

      // Restore for the rest of the suite.
      await setAllDayMode(page, true)
    })
  })
})

// --- Map popup + legend mode-aware label ------------------------------------
// Standalone describe (separate page instance) — toggles aggregation overlay
// and verifies that the legend label switches between modes.

test.describe('Map legend — #239 mode-aware visit label', () => {
  let page: Page

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180000)
    page = await browser.newPage()
    await page.goto(`/tne?bbox=${PORTLAND_BBOX}`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Transit Network Explorer')).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: 'Run Browse Query' }).click()
    await expect(page.getByText('Browsing query data loaded successfully'))
      .toBeVisible({ timeout: 120000 })

    // Switch to Stop visits display mode so the legend renders the visit
    // heading. The "Color by:" radio group lives under the Fixed-Route
    // Services subtab, not Map Display.
    await ensureFilterPanelOpen(page)
    await openFilterSubtab(page, 'Fixed-Route Services')
    await page.locator('.cal-filter-sub').getByLabel('Stop visits').check()
  })

  test.afterAll(async () => {
    await page.close()
  })

  test('legend reads "Total visits" in all-day mode', async () => {
    await setAllDayMode(page, true)
    await page.locator('a[title="Map"]').click()
    // Match the legend heading exactly to avoid colliding with the "in window" variant.
    await expect(page.getByText('Total visits:', { exact: true })).toBeVisible({ timeout: 10000 })
  })

  test('legend reads "Total visits in window" in specific-hours mode', async () => {
    await setAllDayMode(page, false)
    await page.locator('a[title="Map"]').click()
    await expect(page.getByText('Total visits in window:', { exact: true })).toBeVisible({ timeout: 10000 })

    // Restore for cleanliness
    await setAllDayMode(page, true)
  })
})
