/**
 * Scenario Filter Module
 *
 * This module filters transit route and stop data fetched from the Transitland API
 * based on user-selected criteria in the UI. Each route and stop is marked (included)
 * or unmarked (excluded) based on the active filters.
 *
 * FILTER SEMANTICS:
 * - Array filters (selectedWeekdays, selectedRouteTypes, selectedAgencies):
 *   - undefined/null = filter not applied, all items pass
 *   - [] (empty array) = filter applied with nothing selected, no items pass
 *   - [values...] = filter applied, only matching items pass
 *
 * - Numeric filters (frequencyOver, frequencyUnder):
 *   - undefined/null = filter not applied, all items pass
 *   - number = filter applied, items must meet the threshold
 *
 * FILTERING FLOW:
 * 1. Routes are filtered first based on:
 *    - selectedWeekdays: route must have service (headways) on selected days (Any/All mode)
 *    - selectedRouteTypes: route must have matching route_type
 *    - selectedAgencies: route must belong to matching agency
 *    - frequencyOver/frequencyUnder: route's average frequency must be within thresholds
 *
 * 2. Stops are then filtered based on:
 *    - Service availability: stop must have departures on selected days (Any/All mode)
 *      within the selected time window (startTime/endTime)
 *    - Marked routes: if route-level filters are active, stop must serve at least
 *      one marked route
 *
 * 3. Agencies are derived from the filtered stops and routes
 */

import { format } from 'date-fns'
import {
  getSelectedDateRange,
  type ScenarioConfig,
  type ScenarioData,
  type ScenarioFilter
} from './scenario'
import {
  routeHeadways,
  newRouteHeadwaySummary,
  calculateHeadwayStats
} from './route-headway'
import {
  type Weekday,
  type WeekdayMode,
  type RouteType,
  parseHMS,
  routeTypeNames,
} from '~~/src/core'
import type {
  Agency,
  FeedVersion,
  Route,
  RouteHeadwayDirections,
  Stop,
  StopDepartureCache,
  StopGql,
  StopVisitCounts,
  StopVisitSummary,
  FlexAreaFeature
} from '~~/src/tl'
import { getFlexAgencyNames } from '~~/src/tl/flex'

////////////////////
// Route filtering
////////////////////

function routeSetDerived (
  route: Route,
  selectedDateRange: Date[],
  selectedStartTime?: string,
  selectedEndTime?: string,
  selectedWeekdays?: Weekday[],
  selectedWeekdayMode?: WeekdayMode,
  selectedRouteTypes?: RouteType[],
  selectedAgencies?: string[],
  frequencyUnder?: number,
  frequencyOver?: number,
  sdCache?: StopDepartureCache,
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
    // Assign headways to route so it can be used in filtering
    route.headways = headwayResult
    const hwTotal = headwayResult.total
    let deps = hwTotal.dir0.departures
    if (hwTotal.dir1.departures.length > hwTotal.dir0.departures.length) {
      deps = hwTotal.dir1.departures
    }
    // Calculate headways from departures
    const stats = calculateHeadwayStats(deps)
    if (stats) {
      route.average_frequency = stats.average
      route.fastest_frequency = stats.fastest
      route.slowest_frequency = stats.slowest
      // console.debug('routeSetDerived:', route.id,
      //   'departures:', deps.length,
      //   'avg:', Math.round(stats.average / 60), 'min',
      //   'fastest:', Math.round(stats.fastest / 60), 'min',
      //   'slowest:', Math.round(stats.slowest / 60), 'min'
      // )
    } else {
      route.average_frequency = undefined
      route.fastest_frequency = undefined
      route.slowest_frequency = undefined
      // console.debug('routeSetDerived:', route.id,
      //   'departures:', deps.length,
      //   'headways: none (need 2+ departures to calculate headways)'
      // )
    }
  }
  // Mark after setting frequency values
  route.marked = routeMarked(
    route,
    selectedWeekdays,
    selectedWeekdayMode,
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
  selectedWeekdays?: Weekday[],
  selectedWeekdayMode?: WeekdayMode,
  selectedRouteTypes?: RouteType[],
  selectedAgencies?: string[],
  frequencyUnder?: number,
  frequencyOver?: number,
  sdCache?: StopDepartureCache,
): boolean {
  // Check selected days - route must have service on selected days
  if (selectedWeekdays != null) {
    if (selectedWeekdays.length === 0) {
      // console.debug('routeMarked:', route.id, 'unmarked: selectedWeekdays is empty array')
      return false
    }
    // Check if route has service on selected days using headway data
    let hasAny = false
    let hasAll = true
    for (const sd of selectedWeekdays) {
      let dayHeadways: RouteHeadwayDirections | undefined
      if (sd === 'sunday') {
        dayHeadways = route.headways?.sunday
      } else if (sd === 'monday') {
        dayHeadways = route.headways?.monday
      } else if (sd === 'tuesday') {
        dayHeadways = route.headways?.tuesday
      } else if (sd === 'wednesday') {
        dayHeadways = route.headways?.wednesday
      } else if (sd === 'thursday') {
        dayHeadways = route.headways?.thursday
      } else if (sd === 'friday') {
        dayHeadways = route.headways?.friday
      } else if (sd === 'saturday') {
        dayHeadways = route.headways?.saturday
      }
      const hasService = dayHeadways && (dayHeadways.dir0.departures.length > 0 || dayHeadways.dir1.departures.length > 0)
      if (hasService) {
        hasAny = true
      } else {
        hasAll = false
      }
    }
    // Check mode
    let found = false
    if (selectedWeekdayMode === 'Any') {
      found = hasAny
    } else if (selectedWeekdayMode === 'All') {
      found = hasAll
    }
    if (!found) {
      // console.debug('routeMarked:', route.id, 'unmarked: no service on selectedWeekdays', selectedWeekdays, 'mode:', selectedWeekdayMode, 'hasAny:', hasAny, 'hasAll:', hasAll)
      return false
    }
  }

  // Check route types
  if (selectedRouteTypes != null && !selectedRouteTypes.includes(route.route_type)) {
    // console.debug('routeMarked:', route.id, 'unmarked: route_type', route.route_type, 'not in', selectedRouteTypes)
    return false
  }

  // Check agencies
  if (selectedAgencies != null && !selectedAgencies.includes(route.agency.agency_name)) {
    // console.debug('routeMarked:', route.id, 'unmarked: agency', route.agency.agency_name, 'not in', selectedAgencies)
    return false
  }

  if (sdCache && frequencyOver != null) {
    if (!route.average_frequency || route.average_frequency < frequencyOver * 60) {
      // console.debug('routeMarked:', route.id, 'unmarked: average_frequency', route.average_frequency, '< frequencyOver', frequencyOver * 60)
      return false
    }
  }

  if (sdCache && frequencyUnder != null) {
    if (!route.average_frequency || route.average_frequency > frequencyUnder * 60) {
      // console.debug('routeMarked:', route.id, 'unmarked: average_frequency', route.average_frequency, '> frequencyUnder', frequencyUnder * 60)
      return false
    }
  }

  // Default is to return true
  // console.debug('routeMarked:', route.id, 'marked: passed all filters')
  return true
}

