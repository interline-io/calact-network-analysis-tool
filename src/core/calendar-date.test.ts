import { describe, it, expect } from 'vitest'
import { fmtDate, parseCalendarDate, withCalendarDates } from './datetime'

// A calendar date the user picked has to come back out as the same day, in
// whatever zone each end happens to be. CI runs in UTC, where the broken
// behaviour looks correct, so the cases that matter set the zone explicitly.
// Node re-reads TZ per conversion, and it is restored either way.
function inZone<T> (tz: string, fn: () => T): T {
  const previous = process.env.TZ
  process.env.TZ = tz
  try {
    return fn()
  } finally {
    process.env.TZ = previous
  }
}

describe('parseCalendarDate', () => {
  it('reads a date-only string as that calendar day', () => {
    const d = parseCalendarDate('2026-08-24')!
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 8, 24])
  })

  it('round-trips through fmtDate west of Greenwich', () => {
    // `new Date('2026-08-24')` is UTC midnight, which is the 23rd in Pacific.
    // The CLI runs in whatever zone the machine is in, so this is the case
    // that silently analysed the day before the one asked for.
    inZone('America/Los_Angeles', () => {
      expect(fmtDate(parseCalendarDate('2026-08-24'))).toBe('2026-08-24')
      expect(fmtDate(new Date('2026-08-24'))).toBe('2026-08-23')
    })
  })

  it('round-trips through fmtDate east of Greenwich', () => {
    inZone('Asia/Tokyo', () => {
      expect(fmtDate(parseCalendarDate('2026-08-24'))).toBe('2026-08-24')
    })
  })

  it('round-trips in UTC, where the runtime actually is', () => {
    inZone('UTC', () => {
      expect(fmtDate(parseCalendarDate('2026-08-24'))).toBe('2026-08-24')
    })
  })

  it('leaves undefined alone', () => {
    expect(parseCalendarDate(undefined)).toBeUndefined()
  })

  it('rejects a value that is not a date', () => {
    expect(parseCalendarDate('not a date')).toBeUndefined()
  })
})

describe('withCalendarDates', () => {
  it('renders a Date as the day it represents', () => {
    expect(withCalendarDates({ weekdayDate: new Date(2026, 7, 24) }))
      .toEqual({ weekdayDate: '2026-08-24' })
  })

  it('keeps an instant out of the request entirely', () => {
    // This is the point of the helper. A serialized Date is an instant, so the
    // day it lands on depends on the browser's zone and the server's: a browser
    // at UTC+9 picking the 24th sends 2026-08-23T15:00:00Z, and a UTC server
    // reads the 23rd.
    const sent = JSON.stringify(withCalendarDates({ startDate: new Date(2026, 7, 24) }))
    expect(sent).toBe('{"startDate":"2026-08-24"}')
    expect(sent).not.toContain('T')
  })

  it('sends the same day from a browser in any zone', () => {
    for (const tz of ['America/Los_Angeles', 'UTC', 'Asia/Tokyo']) {
      const sent = inZone(tz, () => withCalendarDates({ startDate: new Date(2026, 7, 24) }))
      expect(sent, `browser in ${tz}`).toEqual({ startDate: '2026-08-24' })
    }
  })

  it('leaves everything that is not a date untouched', () => {
    const config = {
      reportName: 'x',
      stopBufferRadius: 800,
      includeFlexAreas: false,
      bbox: { sw: { lon: -122.8, lat: 45.4 }, ne: { lon: -122.5, lat: 45.7 }, valid: true },
      geographyIds: [363717],
    }
    expect(withCalendarDates(config)).toEqual(config)
  })

  it('reaches dates nested inside the config', () => {
    expect(withCalendarDates({ config: { weekdayDate: new Date(2026, 7, 25) } }))
      .toEqual({ config: { weekdayDate: '2026-08-25' } })
  })
})
