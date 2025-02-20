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
            @set-start-date="setStartDate"
            @set-end-date="setEndDate"
            @set-bbox="setBbox"
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
            @set-selected-route-types="setSelectedRouteTypes"
            @set-selected-days="setSelectedDays"
            @set-selected-agencies="setSelectedAgencies"
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
        @set-stop-features="setStopFeatures"
        @set-loading="loading = $event"
        @set-error="error = $event"
      />

      <!-- This is a component for displaying the map -->
      <cal-map
        :bbox="bbox"
        :stop-features="stopFeatures"
        @set-bbox="setBbox"
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
const defaultBbox = `-122.68112,45.51939,-122.67713,45.52240`

// Loading and error handling
const loading = ref(false)
const hasError = computed(() => { return error.value !== null })
const error = ref(null)

// Tab handling
const activeTab = ref(route.query.activeTab || 'filter')

function setTab (v: string) {
  if (activeTab.value === v) {
    activeTab.value = 'map'
    return
  }
  activeTab.value = v
}

function itemHelper (p: string): string {
  if (activeTab.value === p) {
    return 'is-active'
  }
  return 'is-secondary'
}

// Apply stop

const stopFeatures = ref<Feature[]>([])
function setStopFeatures (v: any) {
  stopFeatures.value = v
}

// Handle query parameters

const startDate = computed(() => {
  return parseDate(route.query.startDate?.toString() || '') || new Date()
})

const endDate = computed(() => {
  return parseDate(route.query.endDate?.toString() || '') || new Date()
})

const bbox = computed(() => {
  const bbox = route.query.bbox?.toString() ?? defaultBbox
  return parseBbox(bbox)
})

function arrayParam (p: string): string[] {
  return route.query[p]?.toString().split(',').filter(p => (p)) || []
}

const selectedDays = computed(() => {
  return arrayParam('selectedDays')
})

const selectedRouteTypes = computed(() => {
  return arrayParam('selectedRouteTypes')
})

const selectedAgencies = computed(() => {
  return arrayParam('selectedAgencies')
})

async function setStartDate (v: Date) {
  await navigateTo({ query: { ...route.query, startDate: fmtDate(v) } })
}

async function setEndDate (v: Date) {
  await navigateTo({ query: { ...route.query, endDate: fmtDate(v) } })
}

async function setBbox (v: Bbox) {
  await navigateTo({ replace: true, query: { ...route.query, bbox: bboxString(v) } })
}

async function setSelectedDays (v: string[]) {
  await navigateTo({ query: { ...route.query, selectedDays: v.join(',') } })
}

async function setSelectedRouteTypes (v: string[]) {
  await navigateTo({ query: { ...route.query, selectedRouteTypes: v.join(',') } })
}

// FIXME: agency names might contain commas; use multiple query parameters
async function setSelectedAgencies (v: string[]) {
  await navigateTo({ query: { ...route.query, selectedAgencies: v.join(',') } })
}
async function resetFilters () {
  await navigateTo({ query: { ...route.query, selectedAgencies: '', selectedDays: '', selectedRouteTypes: '' } })
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
