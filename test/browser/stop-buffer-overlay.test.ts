import { test, expect, type Page } from '@playwright/test'
import { PORTLAND_BBOX, openFilterSubtab, waitForScenarioLoad } from './helpers'

// These tests run against a fixed test database (testdata/gtfs/calact_tlserver.dump).
// They cover the "Show stop buffers" overlay: the Map Display control, its URL
// round-trip, and that outlines actually reach the map — the last of which is
// the only check that would catch the GraphQL field being renamed.
test.describe('Stop buffer overlay', () => {
  let page: Page

  // A radius is needed for the overlay to draw anything; 400m is well inside
  // the 1600m cap and produces visible buffers in the Portland test bbox.
  const RADIUS = 400

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180000)
    page = await browser.newPage()
    await waitForScenarioLoad(page, PORTLAND_BBOX)
  })

  test.afterAll(async () => {
    await page.close()
  })

  test('Overlay section offers the stop buffer toggle, unchecked by default', async () => {
    await page.locator('a[title="Filter"]').click()
    await expect(page.locator('.cal-filter-summary-counts')).toBeVisible({ timeout: 5000 })
    await openFilterSubtab(page, 'Map Display')

    await expect(page.getByText('Overlay')).toBeVisible()
    const checkbox = page.locator('.cal-filter-sub').getByLabel('Show stop buffers')
    await expect(checkbox).toBeVisible()
    await expect(checkbox).not.toBeChecked()
  })

  // The checkbox is deliberately never disabled: at radius 0 it simply draws
  // nothing, and disabling it would leave a checked box the user can't clear.
  test('toggle stays usable at radius 0 and round-trips through the URL', async () => {
    await openFilterSubtab(page, 'Map Display')
    const checkbox = page.locator('.cal-filter-sub').getByLabel('Show stop buffers')

    await expect(checkbox).toBeEnabled()
    await checkbox.check()
    await expect(checkbox).toBeChecked()
    await expect(page).toHaveURL(/showStopBuffer=true/)

    await checkbox.uncheck()
    await expect(checkbox).not.toBeChecked()
    await expect(page).not.toHaveURL(/showStopBuffer=true/)
  })

  // Asserts on the request rather than the canvas: the map instance is not
  // exposed to tests, and this is what breaks if the GraphQL field is renamed
  // or the composable stops wiring the radius through.
  test('a stop buffer query is issued with the configured radius', async () => {
    const request = page.waitForRequest(req =>
      req.method() === 'POST' && (req.postData() || '').includes('route_stop_buffer'),
    { timeout: 60000 })

    await page.goto(`/tne?bbox=${PORTLAND_BBOX}&stopBufferRadius=${RADIUS}&showStopBuffer=true`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Run Browse Query' }).click()
    await expect(page.getByText('Browsing query data loaded successfully')).toBeVisible({ timeout: 120000 })

    const body = JSON.parse((await request).postData() || '{}')
    expect(body.variables.radius).toBe(RADIUS)
    expect(body.variables.ids.length).toBeGreaterThan(0)
  })

  test('no stop buffer query is issued at radius 0', async () => {
    let issued = false
    await page.route('**/*', async (route, req) => {
      if (req.method() === 'POST' && (req.postData() || '').includes('route_stop_buffer')) {
        issued = true
      }
      await route.continue()
    })

    await page.goto(`/tne?bbox=${PORTLAND_BBOX}&stopBufferRadius=0&showStopBuffer=true`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Run Browse Query' }).click()
    await expect(page.getByText('Browsing query data loaded successfully')).toBeVisible({ timeout: 120000 })

    await page.unroute('**/*')
    expect(issued).toBe(false)
  })
})
