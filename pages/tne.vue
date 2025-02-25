<template>
  <NuxtLayout name="default">
    <template #breadcrumbs />
    <template #footer />
    <template #menu-items>
      <ul class="menu-list">
        <li>
          <a :class="itemHelper('query')" @click="setTab('query')">
            <o-icon
              icon="magnify"
              class="is-fullwidth"
              size="large"
            />
          </a>
        </li>
        <li>
          <a :class="itemHelper('filter')" @click="setTab('filter')">
            <o-icon
              icon="filter"
              class="is-fullwidth"
              size="large"
            />
          </a>
        </li>
        <li>
          <a :class="itemHelper('map')" @click="setTab('map')">
            <o-icon
              icon="map"
              class="is-fullwidth"
              size="large"
            />
          </a>
        </li>
      </ul>
    </template>

    <template #main>
      <!-- Loading and error handling -->
      <o-loading
        :active="loading"
        :full-page="true"
      >
        <img src="~assets/spinner.svg" alt="Loading">
      </o-loading>

      <tl-modal
        v-model="hasError"
        title="Error"
      >
        <tl-msg-error title="There was an error :(">
          {{ error }}
        </tl-msg-error>
      </tl-modal>

      <div style="position:relative">
        <div v-if="activeTab === 'query'" class="cal-overlay">
          <cal-query
            :bbox="bbox"
            :start-date="startDate"
            :end-date="endDate"
            :geom-source="geomSource"
            @set-start-date="startDate = $event"
            @set-end-date="endDate = $event"
            @set-bbox="bbox = $event"
            @set-geom-source="geomSource = $event"
            @explore="activeTab = 'map'"
          />
        </div>
        <div v-if="activeTab === 'filter'" class="cal-overlay">
          <cal-filter
            :bbox="bbox"
            :start-date="startDate"
            :end-date="endDate"
            :stop-features="stopFeatures"
            :selected-days="selectedDays"
            :selected-route-types="selectedRouteTypes"
            :selected-agencies="selectedAgencies"
            :unit-system="unitSystem"
            :color-key="colorKey"
            :base-map="baseMap"
            @set-base-map="baseMap = $event"
            @set-color-key="colorKey = $event"
            @set-unit-system="unitSystem = $event"
            @set-selected-route-types="selectedRouteTypes = $event"
            @set-selected-days="selectedDays = $event"
            @set-selected-agencies="selectedAgencies = $event"
            @reset-filters="resetFilters"
          />
        </div>
      </div>
      <!-- This is a component for handling data flow -->

      <cal-scenario
        :bbox="bbox"
        :start-date="startDate"
        :end-date="endDate"
        :selected-days="selectedDays"
        :selected-route-types="selectedRouteTypes"
        :selected-agencies="selectedAgencies"
        :geom-source="geomSource"
        @set-stop-features="setStopFeatures"
        @set-loading="loading = $event"
        @set-error="error = $event"
      />

      <!-- This is a component for displaying the map -->
      <cal-map
        :bbox="bbox"
        :stop-features="stopFeatures"
        @set-bbox="bbox = $event"
        @set-map-extent="setMapExtent"
      />
    </template>
  </NuxtLayout>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { type Bbox, type Feature, parseBbox, bboxString, parseDate, fmtDate } from '../components/geom'
import { navigateTo } from '#imports'

definePageMeta({
  layout: false
})

const route = useRoute()

// const defaultBbox = '-121.30929,44.05620,-121.31381,44.05980'
const defaultBbox = `-122.66450,45.52167,-122.66035,45.52420`

// Loading and error handling
const loading = ref(false)
const hasError = computed(() => { return error.value !== null })
const error = ref(null)

// Handle query parameters
const geomSource = computed({
  get () {
    return route.query.geomSource?.toString() || 'bbox'
  },
  set (v: string) {
    navigateTo({ replace: true, query: { ...route.query, geomSource: v } })
  }
})

const startDate = computed({
  get () {
    return parseDate(route.query.startDate?.toString() || '') || new Date()
  },
  set (v: Date) {
    navigateTo({ replace: true, query: { ...route.query, startDate: fmtDate(v) } })
  }
})

const endDate = computed({
  get () {
    return parseDate(route.query.endDate?.toString() || '') || new Date()
  },
  set (v: Date) {
    navigateTo({ replace: true, query: { ...route.query, endDate: fmtDate(v) } })
  }
})

const bbox = computed({
  get () {
    const bbox = route.query.bbox?.toString() ?? defaultBbox
    return parseBbox(bbox)
  },
  set (v: Bbox) {
    navigateTo({ replace: true, query: { ...route.query, bbox: bboxString(v) } })
  }
})

const unitSystem = computed({
  get () {
    return route.query.unitSystem?.toString() || 'us'
  },
  set (v: string) {
    navigateTo({ replace: true, query: { ...route.query, unitSystem: v } })
  }
})

const colorKey = computed({
  get () {
    return route.query.colorKey?.toString() || 'Agency'
  },
  set (v: string) {
    navigateTo({ replace: true, query: { ...route.query, colorKey: v } })
  }
})

const baseMap = computed({
  get () {
    return route.query.baseMap?.toString() || 'Streets'
  },
  set (v: string) {
    navigateTo({ replace: true, query: { ...route.query, baseMap: v } })
  }
})

const selectedDays = computed({
  get () {
    return arrayParam('selectedDays')
  },
  set (v: string[]) {
    navigateTo({ replace: true, query: { ...route.query, selectedDays: v.join(',') } })
  }
})

const selectedRouteTypes = computed({
  get () {
    return arrayParam('selectedRouteTypes')
  },
  set (v: string[]) {
    navigateTo({ replace: true, query: { ...route.query, selectedRouteTypes: v.join(',') } })
  }
})

const selectedAgencies = computed({
  get () {
    return arrayParam('selectedAgencies')
  },
  set (v: string[]) {
    navigateTo({ replace: true, query: { ...route.query, selectedAgencies: v.join(',') } })
  }
})

/////////////////////////
// Event passing
/////////////////////////

// Stop features
const stopFeatures = ref<Feature[]>([])
function setStopFeatures (v: any) {
  stopFeatures.value = v
}

// Tab handling
const activeTab = ref(route.query.activeTab || 'query')

function setTab (v: string) {
  if (activeTab.value === v) {
    activeTab.value = 'map'
    return
  }
  activeTab.value = v
}

/////////////////////////////
// Other setters
/////////////////////////////

// We need to keep reference to the map extent
const mapExtent = ref<Bbox | null>(null)
watch(geomSource, () => {
  if (geomSource.value === 'mapExtent' && mapExtent.value) {
    bbox.value = mapExtent.value
  }
})

async function setMapExtent (v: Bbox) {
  mapExtent.value = v
  if (geomSource.value === 'mapExtent') {
    bbox.value = mapExtent.value
  }
}

async function resetFilters () {
  await navigateTo({ replace: true, query: { ...route.query, selectedAgencies: '', selectedDays: '', selectedRouteTypes: '' } })
}

//////////////////////
// Helpers
//////////////////////

function itemHelper (p: string): string {
  if (activeTab.value === p) {
    return 'is-active'
  }
  return 'is-secondary'
}

function arrayParam (p: string): string[] {
  return route.query[p]?.toString().split(',').filter(p => (p)) || []
}

</script>

<style scoped lang="scss">
.cal-overlay {
  position:absolute;
  top:0px;
  left:0px;
  height:100vh;
  z-index:1000;
}
</style>
