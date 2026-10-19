import { beforeAll, describe, it, expect, vi, type Mock } from 'vitest'
import {
  type GraphQLClient,
  type Bbox,
  type CensusGeographyData,
  parseBbox,
  apportionBuffer,
  censusGeographyMapToEntries,
  apiFetch,
  BasicGraphQLClient,
} from '~~/src/core'
import {
  runCensusValuesPhase,
  runScenarioFetcher,
  applyScenarioResultFilter,
  type ScenarioConfig,
  type ScenarioData,
} from '~~/src/scenario'
import { geographySearchQuery, routesById, stopGeoAggregateCsv } from '~~/src/tl'

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
// rebuild-census.sh test DB (acsdt5y2021). Block group 1500000US410510051012 nests
// under tract 1400000US41051005101.
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
  }
}

function integrationClient (): BasicGraphQLClient {
  return new BasicGraphQLClient(
    (process.env.TRANSITLAND_API_BASE || 'http://localhost:28080') + '/query',
    apiFetch(''),
  )
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
      const geo = data.censusGeographies!.get(c.geoid)
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
      const rows = stopGeoAggregateCsv([], c.layer, new Map(), filtered.censusGeographies)
      const row = rows.find(r => r.geoid === c.geoid)
      expect(row).toBeDefined()
      expect(row!.layer_name).toBe(c.layer)
      expect((row as Record<string, unknown>).total_population).toBe(c.pop)

      // 4) Buffer apportionment (the stopBufferRadius>0 report path): the additive value
      //    scales by the intersection ratio, while median income is non-additive => null.
      const apportioned = apportionBuffer(censusGeographyMapToEntries(data.censusGeographies, 'queryArea'))
      expect(apportioned.values.total_population).toBeCloseTo(c.pop * 0.5, 6)
      expect(apportioned.pctCoverage).toBeCloseTo(0.5, 6)
      expect(apportioned.values.median_household_income).toBeNull()
    })
  }
})

// --- Integration suite ----------------------------------------------------------
//
// Hits a live transitland-server backed by the rebuild-census.sh test DB (states
// WA/OR, datasets acsdt5y2021 + tiger2021). Bring one up with
// `./docker/reset-test-services.sh`, or testdata/gtfs/restore.sh. No API key —
// we only ever test against a local server.
//
// The raw b01003_001 total population is bbox-clip-invariant (the server returns the
// full-geography ACS value and reports clipping separately), so the pinned values are
// deterministic against the rebuild-census.sh test DB.
describe('scenario census pipeline (integration)', () => {
  const client = integrationClient()

  for (const c of CASES) {
    it(`fetches real ${c.layer} census values from the server`, async () => {
      const data = await runScenarioFetcher(noopController(), censusConfig(c.layer), client)

      // The census-values query returned geographies for the requested layer.
      expect(data.censusGeographies!.size).toBeGreaterThan(0)
      for (const geo of data.censusGeographies!.values()) {
        expect(geo.layer).toBe(c.layer)
      }

      // The specific known geography carries its pinned ACS total population.
      const known = data.censusGeographies!.get(c.geoid)
      expect(known, `expected ${c.geoid} in the downtown-Portland ${c.layer} results`).toBeDefined()
      expect(known!.values['b01003_001']).toBe(c.pop)
    }, 120000)
  }
})

// --- Admin-boundary query area suite --------------------------------------------
//
// A run scoped to several admin boundaries clips census to all of them. A client
// that sends only one boundary drops every tract in the others.
describe('admin-boundary query area (integration)', () => {
  const client = integrationClient()
  const COUNTIES = [
    { name: 'Multnomah', geoid: '0500000US41051' },
    { name: 'Washington', geoid: '0500000US41067' },
  ]

  // Ids depend on load order, so each county is looked up by geoid.
  async function countyId (name: string, geoid: string): Promise<number> {
    const resp = await client.query<{ census_datasets: { geographies: { id: number, geoid: string }[] }[] }>(
      geographySearchQuery,
      { search: name, layer: 'county', dataset_name: GEO_DATASET, limit: 100 },
    )
    const geo = resp.data?.census_datasets[0]?.geographies.find(g => g.geoid === geoid)
    if (!geo) {
      throw new Error(`could not find county ${geoid}`)
    }
    return geo.id
  }

  it('clips census to every selected county', async () => {
    const geographyIds = []
    for (const county of COUNTIES) {
      geographyIds.push(await countyId(county.name, county.geoid))
    }
    const config: ScenarioConfig = { ...censusConfig('tract'), bbox: undefined, geographyIds }
    const data = await runScenarioFetcher(noopController(), config, client)
    const tracts = [...data.censusGeographies!.entries()]

    // Every tract in each county is fully inside the query area.
    const prefixes = COUNTIES.map(c => `1400000US${c.geoid.slice(-5)}`)
    for (const prefix of prefixes) {
      const inCounty = tracts.filter(([geoid]) => geoid.startsWith(prefix))
      expect(inCounty.length, `expected tracts under ${prefix}`).toBeGreaterThan(0)
      for (const [geoid, geo] of inCounty) {
        expect(geo.intersectionRatio, `expected ${geoid} fully covered`).toBeGreaterThan(0.999)
      }
    }
    // Tracts in neighboring counties only touch the boundary.
    for (const [geoid, geo] of tracts) {
      if (!prefixes.some(p => geoid.startsWith(p))) {
        expect(geo.intersectionRatio, `expected no area for neighbor ${geoid}`).toBeLessThan(0.001)
      }
    }
  }, 120000)
})

