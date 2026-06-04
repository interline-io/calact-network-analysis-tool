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
        {{ formatStage(progress?.currentStage || 'ready', progress?.currentStageMessage || '') }}
        <span v-if="progressPercentage > 0">
          ({{ progressPercentage }}%)
        </span>
      </p>
    </div>

    <!-- Error Display -->
    <cat-msg v-if="error" variant="danger">
      {{ typeof error === 'string' ? error : error?.message }}
    </cat-msg>

    <!-- Completion Status -->
    <div v-if="progress?.currentStage === 'complete' && !error" class="completion-status">
      <cat-icon icon="check-circle" class="mr-2" />
      Scenario data loading completed successfully!
    </div>

    <!-- Results Display -->
    <div class="columns is-multiline">
      <div class="column is-one-quarter">
        <cat-msg variant="info" title="Stops">
          <p><strong>{{ scenarioData?.stops.length || 0 }}</strong> loaded</p>
          <div v-if="scenarioData?.stops.length" class="stop-list">
            <div v-for="stop in scenarioData?.stops.slice(0, 5)" :key="stop.id" class="stop-item">
              {{ stop.stop_name }}
            </div>
            <div v-if="scenarioData?.stops.length > 5" class="more-label">
              ... and {{ scenarioData.stops.length - 5 }} more
            </div>
          </div>
        </cat-msg>
      </div>
      <div class="column is-one-quarter">
        <cat-msg variant="info" title="Routes">
          <p><strong>{{ scenarioData?.routes.length || 0 }}</strong> loaded</p>
          <div v-if="scenarioData?.routes.length" class="route-list">
            <div v-for="route in scenarioData?.routes.slice(0, 5)" :key="route.id" class="route-item">
              {{ route.route_short_name || route.route_long_name }}
            </div>
            <div v-if="scenarioData?.routes.length > 5" class="more-label">
              ... and {{ scenarioData.routes.length - 5 }} more
            </div>
          </div>
        </cat-msg>
      </div>
      <div class="column is-one-quarter">
        <cat-msg variant="info" title="Departures">
          <p><strong>{{ stopsWithDepartures }}</strong> / {{ totalStops }} stops</p>
          <div class="more-label">
            {{ (stopDepartureCount || 0).toLocaleString() }} total departures
          </div>
        </cat-msg>
      </div>
      <div class="column is-one-quarter">
        <cat-msg variant="info" title="Flex Areas">
          <p><strong>{{ scenarioData?.flexAreas?.length || 0 }}</strong> loaded</p>
          <div v-if="scenarioData?.flexAreas?.length" class="flex-list">
            <div v-for="area in scenarioData?.flexAreas.slice(0, 5)" :key="area.id" class="flex-item">
              {{ area.properties.location_name || area.properties.location_id }}
            </div>
            <div v-if="scenarioData?.flexAreas.length > 5" class="more-label">
              ... and {{ scenarioData.flexAreas.length - 5 }} more
            </div>
          </div>
        </cat-msg>
      </div>
      <!-- Full-width row below the four stage columns: the buffer passes run
           after the other stages, and a fifth column crowds the layout. -->
      <div v-if="demographicsActive" class="column is-full">
        <cat-msg variant="info" title="Demographics">
          <div class="demographics-passes">
            <div v-for="pass of demographicsPasses" :key="pass.stage" class="demographics-pass">
              <cat-icon
                size="small"
                :icon="pass.status === 'done' ? 'check-circle' : pass.status === 'in-progress' ? 'loading' : 'circle-outline'"
              />
              {{ pass.label }}<span v-if="pass.count > 0">&nbsp;({{ pass.count.toLocaleString() }})</span>
            </div>
          </div>
        </cat-msg>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { ScenarioProgress, ScenarioData } from '~~/src/scenario'

// Props
const props = withDefaults(defineProps<{
  progress?: ScenarioProgress
  error?: Error | string
  scenarioData?: ScenarioData
  stopDepartureCount?: number
  // Whether buffer demographics load this run (#315) — shows the
  // Demographics column and folds buffer chunks into the progress bar.
  demographicsActive?: boolean
}>(), {})

