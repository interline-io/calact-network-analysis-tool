<template>
  <aside v-if="row" class="census-panel card">
    <header class="card-header census-panel-header">
      <div class="census-panel-title">
        <div class="census-panel-heading">
          {{ row.name || 'Aggregation area' }}
        </div>
        <div class="census-panel-sub">
          {{ layerLabel }}
        </div>
      </div>
      <button class="delete census-panel-close" aria-label="close" @click="$emit('close')" />
    </header>

    <div class="card-content census-panel-content">
      <section class="census-panel-summary">
        <div><strong>Stops:</strong> {{ row.stops_count ?? '—' }}</div>
        <div><strong>Routes:</strong> {{ row.routes_count ?? '—' }}</div>
        <div><strong>Agencies:</strong> {{ row.agencies_count ?? '—' }}</div>
        <div><strong>Stop visits:</strong> {{ row.visit_count_total ?? '—' }}</div>
      </section>

      <div class="census-panel-divider" />

      <section class="census-panel-list">
        <div
          v-for="col of orderedColumns"
          :key="col.id"
          class="census-panel-row"
          :class="{ 'is-highlighted': col.id === highlightedElement }"
        >
          <div class="census-panel-row-main">
            <div class="census-panel-row-label">
              {{ col.label }}
            </div>
            <div class="census-panel-row-value">
              {{ formatCensusValue(valueFor(col.id), col.format) }}
            </div>
          </div>
          <button
            v-if="col.id !== highlightedElement"
            class="button is-small is-light census-panel-visualize"
            :title="`Shade map by ${col.label}`"
            @click="$emit('visualize', col.id)"
          >
            Visualize
          </button>
        </div>
      </section>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  CENSUS_COLUMNS,
  type CensusColumnDef,
  formatCensusValue,
} from '~~/src/core'

/**
 * Right-side details panel for a clicked aggregation area (#302). Shows the
 * geography name, service summary, and every demographic element. The
 * currently-visualized element is hoisted to the top and highlighted, and
 * each other element has a "Visualize" action that switches the choropleth
 * to that element (Thomas's 3/4 feedback).
 *
 * `row` is the aggregated row from `stopGeoAggregateCsv` with derived census
 * columns merged in. Unset => panel not rendered.
 */
const props = defineProps<{
  row?: Record<string, any> | null
  highlightedElement?: string
  layerLabel?: string
}>()

defineEmits<{
  close: []
  visualize: [elementId: string]
}>()

const orderedColumns = computed((): CensusColumnDef[] => {
  const highlight = props.highlightedElement
  if (!highlight) {
    return CENSUS_COLUMNS
  }
  const match = CENSUS_COLUMNS.find(c => c.id === highlight)
  if (!match) {
    return CENSUS_COLUMNS
  }
  return [match, ...CENSUS_COLUMNS.filter(c => c.id !== highlight)]
})

function valueFor (id: string): number | null {
  const v = props.row?.[id]
  if (v === null || v === undefined) {
    return null
  }
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
</script>

<style scoped lang="scss">
.census-panel {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 300px;
  max-height: calc(100% - 32px);
  display: flex;
  flex-direction: column;
  z-index: 10;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.census-panel-header {
  background: var(--bulma-scheme-main-ter);
  padding: 10px 12px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  border-bottom: 1px solid var(--bulma-border);
  flex-shrink: 0;
}

.census-panel-title {
  flex: 1;
  min-width: 0;
}

.census-panel-heading {
  font-size: 15px;
  font-weight: 600;
  color: var(--bulma-text-strong);
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.census-panel-sub {
  font-size: 12px;
  color: var(--bulma-text-weak);
  margin-top: 2px;
}

.census-panel-close {
  position: relative;
  top: 2px;
  flex-shrink: 0;
}

.census-panel-content {
  padding: 12px;
  overflow-y: auto;
  flex: 1;
}

.census-panel-summary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 12px;
  font-size: 13px;
}

.census-panel-divider {
  border-top: 1px solid var(--bulma-border);
  margin: 10px 0;
}

.census-panel-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.census-panel-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  font-size: 13px;

  &.is-highlighted {
    background: #fff3cd;
    border: 1px solid #ffe082;
    font-weight: 600;
  }
}

.census-panel-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.census-panel-row-label {
  color: var(--bulma-text);
  overflow-wrap: anywhere;
}

.census-panel-row-value {
  font-variant-numeric: tabular-nums;
  color: var(--bulma-text-strong);
  white-space: nowrap;
}

.census-panel-visualize {
  font-size: 11px;
  padding: 0 8px;
  height: 22px;
}
</style>
