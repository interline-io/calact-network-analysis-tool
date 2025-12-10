<template>
  <div>
    <!-- Tabbed Interface -->
    <div class="mt-4">
      <!-- @vue-skip -->
      <o-tabs v-model="activeTab" expanded>
        <o-tab-item :value="0" :label="`Agencies (${computedAgencies.length})`" icon="domain">
          <div class="mt-4">
            <h4 class="title is-4">
              Agency Summary
            </h4>

            <cal-datagrid
              :table-report="agencyDatagrid"
              :show-results-count="false"
            >
              <template #column-agencyId="{ value }">
                <tl-safelink :text="value" max-width="150px" />
              </template>
              <template #column-feedOnestopId="{ value }">
                <tl-safelink :text="value" :url="`https://www.transit.land/feeds/${value}`" />
              </template>
            </cal-datagrid>
          </div>
        </o-tab-item>

        <o-tab-item :value="1" :label="`Transit Stops (${report.stops.length})`" icon="map-marker">
          <div class="mt-4">
            <h4 class="title is-4">
              Transit Stops
            </h4>

            <cal-datagrid
              :table-report="stopDatagrid"
              :show-results-count="false"
            >
              <template #column-stopId="{ value }">
                <tl-safelink :text="value" max-width="100px" />
              </template>
              <template #column-agencyId="{ value }">
                <tl-safelink :text="value" max-width="150px" />
              </template>
              <template #column-feedOnestopId="{ value }">
                <tl-safelink :text="value" :url="`https://www.transit.land/feeds/${value}`" />
              </template>
              <template #column-feedVersionSha1="{ value }">
                <tl-safelink :text="value" :url="`https://www.transit.land/feed-versions/${value}`" max-width="100px" />
              </template>
              <template #column-highestLevel="{ value }">
                <span
                  :class="getFrequencyLevelClass(value)"
                  class="tag"
                >
                  {{ formatHighestLevel(value) }}
                </span>
              </template>
              <template #column-level1="{ value }">
                <o-icon v-if="value == 1" icon="check" />
                <span v-else />
              </template>
              <template #column-level2="{ value }">
                <o-icon v-if="value == 1" icon="check" />
                <span v-else />
              </template>
              <template #column-level3="{ value }">
                <o-icon v-if="value == 1" icon="check" />
                <span v-else />
              </template>
              <template #column-level4="{ value }">
                <o-icon v-if="value == 1" icon="check" />
                <span v-else />
              </template>
              <template #column-level5="{ value }">
                <o-icon v-if="value == 1" icon="check" />
                <span v-else />
              </template>
              <template #column-level6="{ value }">
                <o-icon v-if="value == 1" icon="check" />
                <span v-else />
              </template>
              <template #column-levelNights="{ value }">
                <o-icon v-if="value == 1" icon="check" />
                <span v-else />
              </template>
              <template #additional-downloads="{ loading }">
                <o-field>
                  <cal-geojson-download
                    :data="stopFeatures"
                    filename="wsdot-stops"
                    button-text="Download as GeoJSON"
                    :disabled="loading"
                  />
                </o-field>
              </template>
            </cal-datagrid>
          </div>
        </o-tab-item>

        <o-tab-item :value="2" :label="`Transit Routes (${report.routes.length})`" icon="bus">
          <div class="mt-4">
            <h4 class="title is-4">
              Transit Routes
            </h4>

            <cal-datagrid
              :table-report="routeDatagrid"
              :show-results-count="false"
            >
              <template #column-routeId="{ value }">
                <tl-safelink :text="value" max-width="100px" />
              </template>
              <template #column-routeType="{ value }">
                <tl-route-icon :route-type="value" />
              </template>
              <template #column-agencyId="{ value }">
                <tl-safelink :text="value" max-width="150px" />
              </template>
              <template #column-feedOnestopId="{ value }">
                <tl-safelink :text="value" :url="`https://www.transit.land/feeds/${value}`" />
              </template>
              <template #column-feedVersionSha1="{ value }">
                <tl-safelink :text="value" :url="`https://www.transit.land/feed-versions/${value}`" max-width="100px" />
              </template>
              <template #additional-downloads="{ loading }">
                <o-field>
                  <cal-geojson-download
                    :data="routeFeatures"
                    filename="wsdot-routes"
                    button-text="Download as GeoJSON"
                    :disabled="loading"
                  />
                </o-field>
              </template>
            </cal-datagrid>
          </div>
        </o-tab-item>
      </o-tabs>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { WSDOTStopsRoutesReport } from '~~/src/analysis/wsdot-stops-routes'
