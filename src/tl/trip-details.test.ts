import { describe, it, expect } from 'vitest'
import { parseTripDetails } from './trip-details'

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
    expect(t).toEqual({ id: 1, tripId: 't1', headsign: 'Downtown', startTime: 8 * 3600, endTime: 8.5 * 3600, stopCount: 3 })
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

  it('returns nothing for an empty response', () => {
    expect(parseTripDetails(undefined)).toEqual([])
  })
})
