import { describe, it, expect, beforeAll } from 'vitest'
import { runAnalysis, type WSDOTStopsRoutesReport } from './index'
import type { WSDOTReportConfig } from '~~/src/analysis/wsdot'
import {
  apiFetch,
  BasicGraphQLClient,
  parseBbox,
  parseDate,
  SCENARIO_DEFAULTS,
} from '~~/src/core'

// The stops-and-routes report, pinned against the fixture tlserver. Companion
// to ../wsdot/report-goldens.test.ts, and here for the same reason: recorded
// on the implementation being replaced, so a branch that reworks how the
// report is built can be checked against it rather than against a golden it
// recorded itself.
//
// This is the report behind the GeoJSON and CSV downloads — whole stops with
// their service-level columns, whole routes with their shapes, and the agency
// rollup the viewer lists — so its values are what a user takes away from the
// tool rather than only what the map draws.
//
// Needs the fixture services: `./docker/reset-test-services.sh`. Ungated, like
// scenario-census.test.ts.

const LEVEL_KEYS = ['level1', 'level2', 'level3', 'level4', 'level5', 'level6', 'levelNights'] as const
type LevelKey = (typeof LEVEL_KEYS)[number]

function noopController (): ReadableStreamDefaultController {
  return {
    enqueue () {},
    close () {},
    error () {},
    get desiredSize () { return 1 },
  } as unknown as ReadableStreamDefaultController
}

// Same bbox and week as the service-level goldens, so the two reports are
// pinned over identical input.
const config: WSDOTReportConfig = {
  ...SCENARIO_DEFAULTS,
  reportName: 'stops-routes-goldens',
  bbox: parseBbox('-122.69075,45.51358,-122.66809,45.53306'),
  startDate: parseDate('2025-11-17'),
  endDate: parseDate('2025-11-23'),
  weekdayDate: parseDate('2025-11-17')!,
  weekendDate: parseDate('2025-11-23')!,
  geographyIds: [],
  stopBufferRadius: 0,
  routeHourCompatMode: true,
}

let report: WSDOTStopsRoutesReport

beforeAll(async () => {
  const client = new BasicGraphQLClient(
    (process.env.TRANSITLAND_API_BASE || 'http://localhost:28080') + '/query',
    apiFetch(''),
  )
  const { stopsRoutesReport } = await runAnalysis(noopController(), config, client)
  report = stopsRoutesReport
}, 300000)

// The level columns are counts here rather than booleans, so they are summed.
function levelTotals (): Record<LevelKey, number> {
  return Object.fromEntries(
    LEVEL_KEYS.map(key => [key, report.stops.reduce((n, stop) => n + (stop[key] || 0), 0)]),
  ) as Record<LevelKey, number>
}

// Recorded from this implementation against the fixture dumps. They move when
// the dumps are rebuilt; re-record deliberately, by reading what changed in
// the feeds, rather than pasting what a run printed.
const GOLDEN_COUNTS = { stops: 161, routes: 56, agencies: 11 }

// Fewer stops than ../wsdot's 177: this report lists only stops that are on a
// route.
const GOLDEN_LEVEL_TOTALS: Record<LevelKey, number> = {
  level1: 9,
  level2: 103,
  level3: 123,
  level4: 143,
  level5: 148,
  level6: 155,
  levelNights: 7,
}

// The rollup the viewer lists, as [agencyId, agencyName, stopsCount,
// routesCount], sorted by id. Small enough to pin whole, and the agency id is
// feed-scoped, so two feeds carrying the same GTFS agency stay separate —
// note Columbia County Rider appearing under both its own feed and Tillamook's.
const GOLDEN_AGENCIES: Array<[string, string, number, number]> = [
  ['f-9-amtrak~amtrakcalifornia~amtrakcharteredvehicle:51', 'Amtrak', 1, 3],
  ['f-9rb-pacificcrest~or~us:187', 'Pacific Crest Bus Lines', 1, 1],
  ['f-9rc-cobreeze~or~us:47', 'Central Oregon Breeze', 1, 1],
  ['f-c20-columbiacountyrider:57', 'Columbia County Rider', 1, 1],
  ['f-c20-tillamook~or~us:22', 'Tillamook County Transportation District', 1, 1],
  ['f-c20-tillamook~or~us:57', 'Columbia County Rider', 1, 1],
  ['f-c20-trimet:PSC', 'Portland Streetcar', 23, 3],
  ['f-c20-trimet:TRIMET', 'TriMet', 122, 39],
  ['f-c20g-c~tran:C-TRAN', 'C-TRAN', 7, 3],
  ['f-point~or-us:45', 'Oregon POINT', 2, 2],
  ['f-shuttle~oregon:923', 'Shuttle Oregon', 1, 1],
]

describe('WSDOT stops-and-routes goldens (integration)', () => {
  it('reports the pinned number of stops, routes and agencies', () => {
    expect({
      stops: report.stops.length,
      routes: report.routes.length,
      agencies: report.agencies.length,
    }).toEqual(GOLDEN_COUNTS)
  })

  it('carries the pinned service level totals', () => {
    expect(levelTotals()).toEqual(GOLDEN_LEVEL_TOTALS)
  })

  it('rolls stops and routes up to the pinned agencies', () => {
    const rollup = [...report.agencies]
      .sort((a, b) => a.agencyId.localeCompare(b.agencyId))
      .map(a => [a.agencyId, a.agencyName, a.stopsCount, a.routesCount])
    expect(rollup).toEqual(GOLDEN_AGENCIES)
  })

  it('exports every route with a shape and every stop with an agency', () => {
    // Both are what the GeoJSON download carries. The agency is joined from the
    // routes phase, so a routes failure degrades the label rather than the
    // grouping — this pins that every stop still gets one.
    expect(report.routes.filter(r => (r.geometry?.coordinates || []).length > 0))
      .toHaveLength(GOLDEN_COUNTS.routes)
    expect(report.stops.filter(s => s.agencyId)).toHaveLength(GOLDEN_COUNTS.stops)
    expect(report.stops.filter(s => s.feedVersionSha1)).toHaveLength(GOLDEN_COUNTS.stops)
  })

  it('classifies a known stop the same way', () => {
    const stop = report.stops.find(s => s.stopId === '7594')
    expect(stop, 'stop 7594 missing from the report').toBeDefined()
    expect(stop!.agencyId).toBe('f-c20-trimet:TRIMET')
    expect(stop!.feedOnestopId).toBe('f-c20-trimet')
    expect(Object.fromEntries(LEVEL_KEYS.map(k => [k, stop![k]]))).toEqual({
      level1: 1, level2: 1, level3: 1, level4: 1, level5: 1, level6: 1, levelNights: 0,
    })
  })
})
