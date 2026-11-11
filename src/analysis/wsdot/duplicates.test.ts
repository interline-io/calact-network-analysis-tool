import { describe, it, expect, beforeAll } from 'vitest'
import { findWsdotDuplicateRoutes, type WSDOTDuplicateRoutes } from './duplicates'
import { WSDOTFrequencyAggregator, type FrequencyLabels } from './frequency'
import { WSDOTStopCollector } from './stops'
import { wsdotDepartureDates, wsdotReportDates, type WSDOTReportConfig } from './report-phases'
import { apiFetch, BasicGraphQLClient, parseBbox, parseDate, SCENARIO_DEFAULTS } from '~~/src/core'
import { ScenarioDataReceiver, ScenarioFetcher, StopDepartureTuple, type ScenarioData } from '~~/src/scenario'
import type { RouteGql, RouteTripRelationship } from '~~/src/tl'

describe('findWsdotDuplicateRoutes', () => {
  const route = (id: number, feed: string, agencyId: number): RouteGql => ({
    id,
    route_id: `r${id}`,
    route_short_name: `R${id}`,
    route_long_name: '',
    route_type: 3,
    agency: { id: agencyId, agency_id: `a${agencyId}`, agency_name: `Agency ${agencyId}` },
    feed_version: { sha1: `sha-${feed}`, feed: { onestop_id: feed } },
  })
  const same = (a: RouteGql, b: RouteGql) => {
    const rel: RouteTripRelationship = 'SAME_TRIPS'
    a.similar_routes = [{ route: { id: b.id }, relationship: rel, trips: 4, other_trips: 4, matched_trips: 4, feed_relationship: rel, feed_trips: 4, feed_matched_trips: 4 }]
    b.similar_routes = [{ route: { id: a.id }, relationship: rel, trips: 4, other_trips: 4, matched_trips: 4, feed_relationship: rel, feed_trips: 4, feed_matched_trips: 4 }]
  }

  it('finds the copies and the stops only they serve', () => {
    // f-own has route 1 and two more; f-copy carries a copy of route 1 (2) and
    // a route of its own (3). Stop 20 is the copy's alone; stop 21 is shared
    // with route 3; stop 10 is route 1's.
    const own = route(1, 'f-own', 1)
    const copy = route(2, 'f-copy', 2)
    same(own, copy)
    const routes = [own, copy, route(3, 'f-copy', 3), route(4, 'f-own', 1), route(5, 'f-own', 1)]
    const found = findWsdotDuplicateRoutes(routes, { 1: [10], 2: [20, 21], 3: [21] })
    expect([...found.hidden]).toEqual([2])
    expect(found.removedStopIds).toEqual([20])
    expect(found.collapsedRoutes.map(c => [c.route.id, c.kept[0]?.id])).toEqual([[2, 1]])
  })

  it('finds nothing without copies', () => {
    expect(findWsdotDuplicateRoutes([route(1, 'f-own', 1)], { 1: [10] }).hidden.size).toBe(0)
  })
})

// Against the fixture tlserver (`./docker/reset-test-services.sh`), like the
// report goldens. Warrenton and Astoria: Tillamook's feed also carries Sunset
// Empire's routes 101, 10, 20 and PC (weekends only), which run the same trips
// on the report's days as in Sunset Empire's own feed, at stops its copy of
// route 15 also serves. That one stays, running only some of the same trips,
// so the copies share stops with a route the report keeps.

const config: WSDOTReportConfig = {
  ...SCENARIO_DEFAULTS,
  reportName: 'wsdot-duplicates',
  bbox: parseBbox('-123.95,46.13,-123.80,46.21'),
  startDate: parseDate('2025-11-17'),
  endDate: parseDate('2025-11-23'),
  weekdayDate: parseDate('2025-11-17')!,
  weekendDate: parseDate('2025-11-23')!,
  geographyIds: [],
  stopBufferRadius: 0,
  routeHourCompatMode: true,
  includeRouteGeometry: false,
  departureDates: undefined,
}
const runConfig: WSDOTReportConfig = { ...config, departureDates: wsdotDepartureDates(config) }
const dates = wsdotReportDates(config)

interface Run {
  data: ScenarioData
  stops: WSDOTStopCollector
  frequency: WSDOTFrequencyAggregator
  departures: StopDepartureTuple[]
  duplicates?: WSDOTDuplicateRoutes
}

