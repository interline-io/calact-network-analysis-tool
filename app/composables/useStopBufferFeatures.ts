// Map features for the stop buffer overlay: the part of each census geography
// that falls inside both the query area and the stop buffers, as already
// computed server-side for the `buffer` clipping mode. Derived from the
// filtered scenario result the container passes in — no fetch of its own.

import { computed, type Ref, type ComputedRef } from 'vue'
import { useScenarioDisplay } from './useScenarioDisplay'
import type { Feature } from '~~/src/core'
import type { ScenarioFilterResult } from '~~/src/scenario'

interface UseStopBufferFeaturesDeps {
  scenarioFilterResult: Ref<ScenarioFilterResult | undefined>
}

export interface UseStopBufferFeaturesReturn {
  // Empty unless the overlay is on and the buffer clip has been fetched.
  stopBufferFeatures: ComputedRef<Feature[]>
}

export function useStopBufferFeatures (deps: UseStopBufferFeaturesDeps): UseStopBufferFeaturesReturn {
  const { showStopBuffer } = useScenarioDisplay()

  // One piece per geography rather than one polygon: geographies at a layer
  // don't overlap, so the pieces are disjoint and paint as a single region
  // without a union, and without the opacity stacking that made the old
  // per-route buffers unusable as a fill.
  //
  // Independent of the clipping mode — the point is to see the analyzed
  // footprint over whatever the choropleth is shading. In `buffer` mode the
  // choropleth already draws these same shapes, so the two coincide.
  const stopBufferFeatures = computed((): Feature[] => {
    if (!showStopBuffer.value) { return [] }
    const geos = deps.scenarioFilterResult.value?.censusGeographies
    if (!geos) { return [] }
    const out: Feature[] = []
    for (const [geoid, geo] of geos) {
      if (!geo.bufferIntersectionGeometry) { continue }
      out.push({
        id: `stop-buffer-${geoid}`,
        type: 'Feature',
        geometry: geo.bufferIntersectionGeometry,
        properties: {},
      })
    }
    return out
  })

  return { stopBufferFeatures }
}
