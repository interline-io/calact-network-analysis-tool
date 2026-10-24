// Records real GET /isochrone responses into testdata/isochrone/ for the
// isochrone tests. tlrouter can't run in the docker test stack, so these
// recordings stand in for it; rerun this when the router's output changes.
//
//   TRANSITLAND_API_KEY=... pnpm tsx scripts/record-isochrone-fixtures.ts
//
// The apikey is the transit.land one in 1Password. ISOCHRONE_ROUTER_BASE
// points at another router (default: transit.land's).

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RouteType } from '../src/core'
import { isochroneQuery, type IsochroneParams } from '../src/tl/isochrone'

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../testdata/isochrone')
const base = process.env.ISOCHRONE_ROUTER_BASE || 'https://transit.land/api/v2/routing'
const apikey = process.env.TRANSITLAND_API_KEY || ''

// Downtown Portland, near Pioneer Courthouse Square, on a weekday morning.
const portland: IsochroneParams = {
  place: { lat: 45.518898, lon: -122.679303 },
  arriveBy: false,
  date: '2026-10-27',
  time: '08:00',
  cutoffs: [15, 30, 45],
  mode: { walkOnly: false },
  maxWalk: 800,
}

const cases: Record<string, IsochroneParams> = {
  'leaving-from': portland,
  'arriving-at': { ...portland, arriveBy: true, time: '09:00' },
  'walk-only': { ...portland, mode: { walkOnly: true }, cutoffs: [10, 20] },
  'bus-only': { ...portland, mode: { walkOnly: false, routeTypes: [RouteType.Bus] } },
  // Long before any feed in service: with fallback dates off, only walking.
  'no-service': { ...portland, date: '2010-01-05' },
  'bad-date': { ...portland, date: '2026-13-45' },
}

async function main () {
  if (!apikey) {
    throw new Error('Set TRANSITLAND_API_KEY')
  }
  mkdirSync(outDir, { recursive: true })
  for (const [name, params] of Object.entries(cases)) {
    const query = isochroneQuery(params).toString()
    const response = await fetch(`${base}/isochrone?${query}`, { headers: { apikey } })
    const text = await response.text()
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
    const path = resolve(outDir, `${name}.json`)
    writeFileSync(path, JSON.stringify({ params, query, status: response.status, body }) + '\n')
    console.log(`${name}: HTTP ${response.status}, ${text.length} bytes -> ${path}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
