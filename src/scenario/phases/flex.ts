// Phase 5: GTFS-Flex service areas + flex departure dates. Depends only on
// feed versions and the date range — independent of stops/routes/departures.
//
// Flex areas are fetched via GraphQL:
// - Queries Location type for each feed version
// - Filters by date via StopTimeFilter.date on Location.stop_times
// - Transforms Location -> FlexAreaFeature in BFF before streaming
// - Frontend applies user filters (advance notice, area type, color mode)
//
// GraphQL types used:
// - Location: flex service areas (polygons from locations.geojson)
// - FlexStopTime: stop times with pickup/dropoff types and booking rules
// - BookingRule: booking_type (0=real-time, 1=same-day, 2=prior-day)
// See: https://github.com/interline-io/transitland-lib/pull/527

import { format } from 'date-fns'
import { TaskQueue, type GraphQLClient } from '~~/src/core'
import {
  flexLocationQuery,
  flexStopTimesQuery,
  transformLocationsToFlexAreas,
  type FlexLocationQueryResponse,
  type FlexStopTimesQueryResponse,
} from '~~/src/tl'
import { getSelectedDateRange, PHASE_MAX_CONCURRENT_REQUESTS, type FeedVersionRef, type PhaseEmit, type PhaseOpts } from './common'

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

/**
 * Variables for the slim multi-date flex stop_times query.
 * Mirrors StopDepartureQueryVars but uses fvSha1/limit instead of stop ids.
 */
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

export interface FlexPhaseConfig {
  feedVersions: FeedVersionRef[]
  startDate?: Date
  endDate?: Date
}

/**
 * Fetch flex service areas (GTFS-Flex / DRT) via GraphQL
 *
 * Queries locations for each feed version, filters out those without
 * active service on the selected date, and transforms to FlexAreaFeature format.
 */
export async function runFlexPhase (
  config: FlexPhaseConfig,
  client: GraphQLClient,
  emit: PhaseEmit,
  opts: PhaseOpts = {},
): Promise<void> {
  if (config.feedVersions.length === 0) {
    console.log('[FlexAreas] No feed versions available, skipping flex area fetch')
    return
  }

  emit({ isLoading: true, currentStage: 'flex-areas' })
  console.log(`[FlexAreas] Fetching flex areas from ${config.feedVersions.length} feed versions`)

  const queue: TaskQueue<FeedVersionRef> = new TaskQueue<FeedVersionRef>(
    PHASE_MAX_CONCURRENT_REQUESTS,
    fv => fetchFlexArea(fv),
    {
      onError: error => opts.onError?.(error),
    }
  )

  // Fetch flex areas for a single feed version
  async function fetchFlexArea (fv: FeedVersionRef): Promise<void> {
    const queryDate = config.startDate
      ? format(config.startDate, 'yyyy-MM-dd')
      : format(new Date(), 'yyyy-MM-dd')

    const variables = {
      fvSha1: fv.feedVersionSha1,
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

    if (flexAreas.length === 0) {
      return
    }

    console.log(`[FlexAreas] Found ${flexAreas.length} flex areas in ${fv.feedOnestopId}`)
    emit({ isLoading: true, currentStage: 'flex-areas', partialData: { flexAreas } })

    // Fetch slim multi-date stop_times to populate the flex departure cache.
    // Chunk the date range into 7-day windows (one query per week) so every
    // date in a multi-week scenario is covered — mirrors the stop-departure pattern.
    const dowNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const
    const dates = getSelectedDateRange(config)
    const weekSize = 7
    const flexDepartures: FlexDepartureTuple[] = []
    for (let i = 0; i < dates.length; i += weekSize) {
      const w = new FlexStopTimesQueryVars()
      w.fvSha1 = fv.feedVersionSha1
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

  for (const fv of config.feedVersions) {
    queue.enqueueOne(fv)
  }
  await queue.run()

  console.log(`[FlexAreas] Complete`)
}
