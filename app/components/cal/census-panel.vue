<template>
  <div v-if="row" class="cal-map-census-panel">
    <cat-msg
      :title="row.name || 'Aggregation area'"
      expandable
      closable
      :open="true"
      variant="dark"
      @close="$emit('close')"
    >
      <div class="census-panel-geoid">
        <span class="census-panel-geoid-label">{{ layerLabel || 'GEOID' }}:</span>
        <span class="census-panel-geoid-value">{{ row.geoid }}</span>
      </div>

      <table class="census-panel-table">
        <thead>
          <tr>
            <th>Statistic</th>
            <th>Value</th>
            <th>Bounding Box</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="col of orderedColumns"
            :key="col.id"
            :class="{ 'is-highlighted': col.id === highlightedElement }"
          >
            <td>{{ col.label }}</td>
            <td class="census-panel-num">
              {{ formatCensusValue(valueFor(col.id), col.format) }}
            </td>
            <td class="census-panel-num">
              {{ bboxCell(col) }}
            </td>
          </tr>
        </tbody>
      </table>
    </cat-msg>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  CENSUS_COLUMNS,
  NON_ADDITIVE_CENSUS_COLUMNS,
  type CensusColumnDef,
  formatCensusValue,
} from '~~/src/core'

/**
 * Right-side census details panel for a clicked aggregation area (#302,
 * per Nome's wireframe). Three-column table: Statistic / Value (the clicked
 * geography) / Bounding Box (same statistic summed across the query bbox).
 * The element currently used for map shading is hoisted to the top and
 * highlighted.
 *
 * Chrome is rendered via `<cat-msg>` with `variant="dark"` so this panel
 * matches the existing map legend exactly; collapse and close are built-in.
 *
 * Positioning is owned by the parent `.cal-map-sidebar` stack (in
 * `cal-map.vue`); this component does not position itself.
 */
const props = defineProps<{
  row?: Record<string, any> | null
  highlightedElement?: string
  layerLabel?: string
  bboxDerived?: Record<string, number | null> | null
}>()

defineEmits<{
  close: []
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

function bboxCell (col: CensusColumnDef): string {
  if (NON_ADDITIVE_CENSUS_COLUMNS.has(col.id)) {
    return '—'
  }
  if (!props.bboxDerived) {
    return '—'
  }
  return formatCensusValue(props.bboxDerived[col.id] ?? null, col.format)
}
</script>

<style scoped lang="scss">
.cal-map-census-panel {
  color: black;
}

.census-panel-geoid {
  font-size: 12px;
  margin-bottom: 10px;
  opacity: 0.85;
}

.census-panel-geoid-label {
  font-weight: 600;
  margin-right: 4px;
}

.census-panel-geoid-value {
  font-variant-numeric: tabular-nums;
}

.census-panel-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;

  th, td {
    padding: 6px 8px;
    text-align: left;
    border-bottom: 1px solid var(--bulma-border);
  }

  th {
    background: var(--bulma-scheme-main-bis);
    font-weight: 600;
    color: var(--bulma-text-strong);
    position: sticky;
    top: 0;
  }

  tr.is-highlighted td {
    background: #fff3cd;
    font-weight: 600;
  }
}

.census-panel-num {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  text-align: right;
}
</style>
