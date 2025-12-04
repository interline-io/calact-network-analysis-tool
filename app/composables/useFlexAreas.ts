/**
 * Composable for loading and filtering flex service areas
 *
 * TEMPORARY IMPLEMENTATION: Uses static GeoJSON file for development/testing
 * TODO: Replace with transitland-server GraphQL API when resolvers are implemented
 * Related PR: https://github.com/interline-io/transitland-lib/pull/527
 */

import { ref, computed, watch } from 'vue'
import type { Feature } from '~~/src/core'
import {
  createCategoryColorScale,
  flexColors,
  getFlexPolygonProperties,
} from '~~/src/core'
import type {
  FlexAreaCollection,
  FlexAreaFeature,
  FlexAreaType,
  FlexAdvanceNotice,
} from '~~/src/flex'
import {
  getFlexAreaType,
  getFlexAdvanceNotice,
  getFlexAgencyName,
} from '~~/src/flex'

// ============================================================================
// TEMPORARY: Static data loading
// This section should be removed when API integration is complete
// ============================================================================

// Cache the loaded data to avoid re-fetching
let cachedFlexData: FlexAreaCollection | null = null
let loadPromise: Promise<FlexAreaCollection> | null = null

/**
 * Load the static flex areas GeoJSON file
 * TEMPORARY: Replace with GraphQL query when API is ready
 */
async function loadStaticFlexData (): Promise<FlexAreaCollection> {
  if (cachedFlexData) {
    return cachedFlexData
  }

  if (loadPromise) {
    return loadPromise
  }

  loadPromise = fetch('/wsdot-all-flex-areas.geojson')
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load flex areas: ${response.status}`)
      }
      return response.json()
    })
    .then((data: FlexAreaCollection) => {
      cachedFlexData = data
      console.log(`[useFlexAreas] Loaded ${data.features.length} flex areas from static file`)
      return data
    })
    .catch((error) => {
      console.error('[useFlexAreas] Error loading static flex data:', error)
      loadPromise = null
      throw error
    })

  return loadPromise
}

// ============================================================================
// END TEMPORARY SECTION
// ============================================================================

/**
 * Filter configuration for flex areas
 */
export interface FlexFilterConfig {
  enabled: boolean
  advanceNotice: FlexAdvanceNotice[]
  areaTypes: FlexAreaType[]
  colorBy: 'Agency' | 'Advance notice'
}

/**
 * Composable for managing flex service areas
 */
export function useFlexAreas (filterConfig: Ref<FlexFilterConfig>) {
  // Raw data from API/static file
  const rawFeatures = ref<FlexAreaFeature[]>([])
  const isLoading = ref(false)
  const error = ref<Error | null>(null)

  // Unique agency names for color scale
  const agencyNames = computed(() => {
    const names = new Set<string>()
    for (const feature of rawFeatures.value) {
      const name = getFlexAgencyName(feature)
      if (name) names.add(name)
    }
    return Array.from(names).sort()
  })

  // Color scale for agencies (memoized)
  const agencyColorScale = computed(() => {
    return createCategoryColorScale(agencyNames.value, flexColors.agency)
  })

  /**
   * Load flex areas data
   * TEMPORARY: Loads from static file
   * TODO: Replace with GraphQL query
   */
  async function loadFlexAreas () {
    if (!filterConfig.value.enabled) {
      rawFeatures.value = []
      return
    }

    isLoading.value = true
    error.value = null

    try {
      // TEMPORARY: Load from static file
      // TODO: Replace with:
      // const { data } = await useQuery(FLEX_AREAS_QUERY, { bbox, ... })
      const data = await loadStaticFlexData()
      rawFeatures.value = data.features
    } catch (e) {
      error.value = e as Error
      rawFeatures.value = []
    } finally {
      isLoading.value = false
    }
  }

  // Reload when enabled state changes
  watch(() => filterConfig.value.enabled, (enabled) => {
    if (enabled && rawFeatures.value.length === 0) {
      loadFlexAreas()
    }
  }, { immediate: true })

  /**
   * Filtered features based on current filter configuration
   */
  const filteredFeatures = computed((): FlexAreaFeature[] => {
    if (!filterConfig.value.enabled) {
      return []
    }

    const { advanceNotice, areaTypes } = filterConfig.value

    return rawFeatures.value.filter((feature) => {
      // Filter by area type (PU only, DO only, PU and DO)
      const featureAreaType = getFlexAreaType(feature)
      if (!areaTypes.includes(featureAreaType)) {
        return false
      }

      // Filter by advance notice category
      const featureAdvanceNotice = getFlexAdvanceNotice(feature)
      if (!advanceNotice.includes(featureAdvanceNotice)) {
        return false
      }

      return true
    })
  })

  /**
   * Display features with styling applied
   * Ready to be passed to the map component
   */
  const displayFeatures = computed((): Feature[] => {
    if (!filterConfig.value.enabled) {
      return []
    }

    const { colorBy } = filterConfig.value

    return filteredFeatures.value.map((feature) => {
      // Determine color based on colorBy mode
      let color: string

      if (colorBy === 'Advance notice') {
        const advanceNotice = getFlexAdvanceNotice(feature)
        color = flexColors.advanceNotice[advanceNotice] || flexColors.default
      } else {
        // Color by Agency (default)
        const agencyName = getFlexAgencyName(feature)
        color = agencyColorScale.value(agencyName)
      }

      // Get booking info for popup
      const bookingRule = feature.properties.pickup_booking_rules?.[0]
        || feature.properties.drop_off_booking_rules?.[0]

      // Build the display feature with styling properties
      const displayFeature: Feature = {
        type: 'Feature',
        id: feature.id,
        geometry: feature.geometry,
        properties: {
          // Preserve original properties for popups/tooltips
          location_id: feature.properties.location_id,
          location_name: feature.properties.location_name,
          agency_name: getFlexAgencyName(feature),
          agency_names: feature.properties.agencies?.map((a: { agency_name: string }) => a.agency_name).join(', '),
          route_names: feature.properties.routes?.map((r: { route_long_name?: string, route_short_name?: string }) => r.route_long_name || r.route_short_name).join(', '),
          area_type: getFlexAreaType(feature),
          advance_notice: getFlexAdvanceNotice(feature),
          // Booking contact info
          phone_number: bookingRule?.phone_number,
          booking_message: bookingRule?.message,
          // Add styling properties
          ...getFlexPolygonProperties(color),
        }
      }

      return displayFeature
    })
  })

  /**
   * Statistics about the current data
   */
  const stats = computed(() => ({
    total: rawFeatures.value.length,
    filtered: filteredFeatures.value.length,
    agencies: agencyNames.value.length,
    byAreaType: {
      'PU only': rawFeatures.value.filter(f => getFlexAreaType(f) === 'PU only').length,
      'DO only': rawFeatures.value.filter(f => getFlexAreaType(f) === 'DO only').length,
      'PU and DO': rawFeatures.value.filter(f => getFlexAreaType(f) === 'PU and DO').length,
    },
    byAdvanceNotice: {
      'On-demand': rawFeatures.value.filter(f => getFlexAdvanceNotice(f) === 'On-demand').length,
      'Same day': rawFeatures.value.filter(f => getFlexAdvanceNotice(f) === 'Same day').length,
      'More than 24 hours': rawFeatures.value.filter(f => getFlexAdvanceNotice(f) === 'More than 24 hours').length,
    },
  }))

  return {
    // Data
    rawFeatures,
    filteredFeatures,
    displayFeatures,

    // Metadata
    agencyNames,
    stats,

    // State
    isLoading,
    error,

    // Actions
    loadFlexAreas,
  }
}
