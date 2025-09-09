import { format } from 'date-fns'
import { getSelectedDateRange, type ScenarioConfig, type ScenarioData, type ScenarioFilter } from './scenario'
import { parseHMS, routeTypes, type dow } from '~/src/core'
import type { Agency, FeedVersion, Route, RouteHeadwayDirections, RouteHeadwaySummary, Stop, StopDepartureCache, StopGql, StopTime, StopVisitCounts, StopVisitSummary } from '~/src/tl'

////////////////////
// Route filtering
////////////////////

export function routeSetDerived (
  route: Route,
  selectedDateRange: Date[],
  selectedStartTime: string,
  selectedEndTime: string,
  selectedRouteTypes: number[],
  selectedAgencies: string[],
  frequencyUnder: number,
  frequencyOver: number,
  sdCache: StopDepartureCache | null,
) {
  // Set derived properties
  if (sdCache) {
    const headwayResult = routeHeadways(
      route,
      selectedDateRange,
      selectedStartTime,
      selectedEndTime,
      sdCache,
    )
    const hwTotal = headwayResult.total
    let hw = hwTotal.dir0
    if (hwTotal.dir1.headways_seconds.length > hwTotal.dir0.headways_seconds.length) {
      hw = hwTotal.dir1
    }
    if (hw.headways_seconds.length > 0) {
      route.average_frequency = (hw.headways_seconds.reduce((a, b) => a + b) / hw.headways_seconds.length)
      route.fastest_frequency = hw.headways_seconds[0]
      route.slowest_frequency = hw.headways_seconds[hw.headways_seconds.length - 1]
    } else {
      route.average_frequency = null
      route.fastest_frequency = null
      route.slowest_frequency = null
    }
  }
  // Mark after setting frequency values
  route.marked = routeMarked(
    route,
    selectedRouteTypes,
    selectedAgencies,
    frequencyUnder,
    frequencyOver,
    sdCache,
  )
}

// Filter routes
function routeMarked (
  route: Route,
  selectedRouteTypes: number[],
  selectedAgencies: string[],
  frequencyUnder: number,
  frequencyOver: number,
  sdCache: StopDepartureCache | null,
): boolean {
  // Check route types
  if (selectedRouteTypes.length > 0) {
    if (!selectedRouteTypes.includes(route.route_type)) {
      return false
    }
  }

  // Check agencies
  if (selectedAgencies.length > 0) {
    if (!selectedAgencies.includes(route.agency.agency_name)) {
      return false
    }
  }

  if (sdCache && frequencyOver >= 0) {
    if (!route.average_frequency || route.average_frequency < frequencyOver * 60) {
      return false
    }
  }

  if (sdCache && frequencyUnder >= 0) {
    if (!route.average_frequency || route.average_frequency > frequencyUnder * 60) {
      return false
    }
  }

  // Default is to return true
  return true
}

