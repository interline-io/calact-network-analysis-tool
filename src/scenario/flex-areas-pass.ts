// Flex-areas pass: GTFS-Flex service areas + departure-day cache for a list
// of feed versions. Shared by `ScenarioFetcher.fetchFlexAreas()` (inline
// pipeline) and `streamFlexAreas()` (the standalone /api/flex-areas endpoint
// that powers deferred on-demand loading).

import { format } from 'date-fns'
import { TaskQueue, type GraphQLClient } from '~~/src/core'
import {
  type FeedVersion,
  type FlexLocationQueryResponse,
  type FlexStopTimesQueryResponse,
  flexLocationQuery,
  flexStopTimesQuery,
  transformLocationsToFlexAreas,
} from '~~/src/tl'
import type { ScenarioProgress } from './scenario'

/**
 * Maximum number of flex locations to fetch per feed version.
 * This limit is enforced server-side by transitland-server.
 * If a feed version has more locations than this, some will be silently skipped.
 */
export const MAX_FLEX_LOCATIONS_PER_FEED_VERSION = 100_000

// Wire format for flex departure cache: [locationId, date]
export type FlexDepartureTuple = readonly [
  location_id: number,
  departure_date: string,
]

export const FlexDepartureTuple = {
  create: (location_id: number, departure_date: string): FlexDepartureTuple => [location_id, departure_date],
  locationId: (tuple: FlexDepartureTuple) => tuple[0],
  departureDate: (tuple: FlexDepartureTuple) => tuple[1],
}

export class FlexStopTimesQueryVars {
  fvSha1: string = ''
  limit: number = 0
  monday: string = ''
  tuesday: string = ''
  wednesday: string = ''
  thursday: string = ''
  friday: string = ''
  saturday: string = ''
  sunday: string = ''
  include_monday: boolean = false
  include_tuesday: boolean = false
  include_wednesday: boolean = false
  include_thursday: boolean = false
  include_friday: boolean = false
  include_saturday: boolean = false
  include_sunday: boolean = false

  get (dow: string): string {
    switch (dow) {
      case 'monday': return this.monday
      case 'tuesday': return this.tuesday
      case 'wednesday': return this.wednesday
      case 'thursday': return this.thursday
      case 'friday': return this.friday
      case 'saturday': return this.saturday
      case 'sunday': return this.sunday
    }
    return ''
  }

  setDay (d: Date) {
    const dateFmt = 'yyyy-MM-dd'
    switch (d.getDay()) {
      case 0: this.sunday = format(d, dateFmt); this.include_sunday = true; break
      case 1: this.monday = format(d, dateFmt); this.include_monday = true; break
      case 2: this.tuesday = format(d, dateFmt); this.include_tuesday = true; break
      case 3: this.wednesday = format(d, dateFmt); this.include_wednesday = true; break
      case 4: this.thursday = format(d, dateFmt); this.include_thursday = true; break
      case 5: this.friday = format(d, dateFmt); this.include_friday = true; break
      case 6: this.saturday = format(d, dateFmt); this.include_saturday = true; break
    }
  }

  hasAnyDay (): boolean {
    return this.include_monday || this.include_tuesday || this.include_wednesday
      || this.include_thursday || this.include_friday || this.include_saturday
      || this.include_sunday
  }
}

// Structural subset of ScenarioConfig so both a full config and a slim
// endpoint body satisfy it.
export function getSelectedDateRange (config: { startDate?: Date, endDate?: Date }): Date[] {
  const sd = new Date((config.startDate || new Date()).valueOf())
  const ed = new Date((config.endDate || new Date()).valueOf())
  const dates = []
  while (sd <= ed) {
    dates.push(new Date(sd.valueOf()))
    sd.setDate(sd.getDate() + 1)
  }
  return dates
}

