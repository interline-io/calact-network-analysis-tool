<!-- Flexible analysis progress checklist widget -->
<template>
  <div class="analysis-progress">
    <!-- Analysis Title -->
    <div class="analysis-header mb-4">
      <h3 class="title is-4">
        {{ title }}
      </h3>
      <p v-if="isLoading" class="subtitle is-6">
        {{ getCurrentStageLabel() }}
      </p>
    </div>

    <!-- Progress Checklist -->
    <div class="progress-checklist">
      <div
        v-for="stage in stages"
        :key="stage.id"
        class="progress-item"
        :class="getItemClass(stage)"
      >
        <div class="progress-icon">
          <o-icon
            v-if="stage.status === 'complete'"
            icon="check-circle"
            variant="success"
          />
          <o-icon
            v-else-if="stage.status === 'error'"
            icon="alert-circle"
            variant="danger"
          />
          <o-icon
            v-else-if="stage.status === 'in-progress'"
            icon="loading"
            variant="info"
            spin
          />
          <o-icon
            v-else
            icon="circle-outline"
            class="has-text-grey-light"
          />
        </div>
        <span class="progress-label">{{ stage.label }}</span>
      </div>
    </div>

    <!-- Error Display -->
    <tl-msg-error v-if="error" class="mt-4">
      {{ error }}
    </tl-msg-error>

    <!-- Completion Status -->
    <div v-if="!isLoading && !error" class="completion-status mt-4">
      <o-icon icon="check-circle" variant="success" class="mr-2" />
      Analysis completed successfully!
    </div>

    <!-- Additional Content Slot -->
    <slot name="additional-content" />
  </div>
</template>

<script lang="ts" setup>
export interface AnalysisStage {
  id: string
  label: string
  status: 'pending' | 'in-progress' | 'complete' | 'error'
}

// Props
const props = withDefaults(defineProps<{
  title: string
  stages: AnalysisStage[]
  currentStageId?: string
  isLoading: boolean
  error?: string | null
}>(), {
  error: null,
})

// Helper functions
function getCurrentStageLabel (): string {
  const currentStage = props.stages.find(s => s.id === props.currentStageId)
  return currentStage?.label || 'Processing...'
}

function getItemClass (stage: AnalysisStage): string[] {
  const classes: string[] = []

  if (stage.status === 'complete') {
    classes.push('is-complete')
  } else if (stage.status === 'in-progress') {
    classes.push('is-active')
  } else if (stage.status === 'error') {
    classes.push('is-error')
  }

  return classes
}
</script>

<style scoped>
.analysis-header {
  text-align: center;
}

.progress-checklist {
  max-width: 500px;
  margin: 0 auto;
}

.progress-item {
  display: flex;
  align-items: center;
  padding: 0.75rem 1rem;
  margin-bottom: 0.5rem;
  border-radius: 6px;
  transition: all 0.2s ease;
  background-color: #fafafa;
}

.progress-item.is-active {
  background-color: #f0f8ff;
  border-left: 3px solid #3273dc;
}

.progress-item.is-complete {
  background-color: #f0fff0;
  border-left: 3px solid #48c774;
}

.progress-item.is-error {
  background-color: #fff5f5;
  border-left: 3px solid #f14668;
}

.progress-icon {
  margin-right: 0.75rem;
  font-size: 1.25rem;
}

.progress-label {
  font-weight: 500;
  color: #4a4a4a;
}

.progress-item.is-active .progress-label {
  color: #3273dc;
  font-weight: 600;
}

.progress-item.is-complete .progress-label {
  color: #48c774;
}

.progress-item.is-error .progress-label {
  color: #f14668;
}

.completion-status {
  text-align: center;
  padding: 1rem;
  background-color: #f0fff0;
  border-radius: 6px;
  color: #48c774;
  font-weight: 500;
}

/* Oruga handles spinner animation with the 'spin' prop */
</style>