// Fetched and folded as the WSDOT report does, with or without leaving the
// copies' departures out.
async function fetchRun (client: BasicGraphQLClient, collapse: boolean): Promise<Run> {
  const stops = new WSDOTStopCollector()
  const frequency = new WSDOTFrequencyAggregator(dates)
  const departures: StopDepartureTuple[] = []
  const run: Partial<Run> = { stops, frequency, departures }
  const receiver = new ScenarioDataReceiver({
    onProgress: (progress) => {
      if (progress.partialData?.stops) {
        stops.add(progress.partialData.stops)
      }
    },
  }, {
    onStopDepartures: (batch) => {
      frequency.addDepartures(batch)
      departures.push(...batch)
    },
  })
  const fetcher = new ScenarioFetcher(runConfig, client, p => receiver.onProgress(p), {
    plan: ['feed-versions', 'stops', 'routes', 'departures'],
    excludeDepartureRoutes: collapse
      ? (fetched) => {
          run.duplicates = findWsdotDuplicateRoutes(receiver.getCurrentData().routes, fetched.routeStopIds)
          stops.remove(run.duplicates.removedStopIds)
          return run.duplicates.hidden
        }
      : undefined,
  })
  await fetcher.fetch()
  return { ...run, data: receiver.getCurrentData() } as Run
}

let collapsed: Run
let full: Run

beforeAll(async () => {
  // A client per run: each run hooks the client's request-error reporting.
  const client = () => new BasicGraphQLClient(
    (process.env.TRANSITLAND_API_BASE || 'http://localhost:28080') + '/query',
    apiFetch(''),
  )
  ;[collapsed, full] = await Promise.all([fetchRun(client(), true), fetchRun(client(), false)])
}, 300000)

describe('WSDOT duplicate route collapse (integration)', () => {
  it('hides the copies that run the same trips, and keeps the others', () => {
    const name = (id: number) => collapsed.data.routes.find(r => r.id === id)
    const hidden = [...collapsed.duplicates!.hidden].map(id => `${name(id)?.feed_version.feed.onestop_id}:${name(id)?.route_short_name}`).sort()
    expect(hidden).toEqual(['f-c20-tillamook~or~us:10', 'f-c20-tillamook~or~us:101', 'f-c20-tillamook~or~us:20', 'f-c20-tillamook~or~us:PC'])
  })

  it('never fetches the copies\' departures, and fetches every other route\'s', () => {
    const hidden = collapsed.duplicates!.hidden
    expect(collapsed.departures.some(d => hidden.has(StopDepartureTuple.tripRouteId(d)))).toBe(false)
    expect(full.departures.some(d => hidden.has(StopDepartureTuple.tripRouteId(d)))).toBe(true)
    const kept = full.departures.filter(d => !hidden.has(StopDepartureTuple.tripRouteId(d)))
    expect(collapsed.departures).toHaveLength(kept.length)

    // So each stop counts as if the copies had never run, including the stops
    // they share with route 15.
    const expected = new WSDOTFrequencyAggregator(dates)
    expected.addDepartures(kept)
    const labels: FrequencyLabels = {
      stopGtfsIds: collapsed.stops.gtfsIds(),
      routeGtfsIds: new Map(collapsed.data.routes.filter(r => !hidden.has(r.id)).map(r => [r.id, r.route_id])),
    }
    for (const date of dates) {
      expect(collapsed.frequency.build(date, labels)).toEqual(expected.build(date, labels))
    }
  })

  it('drops the stops only the copies serve, and keeps the ones they share', () => {
    const hidden = collapsed.duplicates!.hidden
    const servedBy = (s: ScenarioData['stops'][number]) => (s.route_stops || []).map(rs => rs.route_id)
    const shared = collapsed.data.stops.filter(s => servedBy(s).some(id => hidden.has(id)) && servedBy(s).some(id => !hidden.has(id)))
    const copyOnly = collapsed.data.stops.filter(s => servedBy(s).length > 0 && servedBy(s).every(id => hidden.has(id)))
    expect(shared.length).toBeGreaterThan(0)
    const listed = collapsed.stops.gtfsIds()
    expect(shared.every(s => listed.has(s.id))).toBe(true)
    expect(copyOnly.some(s => listed.has(s.id))).toBe(false)
    expect(listed.size).toBe(full.stops.gtfsIds().size - copyOnly.length)
  })
})
