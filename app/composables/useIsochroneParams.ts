// The open isochrone's settings (#486), kept in the URL so a link reopens it.
// isoPlace is set while one is open. Every other key is written only when it
// differs from its default, and the defaults follow the scenario: its start
// date, its filter's start time, and its route type filter.

import { computed, type ComputedRef } from 'vue'
import { fmtDate, fmtTime, type Point, type RouteType } from '~~/src/core'
import {
  ISOCHRONE_DEFAULT_CUTOFFS,
  ISOCHRONE_DEFAULT_MAX_WALK,
  ISOCHRONE_DEFAULT_TIME,
  ISOCHRONE_MAX_CUTOFFS,
  ISOCHRONE_ROUTE_TYPES,
  formatIsochronePlace,
  isochroneModeFromRouteTypes,
  isochroneModeParam,
  parseIsochronePlace,
  type IsochroneMode,
  type IsochroneParams,
} from '~~/src/tl'
import { useUrlQuery } from './useUrlQuery'
import { useScenarioInputs } from './useScenarioInputs'
import { useScenarioFilters } from './useScenarioFilters'

const ISOCHRONE_KEYS = ['isoPlace', 'isoArriveBy', 'isoDate', 'isoTime', 'isoCutoffs', 'isoMode', 'isoMaxWalk'] as const

export interface IsochroneParamsState {
  // undefined while no isochrone is open.
  params: ComputedRef<IsochroneParams | undefined>
  // The settings with nothing set, as the scenario seeds them.
  defaults: ComputedRef<Omit<IsochroneParams, 'place' | 'arriveBy'>>
  open: (place: Point, arriveBy?: boolean) => Promise<void>
  update: (next: Partial<IsochroneParams>) => Promise<void>
  close: () => Promise<void>
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/
const timePattern = /^\d{2}:\d{2}$/

function parseCutoffs (s: string | undefined): number[] | undefined {
  if (!s) {
    return undefined
  }
  const cutoffs = [...new Set(s.split(',').map(Number))]
    .filter(n => Number.isInteger(n) && n >= 1 && n <= 240)
    .sort((a, b) => a - b)
    .slice(0, ISOCHRONE_MAX_CUTOFFS)
  return cutoffs.length ? cutoffs : undefined
}

// "walk", "transit" (every route type), or a comma list of route types.
function parseMode (s: string | undefined): IsochroneMode | undefined {
  if (s === 'walk') {
    return { walkOnly: true }
  }
  if (s === 'transit') {
    return { walkOnly: false }
  }
  if (!s) {
    return undefined
  }
  const types = s.split(',').map(Number).filter(n => ISOCHRONE_ROUTE_TYPES.includes(n as RouteType)) as RouteType[]
  return types.length ? { walkOnly: false, routeTypes: types } : undefined
}

function formatMode (mode: IsochroneMode): string {
  if (mode.walkOnly) {
    return 'walk'
  }
  return mode.routeTypes ? mode.routeTypes.join(',') : 'transit'
}

export function useIsochroneParams (): IsochroneParamsState {
  const { query, setQuery } = useUrlQuery()
  const { startDate } = useScenarioInputs()
  const { startTime, selectedRouteTypes } = useScenarioFilters()

  const defaults = computed(() => ({
    date: fmtDate(startDate.value),
    time: startTime.value ? fmtTime(startTime.value, 'HH:mm') : ISOCHRONE_DEFAULT_TIME,
    cutoffs: ISOCHRONE_DEFAULT_CUTOFFS,
    mode: isochroneModeFromRouteTypes(selectedRouteTypes.value),
    maxWalk: ISOCHRONE_DEFAULT_MAX_WALK,
  }))

  const params = computed((): IsochroneParams | undefined => {
    const q = query.value
    const place = parseIsochronePlace(q.isoPlace?.toString())
    if (!place) {
      return undefined
    }
    const d = defaults.value
    const date = q.isoDate?.toString()
    const time = q.isoTime?.toString()
    const maxWalk = Number(q.isoMaxWalk)
    return {
      place,
      arriveBy: q.isoArriveBy === 'true',
      date: date && datePattern.test(date) ? date : d.date,
      time: time && timePattern.test(time) ? time : d.time,
      cutoffs: parseCutoffs(q.isoCutoffs?.toString()) ?? d.cutoffs,
      mode: parseMode(q.isoMode?.toString()) ?? d.mode,
      maxWalk: Number.isFinite(maxWalk) && maxWalk > 0 ? maxWalk : d.maxWalk,
    }
  })

  // Only what differs from the defaults reaches the URL.
  function update (next: Partial<IsochroneParams>): Promise<void> {
    const d = defaults.value
    const out: Record<string, string | undefined> = {}
    if (next.place) {
      out.isoPlace = formatIsochronePlace(next.place)
    }
    if (next.arriveBy !== undefined) {
      out.isoArriveBy = next.arriveBy ? 'true' : undefined
    }
    if (next.date !== undefined) {
      out.isoDate = next.date === d.date ? undefined : next.date
    }
    if (next.time !== undefined) {
      out.isoTime = next.time === d.time ? undefined : next.time
    }
    if (next.cutoffs !== undefined) {
      const cutoffs = [...next.cutoffs].sort((a, b) => a - b).join(',')
      out.isoCutoffs = cutoffs === d.cutoffs.join(',') ? undefined : cutoffs
    }
    if (next.mode !== undefined) {
      out.isoMode = isochroneModeParam(next.mode) === isochroneModeParam(d.mode) ? undefined : formatMode(next.mode)
    }
    if (next.maxWalk !== undefined) {
      out.isoMaxWalk = next.maxWalk === d.maxWalk ? undefined : String(next.maxWalk)
    }
    return setQuery(out)
  }

  // A new place keeps the other settings, so moving the origin, or opening
  // from another stop, compares like with like.
  function open (place: Point, arriveBy?: boolean): Promise<void> {
    return update(arriveBy === undefined ? { place } : { place, arriveBy })
  }

  function close (): Promise<void> {
    return setQuery(Object.fromEntries(ISOCHRONE_KEYS.map(k => [k, undefined])))
  }

  return { params, defaults, open, update, close }
}
