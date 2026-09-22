/**
 * Scenario Filter Module
 *
 * This module filters transit route and stop data fetched from the Transitland API
 * based on user-selected criteria in the UI. Each route and stop is marked (included)
 * or unmarked (excluded) based on the active filters.
 *
 * FILTER SEMANTICS:
 * - Array filters (selectedRouteTypes, selectedAgencies):
 *   - undefined/null = filter not applied, all items pass
 *   - [] (empty array) = filter applied with nothing selected, no items pass
 *   - [values...] = filter applied, only matching items pass
 *
 * - selectedWeekdays follows the same convention, with one exception:
 *   The t-checkbox-group UI control normalizes "all items selected" to
 *   undefined. For 'Any' mode this is fine (no filter = all pass). But for
 *   'All' mode, undefined must be treated as "all 7 days are required" so
 *   that routes/stops without service every day are correctly filtered out.
 *   See resolveEffectiveWeekdays() below.
 *
 * - Numeric filters (frequencyOver, frequencyUnder, stopVisitsOver, stopVisitsUnder):
 *   - undefined/null = filter not applied, all items pass
 *   - number = filter applied, items must meet the threshold
 *
 * FILTERING FLOW:
 * 1. Routes are filtered first based on:
 *    - selectedWeekdays: route must have service (headways) on selected days (Any/All mode)
 *    - selectedRouteTypes: route must have matching route_type
 *    - selectedAgencies: route must belong to matching agency
 *    - frequencyOver/frequencyUnder: route's average frequency (minutes between
 *      trips) must be within thresholds
 *
 * 2. Stops are then filtered based on:
 *    - Service availability: stop must have departures on selected days (Any/All mode)
 *      within the selected time window (startTime/endTime)
 *    - stopVisitsOver/stopVisitsUnder: the stop's total visits during the
 *      filtered period (counting every route that serves it) must be within
 *      thresholds
 *    - Marked routes: if route-level filters are active, stop must serve at least
 *      one marked route
 *
 * 3. If a stop-level threshold is active, routes with no stop meeting that
 *    threshold are unmarked (issue #243) — the mirror of step 2's marked-routes
 *    rule. It tests the thresholds alone and not the weekday gate, so a
 *    threshold that excludes no stop leaves the route set unchanged.
 *
 * 4. Agencies are derived from the filtered stops and routes
 */

import { format } from 'date-fns'
import type {
  ScenarioConfig,
  ScenarioData,
  ScenarioFilter,
} from './scenario'
import { getSelectedDateRange } from './phases'
import {
  routeHeadways,
  hasServiceOnWeekday,
  calculateHeadwayStats,
  calculateRouteTripStats,
  pickDominantDirection,
  buildRouteFrequencyCaveats,
  scopeDatesToWeekdays,
  type RouteDepartures,
} from './route-headway'
import {
  deriveFilteredStopClusters,
  type StopCluster,
} from './phases/stop-clusters'
import { stopVisits } from './stop-visits'
import {
  type Weekday,
  type WeekdayMode,
  type RouteType,
  type CensusGeographyData,
  dowValues,
  routeTypeNames,
  WEEKDAY_BY_GETDAY,
} from '~~/src/core'
import type {
  Agency,
  AgencyGql,
  FeedVersion,
  Route,
  Stop,
  StopDepartureCache,
  StopVisitCounts,
  FlexAreaFeature,
  RouteDepartureIndex,
  BufferGeographyIntersection,
} from '~~/src/tl'
import { routesById } from '~~/src/tl'
import { getFlexAgencyNames } from '~~/src/tl/flex'
import { RouteDepartureIndex as RouteDepartureIndexClass } from '~~/src/tl/departure-cache'
import type { FlexDepartureCache } from '~~/src/tl/flex-departure-cache'

