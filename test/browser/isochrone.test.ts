import { readFileSync } from 'node:fs'
import { test, expect, type Page, type Route } from '@playwright/test'

// Isochrones (#486). tlrouter can't run in the test stack, so its one
// endpoint answers with responses recorded from the real router
// (scripts/record-isochrone-fixtures.ts). No scenario is needed: the panel
// opens from the URL, or from the map.

const PLACE = '45.518898,-122.679303'

function recorded (name: string): { status: number, body: string } {
  const r = JSON.parse(readFileSync(new URL(`../../testdata/isochrone/${name}.json`, import.meta.url), 'utf8'))
  return { status: r.status, body: typeof r.body === 'string' ? r.body : JSON.stringify(r.body) }
}

// Answer every isochrone request with `name`'s recording, and keep the
// requests for the test to read.
async function routeIsochrone (page: Page, name: string): Promise<URL[]> {
  const requests: URL[] = []
  const { status, body } = recorded(name)
  await page.route('**/routing/isochrone?**', async (route: Route) => {
    requests.push(new URL(route.request().url()))
    await route.fulfill({ status, contentType: 'application/json', body })
  })
  return requests
}

const panel = (page: Page) => page.locator('.cal-isochrone-panel')
const legend = (page: Page) => page.locator('.cal-map-legend')

test.describe('Isochrone panel', () => {
  test('opens from the URL and shows the bands', async ({ page }) => {
    const requests = await routeIsochrone(page, 'leaving-from')
    await page.goto(`/tne?isoPlace=${PLACE}&isoDate=2026-10-27`)
    await expect(panel(page).getByText('Travel time: 45.51890, -122.67930')).toBeVisible({ timeout: 15000 })
    // The bands are keyed in the map legend.
    for (const m of [15, 30, 45]) {
      await expect(legend(page).getByText(`Within ${m} min`)).toBeVisible()
    }
    await expect(legend(page).getByText('Leaving from here')).toBeVisible()
    const q = requests.at(-1)!.searchParams
    expect(q.get('fromPlace')).toBe(PLACE)
    expect(q.get('date')).toBe('2026-10-27')
    expect(q.getAll('cutoff')).toEqual(['15m', '30m', '45m'])
    expect(q.get('ignoreRealtimeUpdates')).toBe('true')
    expect(q.has('walkingSpeed')).toBe(false)
  })

  test('settings change the request and the URL', async ({ page }) => {
    const requests = await routeIsochrone(page, 'leaving-from')
    await page.goto(`/tne?isoPlace=${PLACE}&isoDate=2026-10-27`)
    await expect(legend(page).getByText('Within 15 min')).toBeVisible({ timeout: 15000 })

    await panel(page).getByRole('button', { name: '60 minutes' }).click()
    await expect(page).toHaveURL(/isoCutoffs=15%2C30%2C45%2C60|isoCutoffs=15,30,45,60/)
    await expect.poll(() => requests.at(-1)!.searchParams.getAll('cutoff')).toEqual(['15m', '30m', '45m', '60m'])

    await panel(page).getByRole('button', { name: 'Arriving at' }).click()
    await expect(page).toHaveURL(/isoArriveBy=true/)
    await expect.poll(() => requests.at(-1)!.searchParams.get('toPlace')).toBe(PLACE)
    expect(requests.at(-1)!.searchParams.get('arriveBy')).toBe('true')
    await expect(legend(page).getByText('Arriving here')).toBeVisible()

    await panel(page).getByRole('button', { name: 'Bus' }).click()
    await expect.poll(() => requests.at(-1)!.searchParams.get('mode')).toBe('TRANSIT,tram,subway,rail,ferry')
    await expect(panel(page).getByRole('button', { name: 'Bus' })).toHaveAttribute('aria-pressed', 'false')

    await panel(page).getByRole('button', { name: 'Walk only' }).click()
    await expect(page).toHaveURL(/isoMode=walk/)
    await expect.poll(() => requests.at(-1)!.searchParams.get('mode')).toBe('WALK')
  })

  test('shows the router error', async ({ page }) => {
    await routeIsochrone(page, 'bad-date')
    await page.goto(`/tne?isoPlace=${PLACE}&isoDate=2026-10-27`)
    await expect(panel(page).getByText(/Could not calculate travel times/)).toBeVisible({ timeout: 15000 })
  })

  test('closes, clearing the URL', async ({ page }) => {
    await routeIsochrone(page, 'leaving-from')
    await page.goto(`/tne?isoPlace=${PLACE}&isoCutoffs=10,20`)
    await expect(panel(page)).toBeVisible({ timeout: 15000 })
    await panel(page).getByRole('button', { name: 'Dismiss message' }).click()
    await expect(panel(page)).toHaveCount(0)
    await expect(page).not.toHaveURL(/isoPlace|isoCutoffs/)
  })

  test('opens from the map\'s right-click menu', async ({ page }) => {
    const requests = await routeIsochrone(page, 'arriving-at')
    await page.goto('/tne')
    await expect(page.getByText('Transit Network Explorer')).toBeVisible({ timeout: 15000 })
    const canvas = page.locator('#mapelem canvas')
    await expect(canvas).toBeVisible()
    const box = (await canvas.boundingBox())!
    // Right of the query panel, left of the sidebar.
    await canvas.click({ button: 'right', position: { x: box.width * 0.55, y: box.height * 0.5 } })
    await page.getByRole('menuitem', { name: 'Travel time to here' }).click()
    await expect(panel(page)).toBeVisible()
    await expect(page).toHaveURL(/isoPlace=.*isoArriveBy=true|isoArriveBy=true.*isoPlace=/)
    await expect.poll(() => requests.at(-1)?.searchParams.has('toPlace')).toBe(true)
  })
})