// Computed values
const progressPercentage = computed(() => {
  if (!props.progress) { return 0 }
  // Add feed version progress + stop departure progress + buffer progress
  let total = 0
  let completed = 0
  if (props.progress.feedVersionProgress) {
    total += props.progress.feedVersionProgress.total
    completed += props.progress.feedVersionProgress.completed
  }
  if (props.progress.stopDepartureProgress) {
    total += props.progress.stopDepartureProgress.total
    completed += props.progress.stopDepartureProgress.completed
  }
  if (props.progress.bufferProgress) {
    total += props.progress.bufferProgress.total
    completed += props.progress.bufferProgress.completed
  }
  return Math.round((completed / total) * 100)
})

// Buffer-pass order matches runBufferPasses (C/D/E/F).
const BUFFER_STAGE_ORDER = [
  'stop-buffer-geographies',
  'route-buffer-geographies',
  'agency-buffer-geographies',
  'aggregation-buffer-geographies',
] as const

type PassStatus = 'pending' | 'in-progress' | 'done'

// Per-pass status rows for the Demographics column. A pass counts as done
// once a later pass is active/complete or the whole run finished — counts
// alone aren't enough because a pass can legitimately return no rows.
const demographicsPasses = computed((): { label: string, stage: string, count: number, status: PassStatus }[] => {
  const stage = props.progress?.currentStage
  const stageIndex = BUFFER_STAGE_ORDER.indexOf(stage as typeof BUFFER_STAGE_ORDER[number])
  // Not 'ready': the buffer-only refetch initializes progress at 'ready'
  // before any stream events arrive — passes are pending then, not done.
  const runDone = stage === 'complete'
  const counts = [
    props.scenarioData?.stopBufferGeographies?.size ?? 0,
    props.scenarioData?.routeBufferGeographies?.size ?? 0,
    props.scenarioData?.agencyBufferGeographies?.size ?? 0,
    props.scenarioData?.aggregationBufferGeographies?.length ?? 0,
  ]
  const labels = ['Stops', 'Routes', 'Agencies', 'Aggregation']
  return BUFFER_STAGE_ORDER.map((passStage, i) => {
    let status: PassStatus = 'pending'
    if (runDone || (stageIndex >= 0 && i < stageIndex) || ((counts[i] ?? 0) > 0 && stageIndex !== i)) {
      status = 'done'
    } else if (stageIndex === i) {
      status = 'in-progress'
    }
    return { label: labels[i] ?? '', stage: passStage, count: counts[i] ?? 0, status }
  })
})

// Total number of stops loaded
const totalStops = computed(() => {
  return props.scenarioData?.stops?.length || 0
})

// Number of stops that have departures loaded (stops in the departure cache)
const stopsWithDepartures = computed(() => {
  return props.scenarioData?.stopDepartureCache?.cache?.size || 0
})

// Helper functions
function formatStage (stage: ScenarioProgress['currentStage'], stageText: string): string {
  if (stageText) {
    return stageText
  }
  const stageLabels: Record<string, string> = {
    'feed-versions': 'Loading feed versions...',
    'stops': 'Loading stops...',
    'routes': 'Loading routes...',
    'schedules': 'Loading schedules...',
    'flex-areas': 'Loading flex service areas...',
    'census-values': 'Loading census data...',
    'stop-buffer-geographies': 'Loading per-stop buffer demographics...',
    'route-buffer-geographies': 'Loading per-route buffer demographics...',
    'agency-buffer-geographies': 'Loading per-agency buffer demographics...',
    'aggregation-buffer-geographies': 'Loading aggregation buffer demographics...',
    'complete': 'Complete',
    'ready': 'Ready',
  }
  return stageLabels[stage] || 'Loading...'
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

.stop-list, .route-list, .flex-list {
  margin-top: 0.5rem;
}

.demographics-passes {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 2rem;
}

.demographics-pass {
  font-size: 0.85rem;
  color: #6c757d;
  display: flex;
  align-items: center;
  gap: 0.3rem;
  white-space: nowrap;
}

.stop-item, .route-item, .flex-item {
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
  margin-bottom: 1rem;
}

.completion-status .o-icon {
  color: #28a745;
  vertical-align: middle;
}

/* Responsive adjustments for smaller modals */
@media (max-width: 600px) {
  .results-grid {
    grid-template-columns: 1fr;
  }
}
</style>