// The t-checkbox-group control normalizes "all items selected" to undefined,
// which normally means "no filter applied." For 'All' mode we override this:
// undefined + 'All' means the user wants every day to be required, so we
// expand it back to the explicit 7-day array to keep filtering active.
export function resolveEffectiveWeekdays (selectedWeekdays?: Weekday[], selectedWeekdayMode?: WeekdayMode): Weekday[] | undefined {
  if (selectedWeekdays == null && selectedWeekdayMode === 'All') {
    return [...dowValues] as Weekday[]
  }
  return selectedWeekdays
}

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
  routeIndex?: RouteDepartureIndex,
) {
  // Scope the date range to the selected weekdays so frequency and trip stats
  // reflect the current weekday selection (issue #222). Without this, the stats
  // pool every service day in the span and are invariant to weekday vs weekend.
  // resolveEffectiveWeekdays returns undefined when no weekday subset applies,
  // leaving the full range unscoped (all-days behavior unchanged). The Route
  // Timetable debug modal applies the same scopeDatesToWeekdays helper so it
  // cannot drift from these numbers.
  const scopedDateRange = scopeDatesToWeekdays(
    selectedDateRange,
    resolveEffectiveWeekdays(selectedWeekdays, selectedWeekdayMode),
  )

  // Build per-direction per-date in-window departures. Empty when no
  // routeIndex is available (both arrays are empty).
  const deps = routeHeadways(
    route,
    scopedDateRange,
    selectedStartTime,
    selectedEndTime,
    routeIndex,
  )

  // Set derived frequency scalars
  if (routeIndex) {
    // Pick the direction with more total departures across all service days;
    // the other direction is intentionally dropped (a route's headway is
    // reported per dominant direction).
    const chosenDir = pickDominantDirection(deps) === 1 ? deps.dir1 : deps.dir0
    const stats = calculateHeadwayStats(chosenDir)
    if (stats) {
      route.average_frequency = stats.average
      route.fastest_frequency = stats.fastest
      route.slowest_frequency = stats.slowest
    }
    const tripStats = calculateRouteTripStats(
      route,
      scopedDateRange,
      selectedStartTime,
      selectedEndTime,
      routeIndex,
    )
    if (tripStats) {
      route.average_trips_per_day = tripStats.averageTripsPerDay
      route.average_trips_per_hour = tripStats.averageTripsPerHour
      route.earliest_trip_start = tripStats.earliestTripStart
      route.earliest_trip_end = tripStats.earliestTripEnd
      route.latest_trip_start = tripStats.latestTripStart
      route.latest_trip_end = tripStats.latestTripEnd
    }

    // Frequency caveats (issue #368, Option C). Derived from the same windowed
    // deps that feed the reported frequency, so the flags stay consistent with
    // the numbers shown in the report, tooltip, and debug modal.
    const caveats = buildRouteFrequencyCaveats(deps)
    route.frequency_irregular = caveats.irregular
    route.frequency_directions_differ = caveats.directionsDifferMaterially
  }

  // Mark after setting frequency values. Pass the scoped range so deps (built
  // from the same range) and hasServiceOnWeekday stay positionally aligned;
  // marking is unchanged because hasServiceOnWeekday only inspects dates whose
  // weekday already matches a target.
  route.marked = routeMarked(
    route,
    deps,
    scopedDateRange,
    selectedWeekdays,
    selectedWeekdayMode,
    selectedRouteTypes,
    selectedAgencies,
    frequencyUnder,
    frequencyOver,
    routeIndex,
  )
}

