import { describe, it, expect, beforeAll } from 'vitest'
import { runAnalysis, type WSDOTReport, type WSDOTReportConfig, type WSDOTStopResult } from './index'
import {
  apiFetch,
  BasicGraphQLClient,
  parseBbox,
  parseDate,
  SCENARIO_DEFAULTS,
} from '~~/src/core'

// What the WSDOT report puts in front of a user — which service level each stop
// qualifies for — pinned against the fixture tlserver.
//
// This exists to be run from more than one branch. A golden recorded on the
// same branch that reworked how the report is computed only proves that branch
// agrees with itself; recorded here, on the implementation being replaced, it
// says whether the replacement produces the same report.
//
// There is deliberately no mock. A hermetic fixture has to imitate whatever
// GraphQL queries the loader issues, which is exactly the part a loader rewrite
// changes — the first version of this file keyed its fake routes response on a
// variable one branch had added, and every departure on the other branch was
// silently orphaned. Against a real server each branch issues whatever it
// likes, and the only shared surface is runAnalysis's three arguments and the
// WSDOTReport it returns.
//
// Bring the server up with `./docker/reset-test-services.sh`, or
// `docker compose -f docker/docker-compose.services.yaml up -d`. No API key —
// only ever a local server. Ungated, like scenario-census.test.ts.

const LEVEL_KEYS = ['level1', 'level2', 'level3', 'level4', 'level5', 'level6', 'levelNights'] as const
type LevelKey = (typeof LEVEL_KEYS)[number]

// The report is written to the stream as it is built; nothing here reads it
// back, so the sink only has to not block.
function noopController (): ReadableStreamDefaultController {
  return {
    enqueue () {},
    close () {},
    error () {},
    get desiredSize () { return 1 },
  } as unknown as ReadableStreamDefaultController
}

// Downtown Portland, the bbox the browse, filter and census suites all use.
const BBOX = parseBbox('-122.69075,45.51358,-122.66809,45.53306')

// A weekday and a weekend day inside the fixture feeds' service window.
const WEEKDAY = '2025-11-17'
const WEEKEND = '2025-11-23'

const config: WSDOTReportConfig = {
  ...SCENARIO_DEFAULTS,
  reportName: 'report-goldens',
  bbox: BBOX,
  startDate: parseDate(WEEKDAY),
  endDate: parseDate(WEEKEND),
  weekdayDate: parseDate(WEEKDAY)!,
  weekendDate: parseDate(WEEKEND)!,
  geographyIds: [],
  // Off: the buffer passes are demographics, not service levels, and they are
  // the slowest part of a run.
  stopBufferRadius: 0,
  routeHourCompatMode: true,
}

// One run, shared by every assertion below.
let report: WSDOTReport

beforeAll(async () => {
  const client = new BasicGraphQLClient(
    (process.env.TRANSITLAND_API_BASE || 'http://localhost:28080') + '/query',
    apiFetch(''),
  )
  const { wsdotResult } = await runAnalysis(noopController(), config, client)
  report = wsdotResult
}, 300000)

function levelCounts (stops: WSDOTStopResult[]): Record<LevelKey, number> {
  return Object.fromEntries(
    LEVEL_KEYS.map(key => [key, stops.filter(stop => stop[key]).length]),
  ) as Record<LevelKey, number>
}

// Recorded from this implementation against the fixture dumps, and stable
// across repeated runs. The whole point is that a branch reworking how the
// report is computed has to reproduce them.
//
// They move when the fixture dumps are rebuilt. Re-record deliberately, by
// reading what changed in the feeds — never by pasting whatever the run
// printed, which would turn this file into a record of the current behaviour
// rather than a check on it.
const GOLDEN_STOP_COUNT = 177

const GOLDEN_LEVEL_COUNTS: Record<LevelKey, number> = {
  level1: 9,
  level2: 103,
  level3: 123,
  level4: 143,
  level5: 148,
  level6: 155,
  levelNights: 7,
}

// Three stops spanning the range of outcomes: frequent all-day service, the
// bare minimum that still counts as service, and none at all.
const GOLDEN_STOPS: Record<string, Record<LevelKey, boolean>> = {
  // Frequent daytime service, nothing after midnight.
  7594: {
    level1: true, level2: true, level3: true, level4: true, level5: true, level6: true, levelNights: false,
  },
  // Over level 6's two-trips-a-day bar and under every other one.
  13170: {
    level1: false, level2: false, level3: false, level4: false, level5: false, level6: true, levelNights: false,
  },
  // In the query area, on no qualifying route: reported, with no level at all.
  10362: {
    level1: false, level2: false, level3: false, level4: false, level5: false, level6: false, levelNights: false,
  },
}

describe('WSDOT report goldens (integration)', () => {
  it('reports every stop in the query area', () => {
    expect(report.stops).toHaveLength(GOLDEN_STOP_COUNT)
    // Every stop is listed whether or not it has service, and carries the
    // aggregation layer's name.
    expect(report.stops.every(stop => stop.levelAll)).toBe(true)
    expect([...new Set(report.stops.map(stop => stop.stateName))]).toEqual(['Oregon'])
  })

  it('classifies the pinned number of stops at each service level', () => {
    expect(levelCounts(report.stops)).toEqual(GOLDEN_LEVEL_COUNTS)
  })

  it('classifies known stops the same way', () => {
    for (const [stopId, expected] of Object.entries(GOLDEN_STOPS)) {
      const stop = report.stops.find(s => s.stopId === stopId)
      expect(stop, `stop ${stopId} missing from the report`).toBeDefined()
      expect(
        Object.fromEntries(LEVEL_KEYS.map(key => [key, stop![key]])),
        `levels for stop ${stopId}`,
      ).toEqual(expected)
    }
  })

  it('nests the levels, as the thresholds require', () => {
    // Each level's criteria are weaker than the one above it in everything
    // they share, and add nothing of their own, so a stop meeting a stricter
    // level meets every looser one. Holds for any feed, so it stays true when
    // the counts above are re-recorded.
    const ladder = ['level1', 'level2', 'level3', 'level4', 'level5', 'level6'] as const
    for (const stop of report.stops) {
      for (let i = 0; i < ladder.length - 1; i++) {
        if (stop[ladder[i]!]) {
          expect(stop[ladder[i + 1]!], `${stop.stopId} is ${ladder[i]} but not ${ladder[i + 1]}`).toBe(true)
        }
      }
    }
  })
})
