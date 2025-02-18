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
          />
        </div>
      </div>
      <cal-map
        :bbox="bbox"
        :start-date="startDate"
        :end-date="endDate"
        @set-start-date="setStartDate"
        @set-end-date="setEndDate"
        @set-bbox="setBbox"
      />
    </template>
  </NuxtLayout>
</template>

<script lang="ts" setup>
import { startDate, endDate, bbox, setStartDate, setEndDate, setBbox } from '../components/shared'

definePageMeta({
  layout: false
})

const activeTab = ref('query')

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
