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
            {{ report.agencies.length }}
          </p>
        </div>
      </div>
    </div>

    <div class="columns">
      <div class="column is-one-quarter">
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
            <tr v-for="agency in report.agencies" :key="agency.agencyId">
              <td>{{ agency.agencyName }}</td>
              <td>{{ agency.stopsCount }}</td>
              <td>{{ agency.routesCount }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="column">
        <cal-map-viewer-ts
          :features="displayFeatures"
          :center="bboxCenter"
          :zoom="zoom"
        />
      </div>
    </div>

    <!-- Stops Table -->
    <div class="mt-4">
      <div class="level">
        <div class="level-left">
          <div class="level-item">
            <h4 class="title is-4">
              Transit Stops
            </h4>
          </div>
        </div>
        <div class="level-right">
          <div class="level-item">
            <cal-geojson-download
              :features="stopFeatures"
              filename="wsdot-stops"
              label="Download Stops as GeoJSON"
            />
          </div>
        </div>
      </div>

      <cal-datagrid
        :table-report="stopDatagrid"
      />
    </div>

    <!-- Routes Table -->
    <div class="mt-4">
      <div class="level">
        <div class="level-left">
          <div class="level-item">
            <h4 class="title is-4">
              Transit Routes
            </h4>
          </div>
        </div>
        <div class="level-right">
          <div class="level-item">
            <cal-geojson-download
              :features="routeFeatures"
              filename="wsdot-routes"
              label="Download Routes as GeoJSON"
            />
          </div>
        </div>
      </div>

      <cal-datagrid
        :table-report="routeDatagrid"
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { WSDOTStopsRoutesReport } from '~/src/reports/wsdot-stops-routes'
import type { Feature } from '~/src/geom'
import type { TableColumn, TableReport } from '~/components/cal/datagrid.vue'

// Define models for props
const report = defineModel<WSDOTStopsRoutesReport>('report', { required: true })

const zoom = 10
const bboxCenter = computed(() => {
  // Calculate center from stops if available
  if (report.value.stops.length === 0) {
    return { lat: 47.6062, lon: -122.3321 } // Default to Seattle
  }

  const lats = report.value.stops.map(s => s.stopLat)
  const lons = report.value.stops.map(s => s.stopLon)

  const avgLat = lats.reduce((a, b) => a + b, 0) / lats.length
  const avgLon = lons.reduce((a, b) => a + b, 0) / lons.length

  return { lat: avgLat, lon: avgLon }
})

// Convert stops to GeoJSON features for map display
const stopFeatures = computed((): Feature[] => {
  return report.value.stops.map(stop => ({
    id: `stop_${stop.stopId}`,
    type: 'Feature',
    properties: {
      'stopId': stop.stopId,
      'stopName': stop.stopName,
      'agencyId': stop.agencyId,
      'marker-color': '#ff0000',
      'marker-radius': 4,
    },
    geometry: stop.geometry
  }))
})

// Convert routes to GeoJSON features for map display
const routeFeatures = computed((): Feature[] => {
  return report.value.routes.map(route => ({
    id: `route_${route.routeId}`,
    type: 'Feature',
    properties: {
      'routeId': route.routeId,
      'routeShortName': route.routeShortName,
      'routeLongName': route.routeLongName,
      'routeType': route.routeType,
      'agencyId': route.agencyId,
      'stroke': '#0000ff',
      'stroke-width': 2,
    },
    geometry: route.geometry
  }))
})

// Combine features for map display
const displayFeatures = computed((): Feature[] => {
  return [...stopFeatures.value, ...routeFeatures.value]
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
  }))

  const columns: TableColumn[] = [
    { key: 'stopId', label: 'Stop ID', sortable: true },
    { key: 'stopName', label: 'Stop Name', sortable: true },
    { key: 'stopLat', label: 'Latitude', sortable: true },
    { key: 'stopLon', label: 'Longitude', sortable: true },
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
    routeType: route.routeType,
    agencyId: route.agencyId,
    feedOnestopId: route.feedOnestopId,
  }))

  const columns: TableColumn[] = [
    { key: 'routeId', label: 'Route ID', sortable: true },
    { key: 'routeShortName', label: 'Route Short Name', sortable: true },
    { key: 'routeLongName', label: 'Route Long Name', sortable: true },
    { key: 'routeType', label: 'Route Type', sortable: true },
    { key: 'agencyId', label: 'Agency ID', sortable: true },
    { key: 'feedOnestopId', label: 'Feed Onestop ID', sortable: true },
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
