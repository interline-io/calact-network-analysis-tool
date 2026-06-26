// Per-stop visit accounting: counts departures that fall within the selected
// weekdays / dates / time window into a per-day + total summary. Pure (no
// fetching) — extracted from scenario-filter so that file stays focused on the
// marking/filter logic, mirroring how route-headway owns the frequency math.

import { format } from 'date-fns'
import { parseHMS, WEEKDAY_BY_GETDAY, type Weekday } from '~~/src/core'
import type { StopGql, StopVisitSummary, StopVisitCounts, StopDepartureCache } from '~~/src/tl'

function newStopVisitCounts (): StopVisitCounts {
  return {
    visit_count: 0,
    date_count: 0,
    visit_average: undefined,
    all_date_service: true
  }
}

function newStopVisitSummary (): StopVisitSummary {
  return {
    total: newStopVisitCounts(),
    monday: newStopVisitCounts(),
    tuesday: newStopVisitCounts(),
    wednesday: newStopVisitCounts(),
    thursday: newStopVisitCounts(),
    friday: newStopVisitCounts(),
    saturday: newStopVisitCounts(),
    sunday: newStopVisitCounts(),
  }
}

function checkDiv (a: number, b: number): number {
  return b === 0 ? 0 : a / b
}

export function stopVisits (
  stop: StopGql,
  selectedWeekdays?: Weekday[],
  selectedDateRange?: Date[],
  selectedStartTime?: string,
  selectedEndTime?: string,
  sdCache?: StopDepartureCache,
): StopVisitSummary {
  const result = newStopVisitSummary()
  if (!sdCache) {
    return result
  }
  const startTime = parseHMS(selectedStartTime)
  const endTime = parseHMS(selectedEndTime)
  for (const sd of selectedDateRange || []) {
    const sdDow = WEEKDAY_BY_GETDAY[sd.getDay()]
    if (selectedWeekdays != null && (!sdDow || !selectedWeekdays.includes(sdDow))) {
      continue
    }
    // TODO: memoize formatted date
    const stopDepTimes = sdCache.get(stop.id, format(sd, 'yyyy-MM-dd')).map(st => st.departureTime)
    let count = 0
    for (const depTime of stopDepTimes) {
      if (depTime >= startTime && depTime <= endTime) {
        count += 1
      }
    }
    result.total.date_count += 1
    result.total.visit_count += count
    result.total.visit_average = checkDiv(result.total.visit_count, result.total.date_count)
    let resultDay = result.total
    switch (sd.getDay()) {
      case 0:
        resultDay = result.sunday
        break
      case 1:
        resultDay = result.monday
        break
      case 2:
        resultDay = result.tuesday
        break
      case 3:
        resultDay = result.wednesday
        break
      case 4:
        resultDay = result.thursday
        break
      case 5:
        resultDay = result.friday
        break
      case 6:
        resultDay = result.saturday
        break
    }
    resultDay.date_count += 1
    resultDay.visit_count += count
    resultDay.visit_average = checkDiv(resultDay.visit_count, resultDay.date_count)
    if (count === 0) {
      resultDay.all_date_service = false
    }
  }
  return result
}
