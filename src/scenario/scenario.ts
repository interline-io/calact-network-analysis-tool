import { format } from 'date-fns'
import {
  type Stop,
  type StopGql,
  stopSetDerived
} from '../stop'
import type { FeedVersion } from '../feed-version'
import type { Agency } from '../agency'
import {
  type Route,
  type RouteGql,
  routeSetDerived,
  newRouteHeadwaySummary
} from '../route'
import { getCurrentDate, parseDate, getDateOneWeekLater } from '../datetime'
import type { StopDepartureCache } from '~/src/departure-cache'
import { cannedBboxes, type dow, routeTypes } from '~/src/constants'
import { parseBbox, type Bbox } from '~/src/geom'

export function ScenarioConfigFromBboxName (bboxname: string): ScenarioConfig {
  return {
    bbox: parseBbox(cannedBboxes.get(bboxname)!.bboxString),
    scheduleEnabled: true,
    startDate: parseDate(getCurrentDate()),
    endDate: parseDate(getDateOneWeekLater()),
    geographyIds: [],
    stopLimit: 1000,
    maxConcurrentDepartures: 8
  }
}

/**
 * Configuration for scenario fetching
 */
export interface ScenarioConfig {
  bbox?: Bbox
  scheduleEnabled: boolean
  startDate?: Date
  endDate?: Date
  geographyIds?: number[]
  stopLimit?: number
  maxConcurrentDepartures?: number
}

export interface ScenarioFilter {
  startTime?: Date
  endTime?: Date
  selectedRouteTypes: number[]
  selectedDays: dow[]
  selectedAgencies: string[]
  selectedDayOfWeekMode: string
  selectedTimeOfDayMode: string
  frequencyUnder?: number
  frequencyOver?: number
  frequencyUnderEnabled: boolean
  frequencyOverEnabled: boolean
}

/*****************
 * Apply filters to the scenario result data based on the provided configuration and filter criteria.
 */
export interface ScenarioData {
  routes: RouteGql[]
  stops: StopGql[]
  feedVersions: FeedVersion[]
  stopDepartureCache: StopDepartureCache
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

function getSelectedDateRange (config: ScenarioConfig): Date[] {
  const sd = new Date((config.startDate || new Date()).valueOf())
  const ed = new Date((config.endDate || new Date()).valueOf())
  const dates = []
  while (sd <= ed) {
    dates.push(new Date(sd.valueOf()))
    sd.setDate(sd.getDate() + 1)
  }
  // console.log(`Selected date range: ${sd.toISOString()} to ${ed.toISOString()}: dates ${dates.map(d => d.toISOString()).join(', ')}`)
  return dates
}
