// Builds the ordered list of style "matchers" that color stops and routes on the
// map for the active data-display mode (agency / transit mode / route frequency /
// stop visits). Each matcher pairs a legend label + color with a predicate that
// tests a stop or route; the first matching rule wins. A catchall "Other" rule is
// appended when the palette is exhausted (or nothing matched) — see otherThreshold;
// Agency mode is the exception that omits it until the categorical palette fills up.
// Pure: every input is passed in, so it can be unit-tested without the map.

import { colors, categoricalColors, routeTypeNames, type DataDisplayMode } from '~~/src/core'
import { routesById, type Stop, type Route } from '~~/src/tl'
import type { ScenarioFilterResult } from './scenario-filter'

export type MatchFunction = (x: Stop | Route) => boolean

export interface Matcher {
  label: string
  color: string
  match: MatchFunction
}

// The subset of agency data the styling needs (Agency mode). A wider shape like
// the map's AgencyData is structurally assignable.
export interface StyleAgency {
  id: string // GTFS agency_id — matched against stops/routes
  numericId: number // Transitland numeric id — color key
  name: string
}

export interface BuildStyleDataParams {
  scenarioFilterResult: ScenarioFilterResult | undefined
  dataDisplayMode: DataDisplayMode
  agencies: StyleAgency[]
  // Per-agency color scale, keyed by the numeric agency id as a string.
  agencyColorScale: (key: string) => string
}

