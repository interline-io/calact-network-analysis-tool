<template>
  <div class="card popup-card">
    <header class="card-header">
      <p class="card-header-title popup-header-title">
        {{ hasMultiple ? 'Features' : 'Feature' }} at this point
      </p>
      <button class="delete popup-close" aria-label="close" @click="$emit('close')" />
    </header>
    <div class="card-content">
      <div class="popup-content">
        <!-- Stop popup -->
        <template v-if="feature.featureType === 'stop'">
          <div class="popup-feature-type">
            🚏 Stop
          </div>
          <div>Stop ID: {{ feature.data.stop_id }}</div>
          <div><strong>{{ feature.data.stop_name }}</strong></div>
          <div>Routes: {{ feature.data.routes?.join(', ') }}</div>
          <div>Agencies: {{ feature.data.agencies?.join(', ') }}</div>
        </template>

        <!-- Route popup -->
        <template v-else-if="feature.featureType === 'route'">
          <div class="popup-feature-type">
            🚌 Route
          </div>
          <div>Route ID: {{ feature.data.route_id }}</div>
          <div><strong>{{ feature.data.route_short_name }} {{ feature.data.route_long_name }}</strong></div>
          <div>Type: {{ feature.data.route_type_name }}</div>
          <div>Agency: {{ feature.data.agency_name }}</div>
          <button class="button is-small is-info mt-2" @click="$emit('openTimetable', feature.featureId)">
            View Timetable
          </button>
        </template>

        <!-- Aggregation-area popup: all demographic elements for one census geography -->
        <template v-else-if="feature.featureType === 'aggregation'">
          <div class="popup-feature-type">
            📊 {{ feature.data.name || 'Aggregation area' }}
          </div>
          <div class="popup-details">
            <div v-if="feature.data.stops_count !== undefined">
              <strong>Stops:</strong> {{ feature.data.stops_count }}
            </div>
            <div v-if="feature.data.routes_count !== undefined">
              <strong>Routes:</strong> {{ feature.data.routes_count }}
            </div>
            <div v-if="feature.data.agencies_count !== undefined">
              <strong>Agencies:</strong> {{ feature.data.agencies_count }}
            </div>
            <div v-if="feature.data.visit_count_total !== undefined">
              <strong>Stop visits:</strong> {{ feature.data.visit_count_total }}
            </div>
          </div>
          <div class="popup-census-divider" />
          <div class="popup-details">
            <div
              v-for="col of CENSUS_COLUMNS"
              :key="col.id"
              :class="{ 'popup-census-highlighted': col.id === highlightedElement }"
            >
              <strong>{{ col.label }}:</strong>
              {{ formatCensusValue(censusValue(col.id), col.format) }}
            </div>
          </div>
        </template>

        <!-- Flex service area popup -->
        <template v-else-if="feature.featureType === 'flex'">
          <div class="popup-feature-type">
            📍 Flex Service Area
          </div>
          <div
            class="notification popup-status-bar"
            :class="feature.data.marked === false ? 'is-warning is-light' : 'is-success is-light'"
          >
            {{ feature.data.marked === false ? "⚠️ Doesn't match current filters" : '✅ Matches all filters' }}
          </div>
          <div v-if="feature.data.location_name" class="popup-location-name">
            {{ feature.data.location_name }}
          </div>
          <div class="popup-details">
            <div><strong>Agency:</strong> {{ feature.data.agency_name }}</div>
            <div><strong>Routes:</strong> {{ feature.data.route_names }}</div>
            <div><strong>Service:</strong> {{ feature.data.area_type }}</div>
            <div><strong>Advance Notice:</strong> {{ feature.data.advance_notice }}</div>
            <div v-if="feature.data.phone_number">
              <strong>Phone:</strong> {{ feature.data.phone_number }}
            </div>
          </div>
        </template>
      </div>

      <!-- Navigation bar for multiple features -->
      <div v-if="hasMultiple" class="popup-nav-bar">
        <button
          class="button is-small popup-prev"
          :disabled="currentIndex === 0"
          @click="$emit('prev')"
        >
          <span class="icon is-small"><i class="mdi mdi-chevron-left" /></span>
        </button>
        <span class="popup-nav-label">{{ currentIndex + 1 }} of {{ total }}</span>
        <button
          class="button is-small popup-next"
          :disabled="currentIndex === total - 1"
          @click="$emit('next')"
        >
          <span class="icon is-small"><i class="mdi mdi-chevron-right" /></span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { CENSUS_COLUMNS, formatCensusValue } from '~~/src/core'

/**
 * Structured popup feature data for Vue component rendering
 * This avoids HTML string interpolation and XSS concerns
 */
export interface PopupFeatureData {
  featureType: 'stop' | 'route' | 'flex' | 'aggregation'
  featureId: string | number
  sourceLayer: string
  data: {
    // Stop fields
    stop_id?: string
    stop_name?: string
    routes?: string[]
    agencies?: string[]
    // Route fields
    route_id?: string
    route_short_name?: string
    route_long_name?: string
    route_type_name?: string
    agency_name?: string
    // Flex fields
    location_id?: string
    location_name?: string
    route_names?: string
    area_type?: string
    advance_notice?: string
    phone_number?: string
    marked?: boolean
    // Aggregation fields (#302) — raw row from stopGeoAggregateCsv + derived
    // census columns merged in. Indexed by column id (see CENSUS_COLUMNS).
    [key: string]: any
  }
}

const props = defineProps<{
  feature: PopupFeatureData
  currentIndex: number
  total: number
  /** ID of the census column currently rendered as choropleth shading. When
   * the popup is for an aggregation area, that column is highlighted. */
  highlightedElement?: string
}>()

defineEmits<{
  close: []
  prev: []
  next: []
  openTimetable: [featureId: string | number]
}>()

const hasMultiple = computed(() => props.total > 1)

function censusValue (id: string): number | null {
  const v = props.feature.data[id]
  if (v === null || v === undefined) {
    return null
  }
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
</script>

<style scoped lang="scss">
.popup-card {
  margin: 0;
  border-radius: 6px;
  box-shadow: none;
}

.popup-card .card-header {
  padding: 8px 12px;
  background: #f5f5f5;
  border-bottom: 1px solid #e0e0e0;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.popup-header-title {
  font-size: 13px;
  padding: 0;
  margin: 0;
  color: #333;
}

.popup-close {
  position: relative;
  top: 0;
  right: 0;
  flex-shrink: 0;
}

.popup-card .card-content {
  padding: 12px;
  max-height: 350px;
  overflow-y: auto;
}

.popup-nav-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid #eee;
}

.popup-nav-label {
  font-size: 13px;
  color: #666;
  font-weight: 500;
}

.popup-content {
  font-size: 14px;
  line-height: 1.5;
}

.popup-feature-type {
  font-weight: bold;
  font-size: 15px;
  color: #333;
  margin-bottom: 8px;
}

.popup-status-bar {
  padding: 8px 12px;
  margin-bottom: 4px !important;
  font-size: 13px;
  font-weight: 500;
  border-radius: 4px;
}

.popup-location-name {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 8px;
  color: #222;
}

.popup-details {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.popup-details div {
  font-size: 13px;
}

.popup-census-divider {
  border-top: 1px solid #e0e0e0;
  margin: 8px 0;
}

.popup-census-highlighted {
  background: #fff3cd;
  padding: 2px 4px;
  margin: -2px -4px;
  border-radius: 3px;
  font-weight: 600;
}
</style>
