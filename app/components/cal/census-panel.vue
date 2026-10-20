<template>
  <div v-if="row" class="cal-sidebar-panel cal-map-census-panel">
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
        <div v-if="geography">
          <span class="cal-census-panel-meta-label">Area:</span>
          <span class="cal-census-panel-meta-value">{{ formatArea(geography.geometryArea, unitSystem) }}</span>
        </div>
        <div v-for="part of areaParts" :key="part.label">
          <span class="cal-census-panel-meta-label">{{ part.label }}:</span>
          <span class="cal-census-panel-meta-value">
            {{ formatArea(part.area, unitSystem, geography?.geometryArea) }}
            <span class="cal-census-panel-meta-pct">({{ formatCensusValue(part.ratio, 'percent') }})</span>
          </span>
        </div>
      </div>

      <div class="cal-census-panel-actions">
        <a href="#" @click.prevent="$emit('viewDetails')">
          View census details for this area →
        </a>
      </div>

      <cat-tabs v-model="activeTab" expanded>
        <cat-tab-item
          v-for="(tab, i) of tabs"
          :key="tab.label"
          :value="i"
          :label="tab.label"
        >
          <table class="cal-census-panel-table">
            <caption class="is-sr-only">
              {{ tab.caption }}
            </caption>
            <thead>
              <tr>
                <th>Statistic</th>
                <th v-for="column of tab.columns" :key="column.label">
                  <cat-tooltip :text="column.tooltip">
                    {{ column.label }}
                    <cat-icon icon="information" />
                  </cat-tooltip>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="col of CENSUS_COLUMNS"
                :key="col.id"
                :class="{ 'is-highlighted': col.id === choroplethElement }"
              >
                <td>
                  <span v-if="col.id === choroplethElement">{{ col.label }}</span>
                  <button
                    v-else
                    type="button"
                    class="cal-census-panel-stat-link"
                    title="Shade map by this statistic"
                    @click="choroplethElement = col.id"
                  >
                    {{ col.label }}
                  </button>
                </td>
                <td v-for="column of tab.columns" :key="column.label" class="cal-census-panel-num">
                  {{ cell(column.values, col, tab.summed) }}
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="tab.note" class="cal-census-panel-note">
            {{ tab.note }}
          </p>
        </cat-tab-item>
      </cat-tabs>
    </cat-msg>
  </div>
</template>

<script setup lang="ts">
import {
  CENSUS_COLUMNS,
  NON_ADDITIVE_CENSUS_COLUMNS,
  type CensusColumnDef,
  type CensusPanelAnalysisArea,
  type CensusPanelGeography,
  type CensusPanelValues,
  formatArea,
  formatCensusValue,
} from '~~/src/core'

const props = defineProps<{
  row?: Record<string, any> | null
  layerLabel?: string
  geography?: CensusPanelGeography | null
  analysisArea?: CensusPanelAnalysisArea | null
}>()

defineEmits<{
  close: []
  viewDetails: []
}>()

const { choroplethElement, unitSystem } = useScenarioDisplay()

const activeTab = ref(0)

interface PanelColumn {
  label: string
  tooltip: string
  values: CensusPanelValues | null | undefined
}

interface PanelTab {
  label: string
  caption: string
  columns: PanelColumn[]
  // Summed across geographies, so medians can't be shown.
  summed: boolean
  note: string | null
}

const UNCHANGED = 'Ratios (% rows) and medians are unchanged.'

const { stopBufferRadius } = useScenarioInputs()

// Why the Inside and Outside columns are empty: no radius, or a radius with no
// stops to buffer or failed clip requests.
const noBuffersNote = computed((): string => stopBufferRadius.value > 0
  ? 'This run has no stop buffers: it found no fixed-route stops, or the stop buffer requests failed.'
  : 'Set a stop buffer radius to split these values inside and outside the stop buffers.')

// The geography's share of the query area, then its parts inside and outside
// the stop buffers, when the run has them.
const areaParts = computed((): { label: string, area: number, ratio: number }[] => {
  const geo = props.geography
  if (!geo) {
    return []
  }
  const parts = [{ label: 'In query area', area: geo.queryArea, ratio: geo.queryAreaRatio }]
  if (geo.inside) {
    parts.push({ label: 'Inside stop buffers', area: geo.inside.area, ratio: geo.inside.ratio })
  }
  if (geo.outside) {
    parts.push({ label: 'Outside stop buffers', area: geo.outside.area, ratio: geo.outside.ratio })
  }
  return parts
})

// The clips stay inside the query area, so a geography that crosses its edge
// has a share that neither column counts.
const geographyNote = computed((): string | null => {
  const geo = props.geography
  if (!geo) {
    return null
  }
  if (!geo.inside && !geo.outside) {
    return noBuffersNote.value
  }
  const beyond = 1 - geo.queryAreaRatio
  if (beyond < 0.005) {
    return null
  }
  return `${formatCensusValue(beyond, 'percent')} of this geography lies outside the query area, so Inside and Outside add up to less than Total.`
})

const tabs = computed((): PanelTab[] => [
  {
    label: 'Selected geography',
    caption: 'Census statistics for the selected geography',
    summed: false,
    columns: [
      { label: 'Total', tooltip: 'The full ACS value for this geography.', values: props.geography?.total },
      { label: 'Inside stop buffers', tooltip: `Scaled to the part of this geography inside the query area and within the stop buffers. ${UNCHANGED}`, values: props.geography?.inside?.values },
      { label: 'Outside stop buffers', tooltip: `Scaled to the part of this geography inside the query area but outside every stop buffer. ${UNCHANGED}`, values: props.geography?.outside?.values },
    ],
    note: geographyNote.value,
  },
  {
    label: 'Analysis area',
    caption: 'Census statistics for the whole analysis area',
    summed: true,
    columns: [
      { label: 'Total', tooltip: 'Every geography\'s value scaled to its share of the query area, then summed. Medians can\'t be summed and show as —.', values: props.analysisArea?.total },
      { label: 'Inside stop buffers', tooltip: 'Every geography\'s Inside stop buffers value, summed.', values: props.analysisArea?.inside },
      { label: 'Outside stop buffers', tooltip: 'Every geography\'s Outside stop buffers value, summed.', values: props.analysisArea?.outside },
    ],
    note: props.analysisArea && !props.analysisArea.inside && !props.analysisArea.outside ? noBuffersNote.value : null,
  },
])

function cell (values: CensusPanelValues | null | undefined, col: CensusColumnDef, summed: boolean): string {
  if (!values || (summed && NON_ADDITIVE_CENSUS_COLUMNS.has(col.id))) {
    return '—'
  }
  return formatCensusValue(values[col.id] ?? null, col.format)
}
</script>

<style scoped lang="scss">
.cal-census-panel-meta {
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

.cal-census-panel-actions {
  margin-bottom: 8px;

  a {
    color: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
}

.cal-census-panel-note {
  margin-top: 8px;
}

.cal-census-panel-stat-link {
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  color: var(--bulma-link);
  text-decoration: underline;
  text-underline-offset: 2px;
  text-align: left;
  cursor: pointer;

  &:hover {
    color: var(--bulma-link-hover);
  }
}
</style>
