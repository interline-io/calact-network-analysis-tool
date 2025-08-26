<!-- Loading progress widget for modal dialogs -->
<template>
  <div class="scenario-loading">
    <!-- Progress Display -->
    <div class="progress-section">
      <h4>Progress</h4>
      <div class="progress-bar">
        <div
          class="progress-fill"
          :style="{ width: progressPercentage + '%' }"
        />
      </div>
      <p>
        {{ formatStage(progress?.currentStage || 'ready') }}
        <span v-if="progress?.feedVersionProgress">
          ({{ progress?.feedVersionProgress?.completed || 0 }}/{{ progress?.feedVersionProgress?.total || 0 }})
        </span>
      </p>
    </div>

    <!-- Error Display -->
    <tl-msg-error v-if="error">
      {{ typeof error === 'string' ? error : error?.message }}
    </tl-msg-error>

    <!-- Results Display -->
    <div class="columns">
      <div class="column">
        <tl-msg-info title="Stops" no-icon>
          <p><strong>{{ scenarioData?.stops.length }}</strong> loaded</p>
          <div v-if="scenarioData?.stops.length" class="stop-list">
            <div v-for="stop in scenarioData?.stops.slice(0, 5)" :key="stop.id" class="stop-item">
              {{ stop.stop_name }}
            </div>
            <div v-if="scenarioData?.stops.length > 5" class="more-label">
              ... and {{ scenarioData.stops.length - 5 }} more
            </div>
          </div>
        </tl-msg-info>
      </div>
      <div class="column">
        <tl-msg-info title="Routes" no-icon>
          <p><strong>{{ scenarioData?.routes.length }}</strong> loaded</p>
          <div v-if="scenarioData?.routes.length" class="route-list">
            <div v-for="route in scenarioData?.routes.slice(0, 5)" :key="route.id" class="route-item">
              {{ route.route_short_name || route.route_long_name }}
            </div>
            <div v-if="scenarioData?.routes.length > 5" class="more-label">
              ... and {{ scenarioData.routes.length - 5 }} more
            </div>
          </div>
        </tl-msg-info>
      </div>
      <div class="column">
        <tl-msg-info title="Departures" no-icon>
          <p><strong>{{ stopDepartureCount || 0 }}</strong> loaded</p>
        </tl-msg-info>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { ScenarioProgress } from '~/src/scenario/scenario-fetcher'
import type { ScenarioData } from '~/src/scenario/scenario'

// Props
const props = withDefaults(defineProps<{
  progress?: ScenarioProgress | null
  error?: Error | string | null
  scenarioData?: ScenarioData | null
  stopDepartureCount?: number
}>(), {
  progress: null,
  error: null,
  scenarioData: null,
})

// Computed values
const progressPercentage = computed(() => {
  if (!props.progress) return 0

  // Use feedVersionProgress for overall progress since it tracks stops + routes
  const feedProgress = props.progress.feedVersionProgress
  if (!feedProgress || feedProgress.total === 0) return 0

  return Math.round((feedProgress.completed / feedProgress.total) * 100)
})

// Helper functions
function formatStage (stage: ScenarioProgress['currentStage']): string {
  const stageLabels = {
    'feed-versions': 'Loading feed versions...',
    'stops': 'Loading stops...',
    'routes': 'Loading routes...',
    'schedules': 'Loading schedules...',
    'complete': 'Complete',
    'ready': 'Ready'
  }
  return stageLabels[stage] || stage
}
</script>

<style scoped>
.progress-section {
  margin-bottom: 1.5rem;
}

.progress-section h4 {
  margin: 0 0 0.75rem 0;
  color: #495057;
  font-size: 1.1rem;
}

.progress-bar {
  width: 100%;
  height: 16px;
  background-color: #e9ecef;
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 0.5rem;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #28a745, #20c997);
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 0.9rem;
  color: #6c757d;
  margin: 0;
}

.stop-list, .route-list {
  margin-top: 0.5rem;
}

.stop-item, .route-item {
  font-size: 0.85rem;
  color: #6c757d;
  margin-bottom: 0.2rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.more-label {
  font-size: 0.8rem;
  color: #adb5bd;
  font-style: italic;
  margin-top: 0.3rem;
}

.completion-status {
  background-color: #d4edda;
  color: #155724;
  padding: 0.75rem;
  border-radius: 4px;
  border: 1px solid #c3e6cb;
  text-align: center;
  font-weight: 500;
  font-size: 0.95rem;
}

/* Responsive adjustments for smaller modals */
@media (max-width: 600px) {
  .results-grid {
    grid-template-columns: 1fr;
  }
}
</style>