// Filter routes
function routeMarked (
  route: Route,
  deps: RouteDepartures,
  selectedDateRange: Date[],
  selectedWeekdays?: Weekday[],
  selectedWeekdayMode?: WeekdayMode,
  selectedRouteTypes?: RouteType[],
  selectedAgencies?: string[],
  frequencyUnder?: number,
  frequencyOver?: number,
  routeIndex?: RouteDepartureIndex,
): boolean {
  // Check selected days - route must have service on selected days
  const effectiveWeekdays = resolveEffectiveWeekdays(selectedWeekdays, selectedWeekdayMode)
  if (effectiveWeekdays != null) {
    if (effectiveWeekdays.length === 0) {
      return false
    }
    let hasAny = false
    let hasAll = true
    for (const sd of effectiveWeekdays) {
      if (hasServiceOnWeekday(deps, selectedDateRange, sd)) {
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

  if (routeIndex && frequencyOver != null) {
    if (!route.average_frequency || route.average_frequency < frequencyOver * 60) {
      // console.debug('routeMarked:', route.id, 'unmarked: average_frequency', route.average_frequency, '< frequencyOver', frequencyOver * 60)
      return false
    }
  }

  if (routeIndex && frequencyUnder != null) {
    if (!route.average_frequency || route.average_frequency > frequencyUnder * 60) {
      // console.debug('routeMarked:', route.id, 'unmarked: average_frequency', route.average_frequency, '> frequencyUnder', frequencyUnder * 60)
      return false
    }
  }

  // Default is to return true
  // console.debug('routeMarked:', route.id, 'marked: passed all filters')
  return true
}

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
  routeFiltersActive?: boolean,
  stopVisitsUnder?: number,
  stopVisitsOver?: number,
  markedRoutes?: Set<number>,
  sdCache?: StopDepartureCache) {
  // Apply filters
  const effectiveWeekdays = resolveEffectiveWeekdays(selectedWeekdays, selectedWeekdayMode)
  // Make sure to run stopVisits before stopMarked
  stop.visits = stopVisits(
    stop,
    effectiveWeekdays,
    selectedDateRange,
    selectedStartTime,
    selectedEndTime,
    sdCache,
  )
  stop.marked = stopMarked(
    stop,
    effectiveWeekdays,
    selectedWeekdayMode,
    routeFiltersActive,
    stopVisitsUnder,
    stopVisitsOver,
    markedRoutes,
    sdCache,
  )
}

// True when the stop meets the stop-level visit thresholds. Split out of
// stopMarked so the route gate below can ask about the thresholds on their own,
// without inheriting the weekday/service verdict — routes judge weekday service
// for themselves in routeMarked, on laxer terms than stops do.
function passesStopVisitThresholds (stop: Stop, stopVisitsUnder?: number, stopVisitsOver?: number): boolean {
  // Total visits during the filtered period, counting departures from every
  // route that serves the stop, not only marked ones (#239 glossary). A stop
  // with no visits in the window counts as 0.
  const visitCount = stop.visits?.total.visit_count ?? 0
  if (stopVisitsOver != null && visitCount <= stopVisitsOver) {
    return false
  }
  if (stopVisitsUnder != null && visitCount > stopVisitsUnder) {
    return false
  }
  return true
}

// Filter stops
function stopMarked (
  stop: Stop,
  selectedWeekdays?: Weekday[],
  selectedWeekdayMode?: WeekdayMode,
  routeFiltersActive?: boolean,
  stopVisitsUnder?: number,
  stopVisitsOver?: number,
  markedRoutes?: Set<number>,
  sdCache?: StopDepartureCache,
): boolean {
  // Check departure days - only apply if selectedWeekdays is defined
  const effectiveWeekdays = resolveEffectiveWeekdays(selectedWeekdays, selectedWeekdayMode)
  if (sdCache && effectiveWeekdays != null) {
    // hasAny: stop has service on at least one selected day of week
    // hasAll: stop has service on all selected days of week
    let hasAny = false
    let hasAll = true
    for (const sd of effectiveWeekdays) {
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

  // Check stop visits (issue #243). Note the weekday gate above has already
  // dropped stops with no service on the selected days, so a zero-visit stop
  // only reaches an "under" threshold when no weekday filter is active.
  if (!passesStopVisitThresholds(stop, stopVisitsUnder, stopVisitsOver)) {
    return false
  }

  // Check marked routes
  // Must match at least one marked route if any route-level filters are applied
  if (markedRoutes && routeFiltersActive) {
    const hasMarkedRoute = stop.route_stops.some(rs => markedRoutes.has(rs.route_id))
    if (!hasMarkedRoute) {
      // console.debug('stopMarked:', stop.id, 'unmarked: no marked routes')
      return false
    }
  }

  // Default is to return true
  // console.debug('stopMarked:', stop.id, 'marked: passed all filters')
  return true
}

// Unmark routes with no stop meeting the visit thresholds: the stop-side mirror
// of the marked-routes check above. It asks about the thresholds rather than
// stop.marked so that a stop excluded for weekday reasons cannot drag its route
// down — routes apply their own, laxer weekday rule in routeMarked, and a
// threshold that excludes no stop must leave the route set untouched.
function unmarkRoutesWithoutPassingStop (
  routes: Route[],
  stops: Stop[],
  stopVisitsUnder?: number,
  stopVisitsOver?: number,
) {
  const routesWithPassingStop = new Set<number>()
  for (const stop of stops) {
    if (!passesStopVisitThresholds(stop, stopVisitsUnder, stopVisitsOver)) {
      continue
    }
    for (const rs of stop.route_stops || []) {
      routesWithPassingStop.add(rs.route_id)
    }
  }
  for (const route of routes) {
    if (route.marked && !routesWithPassingStop.has(route.id)) {
      route.marked = false
    }
  }
}

//////////////////////////////////////
// Flex area filtering
//////////////////////////////////////

/**
 * Filter flex areas by agency and optionally by day-of-week.
 * Returns true if the flex area passes all active filters.
 */
function flexAreaMarked (
  feature: FlexAreaFeature,
  flexDepartureCache: FlexDepartureCache,
  dateRange: Date[],
  selectedAgencies?: string[],
  selectedWeekdays?: Weekday[],
  selectedWeekdayMode?: WeekdayMode,
): boolean {
  // Agency filter
  if (selectedAgencies != null) {
    if (selectedAgencies.length === 0) { return false }
    const featureAgencyNames = getFlexAgencyNames(feature)
    const hasMatchingAgency = featureAgencyNames.some(name => selectedAgencies.includes(name))
    if (!hasMatchingAgency) {
      return false
    }
  }

  // Day-of-week filter
  const effectiveWeekdays = resolveEffectiveWeekdays(selectedWeekdays, selectedWeekdayMode)
  if (effectiveWeekdays != null) {
    if (effectiveWeekdays.length === 0) { return false }
    const locationId = feature.properties.internal_id
    if (locationId == null) { return false }

    let hasAny = false
    let hasAll = true

    for (const weekday of effectiveWeekdays) {
      let hasServiceOnWeekday = false
      for (const date of dateRange) {
        if (WEEKDAY_BY_GETDAY[date.getDay()] === weekday) {
          if (flexDepartureCache.hasService(locationId, format(date, 'yyyy-MM-dd'))) {
            hasServiceOnWeekday = true
            break
          }
        }
      }
      if (hasServiceOnWeekday) { hasAny = true } else { hasAll = false }
    }

    if (selectedWeekdayMode === 'All' ? !hasAll : !hasAny) {
      return false
    }
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
  // Passed through from ScenarioData for debug UIs (Route Timetable modal).
  tripIdStrings?: Map<number, string>
  // Passed through from ScenarioData for the aggregation table demographic
  // columns. Keyed by census geography geoid.
  censusGeographies?: Map<string, CensusGeographyData>
  // Pass C: per-stop buffer tracts. Populated only when the scenario
  // ran with `stopBufferRadius > 0`.
  stopBufferGeographies?: Map<number, BufferGeographyIntersection[]>
  // Pass D: per-route buffer tracts.
  routeBufferGeographies?: Map<number, BufferGeographyIntersection[]>
  // Pass E: per-agency buffer tracts.
  agencyBufferGeographies?: Map<number, BufferGeographyIntersection[]>
  // Pass F: one-shot union over every stop's buffer at the chosen
  // radius. Drives the aggregation-table apportioned values.
  aggregationBufferGeographies?: BufferGeographyIntersection[]
  // cross-agency transfer-hub clusters, after the client-side max-transfer
  // -time prune. Populated only when the scenario ran with clustering enabled.
  stopClusters?: StopCluster[]
}

export function applyScenarioResultFilter (
  data: ScenarioData,
  config: ScenarioConfig,
  filter: ScenarioFilter
): ScenarioFilterResult {
  const sdCache = data.stopDepartureCache
  const routeIndex = RouteDepartureIndexClass.fromCache(sdCache)
  const selectedDateRangeValue = getSelectedDateRange(config)
  const selectedWeekdayModeValue = filter.selectedWeekdayMode
  const selectedDaysValue = filter.selectedWeekdays
  const selectedRouteTypesValue = filter.selectedRouteTypes
  const selectedAgenciesValue = filter.selectedAgencies
  const startTimeValue = filter.startTime ? format(filter.startTime, 'HH:mm:ss') : '00:00:00'
  const endTimeValue = filter.endTime ? format(filter.endTime, 'HH:mm:ss') : '24:00:00'
  const frequencyUnderValue = filter.frequencyUnder
  const frequencyOverValue = filter.frequencyOver
  const stopVisitsUnderValue = filter.stopVisitsUnder
  const stopVisitsOverValue = filter.stopVisitsOver
  // Cross-entity gates are armed only by filters the other side cannot evaluate
  // itself: route-level filters gate stops (a stop must serve a marked route)
  // and stop-level thresholds gate routes (a route must serve a marked stop).
  // Weekday/time filters are evaluated by both sides and arm neither.
  const routeFiltersActive = selectedAgenciesValue != null
    || selectedRouteTypesValue != null
    || frequencyUnderValue != null
    || frequencyOverValue != null
  const stopFiltersActive = stopVisitsUnderValue != null || stopVisitsOverValue != null

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
      average_trips_per_day: undefined,
      average_trips_per_hour: undefined,
      earliest_trip_start: undefined,
      earliest_trip_end: undefined,
      latest_trip_start: undefined,
      latest_trip_end: undefined,
      frequency_irregular: undefined,
      frequency_directions_differ: undefined,
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
      routeIndex,
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
      // Joined on here rather than merged into the accumulated stops: the
      // stop-census phase finishes after the stops it describes have already
      // streamed past, and the WSDOT path retains no stops to write onto.
      census_geographies: data.stopCensusGeographies?.get(stopGql.id),
      __typename: 'Stop', // backwards compat
    }
    stopSetDerived(
      stop,
      selectedDaysValue,
      selectedWeekdayModeValue,
      selectedDateRangeValue,
      startTimeValue,
      endTimeValue,
      routeFiltersActive,
      stopVisitsUnderValue,
      stopVisitsOverValue,
      markedRoutes,
      sdCache
    )
    return stop
  })

  // Before agencies are derived below, so they follow the final route marks.
  if (stopFiltersActive) {
    unmarkRoutesWithoutPassingStop(routeFeatures, stopFeatures, stopVisitsUnderValue, stopVisitsOverValue)
  }

  const routeLookup = routesById(routeFeatures)

  // Agencies come off the routes phase, so this rolls up empty until it lands.
  const agencyData = new Map()
  for (const stop of stopFeatures) {
    for (const rstop of stop.route_stops || []) {
      const route = routeLookup.get(rstop.route_id)
      if (!route?.agency.agency_id) {
        continue // route not fetched yet, or no agency listed
      }
      const agency = route.agency
      const aid = agency.agency_id
      const adata = agencyData.get(aid) || {
        id: aid,
        routes: new Set(),
        routes_modes: new Set(),
        stops: new Set(),
        agency: agency,
      }
      adata.routes.add(rstop.route_id)
      adata.routes_modes.add(route.route_type)
      adata.stops.add(stop.id)
      agencyData.set(aid, adata)
    }
  }
  // An agency is marked when at least one of its routes is (issue #473). This
  // reads the routes directly rather than the agency ids on a marked stop's
  // route_stops: a stop shared between agencies stays marked as long as any one
  // of its routes passed, so reading ids off it also marked agencies whose own
  // routes had all been filtered out. Routes are the only source here, so the
  // set also reflects any route unmarked by the stop-visits gate above.
  const markedAgencies: Set<number> = new Set()
  for (const route of routeFeatures) {
    if (route.marked && route.agency?.id != null) {
      markedAgencies.add(route.agency.id)
    }
  }
  const agencyDataValues = [...agencyData.values()]
  const agencyFeatures: Agency[] = agencyDataValues.map((adata): Agency => {
    const agency: AgencyGql = adata.agency
    return {
      ...agency,
      marked: markedAgencies.has(agency.id),
      routes_count: adata.routes.size, // adata.routes.intersection(markedRoutes).size,
      routes_modes: [...adata.routes_modes].map(r => (routeTypeNames.get(r) || 'Unknown')).join(', '),
      stops_count: adata.stops.size,
      __typename: 'Agency', // backwards compat
    }
  })

  // Apply flex area filters
  const flexAreaFeatures = (data.flexAreas || []).map((flexArea): FlexAreaFeature => {
    const marked = flexAreaMarked(
      flexArea,
      data.flexDepartureCache,
      selectedDateRangeValue,
      selectedAgenciesValue,
      filter.selectedWeekdays,
      filter.selectedWeekdayMode,
    )
    return {
      ...flexArea,
      properties: {
        ...flexArea.properties,
        marked,
      }
    }
  })

  // apply the max-transfer-time prune to the server's proximity clusters.
  // Pure time arithmetic over the already-loaded departure cache, so it re-runs
  // here (no refetch) whenever the user changes the transfer-time input.
  const stopClusters = deriveFilteredStopClusters(
    data.stopClusters,
    filter.clusterMaxTransferMinutes,
    stopFeatures,
    sdCache,
    selectedDateRangeValue,
    resolveEffectiveWeekdays(selectedDaysValue, selectedWeekdayModeValue),
    startTimeValue,
    endTimeValue,
  )

  ///////////
  const result: ScenarioFilterResult = {
    routes: routeFeatures,
    stops: stopFeatures,
    agencies: agencyFeatures,
    feedVersions: [],
    stopDepartureCache: sdCache,
    flexAreas: flexAreaFeatures,
    tripIdStrings: data.tripIdStrings,
    censusGeographies: data.censusGeographies,
    stopBufferGeographies: data.stopBufferGeographies,
    routeBufferGeographies: data.routeBufferGeographies,
    agencyBufferGeographies: data.agencyBufferGeographies,
    aggregationBufferGeographies: data.aggregationBufferGeographies,
    stopClusters,
  }
  return result
}
