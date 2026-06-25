// Derives the GeoJSON feature collections for flex (demand-responsive) service
// areas — both the map-display set (styled, respects the map toggles) and the
// Reports-tab set (always available when data exists). All inputs are plain
// data: the raw/filtered scenario results are passed in by the container, and
// the URL-backed filter/display state is read from the useScenario* composables
// (callable anywhere). No fetching or Apollo access happens here.

import { computed, type Ref, type ComputedRef } from 'vue'
import { useScenarioFilters } from './useScenarioFilters'
import { useScenarioDisplay } from './useScenarioDisplay'
import { useFlexAreaFormatting } from './useFlexAreaFormatting'
import { getFlexAdvanceNotice, getFlexAgencyName, flexAreaMatchesFilters } from '~~/src/tl'
import { type Feature, createCategoryColorScale, flexColors, dateToSeconds } from '~~/src/core'
import type { ScenarioData, ScenarioFilterResult } from '~~/src/scenario'

interface UseFlexDisplayFeaturesDeps {
  // Raw stream data (all agencies, unfiltered) — drives the agency color scale.
  scenarioData: Ref<ScenarioData | undefined>
  // Agency-filtered results — the source for the per-area marked status.
  scenarioFilterResult: Ref<ScenarioFilterResult | undefined>
}

export interface UseFlexDisplayFeaturesReturn {
  // Styled features for the map; empty when flex display is toggled off.
  flexDisplayFeatures: ComputedRef<Feature[]>
  // Features for the Reports tab; available whenever flex data exists.
  flexFeaturesForReport: ComputedRef<Feature[]>
}

export function useFlexDisplayFeatures (deps: UseFlexDisplayFeaturesDeps): UseFlexDisplayFeaturesReturn {
  const {
    startTime,
    endTime,
    flexServicesEnabled,
    flexAdvanceNotice,
    flexAreaTypesSelected,
    flexColorBy,
  } = useScenarioFilters()
  const { hideUnmarked } = useScenarioDisplay()
  const { buildFlexAreaProperties } = useFlexAreaFormatting()

  // Color scale spans every agency in the raw stream (not the filtered set), so
  // an agency's color stays stable as filters change.
  const flexAgencyNames = computed(() => {
    const names = new Set<string>()
    for (const feature of deps.scenarioData.value?.flexAreas || []) {
      const name = getFlexAgencyName(feature)
      if (name) { names.add(name) }
    }
    return Array.from(names).sort()
  })

  const flexAgencyColorScale = computed(() => {
    return createCategoryColorScale(flexAgencyNames.value, flexColors.agency)
  })

  // Every flex area with its marked status, independent of the map toggle.
  // Combines agency marking from the scenario filter with the advance-notice,
  // area-type, and time-of-day filters.
  const flexAreasWithMarked = computed(() => {
    const criteria = {
      advanceNotice: flexAdvanceNotice.value,
      areaTypes: flexAreaTypesSelected.value,
      startSeconds: dateToSeconds(startTime.value),
      endSeconds: dateToSeconds(endTime.value),
    }
    return (deps.scenarioFilterResult.value?.flexAreas || []).map(feature => ({
      feature,
      marked: (feature.properties.marked !== false) && flexAreaMatchesFilters(feature, criteria),
    }))
  })

  const flexDisplayFeatures = computed((): Feature[] => {
    if (!flexServicesEnabled.value) { return [] }
    const colorBy = flexColorBy.value
    return flexAreasWithMarked.value
      .filter(({ marked }) => !hideUnmarked.value || marked) // Hide unmarked if toggle is on
      .map(({ feature, marked }) => {
        // Color by advance notice, else by agency.
        let color: string
        if (colorBy === 'Advance notice') {
          const advanceNotice = getFlexAdvanceNotice(feature)
          color = flexColors.advanceNotice[advanceNotice] || flexColors.default
        } else {
          const agencyName = getFlexAgencyName(feature)
          color = flexAgencyColorScale.value(agencyName)
        }

        // Marked: filled with solid outline. Unmarked: no fill, dashed, faded.
        const fillOpacity = marked ? 0.3 : 0
        const strokeOpacity = marked ? 0.8 : 0.4
        const properties: Record<string, any> = {
          ...buildFlexAreaProperties(feature, marked),
          'fill': color,
          'fill-opacity': fillOpacity,
          'stroke': color,
          'stroke-width': 2,
          'stroke-opacity': strokeOpacity,
        }
        if (!marked) {
          properties['stroke-dasharray'] = true
        }

        return {
          type: 'Feature',
          id: feature.id,
          geometry: feature.geometry,
          properties,
        } as Feature
      })
  })

  const flexFeaturesForReport = computed((): Feature[] => {
    return flexAreasWithMarked.value.map(({ feature, marked }) => ({
      type: 'Feature',
      id: feature.id,
      geometry: feature.geometry,
      properties: buildFlexAreaProperties(feature, marked),
    } as Feature))
  })

  return { flexDisplayFeatures, flexFeaturesForReport }
}
