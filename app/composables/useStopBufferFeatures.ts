// Map features for the stop buffer overlay: the area within the stop
// statistical radius of each marked route's stops, unioned server-side. The
// filtered scenario result is passed in by the container; the URL-backed
// radius and display toggle are read from the useScenario* composables.

import { computed, type Ref, type ComputedRef } from 'vue'
import { useQuery } from '@vue/apollo-composable'
import { useScenarioDisplay } from './useScenarioDisplay'
import { useScenarioInputs } from './useScenarioInputs'
import { routeStopBufferQuery, type RouteStopBufferResponse } from '~~/src/tl'
import type { Feature } from '~~/src/core'
import type { ScenarioFilterResult } from '~~/src/scenario'

// The backend clamps `routes(limit:)` to this; asking for more silently
// returns the same page.
const ROUTE_LIMIT = 1000

interface UseStopBufferFeaturesDeps {
  scenarioFilterResult: Ref<ScenarioFilterResult | undefined>
}

export interface UseStopBufferFeaturesReturn {
  // Empty when the overlay is off, the radius is 0, or no route is marked.
  stopBufferFeatures: ComputedRef<Feature[]>
}

export function useStopBufferFeatures (deps: UseStopBufferFeaturesDeps): UseStopBufferFeaturesReturn {
  const { showStopBuffer } = useScenarioDisplay()
  const { stopBufferRadius } = useScenarioInputs()

  // Marked only, so the outlines trace what the map is drawing.
  const routeIds = computed((): number[] => {
    if (!showStopBuffer.value || stopBufferRadius.value <= 0) { return [] }
    return (deps.scenarioFilterResult.value?.routes || []).filter(r => r.marked).map(r => r.id)
  })

  const { result } = useQuery<{ routes: RouteStopBufferResponse[] }>(
    routeStopBufferQuery,
    () => ({
      ids: routeIds.value,
      radius: stopBufferRadius.value,
      limit: ROUTE_LIMIT,
    }),
    () => ({
      enabled: routeIds.value.length > 0,
      // The radius is a slider; without this every step fires its own union.
      debounce: 300,
      // Holds the current outlines while the next radius is in flight.
      keepPreviousResult: true,
      // Each radius would otherwise pin its own copy of every route's
      // geometry in the store for the session, and none of it is reused.
      fetchPolicy: 'no-cache',
    })
  )

  const stopBufferFeatures = computed((): Feature[] => {
    // keepPreviousResult holds the last union after the query is disabled.
    if (routeIds.value.length === 0) { return [] }
    const out: Feature[] = []
    for (const route of result.value?.routes || []) {
      const g = route.route_stop_buffer?.stop_buffer
      if (!g) { continue }
      out.push({ id: `route-buffer-${route.id}`, type: 'Feature', geometry: g, properties: {} })
    }
    return out
  })

  return { stopBufferFeatures }
}
