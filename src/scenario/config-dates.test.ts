import { describe, it, expect } from 'vitest'
import { getSelectedDateRange } from '~~/src/scenario'
import { wsdotDepartureDates, wsdotReportDates } from '~~/src/analysis/wsdot'
import { fmtDate, type WSDOTReportConfig } from '~~/src/core'

function inZone<T> (tz: string, fn: () => T): T {
  const previous = process.env.TZ
  process.env.TZ = tz
  try {
    return fn()
  } finally {
    // Restored by removing it when it was unset: assigning `undefined` writes
    // the string "undefined", which Intl resolves to a broken zone and Node
    // treats as GMT. Vitest runs many files per worker, so that leaks out of
    // this file and quietly moves every test after it to UTC — where the
    // behaviour these cases exist to catch looks correct.
    if (previous === undefined) {
      delete process.env.TZ
    } else {
      process.env.TZ = previous
    }
  }
}

describe('config dates across runtime zones', () => {
  it('selects the days the config names, in any zone', () => {
    for (const tz of ['America/Los_Angeles', 'UTC', 'Asia/Tokyo']) {
      const days = inZone(tz, () =>
        getSelectedDateRange({ startDate: '2026-08-24' as unknown as Date, endDate: '2026-08-26' as unknown as Date })
          .map(d => fmtDate(d)))
      expect(days, `runtime in ${tz}`).toEqual(['2026-08-24', '2026-08-25', '2026-08-26'])
    }
  })

  it('reads the report dates the config names, in any zone', () => {
    const cfg = { weekdayDate: '2026-08-24', weekendDate: '2026-08-30' } as unknown as WSDOTReportConfig
    for (const tz of ['America/Los_Angeles', 'UTC', 'Asia/Tokyo']) {
      expect(inZone(tz, () => wsdotReportDates(cfg).map(d => fmtDate(d))), `runtime in ${tz}`)
        .toEqual(['2026-08-24', '2026-08-30', '2026-08-25'])
      expect(inZone(tz, () => wsdotDepartureDates(cfg)), `runtime in ${tz}`)
        .toEqual(['2026-08-23', '2026-08-24', '2026-08-25', '2026-08-29', '2026-08-30'])
    }
  })
})
