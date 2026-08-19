import { describe, it, expect, vi, type Mock } from 'vitest'
import { runAnalysis, WSDOT_FETCH_PHASES, type WSDOTReportConfig } from './index'
import { parseDate, SCENARIO_DEFAULTS, type Bbox, type GraphQLClient } from '~~/src/core'
import type { ScenarioProgress } from '~~/src/scenario'

class MockGraphQLClient implements GraphQLClient {
  public mockQuery: Mock = vi.fn()

  async query<T = any>(query: any, variables?: any): Promise<{ data?: T }> {
    return this.mockQuery(query, variables)
  }
}

// The stops-and-routes report asks for whole stops to be kept; the plain
// report does not. Both build their service levels from the same folded
// records, so the fold has to happen either way. Getting that wrong fails
// quietly: the frequency maps come up empty and every level driven by
// per-stop counts reports zero while the route-driven levels still return
// plausible numbers.

const config: WSDOTReportConfig = {
  ...SCENARIO_DEFAULTS,
  reportName: 'test',
  bbox: { sw: { lat: 45.4, lon: -122.8 }, ne: { lat: 45.7, lon: -122.5 }, valid: true } as Bbox,
  startDate: parseDate('2026-08-24'),
  endDate: parseDate('2026-08-30'),
  weekdayDate: parseDate('2026-08-25')!,
  weekendDate: parseDate('2026-08-30')!,
  geographyIds: [],
  aggregateLayer: 'state',
  stopBufferRadius: 0,
  routeHourCompatMode: true,
}

const feed = {
  id: '1',
  onestop_id: 'f-1',
  feed_state: { feed_version: { id: '1', sha1: 'sha1', feed: { id: 1, onestop_id: 'f-1' } } },
}

const stop = {
  id: 7,
  stop_id: 'stop_7',
  stop_name: 'Test Stop',
  location_type: 0,
  geometry: { type: 'Point', coordinates: [-122.6, 45.5] },
  census_geographies: [{ id: 1, geoid: '53', layer_name: 'state', name: 'Washington' }],
  feed_version: { sha1: 'sha1', feed: { onestop_id: 'f-1' } },
  route_stops: [],
}

function client () {
  const c = new MockGraphQLClient()
  c.mockQuery
    .mockResolvedValueOnce({ data: { feeds: [feed] } })
    .mockResolvedValueOnce({ data: { stops: [stop] } })
    .mockResolvedValue({ data: { stops: [], routes: [], census_geographies: [] } })
  return c
}

async function run (opts?: { retainScenarioEntities?: boolean }) {
  const controller = { enqueue: vi.fn(), close: vi.fn(), error: vi.fn() } as unknown as ReadableStreamDefaultController
  return runAnalysis(controller, config, client(), opts)
}

describe('runAnalysis fetch policy', () => {
  it('runs only the phases the report reads, whatever the caller asks for', async () => {
    // The browse config these reports are built from carries explicit values
    // for flex, census, buffers and clustering, so nothing here can be left to
    // default. Asserting the whole plan catches a phase coming back on, rather
    // than needing a separate test per flag.
    const sent: ScenarioProgress[] = []
    const controller = {
      enqueue: (chunk: Uint8Array) => {
        for (const line of new TextDecoder().decode(chunk).split('\n')) {
          if (line.trim()) { sent.push(JSON.parse(line)) }
        }
      },
      close: vi.fn(),
      error: vi.fn(),
    } as unknown as ReadableStreamDefaultController
    await runAnalysis(controller, {
      ...config,
      includeFlexAreas: true,
      includeCensus: true,
      stopBufferRadius: 800,
      stopClusterDistance: 400,
    }, client())

    expect(sent.find(p => p.phasePlan)?.phasePlan).toEqual(WSDOT_FETCH_PHASES)
  })

  it('never runs the flex phase, even when the caller asks for it', async () => {
    // The browse config these reports are built from always carries an
    // explicit includeFlexAreas: true, so defaulting rather than overriding
    // would run the phase for every report. Nothing here reads flex.
    const sent: ScenarioProgress[] = []
    const controller = {
      enqueue: (chunk: Uint8Array) => {
        for (const line of new TextDecoder().decode(chunk).split('\n')) {
          if (line.trim()) { sent.push(JSON.parse(line)) }
        }
      },
      close: vi.fn(),
      error: vi.fn(),
    } as unknown as ReadableStreamDefaultController
    await runAnalysis(controller, { ...config, includeFlexAreas: true }, client())

    const plan = sent.find(p => p.phasePlan)?.phasePlan
    expect(plan).toBeDefined()
    expect(plan).not.toContain('flex-areas')
  })

  it('narrows departures to the report dates, but lets a caller narrow further', async () => {
    const controller = { enqueue: vi.fn(), close: vi.fn(), error: vi.fn() } as unknown as ReadableStreamDefaultController
    const c = client()
    await runAnalysis(controller, { ...config, departureDates: ['2026-08-25'] }, c)
    const tripCalls = c.mockQuery.mock.calls.filter(([, v]) => v?.dates)
    for (const [, vars] of tripCalls) {
      expect(vars.dates).toEqual(['2026-08-25'])
    }
  })
})

