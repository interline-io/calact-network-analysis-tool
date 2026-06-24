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
          <div v-if="feature.data.average_frequency != null">
            Frequency: {{ formatDuration(feature.data.average_frequency) }} (dominant direction)
          </div>
          <div
            v-if="feature.data.frequency_irregular || feature.data.frequency_directions_differ"
            class="popup-frequency-caveat"
          >
            ⚠️
            <template v-if="feature.data.frequency_irregular && feature.data.frequency_directions_differ">
              Irregular service; directions differ.
            </template>
            <template v-else-if="feature.data.frequency_irregular">
              Irregular service.
            </template>
            <template v-else>
              Directions differ.
            </template>
            See timetable for details.
          </div>
          <button class="button is-small is-info mt-2" @click="$emit('openTimetable', feature.featureId)">
            View Timetable
          </button>
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

        <!-- Stop cluster popup -->
        <template v-else-if="feature.featureType === 'cluster'">
          <div class="popup-feature-type">
            🔗 Stop Cluster
          </div>
          <div class="popup-details">
            <div><strong>Agencies:</strong> {{ feature.data.agency_names?.join(', ') }}</div>
          </div>
          <div class="cal-cluster-members">
            <div
              v-for="(member, i) in feature.data.cluster_members"
              :key="i"
              class="cal-cluster-member"
            >
              <div>
                <strong>{{ member.stop_name }}</strong>
                <span v-if="member.stop_id" class="cal-cluster-member-id"> ({{ member.stop_id }})</span>
              </div>
              <div><strong>Agency:</strong> {{ member.agency_names.join(', ') }}</div>
              <div><strong>Routes:</strong> {{ member.route_names.join(', ') }}</div>
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
import { STOP_CLUSTER_COLOR, formatDuration } from '~~/src/core'
import type { ClusterMemberInfo } from '~~/src/core'

/**
 * Structured popup feature data for Vue component rendering
 * This avoids HTML string interpolation and XSS concerns
 */
export interface PopupFeatureData {
  featureType: 'stop' | 'route' | 'flex' | 'cluster'
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
    average_frequency?: number
    frequency_irregular?: boolean
    frequency_directions_differ?: boolean
    // Flex fields
    location_id?: string
    location_name?: string
    route_names?: string
    area_type?: string
    advance_notice?: string
    phone_number?: string
    marked?: boolean
    // Stop cluster fields
    cluster_id?: string
    agency_names?: string[]
    cluster_members?: ClusterMemberInfo[]
  }
}

const props = defineProps<{
  feature: PopupFeatureData
  currentIndex: number
  total: number
}>()

defineEmits<{
  close: []
  prev: []
  next: []
  openTimetable: [featureId: string | number]
}>()

const hasMultiple = computed(() => props.total > 1)
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

.popup-frequency-caveat {
  margin-top: 4px;
  font-size: 12px;
  color: #946c00;
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

.cal-cluster-members {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cal-cluster-member {
  font-size: 13px;
  padding: 6px 8px;
  // Accent bound from STOP_CLUSTER_COLOR (matches the map marker); the pale fill
  // is an independent decorative tint.
  border-left: 3px solid v-bind(STOP_CLUSTER_COLOR);
  background: #faf3f6;
  border-radius: 3px;
}

.cal-cluster-member-id {
  color: #666;
  font-weight: normal;
}
</style>