export interface FlexAreasFetchConfig {
  // Only `sha1` is queried; the full FeedVersion shape is what the client
  // already holds in scenarioData.feedVersions.
  feedVersions: FeedVersion[]
  startDate?: Date
  endDate?: Date
  // Default 8 — matches ScenarioFetcher's maxConcurrentRequests.
  maxConcurrentRequests?: number
}

// Pure over its inputs; callers wrap `emit`/`onError` with either a stream
// sender or the in-process ScenarioFetcher channels. Per-feed-version errors
// go to `onError` and the remaining feed versions continue (matches the
// pre-extraction TaskQueue behavior).
export async function runFlexAreasPass (
  config: FlexAreasFetchConfig,
  client: GraphQLClient,
  emit: (progress: ScenarioProgress) => void,
  onError?: (error: any) => void,
): Promise<void> {
  if (config.feedVersions.length === 0) {
    console.log('[FlexAreas] No feed versions available, skipping flex area fetch')
    return
  }

  emit({ isLoading: true, currentStage: 'flex-areas' })
  console.log(`[FlexAreas] Fetching flex areas from ${config.feedVersions.length} feed versions`)

  const queue = new TaskQueue<FeedVersion>(
    config.maxConcurrentRequests ?? 8,
    fv => fetchFlexArea(fv, config, client, emit), {
      onError: error => onError?.(error)
    }
  )
  for (const fv of config.feedVersions) {
    queue.enqueueOne(fv)
  }
  await queue.run()

  console.log(`[FlexAreas] Complete`)
}

// Fetch flex areas for a single feed version
async function fetchFlexArea (
  fv: FeedVersion,
  config: FlexAreasFetchConfig,
  client: GraphQLClient,
  emit: (progress: ScenarioProgress) => void,
): Promise<void> {
  const queryDate = config.startDate
    ? format(config.startDate, 'yyyy-MM-dd')
    : format(new Date(), 'yyyy-MM-dd')

  const variables = {
    fvSha1: fv.sha1,
    limit: MAX_FLEX_LOCATIONS_PER_FEED_VERSION,
    serviceDate: queryDate,
  }

  const response = await client.query<FlexLocationQueryResponse>(flexLocationQuery, variables)

  const feedVersionData = response.data?.feed_versions?.[0]
  if (!feedVersionData) {
    return
  }

  const locations = feedVersionData.locations || []
  const flexAreas = transformLocationsToFlexAreas(locations)

  if (flexAreas.length > 0) {
    console.log(`[FlexAreas] Found ${flexAreas.length} flex areas in ${fv.feed.onestop_id}`)
    emit({ isLoading: true, currentStage: 'flex-areas', partialData: { flexAreas } })
  }

  // Fetch slim multi-date stop_times to populate the flex departure cache.
  // Chunk the date range into 7-day windows (one query per week) so every
  // date in a multi-week scenario is covered — mirrors the stop-departure pattern.
  if (flexAreas.length > 0) {
    const dowNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const
    const dates = getSelectedDateRange(config)
    const weekSize = 7
    const flexDepartures: FlexDepartureTuple[] = []
    for (let i = 0; i < dates.length; i += weekSize) {
      const w = new FlexStopTimesQueryVars()
      w.fvSha1 = fv.sha1
      w.limit = MAX_FLEX_LOCATIONS_PER_FEED_VERSION
      for (const d of dates.slice(i, i + weekSize)) {
        w.setDay(d)
      }
      if (!w.hasAnyDay()) { continue }
      const stopTimesResponse = await client.query<FlexStopTimesQueryResponse>(flexStopTimesQuery, w)
      for (const location of stopTimesResponse?.data?.feed_versions?.[0]?.locations || []) {
        for (const dowName of dowNames) {
          const date = w.get(dowName)
          if (!date) { continue }
          if ((location[dowName]?.length ?? 0) > 0) {
            flexDepartures.push(FlexDepartureTuple.create(location.id, date))
          }
        }
      }
    }
    if (flexDepartures.length > 0) {
      emit({ isLoading: true, currentStage: 'flex-areas', partialData: { flexDepartures } })
    }
  }
}