describe('runAnalysis client stream', () => {
  it('attaches the departure totals to every event, including the analysis stage', async () => {
    // The loading modal reads the running figures off whatever event it last
    // received. An analysis-stage event without them makes the figures fall
    // back to a departure cache the server deliberately left empty, so the
    // readout drops to zero partway through the run.
    const sent: ScenarioProgress[] = []
    const controller = {
      enqueue: (chunk: Uint8Array) => {
        for (const line of new TextDecoder().decode(chunk).split('\n')) {
          if (line.trim()) { sent.push(JSON.parse(line)) }
        }
      },
      close: vi.fn(),
      error: vi.fn(),
    } as unknown as ReadableStreamDefaultController
    await runAnalysis(controller, config, client())

    expect(sent.length).toBeGreaterThan(0)
    expect(sent.every(p => p.departureSummary !== undefined)).toBe(true)
    // Including the stages the report fetcher emits, and the final one.
    expect(sent.some(p => p.currentStage === 'extra')).toBe(true)
    expect(sent.at(-1)?.currentStage).toBe('complete')
    expect(sent.at(-1)?.departureSummary).toBeDefined()
  })

  it('never puts departure tuples on the wire', async () => {
    const sent: ScenarioProgress[] = []
    const controller = {
      enqueue: (chunk: Uint8Array) => {
        for (const line of new TextDecoder().decode(chunk).split('\n')) {
          if (line.trim()) { sent.push(JSON.parse(line)) }
        }
      },
      close: vi.fn(),
      error: vi.fn(),
    } as unknown as ReadableStreamDefaultController
    await runAnalysis(controller, config, client())
    expect(sent.some(p => p.partialData?.stopDepartures)).toBe(false)
    expect(sent.some(p => p.partialData?.tripIdStrings)).toBe(false)
  })
})

describe('runAnalysis stop folding', () => {
  it('builds the stop table when whole stops are not retained', async () => {
    const { scenarioData, wsdotResult } = await run()
    expect(scenarioData.stops).toHaveLength(0)
    expect(wsdotResult.stops.map(s => s.stopId)).toEqual(['stop_7'])
    expect(wsdotResult.stops[0]?.stateName).toBe('Washington')
  })

  it('builds the same stop table when whole stops are retained', async () => {
    const { scenarioData, wsdotResult } = await run({ retainScenarioEntities: true })
    expect(scenarioData.stops).toHaveLength(1)
    expect(wsdotResult.stops.map(s => s.stopId)).toEqual(['stop_7'])
    expect(wsdotResult.stops[0]?.stateName).toBe('Washington')
  })

  it('produces an identical report either way', async () => {
    const folded = await run()
    const retained = await run({ retainScenarioEntities: true })
    expect(retained.wsdotResult.stops).toEqual(folded.wsdotResult.stops)
    expect(retained.wsdotResult.levelStops).toEqual(folded.wsdotResult.levelStops)
  })
})