import type { Feature } from '~~/src/core'
import type { TableColumn, TableReport } from '~/components/cal/datagrid.vue'

// Define models for props
const report = defineModel<WSDOTStopsRoutesReport>('report', { required: true })

// Tab state
const activeTab = ref(0)

// Create agency lookup map for efficient name resolution
const agencyLookup = computed(() => {
  const lookup = new Map<string, string>()
  for (const agency of report.value.agencies) {
    lookup.set(agency.agencyId, agency.agencyName)
  }
  return lookup
})

// Use the agencies directly from the report
const computedAgencies = computed(() => {
  return report.value.agencies
})

// Convert stops to GeoJSON features for download
const stopFeatures = computed((): Feature[] => {
  return report.value.stops.map(stop => ({
    id: `stop_${stop.stopId}`,
    type: 'Feature',
    properties: {
      // GTFS stop fields (using existing camelCase convention)
      stopId: stop.stopId,
      stopCode: stop.stopCode,
      platformCode: stop.platformCode,
      stopName: stop.stopName,
      stopDesc: stop.stopDesc,
      stopLat: stop.stopLat,
      stopLon: stop.stopLon,
      zoneId: stop.zoneId,
      stopUrl: stop.stopUrl,
      locationType: stop.locationType,
      parentStation: stop.parentStation,
      wheelchairBoarding: stop.wheelchairBoarding,
      ttsStopName: stop.ttsStopName,
      stopTimezone: stop.stopTimezone,

      // Service level columns
      level6: stop.level6,
      level5: stop.level5,
      level4: stop.level4,
      level3: stop.level3,
      level2: stop.level2,
      level1: stop.level1,
      levelNights: stop.levelNights,

      // Additional fields for our internal use
      agencyId: stop.agencyId,
      agencyName: agencyLookup.value.get(stop.agencyId) || 'Unknown', // Use lookup
      feedOnestopId: stop.feedOnestopId,
      feedVersionSha1: stop.feedVersionSha1,
    },
    geometry: stop.geometry
  }))
})

// Convert stops to table data for CSV download
const _stopTableData = computed(() => {
  return report.value.stops.map(stop => ({
    // GTFS stop fields (using existing camelCase convention)
    stopId: stop.stopId,
    stopCode: stop.stopCode,
    platformCode: stop.platformCode,
    stopName: stop.stopName,
    stopDesc: stop.stopDesc,
    stopLat: stop.stopLat,
    stopLon: stop.stopLon,
    zoneId: stop.zoneId,
    stopUrl: stop.stopUrl,
    locationType: stop.locationType,
    parentStation: stop.parentStation,
    wheelchairBoarding: stop.wheelchairBoarding,
    ttsStopName: stop.ttsStopName,
    stopTimezone: stop.stopTimezone,

    // Service level columns
    level6: stop.level6,
    level5: stop.level5,
    level4: stop.level4,
    level3: stop.level3,
    level2: stop.level2,
    level1: stop.level1,
    levelNights: stop.levelNights,

    // Additional fields for our internal use
    agencyId: stop.agencyId,
    agencyName: agencyLookup.value.get(stop.agencyId) || 'Unknown',
    feedOnestopId: stop.feedOnestopId,
    feedVersionSha1: stop.feedVersionSha1,
  }))
})

// Convert routes to GeoJSON features for download
const routeFeatures = computed((): Feature[] => {
  return report.value.routes.map(route => ({
    id: `route_${route.routeId}`,
    type: 'Feature',
    properties: {
      // GTFS route fields (using existing camelCase convention)
      routeId: route.routeId,
      routeShortName: route.routeShortName,
      routeLongName: route.routeLongName,
      routeDesc: route.routeDesc,
      routeType: route.routeType,
      routeUrl: route.routeUrl,
      routeColor: route.routeColor,
      routeTextColor: route.routeTextColor,
      routeSortOrder: route.routeSortOrder,
      continuousPickup: route.continuousPickup,
      continuousDropOff: route.continuousDropOff,

      // Additional fields for our internal use
      agencyId: route.agencyId,
      agencyName: agencyLookup.value.get(route.agencyId) || 'Unknown',
      feedOnestopId: route.feedOnestopId,
      feedVersionSha1: route.feedVersionSha1,
    },
    geometry: route.geometry
  }))
})

