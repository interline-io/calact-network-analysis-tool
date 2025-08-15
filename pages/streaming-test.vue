<!-- Test page for streaming scenario implementation -->
<template>
  <div class="streaming-test">
    <h1>Streaming Scenario Test</h1>

    <div class="controls">
      <button
        class="btn btn-primary"
        :disabled="isLoading"
        @click="testStreaming"
      >
        {{ isLoading ? 'Loading...' : 'Test Streaming Scenario' }}
      </button>

      <button
        class="btn btn-secondary"
        :disabled="!isLoading"
        @click="cancel"
      >
        Cancel
      </button>

      <button
        class="btn btn-outline"
        @click="clear"
      >
        Clear
      </button>
    </div>

    <!-- Progress Display -->
    <div v-if="progress" class="progress-section">
      <h3>Progress</h3>
      <div class="progress-bar">
        <div
          class="progress-fill"
          :style="{ width: progressPercentage + '%' }"
        />
      </div>
      <p>{{ progress.message }} ({{ progress.current }}/{{ progress.total }})</p>
    </div>

    <!-- Error Display -->
    <div v-if="error" class="error-section">
      <h3>Error</h3>
      <p class="error-message">
        {{ error.message }}
      </p>
    </div>

    <!-- Results Display -->
    <div class="results-section">
      <h3>Results</h3>
      <div class="results-grid">
        <div class="result-card">
          <h4>Stops</h4>
          <p>{{ stops.length }} stops loaded</p>
          <div v-if="stops.length > 0" class="preview">
            <div v-for="stop in stops.slice(0, 3)" :key="stop.id" class="preview-item">
              {{ stop.stop_name }} ({{ stop.stop_id }})
            </div>
          </div>
        </div>

        <div class="result-card">
          <h4>Routes</h4>
          <p>{{ routes.length }} routes loaded</p>
          <div v-if="routes.length > 0" class="preview">
            <div v-for="route in routes.slice(0, 3)" :key="route.id" class="preview-item">
              {{ route.route_short_name }} - {{ route.route_long_name }}
            </div>
          </div>
        </div>

        <div class="result-card">
          <h4>Agencies</h4>
          <p>{{ agencies.length }} agencies loaded</p>
          <div v-if="agencies.length > 0" class="preview">
            <div v-for="agency in agencies.slice(0, 3)" :key="agency.id" class="preview-item">
              {{ agency.agency_name }} ({{ agency.agency_id }})
            </div>
          </div>
        </div>
      </div>

      <div v-if="isComplete" class="completion-status">
        ✅ Scenario loading complete!
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref } from 'vue'
import {
  StreamingScenarioClient,
  type ScenarioStreamingProgress,
  type StopGql,
  type RouteGql,
  type AgencyGql
} from '~/src/streaming/scenario'

// Reactive state - directly in component
const isLoading = ref(false)
const progress = ref<ScenarioStreamingProgress | null>(null)
const error = ref<Error | null>(null)
const stops = ref<StopGql[]>([])
const routes = ref<RouteGql[]>([])
const agencies = ref<AgencyGql[]>([])
const isComplete = ref(false)

// Client instance
const client = new StreamingScenarioClient()

// Test function
const testStreaming = async () => {
  const testConfig = {
    bbox: {
      sw: { lon: -122.5, lat: 37.7 },
      ne: { lon: -122.3, lat: 37.8 },
      valid: true
    },
    scheduleEnabled: true,
    startDate: new Date('2024-01-01'),
    endDate: new Date('2024-01-07')
  }

  try {
    // Reset state
    isLoading.value = true
    error.value = null
    progress.value = null
    stops.value = []
    routes.value = []
    agencies.value = []
    isComplete.value = false

    // Call fetchScenario directly with callbacks
    await client.fetchScenario(testConfig, {
      onProgress: (progressData) => {
        progress.value = progressData
      },
      onStopsComplete: (stopsData) => {
        stops.value = stopsData
      },
      onRoutesComplete: (routesData, agenciesData) => {
        routes.value = routesData
        agencies.value = agenciesData
      },
      onDeparturesComplete: (_result) => {
        isComplete.value = true
        isLoading.value = false
      },
      onError: (err) => {
        error.value = err
        isLoading.value = false
      }
    })
  } catch (err: any) {
    error.value = err
    isLoading.value = false
  }
}

// Cancel current request
const cancel = () => {
  client.cancel()
  isLoading.value = false
}

// Clear all data
const clear = () => {
  stops.value = []
  routes.value = []
  agencies.value = []
  progress.value = null
  error.value = null
  isComplete.value = false
  isLoading.value = false
}

// Computed progress percentage
const progressPercentage = computed(() => {
  if (!progress.value || progress.value.total === 0) return 0
  return Math.round((progress.value.current / progress.value.total) * 100)
})
</script>

<style scoped>
.streaming-test {
  padding: 2rem;
  max-width: 1200px;
  margin: 0 auto;
}

.controls {
  display: flex;
  gap: 1rem;
  margin-bottom: 2rem;
}

.btn {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 1rem;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-primary {
  background-color: #007bff;
  color: white;
}

.btn-secondary {
  background-color: #6c757d;
  color: white;
}

.btn-outline {
  background-color: transparent;
  color: #007bff;
  border: 1px solid #007bff;
}

.progress-section {
  margin-bottom: 2rem;
}

.progress-bar {
  width: 100%;
  height: 20px;
  background-color: #e9ecef;
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 0.5rem;
}

.progress-fill {
  height: 100%;
  background-color: #28a745;
  transition: width 0.3s ease;
}

.error-section {
  margin-bottom: 2rem;
}

.error-message {
  color: #dc3545;
  background-color: #f8d7da;
  padding: 1rem;
  border-radius: 4px;
  border: 1px solid #f5c6cb;
}

.results-section {
  margin-bottom: 2rem;
}

.results-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 1rem;
  margin-bottom: 1rem;
}

.result-card {
  background-color: #f8f9fa;
  padding: 1rem;
  border-radius: 4px;
  border: 1px solid #dee2e6;
}

.result-card h4 {
  margin: 0 0 0.5rem 0;
  color: #495057;
}

.preview {
  margin-top: 0.5rem;
}

.preview-item {
  font-size: 0.875rem;
  color: #6c757d;
  margin-bottom: 0.25rem;
}

.completion-status {
  background-color: #d4edda;
  color: #155724;
  padding: 1rem;
  border-radius: 4px;
  border: 1px solid #c3e6cb;
  text-align: center;
  font-weight: bold;
}
</style>
