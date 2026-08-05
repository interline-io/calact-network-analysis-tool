import { test, expect, type Page } from '@playwright/test'
import { PORTLAND_BBOX, waitForScenarioLoad } from './helpers'

// These tests run against a fixed test database (testdata/gtfs/calact_tlserver.dump).
// They cover the "Show stop buffers" overlay, which has no Map Display control
// and is reached by URL: that outlines make it to the map, which is the only
// check that would catch the GraphQL field being renamed.
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

  // The Map Display checkbox is gone; the overlay is URL-only now.

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
