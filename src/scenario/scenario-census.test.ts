import { describe, it, expect, vi, type Mock } from 'vitest'
import {
  type GraphQLClient,
  type Bbox,
  parseBbox,
  apportionBuffer,
  censusGeographyMapToEntries,
  apiFetch,
  BasicGraphQLClient,
} from '~~/src/core'
import {
  runScenarioFetcher,
  applyScenarioResultFilter,
  type ScenarioConfig,
} from '~~/src/scenario'
import { stopGeoAggregateCsv } from '~~/src/tl'

// End-to-end tests of the census branch of the scenario pipeline. Both suites drive
// runScenarioFetcher and assert the same census numbers (tract and block group) — the
// hermetic suite from a MockGraphQLClient (always runs), the integration suite from a
// live transitland-server backed by the rebuild-census.sh test DB (opt-in). They share
// the config, the known geoids, and the pinned values, so the mock and the server are
// checked against the same expectations from opposite ends.

const GEO_DATASET = 'tiger2021'
const TABLE_DATASET = 'acsdt5y2021'
// Downtown Portland, OR — inside the WA/OR/CA fixture and known to intersect the
// geographies below. (The hermetic mock ignores query variables, but feed-versions
// throws without a bbox.)
const BBOX: Bbox = parseBbox('-122.69075,45.51358,-122.66809,45.53306')

// Known geographies in the bbox with total population (b01003_001) pinned to the
// committed census-data .dat. Block group 1500000US410510051012 nests under tract
// 1400000US41051005101.
const CASES = [
  { layer: 'tract', geoid: '1400000US41051005101', name: 'Census Tract 51.01', pop: 3353 },
  { layer: 'bg', geoid: '1500000US410510051012', name: 'Block Group 2', pop: 1843 },
]

// Census-only config: includeFixedRoute:false drops stops/routes/departures/buffers and
// includeFlexAreas:false drops flex, so the plan is exactly [feed-versions, census-values].
function censusConfig (aggregateLayer: string): ScenarioConfig {
  return {
    reportName: 'census-test',
    bbox: BBOX,
    geoDatasetName: GEO_DATASET,
    tableDatasetName: TABLE_DATASET,
    aggregateLayer,
    includeFixedRoute: false,
    includeFlexAreas: false,
    includeDepartures: false,
  }
}

// runScenarioFetcher streams progress to this controller while also accumulating
// ScenarioData internally; the accumulation path doesn't depend on the controller, so
// a no-op sink is sufficient for assertions.
function noopController (): ReadableStreamDefaultController {
  return {
    enqueue () {},
    close () {},
    error () {},
    get desiredSize () { return 1 },
  } as unknown as ReadableStreamDefaultController
}

// --- Hermetic suite -------------------------------------------------------------

// A GraphQLClient whose responses are scripted per call, in pipeline order.
class MockGraphQLClient implements GraphQLClient {
  public mockQuery: Mock
  constructor () {
    this.mockQuery = vi.fn()
  }

  async query<T = any> (query: any, variables?: any): Promise<{ data?: T }> {
    return this.mockQuery(query, variables)
  }
}

// Build the census_datasets response fetchCensusIntersection expects. geometryArea >
// intersectionArea so the apportionment ratio is a clean 0.5.
function censusResponse (geoid: string, layer: string, name: string, pop: number) {
  return {
    data: {
      census_datasets: [{
        id: 1,
        name: GEO_DATASET,
        url: '',
        geographies: [{
          id: 100,
          name,
          aland: 0,
          awater: 0,
          geoid,
          layer_name: layer,
          adm0_name: 'United States',
          adm0_iso: 'US',
          adm1_name: 'Oregon',
          adm1_iso: 'US-OR',
          geometry_area: 1000,
          intersection_area: 500,
          intersection_geometry: null,
          values: [
            { dataset_name: TABLE_DATASET, geoid, values: { b01003_001: pop } },
          ],
        }],
      }],
    },
  }
}