// --- Stop-buffer clip suite -----------------------------------------------------
//
// The census clips come from the server: the query area narrowed to the stop
// buffers, and with `exclude` the query area outside them. Only a live server
// shows the two splitting each geography's query-area share.
describe('stop-buffer clips (integration)', () => {
  const client = integrationClient()

  // Fixed-route on for the stops, and a radius small enough that downtown
  // Portland's buffers leave gaps, so some tracts straddle a buffer edge.
  const RADIUS = 100
  const clipConfig: ScenarioConfig = {
    ...censusConfig('tract'),
    reportName: 'stop-buffer-clip-test',
    includeFixedRoute: true,
    stopBufferRadius: RADIUS,
    includeOutsideClip: true,
  }

  let data: ScenarioData
  beforeAll(async () => {
    data = await runScenarioFetcher(noopController(), clipConfig, client)
  }, 300000)

  it('splits each tract between the inside and outside clips', () => {
    expect(data.stops.length).toBeGreaterThan(0)
    const tracts = [...data.censusGeographies!.entries()]
    expect(tracts.length).toBeGreaterThan(0)

    let split = 0
    for (const [geoid, geo] of tracts) {
      // A failed clip pass leaves its clip undefined, so these catch a server
      // that rejects the clip as well as one that measures it wrong.
      expect(geo.bufferIntersectionArea, `expected ${geoid} to carry the buffer clip`).toBeDefined()
      expect(geo.outsideIntersectionArea, `expected ${geoid} to carry the outside clip`).toBeDefined()
      const parts = geo.bufferIntersectionArea! + geo.outsideIntersectionArea!
      expect(Math.abs(geo.intersectionArea - parts), `expected ${geoid}'s clips to add up`).toBeLessThan(1)
      if (geo.bufferIntersectionArea! >= 1 && geo.outsideIntersectionArea! >= 1) {
        split++
      }
    }
    // Tracts cut by a buffer edge have area on both sides, so the sums check
    // the difference rather than either clip alone.
    expect(split).toBeGreaterThan(0)
  })

  // The outside clip costs a server pass of its own, so callers opt in.
  it('skips the outside pass unless asked', async () => {
    const emitted: [string, CensusGeographyData][] = []
    await runCensusValuesPhase({
      bbox: BBOX,
      geoDatasetName: GEO_DATASET,
      tableDatasetName: TABLE_DATASET,
      aggregateLayer: 'tract',
      stopBufferRadius: RADIUS,
      stopIds: data.stops.map(s => s.id),
    }, client, (p) => {
      if (p.partialData?.censusGeographies) {
        emitted.push(...p.partialData.censusGeographies as [string, CensusGeographyData][])
      }
    })
    expect(emitted.length).toBeGreaterThan(0)
    for (const [geoid, geo] of emitted) {
      expect(geo.bufferIntersectionArea, `expected ${geoid} to carry the buffer clip`).toBeDefined()
      expect(geo.outsideIntersectionArea, `expected no outside clip for ${geoid}`).toBeUndefined()
    }
  }, 120000)
})

// --- Per-stop census suite ------------------------------------------------------
//
// The other suites run with includeFixedRoute:false, so nothing there covers the
// stop-census phase or the join that puts its results on each Stop. That path
// fails silently when it breaks: the aggregation table keeps rendering, with
// every stop count at zero.
describe('per-stop census pipeline (integration)', () => {
  const client = integrationClient()

  const LAYER = 'tract'
  // The census config with fixed-route back on — the one difference that
  // brings the stops, and with them this phase.
  const stopCensusConfig: ScenarioConfig = {
    ...censusConfig(LAYER),
    reportName: 'stop-census-test',
    includeFixedRoute: true,
  }

  it('carries the aggregation layer from the phase through to the aggregation table', async () => {
    const data = await runScenarioFetcher(noopController(), stopCensusConfig, client)
    expect(data.stops.length).toBeGreaterThan(0)

    // 1) The phase answered for every stop the run discovered, at one layer.
    expect(data.stopCensusGeographies?.size).toBe(data.stops.length)
    for (const geographies of data.stopCensusGeographies!.values()) {
      for (const g of geographies) {
        expect(g.layer_name).toBe(LAYER)
      }
    }

    // 2) The result filter joins them onto each Stop, which is where every
    //    consumer reads them from.
    const filtered = applyScenarioResultFilter(data, stopCensusConfig, {})
    const withGeographies = filtered.stops.filter(s => (s.census_geographies?.length ?? 0) > 0)
    expect(withGeographies.length).toBeGreaterThan(0)

    // 3) The Stops (Aggregated) table: rows the stops actually landed in, not
    //    just the stop-less rows census-values seeds.
    const rows = stopGeoAggregateCsv(
      filtered.stops.filter(s => s.marked),
      LAYER,
      routesById(filtered.routes),
      filtered.censusGeographies,
    )
    // The table counts marked stops only, and stops with no service in the
    // period are unmarked (#433), so compare against the marked ones.
    const withStops = rows.filter(r => r.stops_count > 0)
    expect(withStops.length).toBeGreaterThan(0)
    expect(withStops.reduce((n, r) => n + r.stops_count, 0)).toBe(withGeographies.filter(s => s.marked).length)
  }, 300000)
})
