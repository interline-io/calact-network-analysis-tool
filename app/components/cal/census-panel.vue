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
      <div class="cal-census-panel-meta">
        <div>
          <span class="cal-census-panel-meta-label">{{ layerLabel || 'GEOID' }}:</span>
          <span class="cal-census-panel-meta-value">{{ row.geoid }}</span>
        </div>
        <div v-if="areaStats && areaStats.geometryArea !== null">
          <span class="cal-census-panel-meta-label">Area:</span>
          <span class="cal-census-panel-meta-value">{{ formatArea(areaStats.geometryArea) }}</span>
        </div>
        <div v-if="areaStats && areaStats.intersectionArea !== null">
          <span class="cal-census-panel-meta-label">Intersection:</span>
          <span class="cal-census-panel-meta-value">
            {{ formatArea(areaStats.intersectionArea) }}
            <span v-if="areaStats.intersectionRatio !== null" class="cal-census-panel-meta-pct">
              ({{ (areaStats.intersectionRatio * 100).toFixed(0) }}%)
            </span>
          </span>
        </div>
      </div>

      <table class="cal-census-panel-table">
        <thead>
          <tr>
            <th>Statistic</th>
            <th>
              <cat-tooltip text="The full raw ACS value for this geography — not scaled by the intersection with the query area.">
                Full Geography
                <cat-icon size="small" icon="information" />
              </cat-tooltip>
            </th>
            <th>
              <cat-tooltip text="This geography's raw ACS value scaled by its intersection with the query area. Ratios (% columns) and medians are unchanged.">
                Intersection
                <cat-icon size="small" icon="information" />
              </cat-tooltip>
            </th>
            <th>
              <cat-tooltip text="Sum of every geography's Intersection value across the query area. This is the apportioned total, not the sum of the full geographies. Medians are not summable and render as —.">
                Query Area Total
                <cat-icon size="small" icon="information" />
              </cat-tooltip>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="col of orderedColumns"
            :key="col.id"
            :class="{ 'is-highlighted': col.id === highlightedElement }"
          >
            <td>{{ col.label }}</td>
            <td class="cal-census-panel-num">
              {{ formatCensusValue(valueFor(col.id), col.format) }}
            </td>
            <td class="cal-census-panel-num">
              {{ intersectionCell(col) }}
            </td>
            <td class="cal-census-panel-num">
              {{ allGeographiesCell(col) }}
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
  formatArea,
  formatCensusValue,
} from '~~/src/core'

const props = defineProps<{
  row?: Record<string, any> | null
  highlightedElement?: string
  layerLabel?: string
  apportionedDerived?: Record<string, number | null> | null
  allDerived?: Record<string, number | null> | null
  areaStats?: {
    geometryArea: number | null
    intersectionArea: number | null
    intersectionRatio: number | null
  } | null
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

function intersectionCell (col: CensusColumnDef): string {
  if (!props.apportionedDerived) {
    return '—'
  }
  return formatCensusValue(props.apportionedDerived[col.id] ?? null, col.format)
}

function allGeographiesCell (col: CensusColumnDef): string {
  if (NON_ADDITIVE_CENSUS_COLUMNS.has(col.id)) {
    return '—'
  }
  if (!props.allDerived) {
    return '—'
  }
  return formatCensusValue(props.allDerived[col.id] ?? null, col.format)
}
</script>

<style scoped lang="scss">
.cal-map-census-panel {
  color: black;
}

.cal-map-census-panel :deep(.message-body) {
  padding: 8px 10px;
}

.cal-census-panel-meta {
  font-size: 12px;
  margin-bottom: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cal-census-panel-meta-label {
  font-weight: 600;
  margin-right: 4px;
}

.cal-census-panel-meta-value {
  font-variant-numeric: tabular-nums;
}

.cal-census-panel-meta-pct {
  opacity: 0.7;
}

.cal-census-panel-table {
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

.cal-census-panel-num {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  text-align: right;
}
</style>
