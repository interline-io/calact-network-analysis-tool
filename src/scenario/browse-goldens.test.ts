import { describe, it, expect, beforeAll } from 'vitest'
import {
  runScenarioFetcher,
  applyScenarioResultFilter,
  getSelectedDateRange,
  type ScenarioConfig,
  type ScenarioFilterResult,
} from '~~/src/scenario'
import { routeHeadways } from './route-headway'
import { stopVisits } from './stop-visits'
import { RouteDepartureIndex } from '~~/src/tl/departure-cache'
import {
  apiFetch,
  BasicGraphQLClient,
  parseBbox,
  parseDate,
  SCENARIO_DEFAULTS,
} from '~~/src/core'

// The browse flow's values, pinned against the fixture tlserver — the trips and
// visits behind the Report tab's columns.
//
// Browse is the default flow and its numbers had no live coverage: every test
// under src/scenario except the census and buffer ones drives pure functions
// over hand-written data. The phases underneath it — departures, stops, routes,
// and the calendar-date handling all three share — are also the ones most
// heavily reworked, so this is where an unintended change would show up
// without any existing test noticing.
//
// Recorded on this implementation so a branch that reworks those phases can be
// checked against it. Needs the fixture services:
// `./docker/reset-test-services.sh`. Ungated, like scenario-census.test.ts.

function noopController (): ReadableStreamDefaultController {
  return {
    enqueue () {},
    close () {},
    error () {},
    get desiredSize () { return 1 },
  } as unknown as ReadableStreamDefaultController
}

// Same bbox and week as the WSDOT goldens, so all three reports are pinned
// over identical input.
const config: ScenarioConfig = {
  ...SCENARIO_DEFAULTS,
  reportName: 'browse-goldens',
  bbox: parseBbox('-122.69075,45.51358,-122.66809,45.53306'),
  startDate: parseDate('2025-11-17'),
  endDate: parseDate('2025-11-23'),
  // Demographics are pinned by scenario-census.test.ts; this is about service.
  includeCensus: false,
  stopBufferRadius: 0,
}

let filtered: ScenarioFilterResult
let dates: Date[]

beforeAll(async () => {
  const client = new BasicGraphQLClient(
    (process.env.TRANSITLAND_API_BASE || 'http://localhost:28080') + '/query',
    apiFetch(''),
  )
  const data = await runScenarioFetcher(noopController(), config, client)
  filtered = applyScenarioResultFilter(data, config, {})
  dates = getSelectedDateRange(config)
}, 300000)

// Departures per day, per direction, for one route — the shape the headway and
// trips-per-day columns are computed from. The index is what the report builds
// once and reuses; without it every route reads as having no service.
function dailyCounts (routeId: string): { dir0: number[], dir1: number[] } {
  const route = filtered.routes.find(r => r.route_id === routeId)!
  const index = RouteDepartureIndex.fromCache(filtered.stopDepartureCache)
  const departures = routeHeadways(route, dates, '00:00:00', '24:00:00', index)
  return {
    dir0: departures.dir0.map(day => day.length),
    dir1: departures.dir1.map(day => day.length),
  }
}

// Recorded from this implementation against the fixture dumps. They move when
// the dumps are rebuilt; re-record deliberately, by reading what changed in
// the feeds, rather than pasting what a run printed.
// agencies is 11, not the 10 a same-named pair reads as: Columbia County Rider
// appears in two feeds, both publishing GTFS agency_id "57". The rollup keys on
// the Transitland numeric id, so they stay two rows of 1 stop / 1 route each
// rather than merging into one row of 2 and 2.
const GOLDEN_COUNTS = { routes: 56, stops: 177, agencies: 11, dates: 7 }

// Departures per day for the three busiest routes, Monday through Sunday. The
// weekday/weekend structure is visible in the numbers, so a date range that
// slipped by a day — the failure this codebase has already had twice — moves
// them rather than merely changing a total.
const GOLDEN_ROUTES: Record<string, { dir0: number[], dir1: number[] }> = {
  2: {
    dir0: [89, 89, 89, 89, 89, 85, 85],
    dir1: [90, 90, 90, 90, 90, 86, 86],
  },
  6: {
    dir0: [77, 77, 77, 77, 77, 59, 59],
    dir1: [74, 74, 74, 74, 74, 60, 60],
  },
  14: {
    dir0: [70, 70, 70, 70, 70, 61, 61],
    dir1: [70, 70, 70, 70, 70, 62, 61],
  },
}

describe('browse goldens (integration)', () => {
  it('fetches the pinned routes, stops and agencies', () => {
    expect({
      routes: filtered.routes.length,
      stops: filtered.stops.length,
      agencies: filtered.agencies.length,
      dates: dates.length,
    }).toEqual(GOLDEN_COUNTS)
  })

  it('computes the pinned departures per day for the busiest routes', () => {
    for (const [routeId, expected] of Object.entries(GOLDEN_ROUTES)) {
      expect(dailyCounts(routeId), `route ${routeId}`).toEqual(expected)
    }
  })

  it('computes the pinned stop visit summary', () => {
    const stop = filtered.stops.find(s => s.stop_id === '7594')
    expect(stop, 'stop 7594 missing from the browse result').toBeDefined()
    const visits = stopVisits(
      stop!, undefined, dates, '00:00:00', '24:00:00', filtered.stopDepartureCache,
    )
    expect(visits.total.visit_count).toBe(1699)
    // Weekdays and weekend days differ, so a range that slipped a day shows up
    // here as well as in the per-route arrays.
    expect(visits.monday.visit_count).toBe(249)
    expect(visits.saturday.visit_count).toBe(227)
  })

  it('keeps every route and stop the filter returned addressable', () => {
    // Holds for any fixture: the report indexes departures by route and stop,
    // so an entity the filter surfaces without an id is a row the UI cannot
    // draw.
    expect(filtered.routes.every(r => r.route_id)).toBe(true)
    expect(filtered.stops.every(s => s.stop_id)).toBe(true)
  })
})
