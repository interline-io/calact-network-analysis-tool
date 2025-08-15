<!-- Test page for streaming scenario implementation -->
<template>
  <div class="streaming-test">
    <tl-title>Streaming Scenario Test</tl-title>

    <o-field label="Preset bounding box">
      <o-select v-model="cannedBbox">
        <option v-for="[cannedBboxName, cannedBboxDetails] of cannedBboxes.entries()" :key="cannedBboxName" :value="cannedBboxName">
          {{ cannedBboxDetails.label }}
        </option>
      </o-select>
    </o-field>

    <o-field label="Actions" grouped>
      <o-button
        class="btn btn-primary"
        :disabled="isLoading"
        @click="testStreaming"
      >
        {{ isLoading ? 'Loading...' : 'Test Streaming Scenario' }}
      </o-button>

      <o-button
        class="btn btn-secondary"
        :disabled="!isLoading"
        @click="cancel"
      >
        Cancel
      </o-button>

      <o-button
        class="btn btn-outline"
        @click="clear"
      >
        Clear
      </o-button>
    </o-field>

    <!-- Progress Display -->
    <div v-if="progress" class="progress-section">
      <h3>Progress</h3>
      <div class="progress-bar">
        <div
          class="progress-fill"
          :style="{ width: progressPercentage + '%' }"
        />
      </div>
      <p>{{ progress.currentStage }} ({{ progress.feedVersionProgress.completed }}/{{ progress.feedVersionProgress.total }})</p>
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
import { ScenarioConfigFromBboxName } from '~/src/scenario'
import type { ScenarioProgress, ScenarioData, StopGql, RouteGql, AgencyGql } from '~/src/scenario-streaming'
import { StreamingScenarioClient } from '~/src/scenario-streaming'
import { cannedBboxes } from '~/src/constants'

// Reactive state - directly in component
const isLoading = ref(false)
const progress = ref<ScenarioProgress | null>(null)
const error = ref<Error | null>(null)
const stops = ref<StopGql[]>([])
const routes = ref<RouteGql[]>([])
const agencies = ref<AgencyGql[]>([])
const isComplete = ref(false)

// Client instance
const client = new StreamingScenarioClient()

const cannedBbox = ref('downtown-portland')

// Test function
const testStreaming = async () => {
  const testConfig = ScenarioConfigFromBboxName(cannedBbox.value)

  try {
    // Reset state
    clear()

    // Call fetchScenario with the new simplified callbacks
    const result = await client.fetchScenario(testConfig, {
      onProgress: (progressData: ScenarioProgress) => {
        progress.value = progressData

        // Accumulate incremental data from progress events
        if (progressData.partialData) {
          if (progressData.partialData.stops.length > 0) {
            stops.value.push(...progressData.partialData.stops)
          }
          if (progressData.partialData.routes.length > 0) {
            routes.value.push(...progressData.partialData.routes)
          }
        }
      },
      onComplete: (result: ScenarioData) => {
        // Final data is available in result
        stops.value = result.stops
        routes.value = result.routes

        // Extract agencies from routes (since ScenarioData doesn't have agencies directly)
        const agencyMap = new Map<string, AgencyGql>()
        result.routes.forEach((route) => {
          if (route.agency) {
            agencyMap.set(route.agency.agency_id, route.agency)
          }
        })
        agencies.value = Array.from(agencyMap.values())

        isComplete.value = true
        isLoading.value = false
      },
      onError: (err: any) => {
        error.value = err
        isLoading.value = false
      }
    })

    // Note: result is also returned from fetchScenario if needed
    console.log('Final scenario result:', result)
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
  if (!progress.value) return 0

  // Use feedVersionProgress for overall progress since it tracks stops + routes
  const feedProgress = progress.value.feedVersionProgress
  if (feedProgress.total === 0) return 0

  return Math.round((feedProgress.completed / feedProgress.total) * 100)
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
