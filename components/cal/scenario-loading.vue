<!-- Test page for streaming scenario implementation -->
<template>
  <div class="streaming-test">
    <tl-title>Streaming Loading Progress</tl-title>

    <!-- Progress Display -->
    <div v-if="progress" class="progress-section">
      <h3>Progress</h3>
      <div class="progress-bar">
        <div
          class="progress-fill"
          :style="{ width: progressPercentage + '%' }"
        />
      </div>
      <p>{{ progress.currentStage }} ({{ progress.feedVersionProgress?.completed }}/{{ progress.feedVersionProgress?.total }})</p>
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
          <h4>Stop Departure Events</h4>
          <p>{{ stopDepartureEventCount }} events loaded</p>
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
import { ScenarioDataReceiver, type ScenarioProgress } from '~/src/scenario/scenario-fetcher'
import { ScenarioStreamReceiver } from '~/src/scenario/scenario-streamer'
import { ScenarioConfigFromBboxName } from '~/src/scenario/scenario'
import type { StopGql } from '~/src/stop'
import type { RouteGql } from '~/src/route'

// Reactive state - directly in component
const isLoading = ref(false)
const progress = ref<ScenarioProgress | null>(null)
const error = ref<Error | null>(null)
const stops = ref<StopGql[]>([])
const routes = ref<RouteGql[]>([])
const stopDepartureEventCount = ref(0)
const isComplete = ref(false)

// Computed progress percentage
const progressPercentage = computed(() => {
  if (!progress.value) return 0

  // Use feedVersionProgress for overall progress since it tracks stops + routes
  const feedProgress = progress.value.feedVersionProgress
  if (!feedProgress || feedProgress.total === 0) return 0

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