const dowDateString: Weekday[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

//////////////////////////////////////
// Stop filtering
//////////////////////////////////////

// Mutates calculated fields on Stop
function stopSetDerived (
  stop: Stop,
  selectedWeekdays?: Weekday[],
  selectedWeekdayMode?: WeekdayMode,
  selectedDateRange?: Date[],
  selectedStartTime?: string,
  selectedEndTime?: string,
  selectedRouteTypes?: RouteType[],
  selectedAgencies?: string[],
  frequencyUnder?: number,
  frequencyOver?: number,
  markedRoutes?: Set<number>,
  sdCache?: StopDepartureCache) {
  // Apply filters
  // Make sure to run stopVisits before stopMarked
  stop.visits = stopVisits(
    stop,
    selectedWeekdays,
    selectedDateRange,
    selectedStartTime,
    selectedEndTime,
    sdCache,
  )
  stop.marked = stopMarked(
    stop,
    selectedWeekdays,
    selectedWeekdayMode,
    selectedRouteTypes,
    selectedAgencies,
    frequencyUnder,
    frequencyOver,
    markedRoutes,
    sdCache,
  )
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

function stopVisits (
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
    const sdDow = dowDateString[sd.getDay()]
    if (!sdDow || !selectedWeekdays?.includes(sdDow)) {
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
  selectedWeekdays?: Weekday[],
  selectedWeekdayMode?: WeekdayMode,
  selectedRouteTypes?: RouteType[],
  selectedAgencies?: string[],
  frequencyUnder?: number,
  frequencyOver?: number,
  markedRoutes?: Set<number>,
  sdCache?: StopDepartureCache,
): boolean {
  // Check departure days - only apply if selectedWeekdays is defined
  if (sdCache && selectedWeekdays != null) {
    // hasAny: stop has service on at least one selected day of week
    // hasAll: stop has service on all selected days of week
    let hasAny = false
    let hasAll = true
    for (const sd of selectedWeekdays) {
      // if-else tree required to avoid arbitrary index into type
      let r: StopVisitCounts | undefined
      if (sd === 'sunday') {
        r = stop.visits?.sunday || undefined
      } else if (sd === 'monday') {
        r = stop.visits?.monday || undefined
      } else if (sd === 'tuesday') {
        r = stop.visits?.tuesday || undefined
      } else if (sd === 'wednesday') {
        r = stop.visits?.wednesday || undefined
      } else if (sd === 'thursday') {
        r = stop.visits?.thursday || undefined
      } else if (sd === 'friday') {
        r = stop.visits?.friday || undefined
      } else if (sd === 'saturday') {
        r = stop.visits?.saturday || undefined
      }
      if (r == undefined) { continue }
      if (r.visit_count > 0) {
        hasAny = true
      }
      if (!r.all_date_service) {
        hasAll = false
      }
    }
    // Check mode
    let found = false
    if (selectedWeekdayMode === 'Any') {
      found = hasAny
    } else if (selectedWeekdayMode === 'All') {
      found = hasAll
    }
    // Not found, no further processing
    if (!found) {
      // console.debug('stopMarked:', stop.id, 'unmarked: no service on selectedWeekdays', selectedWeekdays, 'mode:', selectedWeekdayMode)
      return false
    }
  }

  // Check marked routes
  // Must match at least one marked route if any route-level filters are applied
  if (markedRoutes && (selectedAgencies != null || selectedRouteTypes != null || frequencyUnder != null || frequencyOver != null)) {
    const hasMarkedRoute = stop.route_stops.some(rs => markedRoutes.has(rs.route.id))
    if (!hasMarkedRoute) {
      // console.debug('stopMarked:', stop.id, 'unmarked: no marked routes')
      return false
    }
  }

  // Default is to return true
  // console.debug('stopMarked:', stop.id, 'marked: passed all filters')
  return true
}

function newStopVisitCounts (): StopVisitCounts {
  return {
    visit_count: 0,
    date_count: 0,
    visit_average: undefined,
    all_date_service: true
  }
}

function checkDiv (a: number, b: number): number {
  return b === 0 ? 0 : a / b
}

//////////////////////////////////////
// Flex area filtering
//////////////////////////////////////

/**
 * Filter flex areas by agency
 * Returns true if the flex area matches the selected agencies filter
 */
function flexAreaMarked (
  feature: FlexAreaFeature,
  selectedAgencies?: string[],
): boolean {
  // No filter applied - all pass
  if (selectedAgencies == null) { return true }
  // Empty filter - nothing passes
  if (selectedAgencies.length === 0) { return false }

  // Check if flex area matches any selected agency
  const featureAgencyNames = getFlexAgencyNames(feature)
  const hasMatchingAgency = featureAgencyNames.some(name =>
    selectedAgencies.includes(name)
  )
  if (!hasMatchingAgency) {
    // console.debug('flexAreaMarked:', feature.id, 'unmarked: no matching agency in', selectedAgencies)
    return false
  }

  return true
}

export interface ScenarioFilterResult {
  routes: Route[]
  stops: Stop[]
  agencies: Agency[]
  stopDepartureCache: StopDepartureCache
  feedVersions: FeedVersion[]
  flexAreas: FlexAreaFeature[]
}

export function applyScenarioResultFilter (
  data: ScenarioData,
  config: ScenarioConfig,
  filter: ScenarioFilter
): ScenarioFilterResult {
  const sdCache = data.stopDepartureCache
  const selectedDateRangeValue = getSelectedDateRange(config)
  const selectedWeekdayModeValue = filter.selectedWeekdayMode
  const selectedDaysValue = filter.selectedWeekdays
  const selectedRouteTypesValue = filter.selectedRouteTypes
  const selectedAgenciesValue = filter.selectedAgencies
  const startTimeValue = filter.startTime ? format(filter.startTime, 'HH:mm:ss') : '00:00:00'
  const endTimeValue = filter.endTime ? format(filter.endTime, 'HH:mm:ss') : '24:00:00'
  const frequencyUnderValue = filter.frequencyUnder
  const frequencyOverValue = filter.frequencyOver
  ///////////

  // Apply route filters
  const routeFeatures = data.routes.map((routeGql): Route => {
    const route: Route = {
      ...routeGql,
      route_name: routeGql.route_long_name || routeGql.route_short_name || routeGql.route_id,
      agency_name: routeGql.agency?.agency_name || 'Unknown',
      route_mode: routeTypeNames.get(routeGql.route_type) || 'Unknown',
      marked: true,
      average_frequency: undefined,
      fastest_frequency: undefined,
      slowest_frequency: undefined,
      headways: newRouteHeadwaySummary(),
      __typename: 'Route', // backwards compat
    }
    routeSetDerived(
      route,
      selectedDateRangeValue,
      startTimeValue,
      endTimeValue,
      selectedDaysValue,
      selectedWeekdayModeValue,
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
      visits: undefined,
      __typename: 'Stop', // backwards compat
    }
    stopSetDerived(
      stop,
      selectedDaysValue,
      selectedWeekdayModeValue,
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
      routes_modes: [...adata.routes_modes].map(r => (routeTypeNames.get(r) || 'Unknown')).join(', '),
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

  // Apply flex area filters
  const flexAreaFeatures = (data.flexAreas || []).map((flexArea): FlexAreaFeature => {
    const marked = flexAreaMarked(
      flexArea,
      selectedAgenciesValue,
    )
    return {
      ...flexArea,
      properties: {
        ...flexArea.properties,
        marked,
      }
    }
  })

  ///////////
  const result: ScenarioFilterResult = {
    routes: routeFeatures,
    stops: stopFeatures,
    agencies: agencyFeatures,
    feedVersions: [],
    stopDepartureCache: sdCache,
    flexAreas: flexAreaFeatures,
  }
  return result
}
