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

// A GTFS stop_id is unique within a feed, not across feeds. Keying service
// levels on the id alone let one feed's levels overwrite another's, so a busy
// stop reported whatever the last feed processed happened to say — which
// statewide read as most of the network having almost no service.
//
// Unlike the goldens beside it, this is not a value recorded from an earlier
// implementation. It states the behaviour the keying fix is for, and fails
// against the version that keys on the bare id.
//
// The box is chosen for the collision rather than for coverage: 31 stops
// around Southworth on Puget Sound, where exactly two active feeds both carry
// a stop numbered 20 and their service is nothing alike — a ferry terminal
// against a small transit stop 4.9 km away, roughly 5,300 stop times against
// 55. Under the old keying the terminal lost its level 4 to the smaller stop.
//
// Needs the fixture services: `./docker/reset-test-services.sh`. Ungated, like
// scenario-census.test.ts.

const COLLIDING_STOP_ID = '20'
const FERRY_FEED = 'f-c28-washingtonstateferries'
const TRANSIT_FEED = 'f-c22y-kitsaptransit'

function noopController (): ReadableStreamDefaultController {
  return {
    enqueue () {},
    close () {},
    error () {},
    get desiredSize () { return 1 },
  } as unknown as ReadableStreamDefaultController
}

const config: WSDOTReportConfig = {
  ...SCENARIO_DEFAULTS,
  reportName: 'feed-version-keying',
  bbox: parseBbox('-122.5450,47.5050,-122.4950,47.5550'),
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

function rowFor (feedOnestopId: string) {
  return report.stops.find(s => s.stopId === COLLIDING_STOP_ID && s.feedOnestopId === feedOnestopId)
}

describe('service levels across feeds sharing a GTFS stop id', () => {
  it('lists both feeds\' copies of the shared id', () => {
    // The precondition the rest of the suite rests on. If a dump rebuild ever
    // removes the collision, this fails first and says so, rather than the
    // assertions below passing for the wrong reason.
    const rows = report.stops.filter(s => s.stopId === COLLIDING_STOP_ID)
    expect(rows.map(r => r.feedOnestopId).sort()).toEqual([TRANSIT_FEED, FERRY_FEED].sort())
  })

  it('gives each copy the levels its own feed earns', () => {
    const ferry = rowFor(FERRY_FEED)
    const transit = rowFor(TRANSIT_FEED)
    expect(ferry, `no ${FERRY_FEED} row for stop ${COLLIDING_STOP_ID}`).toBeDefined()
    expect(transit, `no ${TRANSIT_FEED} row for stop ${COLLIDING_STOP_ID}`).toBeDefined()

    // The terminal's service reaches level 4; the smaller stop's does not.
    // Keyed on the bare stop id, both rows came back with the smaller stop's
    // levels and the terminal's level 4 disappeared.
    expect(ferry!.level4).toBe(1)
    expect(transit!.level4).toBe(0)

    // Everything the two do agree on still agrees, so the assertion above is
    // about the keying rather than about one of them losing service outright.
    expect(ferry!.level5).toBe(1)
    expect(transit!.level5).toBe(1)
    expect(ferry!.level6).toBe(1)
    expect(transit!.level6).toBe(1)
  })

  it('carries a distinct feed version on each copy', () => {
    // What the levels are keyed by. Two rows sharing a sha1 would make the
    // keys collide again whatever the id.
    expect(rowFor(FERRY_FEED)!.feedVersionSha1)
      .not.toBe(rowFor(TRANSIT_FEED)!.feedVersionSha1)
  })
})