// Convert routes to table data for CSV download
const _routeTableData = computed(() => {
  return report.value.routes.map(route => ({
    // GTFS route fields (using existing camelCase convention)
    routeId: route.routeId,
    routeShortName: route.routeShortName,
    routeLongName: route.routeLongName,
    routeDesc: route.routeDesc,
    routeType: route.routeType,
    routeUrl: route.routeUrl,
    routeColor: route.routeColor,
    routeTextColor: route.routeTextColor,
    routeSortOrder: route.routeSortOrder,
    continuousPickup: route.continuousPickup,
    continuousDropOff: route.continuousDropOff,

    // Additional fields for our internal use
    agencyId: route.agencyId,
    agencyName: agencyLookup.value.get(route.agencyId) || 'Unknown',
    feedOnestopId: route.feedOnestopId,
    feedVersionSha1: route.feedVersionSha1,
  }))
})

// Helper function to determine the highest service level for a stop (matching WSDOT viewer)
const getHighestServiceLevel = (stop: any): string => {
  if (stop.level6) return 'level6'
  if (stop.level5) return 'level5'
  if (stop.level4) return 'level4'
  if (stop.level3) return 'level3'
  if (stop.level2) return 'level2'
  if (stop.level1) return 'level1'
  if (stop.levelNights) return 'levelNights'
  return 'unknown'
}

// Helper functions for styling (matching WSDOT viewer)
const getFrequencyLevelClass = (level: string) => {
  if (level === 'levelNights') return 'frequency-level-nights'
  return `frequency-level-${level.replace('level', '')}`
}

const formatHighestLevel = (level: string) => {
  if (level === 'levelNights') return 'Night'
  if (level === 'unknown') return 'No Service Level'
  return level.replace('level', 'Level ')
}

// Stops datagrid
const stopDatagrid = computed((): TableReport => {
  const data = report.value.stops.map(stop => ({
    id: stop.stopId,
    stopId: stop.stopId,
    stopName: stop.stopName,
    stopCode: stop.stopCode,
    platformCode: stop.platformCode,
    stopDesc: stop.stopDesc,
    zoneId: stop.zoneId,
    stopUrl: stop.stopUrl,
    locationType: stop.locationType,
    parentStation: stop.parentStation,
    wheelchairBoarding: stop.wheelchairBoarding,
    ttsStopName: stop.ttsStopName,
    stopTimezone: stop.stopTimezone,
    // Include highest service level (matching WSDOT viewer)
    highestLevel: getHighestServiceLevel(stop),
    // Include individual service levels for checkmark display
    level1: stop.level1,
    level2: stop.level2,
    level3: stop.level3,
    level4: stop.level4,
    level5: stop.level5,
    level6: stop.level6,
    levelNights: stop.levelNights,
    agencyId: stop.agencyId,
    agencyName: agencyLookup.value.get(stop.agencyId) || 'Unknown',
    feedOnestopId: stop.feedOnestopId,
    feedVersionSha1: stop.feedVersionSha1,
  }))

  const columns: TableColumn[] = [
    { key: 'stopId', label: 'Stop ID', sortable: true },
    { key: 'stopName', label: 'Stop Name', sortable: true },
    { key: 'highestLevel', label: 'Highest Level', sortable: true },
    { key: 'level1', label: 'Level 1', sortable: true },
    { key: 'level2', label: 'Level 2', sortable: true },
    { key: 'level3', label: 'Level 3', sortable: true },
    { key: 'level4', label: 'Level 4', sortable: true },
    { key: 'level5', label: 'Level 5', sortable: true },
    { key: 'level6', label: 'Level 6', sortable: true },
    { key: 'levelNights', label: 'Level Nights', sortable: true },
    { key: 'agencyName', label: 'Agency Name', sortable: true },
    { key: 'agencyId', label: 'Agency ID', sortable: true },
    { key: 'feedOnestopId', label: 'Feed Onestop ID', sortable: true },
    { key: 'feedVersionSha1', label: 'Feed Version SHA1', sortable: true },
  ]

  return {
    data,
    columns
  }
})

