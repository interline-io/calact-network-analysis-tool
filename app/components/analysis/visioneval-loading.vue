<!-- Loading progress widget for VisionEval analysis -->
<template>
  <div class="visioneval-loading">
    <!-- Progress Display -->
    <div class="progress-section">
      <div class="progress-bar">
        <div
          class="progress-fill"
          :class="{ 'is-complete': progress?.currentStage === 'complete' }"
          :style="{ width: progressWidth }"
        />
      </div>

      <p class="progress-text">
        {{ progressMessage }}
      </p>
    </div>

    <!-- Error Display -->
    <t-msg v-if="error" variant="danger" class="mt-4">
      {{ typeof error === 'string' ? error : error?.message }}
    </t-msg>

    <!-- Stats Display -->
    <div v-if="progress?.fetchedCount || progress?.filteredCount" class="stats-section">
      <div class="columns">
        <div class="column">
          <div class="stat-box">
            <div class="stat-value">
              {{ (progress?.fetchedCount || 0).toLocaleString() }}
            </div>
            <div class="stat-label">
              Records Scanned
            </div>
          </div>
        </div>
        <div class="column">
          <div class="stat-box">
            <div class="stat-value">
              {{ (progress?.filteredCount || 0).toLocaleString() }}
            </div>
            <div class="stat-label">
              Records Matched
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Completion Status -->
    <div v-if="progress?.currentStage === 'complete' && !error" class="completion-status">
      <t-icon icon="check-circle" class="mr-2" />
      Analysis completed successfully!
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { VisionEvalProgress } from '~~/src/analysis/visioneval'

const props = defineProps<{
  progress?: VisionEvalProgress
  error?: Error | string
}>()

const progressMessage = computed(() => {
  if (!props.progress) { return 'Initializing...' }

  if (props.progress.message) {
    return props.progress.message
  }

  const stageLabels: Record<string, string> = {
    ready: 'Initializing...',
    fetching: 'Fetching NTD data...',
    processing: 'Processing records...',
    complete: 'Complete',
    error: 'Error occurred',
  }
  return stageLabels[props.progress.currentStage] || 'Loading...'
})

const progressWidth = computed(() => {
  if (!props.progress) { return '5%' }

  switch (props.progress.currentStage) {
    case 'ready':
      return '5%'
    case 'fetching':
      return '50%'
    case 'processing':
      return '80%'
    case 'complete':
      return '100%'
    case 'error':
      return '100%'
    default:
      return '10%'
  }
})
</script>

<style scoped>
.visioneval-loading {
  padding: 0.5rem 0;
}

.progress-section {
  margin-bottom: 1rem;
}

.progress-bar {
  width: 100%;
  height: 12px;
  background-color: #e9ecef;
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 0.5rem;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #3273dc, #209cee);
  transition: width 0.3s ease;
}

.progress-fill.is-complete {
  background: linear-gradient(90deg, #28a745, #20c997);
}

.progress-text {
  font-size: 0.9rem;
  color: #6c757d;
  margin: 0;
}

.stats-section {
  margin: 1rem 0;
}

.stat-box {
  background-color: #f8f9fa;
  border-radius: 6px;
  padding: 0.75rem;
  text-align: center;
}

.stat-value {
  font-size: 1.5rem;
  font-weight: 600;
  color: #3273dc;
}

.stat-label {
  font-size: 0.8rem;
  color: #6c757d;
  margin-top: 0.25rem;
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

.completion-status .o-icon {
  color: #28a745;
  vertical-align: middle;
}
</style>