// Matchers run in the order they are added to the rules array.
export function buildStyleData (params: BuildStyleDataParams): Matcher[] {
  const { scenarioFilterResult, dataDisplayMode, agencies, agencyColorScale } = params

  const routeLookup = routesById(scenarioFilterResult?.routes || [])

  const stopLookup = new Map<number, Stop>()
  const routeStopLookup = new Map<number, number[]>()
  // Agencies and modes per stop, so a matcher answers with one lookup instead of
  // re-joining every route_stop once per style rule. Only these two modes read
  // them, and the maps are per-stop, so the other modes skip the allocation.
  const indexRouteData = dataDisplayMode === 'Agency' || dataDisplayMode === 'Transit mode'
  const stopAgencyIds = new Map<number, Set<string>>()
  const stopModes = new Map<number, Set<number>>()
  for (const stop of scenarioFilterResult?.stops || []) {
    stopLookup.set(stop.id, stop)
    const agencyIds = new Set<string>()
    const modes = new Set<number>()
    for (const rs of stop.route_stops) {
      const rid = rs.route_id
      const stops = routeStopLookup.get(rid) || []
      stops.push(stop.id)
      routeStopLookup.set(rid, stops)
      if (!indexRouteData) {
        continue
      }
      const route = routeLookup.get(rid)
      if (route) {
        agencyIds.add(route.agency?.agency_id)
        modes.add(route.route_type)
      }
    }
    if (indexRouteData) {
      stopAgencyIds.set(stop.id, agencyIds)
      stopModes.set(stop.id, modes)
    }
  }

  // Style based on AGENCY
  function getAgencyMatcher (val: string): MatchFunction {
    return (v: any) => {
      if (v.__typename === 'Stop') {
        return stopAgencyIds.get((v as Stop).id)?.has(val) ?? false
      } else if (v.__typename === 'Route') {
        return (v as Route).agency?.agency_id === val
      }
      return false
    }
  }

  // Style based on ROUTE MODE
  function getModeMatcher (val: number): MatchFunction {
    return (v: any) => {
      if (v.__typename === 'Stop') {
        // Empty until the routes phase lands.
        return stopModes.get((v as Stop).id)?.has(val) ?? false
      } else if (v.__typename === 'Route') {
        return (v as Route).route_type === val
      }
      return false
    }
  }

  // Style based on ROUTE FREQUENCY
  function getRouteFrequencyMatcher (val: number): MatchFunction {
    return (v: any) => {
      if (v.__typename === 'Stop') {
        return (v as Stop).route_stops.some((rs) => {
          const route = routeLookup.get(rs.route_id)
          const headway = route?.average_frequency || -1
          return headway >= val * 60
        })
      } else if (v.__typename === 'Route') {
        const headway = (v as Route).average_frequency || -1
        return headway >= val * 60
      }
      return false
    }
  }

  // Style based on STOP VISIT COUNT
  function getStopVisitMatcher (val: number): MatchFunction {
    return (v: any) => {
      if (v.__typename === 'Stop') {
        const count = (v as Stop).visits?.total.visit_average || -1
        return count >= val
      } else if (v.__typename === 'Route') {
        const stopIds = routeStopLookup.get((v as Route).id) || []
        return stopIds.some((sid) => {
          const stop = stopLookup.get(sid)
          return (stop?.visits?.total.visit_average || -1) >= val
        })
      }
      return false
    }
  }

  // Agencies use the wider 10-color categorical palette (agencyColorScale),
  // not the 6-color route palette.
  function getAgencyMatchers (): Matcher[] {
    const rules: Matcher[] = []
    for (let i = 0; i < Math.min(agencies.length, categoricalColors.length); i++) {
      const agency = agencies[i]
      if (agency) {
        rules.push({ label: agency.name ?? '', color: agencyColorScale(String(agency.numericId)), match: getAgencyMatcher(agency.id ?? '') })
      }
    }
    return rules
  }

  // Generate a set of MODE MATCHERS (static)
  function getModeMatchers (): Matcher[] {
    const rules: Matcher[] = []
    const modes = [...routeTypeNames.keys()]
    for (let i = 0; i < Math.min(modes.length, maxColor); i++) {
      const mode = modes[i]
      if (mode !== undefined) {
        const label = routeTypeNames.get(mode) || 'Unknown'
        rules.push({ label: label, color: colors[i]!, match: getModeMatcher(mode) })
      }
    }
    return rules
  }

  // Generate a set of ROUTE FREQUENCY MATCHERS (static)
  function getRouteFrequencyMatchers (): Matcher[] {
    const rules: Matcher[] = []
    rules.push({ label: '40+ mins', color: colors[0], match: getRouteFrequencyMatcher(40) })
    rules.push({ label: '30-39 mins', color: colors[1], match: getRouteFrequencyMatcher(30) })
    rules.push({ label: '20-29 mins', color: colors[2], match: getRouteFrequencyMatcher(20) })
    rules.push({ label: '10-19 mins', color: colors[3], match: getRouteFrequencyMatcher(10) })
    rules.push({ label: '0-9 mins', color: colors[4], match: getRouteFrequencyMatcher(0) })
    return rules
  }

  // Generate a set of STOP VISIT MATCHERS (static)
  function getStopVisitMatchers (): Matcher[] {
    const rules: Matcher[] = []
    rules.push({ label: '100+ visits', color: colors[0], match: getStopVisitMatcher(100) })
    rules.push({ label: '50-100 visits', color: colors[1], match: getStopVisitMatcher(50) })
    rules.push({ label: '20-50 visits', color: colors[2], match: getStopVisitMatcher(20) })
    rules.push({ label: '10-20 visits', color: colors[3], match: getStopVisitMatcher(10) })
    rules.push({ label: '0-9 visits', color: colors[4], match: getStopVisitMatcher(0) })
    return rules
  }

  // Cap mode matchers at one short of the full palette so a slot is left before
  // colors run out. The "Other" rule itself is drawn in black ('#000'), not a
  // palette color. Agency mode draws from the wider categorical palette, so its
  // "Other" bucket only kicks in past that.
  const maxColor = colors.length - 1
  const rules: Matcher[] = []

  let otherThreshold = maxColor
  if (dataDisplayMode === 'Agency') {
    rules.push(...getAgencyMatchers())
    otherThreshold = categoricalColors.length
  } else if (dataDisplayMode === 'Transit mode') {
    rules.push(...getModeMatchers())
  } else if (dataDisplayMode === 'Route frequency') {
    rules.push(...getRouteFrequencyMatchers())
  } else if (dataDisplayMode === 'Stop visits') {
    rules.push(...getStopVisitMatchers())
  } else if (dataDisplayMode === 'Service area') {
    // report-only mode; no map color rules
  }

  // Once the rules reach the palette threshold (or none were produced), add a
  // catchall "Other" rule.
  if (rules.length >= otherThreshold || rules.length === 0) {
    rules.push({ label: 'Other', color: '#000', match: _ => true })
  }

  return rules
}
