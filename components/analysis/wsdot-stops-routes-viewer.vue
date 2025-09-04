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

    <div class="mt-4">
      <h4 class="title is-4">
        Agency Summary
      </h4>

      <cal-datagrid
        :table-report="agencyDatagrid"
      />
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
    agencyName: agencyLookup.value.get(route.agencyId) || 'Unknown',
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
    agencyName: agencyLookup.value.get(stop.agencyId) || 'Unknown',
    feedOnestopId: stop.feedOnestopId,
    feedVersionSha1: stop.feedVersionSha1,
  }))

  const columns: TableColumn[] = [
    { key: 'stopId', label: 'Stop ID', sortable: true },
    { key: 'stopName', label: 'Stop Name', sortable: true },
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
    routeType: route.routeType,
    agencyId: route.agencyId,
    agencyName: agencyLookup.value.get(route.agencyId) || 'Unknown',
    feedOnestopId: route.feedOnestopId,
    feedVersionSha1: route.feedVersionSha1,
  }))

  const columns: TableColumn[] = [
    { key: 'routeId', label: 'Route ID', sortable: true },
    { key: 'routeShortName', label: 'Route Short Name', sortable: true },
    { key: 'routeLongName', label: 'Route Long Name', sortable: true },
    { key: 'routeType', label: 'Route Type', sortable: true },
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
