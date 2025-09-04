<template>
  <div>
    <div class="box level">
      <div class="level-item has-text-centered">
        <div>
          <p class="heading">
            Total Stops
          </p>
          <p class="title is-6">
            {{ report.stops.length }}
          </p>
        </div>
      </div>
      <div class="level-item has-text-centered">
        <div>
          <p class="heading">
            Total Routes
          </p>
          <p class="title is-6">
            {{ report.routes.length }}
          </p>
        </div>
      </div>
      <div class="level-item has-text-centered">
        <div>
          <p class="heading">
            Total Agencies
          </p>
          <p class="title is-6">
            {{ computedAgencies.length }}
          </p>
        </div>
      </div>
    </div>

    <div class="columns">
      <div class="column">
        <o-field label="Agency Summary" class="mt-4" />
        <table class="agency-summary-table">
          <thead>
            <tr>
              <th>Agency</th>
              <th>Stops</th>
              <th>Routes</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="agency in computedAgencies" :key="agency.agencyId">
              <td>{{ agency.agencyName }}</td>
              <td>{{ agency.stopsCount }}</td>
              <td>{{ agency.routesCount }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Stops Table -->
    <div class="mt-4">
      <h4 class="title is-4">
        Transit Stops
      </h4>

      <cal-datagrid
        :table-report="stopDatagrid"
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
        <template #additional-downloads="{ loading }">
          <o-field>
            <cal-geojson-download
              :data="stopFeatures"
              filename="wsdot-stops"
              button-text="Download as GeoJSON"
              :disabled="loading"
            />
          </o-field>
          <o-field>
            <cal-geopackage-download
              :data="stopFeatures"
              filename="wsdot-stops"
              button-text="Download as GeoPackage"
              :disabled="loading"
            />
          </o-field>
        </template>
      </cal-datagrid>
    </div>

    <!-- Routes Table -->
    <div class="mt-4">
      <h4 class="title is-4">
        Transit Routes
      </h4>

      <cal-datagrid
        :table-report="routeDatagrid"
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
          <o-field>
            <cal-geopackage-download
              :data="routeFeatures"
              filename="wsdot-routes"
              button-text="Download as GeoPackage"
              :disabled="loading"
            />
          </o-field>
        </template>
      </cal-datagrid>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { WSDOTStopsRoutesReport } from '~/src/reports/wsdot-stops-routes'
import type { Feature } from '~/src/geom'
import type { TableColumn, TableReport } from '~/components/cal/datagrid.vue'

// Define models for props
const report = defineModel<WSDOTStopsRoutesReport>('report', { required: true })

// Compute agencies from stops and routes data
const computedAgencies = computed(() => {
  const agencyMap = new Map<string, { agencyId: string, agencyName: string, stopsCount: number, routesCount: number }>()

  // Count stops per agency
  for (const stop of report.value.stops) {
    const existing = agencyMap.get(stop.agencyId)
    if (existing) {
      existing.stopsCount++
    } else {
      agencyMap.set(stop.agencyId, {
        agencyId: stop.agencyId,
        agencyName: stop.agencyId.includes(':') ? stop.agencyId.split(':')[1] : stop.agencyId,
        stopsCount: 1,
        routesCount: 0
      })
    }
  }

  // Count routes per agency
  for (const route of report.value.routes) {
    const existing = agencyMap.get(route.agencyId)
    if (existing) {
      existing.routesCount++
    } else {
      agencyMap.set(route.agencyId, {
        agencyId: route.agencyId,
        agencyName: route.agencyId.includes(':') ? route.agencyId.split(':')[1] : route.agencyId,
        stopsCount: 0,
        routesCount: 1
      })
    }
  }

  return Array.from(agencyMap.values())
})

// Convert stops to GeoJSON features for download
const stopFeatures = computed((): Feature[] => {
  return report.value.stops.map(stop => ({
    id: `stop_${stop.stopId}`,
    type: 'Feature',
    properties: {
      stopId: stop.stopId,
      stopName: stop.stopName,
      stopLat: stop.stopLat,
      stopLon: stop.stopLon,
      agencyId: stop.agencyId,
      feedOnestopId: stop.feedOnestopId,
    },
    geometry: stop.geometry
  }))
})

// Convert stops to table data for CSV download
const _stopTableData = computed(() => {
  return report.value.stops.map(stop => ({
    stopId: stop.stopId,
    stopName: stop.stopName,
    stopLat: stop.stopLat,
    stopLon: stop.stopLon,
    agencyId: stop.agencyId,
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
      routeId: route.routeId,
      routeShortName: route.routeShortName,
      routeLongName: route.routeLongName,
      routeType: route.routeType,
      agencyId: route.agencyId,
      feedOnestopId: route.feedOnestopId,
    },
    geometry: route.geometry
  }))
})

// Convert routes to table data for CSV download
const _routeTableData = computed(() => {
  return report.value.routes.map(route => ({
    routeId: route.routeId,
    routeShortName: route.routeShortName,
    routeLongName: route.routeLongName,
    routeType: route.routeType,
    agencyId: route.agencyId,
    feedOnestopId: route.feedOnestopId,
    feedVersionSha1: route.feedVersionSha1,
  }))
})

// Stops datagrid
const stopDatagrid = computed((): TableReport => {
  const data = report.value.stops.map(stop => ({
    id: stop.stopId,
    stopId: stop.stopId,
    stopName: stop.stopName,
    stopLat: stop.stopLat,
    stopLon: stop.stopLon,
    agencyId: stop.agencyId,
    feedOnestopId: stop.feedOnestopId,
    feedVersionSha1: stop.feedVersionSha1,
  }))

  const columns: TableColumn[] = [
    { key: 'stopId', label: 'Stop ID', sortable: true },
    { key: 'stopName', label: 'Stop Name', sortable: true },
    { key: 'agencyId', label: 'Agency ID', sortable: true },
    { key: 'feedOnestopId', label: 'Feed Onestop ID', sortable: true },
    { key: 'feedVersionSha1', label: 'Feed Version SHA1', sortable: true },
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
    routeType: route.routeType,
    agencyId: route.agencyId,
    feedOnestopId: route.feedOnestopId,
    feedVersionSha1: route.feedVersionSha1,
  }))

  const columns: TableColumn[] = [
    { key: 'routeId', label: 'Route ID', sortable: true },
    { key: 'routeShortName', label: 'Route Short Name', sortable: true },
    { key: 'routeLongName', label: 'Route Long Name', sortable: true },
    { key: 'routeType', label: 'Route Type', sortable: true },
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
.agency-summary-table {
  width: 100%;
  border-collapse: collapse;
}

.agency-summary-table th,
.agency-summary-table td {
  padding: 8px;
  text-align: left;
  border-bottom: 1px solid #ddd;
}

.agency-summary-table th {
  background-color: #f5f5f5;
  font-weight: bold;
}
</style>
