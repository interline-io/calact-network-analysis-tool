<template>
  <aside v-if="row" class="census-panel card">
    <header class="card-header census-panel-header">
      <div class="census-panel-title">
        <div class="census-panel-heading">
          {{ row.name || 'Aggregation area' }}
        </div>
        <div v-if="layerLabel" class="census-panel-sub">
          {{ layerLabel }}
        </div>
      </div>
      <div class="census-panel-header-actions">
        <button
          type="button"
          class="census-panel-iconbtn"
          :aria-label="collapsed ? 'Expand' : 'Collapse'"
          :title="collapsed ? 'Expand' : 'Collapse'"
          @click="collapsed = !collapsed"
        >
          <cat-icon :icon="collapsed ? 'chevron-down' : 'chevron-up'" size="small" />
        </button>
        <button
          type="button"
          class="delete census-panel-close"
          aria-label="close"
          @click="$emit('close')"
        />
      </div>
    </header>

    <div v-if="!collapsed" class="card-content census-panel-content">
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
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
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
 * highlighted. Collapsible via chevron toggle. Closed via the delete X.
 *
 * `row` is the aggregated row from `stopGeoAggregateCsv` with derived census
 * columns merged in. `bboxDerived` is the pre-computed bbox aggregate, or
 * null if not available (e.g. tableDatasetName not set on the scenario).
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

const collapsed = ref(false)

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
.census-panel {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 340px;
  max-height: calc(100% - 280px); // Leave space for the legend below
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
  font-size: 14px;
  font-weight: 600;
  color: var(--bulma-text-strong);
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.census-panel-sub {
  font-size: 11px;
  color: var(--bulma-text-weak);
  margin-top: 2px;
}

.census-panel-header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.census-panel-iconbtn {
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 2px 4px;
  color: var(--bulma-text);

  &:hover {
    color: var(--bulma-text-strong);
  }
}

.census-panel-close {
  position: relative;
}

.census-panel-content {
  padding: 0;
  overflow-y: auto;
  flex: 1;
}

.census-panel-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;

  th, td {
    padding: 6px 10px;
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
}
</style>