// Agency datagrid
const agencyDatagrid = computed((): TableReport => {
  const data = computedAgencies.value.map(agency => ({
    id: agency.agencyId,
    agencyName: agency.agencyName,
    agencyId: agency.agencyId,
    feedOnestopId: agency.feedOnestopId,
    stopsCount: agency.stopsCount,
    routesCount: agency.routesCount,
  }))

  const columns: TableColumn[] = [
    { key: 'agencyName', label: 'Agency Name', sortable: true },
    { key: 'stopsCount', label: 'Stops', sortable: true },
    { key: 'routesCount', label: 'Routes', sortable: true },
    { key: 'agencyId', label: 'Agency ID', sortable: true },
    { key: 'feedOnestopId', label: 'Feed Onestop ID', sortable: true },
  ]

  return {
    data,
    columns
  }
})

// Routes datagrid
const routeDatagrid = computed((): TableReport => {
  const data = report.value.routes.map(route => ({
    id: route.routeId,
    routeId: route.routeId,
    routeShortName: route.routeShortName,
    routeLongName: route.routeLongName,
    routeDesc: route.routeDesc,
    routeType: route.routeType,
    routeUrl: route.routeUrl,
    routeColor: route.routeColor,
    routeTextColor: route.routeTextColor,
    routeSortOrder: route.routeSortOrder,
    continuousPickup: route.continuousPickup,
    continuousDropOff: route.continuousDropOff,
    agencyId: route.agencyId,
    agencyName: agencyLookup.value.get(route.agencyId) || 'Unknown',
    feedOnestopId: route.feedOnestopId,
    feedVersionSha1: route.feedVersionSha1,
  }))

  const columns: TableColumn[] = [
    { key: 'routeId', label: 'Route ID', sortable: true },
    { key: 'routeShortName', label: 'Route Short Name', sortable: true },
    { key: 'routeLongName', label: 'Route Long Name', sortable: true },
    { key: 'routeDesc', label: 'Route Description', sortable: true },
    { key: 'routeType', label: 'Route Type', sortable: true },
    { key: 'routeUrl', label: 'Route URL', sortable: true },
    { key: 'routeColor', label: 'Route Color', sortable: true },
    { key: 'routeTextColor', label: 'Route Text Color', sortable: true },
    { key: 'routeSortOrder', label: 'Route Sort Order', sortable: true },
    { key: 'continuousPickup', label: 'Continuous Pickup', sortable: true },
    { key: 'continuousDropOff', label: 'Continuous Drop Off', sortable: true },
    { key: 'agencyName', label: 'Agency Name', sortable: true },
    { key: 'agencyId', label: 'Agency ID', sortable: true },
    { key: 'feedOnestopId', label: 'Feed Onestop ID', sortable: true },
    { key: 'feedVersionSha1', label: 'Feed Version SHA1', sortable: true },
  ]

  return {
    data,
    columns
  }
})
</script>

<style scoped>
/* Frequency level color classes - extending Bulma's tag component (matching WSDOT viewer) */
.frequency-level-1 {
  background-color: #00ffff !important;
}

.frequency-level-2 {
  background-color: #00ff80 !important;
}

.frequency-level-3 {
  background-color: #80ff00 !important;
}

.frequency-level-4 {
  background-color: #ffff00 !important;
}

.frequency-level-5 {
  background-color: #ff8000 !important;
}

.frequency-level-6 {
  background-color: #ff0000 !important;
}

.frequency-level-nights {
  background-color: #5c5cff !important;
  color: #ffffff !important;
}

/* Override Oruga tab styling to match Bulma's default behavior */
:deep(.o-tabs) {
  .o-tabs__nav {
    border-bottom: 1px solid var(--bulma-border);
    border-top: none;
    border-left: none;
    border-right: none;
  }

  .o-tabs__item {
    border-bottom: none !important;

    &.is-active {
      border-bottom: none !important;
    }
  }

  .o-tabs__link {
    border-bottom: none !important;
    padding: 0.5em 1em;

    &:hover {
      border-bottom: none !important;
    }
  }
}
</style>