export function routeHeadways (
  route: Route,
  selectedDateRange: Date[],
  selectedStartTime: string,
  selectedEndTime: string,
  sdCache: StopDepartureCache | null
): RouteHeadwaySummary {
  const result = newRouteHeadwaySummary()
  if (!sdCache) {
    return result
  }
  const startTime = parseHMS(selectedStartTime)
  const endTime = parseHMS(selectedEndTime)
  for (const dir of [0, 1]) {
    for (const d of selectedDateRange) {
      // Get the stop with the most departures
      let stopId: number = 0
      let stopDepartures: StopTime[] = []
      const dateStopDeps = sdCache.getRouteDate(route.id, dir, format(d, 'yyyy-MM-dd'))
      for (const [depStopId, deps] of dateStopDeps.entries()) {
        if (deps.length > stopDepartures.length) {
          stopId = depStopId
          stopDepartures = deps
        }
      }

      // Convert HH:MM:SS to seconds and calculate headways
      const stSecs = stopDepartures
        .map((st) => { return parseHMS(st.departure_time) })
        .filter((depTime) => { return depTime >= startTime && depTime <= endTime })
      stSecs.sort((a, b) => a - b)

      const headways: number[] = []
      for (let i = 0; i < stSecs.length - 1; i++) {
        headways.push(stSecs[i + 1] - stSecs[i])
      }
      headways.sort((a, b) => a - b)

      // Add to result
      const resultDir = dir ? result.total.dir1 : result.total.dir0
      resultDir.stop_id = stopId
      resultDir.headways_seconds.push(...headways)

      let resultDay: RouteHeadwayDirections | null = null
      switch (d.getDay()) {
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
      if (resultDay) {
        const dayDir = dir ? resultDay.dir1 : resultDay.dir0
        dayDir.stop_id = stopId
        dayDir.headways_seconds.push(...headways)
      }
    }
  }
  return result
}

export function newRouteHeadwaySummary (): RouteHeadwaySummary {
  return {
    total: newRouteHeadwayDirections(),
    sunday: newRouteHeadwayDirections(),
    monday: newRouteHeadwayDirections(),
    tuesday: newRouteHeadwayDirections(),
    wednesday: newRouteHeadwayDirections(),
    thursday: newRouteHeadwayDirections(),
    friday: newRouteHeadwayDirections(),
    saturday: newRouteHeadwayDirections(),
  }
}

function newRouteHeadwayDirections () {
  return {
    dir0: { stop_id: 0, headways_seconds: [] },
    dir1: { stop_id: 0, headways_seconds: [] }
  }
}

const dowDateString: dow[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

//////////////////////////////////////
// Stop filtering
//////////////////////////////////////

// Mutates calculated fields on Stop
export function stopSetDerived (
  stop: Stop,
  selectedDays: dow[],
  selectedDayMode: string,
  selectedDateRange: Date[],
  selectedStartTime: string,
  selectedEndTime: string,
  selectedRouteTypes: number[],
  selectedAgencies: string[],
  frequencyUnder: number,
  frequencyOver: number,
  markedRoutes: Set<number>,
  sdCache: StopDepartureCache | null,) {
  // Apply filters
  // Make sure to run stopVisits before stopMarked
  stop.visits = stopVisits(
    stop,
    selectedDays,
    selectedDateRange,
    selectedStartTime,
    selectedEndTime,
    sdCache,
  )
  stop.marked = stopMarked(
    stop,
    selectedDays,
    selectedDayMode,
    selectedRouteTypes,
    selectedAgencies,
    frequencyUnder,
    frequencyOver,
    markedRoutes,
    sdCache,
  )
}

export function newStopVisitSummary (): StopVisitSummary {
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

function stopVisits (
  stop: StopGql,
  selectedDays: dow[],
  selectedDateRange: Date[],
  selectedStartTime: string,
  selectedEndTime: string,
  sdCache: StopDepartureCache | null,
): StopVisitSummary {
  const result = newStopVisitSummary()
  if (!sdCache) {
    return result
  }
  const startTime = parseHMS(selectedStartTime)
  const endTime = parseHMS(selectedEndTime)
  for (const sd of selectedDateRange) {
    const sdDow = dowDateString[sd.getDay()] || ''
    if (!selectedDays.includes(sdDow)) {
      continue
    }
    // TODO: memoize formatted date
    const stopDepTimes = sdCache.get(stop.id, format(sd, 'yyyy-MM-dd')).map((st) => { return parseHMS(st.departure_time) })
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
  // console.log('stopVisitResult:', stop.id, 'counts:', result)
  return result
}

// Filter stops
function stopMarked (
  stop: Stop,
  selectedDays: dow[],
  selectedDayMode: string,
  selectedRouteTypes: number[],
  selectedAgencies: string[],
  frequencyUnder: number,
  frequencyOver: number,
  markedRoutes: Set<number>,
  sdCache: StopDepartureCache | null,
): boolean {
  // Check departure days
  if (sdCache) {
    // hasAny: stop has service on at least one selected day of week
    // hasAll: stop has service on all selected days of week
    let hasAny = false
    let hasAll = true
    for (const sd of selectedDays) {
      // if-else tree required to avoid arbitrary index into type
      let r: StopVisitCounts | null = null
      if (sd === 'sunday') {
        r = stop.visits?.sunday || null
      } else if (sd === 'monday') {
        r = stop.visits?.monday || null
      } else if (sd === 'tuesday') {
        r = stop.visits?.tuesday || null
      } else if (sd === 'wednesday') {
        r = stop.visits?.wednesday || null
      } else if (sd === 'thursday') {
        r = stop.visits?.thursday || null
      } else if (sd === 'friday') {
        r = stop.visits?.friday || null
      } else if (sd === 'saturday') {
        r = stop.visits?.saturday || null
      }
      if (!r) { continue }
      if (r.visit_count > 0) {
        hasAny = true
      }
      if (!r.all_date_service) {
        hasAll = false
      }
    }
    // Check mode
    let found = false
    if (selectedDayMode === 'Any') {
      found = hasAny
    } else if (selectedDayMode === 'All') {
      found = hasAll
    }
    // Not found, no further processing
    if (!found) {
      return false
    }
  }

  // Check marked routes
  // Must match at least one marked route
  if (selectedAgencies.length > 0 || selectedRouteTypes.length > 0 || frequencyUnder > 0 || frequencyOver > 0) {
    const hasMarkedRoute = stop.route_stops.some(rs => markedRoutes.has(rs.route.id))
    if (!hasMarkedRoute) {
      console.log('no marked route', stop.id)
      return false
    }
  }

  // Default is to return true
  return true
}

function newStopVisitCounts (): StopVisitCounts {
  return {
    visit_count: 0,
    date_count: 0,
    visit_average: null,
    all_date_service: true
  }
}

function checkDiv (a: number, b: number): number {
  return b === 0 ? 0 : a / b
}

export interface ScenarioFilterResult {
  routes: Route[]
  stops: Stop[]
  agencies: Agency[]
  stopDepartureCache: StopDepartureCache
  feedVersions: FeedVersion[]
}

export function applyScenarioResultFilter (
  data: ScenarioData,
  config: ScenarioConfig,
  filter: ScenarioFilter
): ScenarioFilterResult {
  const sdCache = data.stopDepartureCache
  const selectedDateRangeValue = getSelectedDateRange(config)
  const selectedDayOfWeekModeValue = filter.selectedDayOfWeekMode || ''
  const selectedDaysValue = filter.selectedDays || []
  const selectedRouteTypesValue = filter.selectedRouteTypes || []
  const selectedAgenciesValue = filter.selectedAgencies || []
  const startTimeValue = filter.startTime ? format(filter.startTime, 'HH:mm:ss') : '00:00:00'
  const endTimeValue = filter.endTime ? format(filter.endTime, 'HH:mm:ss') : '24:00:00'
  const frequencyUnderValue = (filter.frequencyUnderEnabled ? filter.frequencyUnder : -1) || -1
  const frequencyOverValue = (filter.frequencyOverEnabled ? filter.frequencyOver : -1) || -1
  ///////////

  // Apply route filters
  const routeFeatures = data.routes.map((routeGql): Route => {
    const route: Route = {
      ...routeGql,
      route_name: routeGql.route_long_name || routeGql.route_short_name || routeGql.route_id,
      agency_name: routeGql.agency?.agency_name || 'Unknown',
      route_mode: routeTypes.get(routeGql.route_type) || 'Unknown',
      marked: true,
      average_frequency: null,
      fastest_frequency: null,
      slowest_frequency: null,
      headways: newRouteHeadwaySummary(),
      __typename: 'Route', // backwards compat
    }
    routeSetDerived(
      route,
      selectedDateRangeValue,
      startTimeValue,
      endTimeValue,
      selectedRouteTypesValue,
      selectedAgenciesValue,
      frequencyUnderValue,
      frequencyOverValue,
      sdCache,
    )
    return route
  })
  const markedRoutes = new Set(routeFeatures.filter(r => r.marked).map(r => r.id))

  // Apply stop filters
  const stopFeatures = data.stops.map((stopGql): Stop => {
    const stop: Stop = {
      ...stopGql,
      marked: true,
      visits: null,
      __typename: 'Stop', // backwards compat
    }
    stopSetDerived(
      stop,
      selectedDaysValue,
      selectedDayOfWeekModeValue,
      selectedDateRangeValue,
      startTimeValue,
      endTimeValue,
      selectedRouteTypesValue,
      selectedAgenciesValue,
      frequencyUnderValue,
      frequencyOverValue,
      markedRoutes,
      sdCache
    )
    return stop
  })
  const _markedStops = new Set(stopFeatures.filter(s => s.marked).map(s => s.id))

  // Apply agency filters
  const agencyData = new Map()
  for (const stop of stopFeatures) {
    for (const rstop of stop.route_stops || []) {
      const agency = rstop.route.agency
      const aid = agency?.agency_id
      if (!aid) {
        continue // no valid agency listed for this stop?
      }
      const adata = agencyData.get(aid) || {
        id: aid,
        routes: new Set(),
        routes_modes: new Set(),
        stops: new Set(),
        agency: agency,
      }
      adata.routes.add(rstop.route.id)
      adata.routes_modes.add(rstop.route.route_type)
      adata.stops.add(stop.id)
      agencyData.set(aid, adata)
    }
  }
  const markedAgencies: Set<number> = new Set()
  stopFeatures.filter(s => s.marked).forEach((s) => {
    for (const rstop of s.route_stops || []) {
      markedAgencies.add(rstop.route.agency?.id)
    }
  })
  routeFeatures.filter(s => s.marked).forEach((s) => {
    markedAgencies.add(s.agency?.id)
  })
  const agencyDataValues = [...agencyData.values()]
  const agencyFeatures: Agency[] = agencyDataValues.map((adata): Agency => {
    const agency = adata.agency as Agency
    return {
      marked: markedAgencies.has(agency.id),
      routes_count: adata.routes.size, // adata.routes.intersection(markedRoutes).size,
      routes_modes: [...adata.routes_modes].map(r => (routeTypes.get(r) || 'Unknown')).join(', '),
      stops_count: adata.stops.size, // adata.stops.intersection(markedStops).size,
      id: agency.id,
      agency_id: agency.agency_id,
      agency_name: agency.agency_name,
      agency_email: agency.agency_email,
      agency_fare_url: agency.agency_fare_url,
      agency_lang: agency.agency_lang,
      agency_phone: agency.agency_phone,
      agency_timezone: agency.agency_timezone,
      __typename: 'Agency', // backwards compat
    }
  })

  ///////////
  const result: ScenarioFilterResult = {
    routes: routeFeatures,
    stops: stopFeatures,
    agencies: agencyFeatures,
    feedVersions: [],
    stopDepartureCache: sdCache,
  }
  return result
}