describe('scenario census pipeline (hermetic)', () => {
  for (const c of CASES) {
    it(`runs the full pipeline and surfaces ${c.layer} census values end to end`, async () => {
      const client = new MockGraphQLClient()
      client.mockQuery
        .mockResolvedValueOnce({ data: { feeds: [] } }) // feed-versions phase
        .mockResolvedValueOnce(censusResponse(c.geoid, c.layer, c.name, c.pop)) // census-values phase
        .mockResolvedValue({ data: {} })

      const config = censusConfig(c.layer)
      const data = await runScenarioFetcher(noopController(), config, client)

      // Exactly two GraphQL calls: feed-versions then census-values.
      expect(client.mockQuery).toHaveBeenCalledTimes(2)

      // 1) Raw pipeline output: the geography + ACS value landed in ScenarioData, tagged
      //    with the requested layer and the area-derived intersection ratio (500/1000).
      const geo = data.censusGeographies.get(c.geoid)
      expect(geo).toBeDefined()
      expect(geo!.values['b01003_001']).toBe(c.pop)
      expect(geo!.layer).toBe(c.layer)
      expect(geo!.intersectionRatio).toBeCloseTo(0.5, 6)

      // 2) scenarioFilter (applyScenarioResultFilter) passes the census map through
      //    unchanged — this is the object the report components consume.
      const filtered = applyScenarioResultFilter(data, config, {})
      expect(filtered.censusGeographies?.get(c.geoid)?.values['b01003_001']).toBe(c.pop)

      // 3) The aggregation table the report renders: a stop-less row is seeded per
      //    geography and carries the full (un-apportioned) demographic value.
      const rows = stopGeoAggregateCsv([], c.layer, filtered.censusGeographies)
      const row = rows.find(r => r.geoid === c.geoid)
      expect(row).toBeDefined()
      expect(row!.layer_name).toBe(c.layer)
      expect((row as Record<string, unknown>).total_population).toBe(c.pop)

      // 4) Buffer apportionment (the stopBufferRadius>0 report path): the additive value
      //    scales by the intersection ratio, while median income is non-additive => null.
      const apportioned = apportionBuffer(censusGeographyMapToEntries(data.censusGeographies))
      expect(apportioned.values.total_population).toBeCloseTo(c.pop * 0.5, 6)
      expect(apportioned.pctCoverage).toBeCloseTo(0.5, 6)
      expect(apportioned.values.median_household_income).toBeNull()
    })
  }
})

// --- Integration suite ----------------------------------------------------------
//
// Hits a live transitland-server backed by the rebuild-census.sh test DB (states
// WA/OR/CA, datasets acsdt5y2021 + tiger2021). Opt-in so an environment without a
// server doesn't fail; enable with:
//   TEST_CENSUS=true TRANSITLAND_API_BASE=http://localhost:8080 pnpm test
//
// The raw b01003_001 total population is bbox-clip-invariant (the server returns the
// full-geography ACS value and reports clipping separately), so the pinned values are
// deterministic against the committed dump.
describe.skipIf(process.env.TEST_CENSUS !== 'true')('scenario census pipeline (integration)', () => {
  const client = new BasicGraphQLClient(
    (process.env.TRANSITLAND_API_BASE || '') + '/query',
    apiFetch(process.env.TRANSITLAND_API_KEY || ''),
  )

  for (const c of CASES) {
    it(`fetches real ${c.layer} census values from the server`, async () => {
      const data = await runScenarioFetcher(noopController(), censusConfig(c.layer), client)

      // The census-values query returned geographies for the requested layer.
      expect(data.censusGeographies.size).toBeGreaterThan(0)
      for (const geo of data.censusGeographies.values()) {
        expect(geo.layer).toBe(c.layer)
      }

      // The specific known geography carries its pinned ACS total population.
      const known = data.censusGeographies.get(c.geoid)
      expect(known, `expected ${c.geoid} in the downtown-Portland ${c.layer} results`).toBeDefined()
      expect(known!.values['b01003_001']).toBe(c.pop)
    }, 120000)
  }
})
