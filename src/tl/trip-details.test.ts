import { describe, it, expect } from 'vitest'
import { gql } from 'graphql-tag'
import { apiFetch, BasicGraphQLClient } from '../core'
import { parseTripDetails, tripDetailsQuery, tripHeadsignAt, type TripDetailsResponse } from './trip-details'

describe('parseTripDetails', () => {
  it('spans a trip from its earliest departure to its latest arrival', () => {
    const [t] = parseTripDetails({
      trips: [{
        id: 1,
        trip_id: 't1',
        trip_headsign: 'Downtown',
        stop_times: [
          { arrival_time: '07:58:00', departure_time: '08:00:00' },
          { arrival_time: '08:10:00', departure_time: '08:11:00' },
          { arrival_time: '08:30:00', departure_time: '08:32:00' },
        ],
      }],
    })
    expect(t).toMatchObject({ id: 1, tripId: 't1', headsign: 'Downtown', startTime: 8 * 3600, endTime: 8.5 * 3600, stopCount: 3 })
  })

  it('falls back to the other time where the feed left one blank, and keeps after-midnight times', () => {
    const [t] = parseTripDetails({
      trips: [{
        id: 2,
        trip_id: 't2',
        trip_headsign: '',
        stop_times: [
          { arrival_time: null, departure_time: '23:50:00' },
          { arrival_time: null, departure_time: null },
          { arrival_time: '24:20:00', departure_time: null },
        ],
      }],
    })
    expect(t?.headsign).toBeUndefined()
    expect(t?.startTime).toBe(23 * 3600 + 50 * 60)
    expect(t?.endTime).toBe(24 * 3600 + 20 * 60)
    expect(t?.stopCount).toBe(3)
  })

  it('signs a trip by the stop\'s headsign, then the trip\'s, then its last stop', () => {
    const [t] = parseTripDetails({
      trips: [{
        id: 3,
        trip_id: 't3',
        trip_headsign: null,
        stop_times: [
          { stop_sequence: 2, departure_time: '08:10:00', stop_headsign: null, stop: { id: 11, stop_name: 'Middle' } },
          { stop_sequence: 1, departure_time: '08:00:00', stop_headsign: 'Gateway TC', stop: { id: 10, stop_name: 'Start' } },
          { stop_sequence: 3, arrival_time: '08:20:00', stop_headsign: null, stop: { id: 12, stop_name: 'Gateway Transit Center' } },
        ],
      }],
    })
    expect(tripHeadsignAt(t!, 10)).toBe('Gateway TC')
    expect(tripHeadsignAt(t!, 11)).toBe('Gateway Transit Center')
    expect(tripHeadsignAt({ ...t!, headsign: 'Gateway' }, 11)).toBe('Gateway')
  })

  it('names and places where a trip ends by its last stop\'s parent station, where it has one', () => {
    const point = (lon: number, lat: number): GeoJSON.Point => ({ type: 'Point', coordinates: [lon, lat] })
    const [t] = parseTripDetails({
      trips: [{
        id: 4,
        trip_id: 't4',
        trip_headsign: null,
        stop_times: [
          { stop_sequence: 1, departure_time: '08:00:00', stop: { id: 10, stop_name: 'Start', geometry: point(-122.7, 45.5) } },
          { stop_sequence: 2, arrival_time: '08:20:00', stop: { id: 12, stop_name: 'Platform 2', geometry: point(-122.6767, 45.5293), parent: { stop_name: 'Union Station', geometry: point(-122.6765, 45.5290) } } },
        ],
      }],
    })
    expect(t).toMatchObject({ firstStopName: 'Start', firstStopPoint: [-122.7, 45.5], lastStopName: 'Union Station', lastStopPoint: [-122.6765, 45.529] })
  })

  it('reads around stop times the API returned as null, still counting them as stops', () => {
    const [t] = parseTripDetails({
      trips: [{
        id: 4,
        trip_id: 't4',
        trip_headsign: 'Sacramento',
        stop_times: [
          { stop_sequence: 1, departure_time: '04:15:00', stop: { id: 1, stop_name: 'Seattle' } },
          null,
          { stop_sequence: 3, arrival_time: '21:40:00', stop: { id: 3, stop_name: 'Sacramento' } },
        ],
      }],
    })
    expect(t).toMatchObject({ startTime: 4 * 3600 + 15 * 60, endTime: 21 * 3600 + 40 * 60, stopCount: 3, lastStopName: 'Sacramento' })
  })

  it('returns nothing for an empty response', () => {
    expect(parseTripDetails(undefined)).toEqual([])
  })
})

// Against the fixture transitland-server (docker/docker-compose.services.yaml):
// the details query's stop times, with pickup and drop-off types, as the
// server answers them.
describe('tripDetailsQuery (integration)', () => {
  const client = new BasicGraphQLClient(
    (process.env.TRANSITLAND_API_BASE || 'http://localhost:28080') + '/query',
    apiFetch(''),
  )

  it('reads every stop time of a trip, in order, with its pickup and drop-off types', async () => {
    const found = await client.query<{ trips: { id: number }[] }>(gql`
      query { trips(limit: 3, where: { feed_onestop_id: "f-c20-trimet" }) { id } }
    `, {})
    const ids = (found.data?.trips || []).map(t => t.id)
    expect(ids.length).toBeGreaterThan(0)
    const result = await client.query<TripDetailsResponse>(tripDetailsQuery, { ids, limit: ids.length })
    const details = parseTripDetails(result.data)
    expect(details.map(d => d.id).sort()).toEqual([...ids].sort())
    for (const d of details) {
      expect(d.firstStopPoint).toHaveLength(2)
      expect(d.lastStopPoint).toHaveLength(2)
      expect(d.stopTimes.length).toBe(d.stopCount)
      const departures = d.stopTimes.map(st => st.departure ?? st.arrival).filter(t => t !== undefined)
      expect(departures).toEqual([...departures].sort((a, b) => a - b))
      for (const st of d.stopTimes) {
        expect(st.pickupType === null || typeof st.pickupType === 'number').toBe(true)
        expect(st.dropOffType === null || typeof st.dropOffType === 'number').toBe(true)
      }
    }
  })
})
