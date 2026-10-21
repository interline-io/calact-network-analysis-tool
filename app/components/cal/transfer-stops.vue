<template>
  <!-- The stops the transfers are at: on a map to pick by where they are,
       and as a list to pick by name. -->
  <section class="cal-transfer-stops" aria-label="Stops and platforms">
    <cal-transfer-stops-map v-model="stops" :stops="mapStops" :fit-key="fitKey" />
    <div class="cal-transfer-stops-list">
      <cat-field :label="`Stops (${stops.length})`">
        <cat-taginput
          v-model="stops"
          :options="stopOptions"
          placeholder="Add a stop by name…"
          icon="plus"
          fullwidth
          size="small"
        />
      </cat-field>
      <p class="cal-transfer-stops-help">
        A cluster holds one stop per agency, so a station's other platforms
        may need adding.
        <template v-if="edited">
          Changed from the {{ subjectStopCount }} {{ subjectStopCount === 1 ? 'stop' : 'stops' }} it started with.
          <button type="button" class="cal-transfer-stops-reset" @click="$emit('reset')">
            Reset
          </button>
        </template>
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { TransferMapStop } from './transfer-stops-map.vue'

defineProps<{
  stopOptions: { value: number, label: string }[]
  mapStops: TransferMapStop[]
  // Frames the map anew when it changes: the subject.
  fitKey: string
  // Whether the stops differ from the subject's own, and how many those are.
  edited: boolean
  subjectStopCount: number
}>()

defineEmits<{
  // Back to the subject's own stops.
  reset: []
}>()

const stops = defineModel<number[]>({ required: true })
</script>

<style scoped lang="scss">
// The map at most of the width, the list beside it; one above the other on
// narrow screens.
.cal-transfer-stops {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(16rem, 2fr);
  gap: 0.75rem 1.5rem;
  padding: 0.75rem 1rem;
  margin-bottom: 0.75rem;
  border: 1px solid var(--bulma-border);
  border-radius: var(--bulma-radius);
  background: var(--bulma-scheme-main-bis);
  font-size: 0.875rem;
  flex: 0 0 auto;

  @media (max-width: 48rem) {
    grid-template-columns: minmax(0, 1fr);
  }
}

.cal-transfer-stops-list {
  min-width: 0;
  max-height: 17.5rem;
  overflow-y: auto;

  :deep(.field) {
    margin-bottom: 0.5rem;
  }
}

.cal-transfer-stops-help {
  color: var(--bulma-text-weak);
  font-size: 0.75rem;
}

.cal-transfer-stops-reset {
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  color: var(--bulma-link);
  cursor: pointer;
  text-decoration: underline;
}
</style>
