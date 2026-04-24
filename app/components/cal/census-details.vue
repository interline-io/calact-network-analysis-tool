<template>
  <div class="cal-census-details">
    <div class="cal-census-details-header">
      <h2 class="title is-5">
        Census Details
      </h2>
      <p class="subtitle is-6">
        {{ geographies.length }}
        {{ geographies.length === 1 ? layerLabel || 'geography' : (layerLabel ? pluralize(layerLabel) : 'geographies') }}
        fetched for the current scenario
      </p>
    </div>

    <cat-tabs v-model="activeTab" type="boxed">
      <cat-tab-item value="geographies" label="Geographies" />
      <cat-tab-item value="raw" label="Raw ACS values" />
      <cat-tab-item value="coverage" label="Coverage" />
      <cat-tab-item value="inspector" label="Derivation inspector" />
    </cat-tabs>

    <!-- Geographies tab: one row per geography with metadata + derived columns -->
    <div v-if="activeTab === 'geographies'">
      <cat-msg variant="info" title="About this table" class="mb-4">
        <p class="mb-2">
          One row per census geography fetched for the current scenario.
          <strong>Intersection %</strong> shows the fraction of each geography
          that falls inside the query area.
        </p>
        <p class="mb-3">
          Demographic columns show the <strong>full ACS value for the whole
            geography</strong>. Toggle the checkbox below to scale counts by
          Intersection %. Ratios and medians are unchanged either way.
        </p>
        <cat-checkbox v-model="geographiesApportioned">
          Scale counts by intersection %
        </cat-checkbox>
      </cat-msg>
      <cal-datagrid
        v-model:table-report="geographiesTableReport"
        filename="census-geographies.csv"
        freeze-first-column
      >
        <template #column-actions="{ row }">
          <cal-census-row-actions
            :row="row"
            @copy-text="copyText"
            @copy-json="copyJson"
          />
        </template>
      </cal-datagrid>
    </div>

    <!-- Raw ACS values tab: per-geography × per-column matrix -->
    <div v-if="activeTab === 'raw'">
      <cat-msg variant="info" title="About this table" class="mb-4">
        <p>
          Every raw ACS column returned by the backend for these geographies.
          Missing cells mean the backend had no value for that
          (geography, column) pair.
        </p>
      </cat-msg>
      <cal-datagrid
        v-model:table-report="rawTableReport"
        filename="census-raw-values.csv"
        freeze-first-column
      >
        <template #column-actions="{ row }">
          <cal-census-row-actions
            :row="row"
            @copy-text="copyText"
            @copy-json="copyJson"
          />
        </template>
      </cal-datagrid>
    </div>

    <!-- Coverage tab: per-column + per-ACS-table coverage summary -->
    <div v-if="activeTab === 'coverage'">
      <cat-msg variant="info" title="About this table" class="mb-4">
        <p>
          How many geographies have a usable value for each display column and
          underlying ACS table. 0% coverage usually means the ACS table isn't
          loaded on the backend yet.
        </p>
      </cat-msg>

      <h3 class="title is-6 mt-4">
        Display columns
      </h3>
      <table class="table is-striped is-narrow is-fullwidth">
        <thead>
          <tr>
            <th>Column</th>
            <th>Non-null</th>
            <th>Coverage</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row of displayCoverage" :key="row.id">
            <td>{{ row.label }}</td>
            <td class="cal-census-details-num">
              {{ row.nonNull }} / {{ row.total }}
            </td>
            <td class="cal-census-details-num">
              {{ row.total === 0 ? '—' : formatCensusValue(row.pct, 'percent') }}
            </td>
          </tr>
        </tbody>
      </table>

      <h3 class="title is-6 mt-4">
        ACS source tables
      </h3>
      <table class="table is-striped is-narrow is-fullwidth">
        <thead>
          <tr>
            <th>Table</th>
            <th>Geographies w/ any value</th>
            <th>Coverage</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row of tableCoverage" :key="row.table">
            <td>{{ row.table }}</td>
            <td class="cal-census-details-num">
              {{ row.withAny }} / {{ row.total }}
            </td>
            <td class="cal-census-details-num">
              {{ row.total === 0 ? '—' : formatCensusValue(row.pct, 'percent') }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Derivation inspector tab: derive source + per-geography input values -->
    <div v-if="activeTab === 'inspector'">
      <cat-msg variant="info" title="About this tool" class="mb-4">
        <p>
          See the derive function for a column and the actual raw ACS values
          feeding into it for a specific geography.
        </p>
      </cat-msg>
      <div class="cal-census-details-inspector-controls">
        <cat-field>
          <template #label>
            Column
          </template>
          <cat-select v-model="inspectorColumnId">
            <option
              v-for="col of CENSUS_COLUMNS"
              :key="col.id"
              :value="col.id"
            >
              {{ col.label }}
            </option>
          </cat-select>
        </cat-field>
        <cat-field>
          <template #label>
            Geography
          </template>
          <cat-select v-model="inspectorGeoid">
            <option
              v-for="g of geographies"
              :key="g.geoid"
              :value="g.geoid"
            >
              {{ g.geoid }} — {{ nameFor(g.geoid) || '(unnamed)' }}
            </option>
          </cat-select>
        </cat-field>
      </div>

      <div v-if="inspectorSelected" class="cal-census-details-inspector-body">
        <p>
          <strong>Derive function:</strong>
        </p>
        <pre class="cal-census-details-inspector-code">{{ inspectorSelected.deriveSource }}</pre>
        <p class="mt-3">
          <strong>Required ACS tables:</strong>
          {{ inspectorSelected.column.requiredTables.join(', ') }}
        </p>

        <h4 class="title is-6 mt-4">
          Input values for {{ inspectorSelected.geoid }}
        </h4>
        <table class="table is-striped is-narrow">
          <thead>
            <tr>
              <th>Raw column</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="key of inspectorSelected.sourceKeys" :key="key">
              <td><code>{{ key }}</code></td>
              <td class="cal-census-details-num">
                {{ formatRaw(inspectorSelected.data.values[key]) }}
              </td>
            </tr>
          </tbody>
        </table>

        <p class="mt-3">
          <strong>Result:</strong>
          {{ formatCensusValue(inspectorSelected.result, inspectorSelected.column.format) }}
        </p>
      </div>
    </div>

    <p v-if="copiedMessage" class="help has-text-success mt-2">
      {{ copiedMessage }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ScenarioFilterResult } from '~~/src/scenario'
import type { TableColumn, TableReport } from './datagrid.vue'
import {
  CENSUS_COLUMNS,
  REQUIRED_ACS_TABLES,
  deriveApportionedRow,
  deriveCensusRow,
  detectCensusColumnSourceKeys,
  formatCensusValue,
  type CensusGeographyData,
} from '~~/src/core'

/**
 * Drill-down view of the census data fetched as part of the current
 * scenario (#302). Mirrors the Route Timetable modal pattern:
 * self-contained, tabbed, reuses the generic datagrid, CSV-exportable.
 *
 * Tabs:
 *  - Geographies       — metadata + derived demographic columns, with an
 *                        optional intersection-% scaling toggle.
 *  - Raw ACS values    — per-geography × per-column matrix of the backend
 *                        values, useful for confirming ACS table coverage.
 *  - Coverage          — how many geographies have a usable value per
 *                        column / per ACS source table.
 *  - Derivation inspector — the derive function source plus the input
 *                        values feeding it for one (column, geography).
 */
const props = defineProps<{
  scenarioFilterResult: ScenarioFilterResult
  layerLabel?: string
  highlightedGeoid?: string
}>()

const activeTab = ref<'geographies' | 'raw' | 'coverage' | 'inspector'>('geographies')

// Geographies tab: when true, additive count columns are multiplied by the
// geography's intersection ratio (ratios and medians stay unchanged). Default
// off — matches historical behavior and avoids silently showing a number that
// differs from the raw ACS value.
const geographiesApportioned = ref(false)

const geographies = computed((): Array<{ geoid: string, data: CensusGeographyData }> => {
  const m = props.scenarioFilterResult.censusGeographies
  if (!m) { return [] }
  return [...m.entries()].map(([geoid, data]) => ({ geoid, data }))
})

// --- Geographies tab ---------------------------------------------------

const geographiesColumns = computed((): TableColumn[] => [
  { key: 'geoid', label: 'GEOID', sortable: true },
  { key: 'name', label: 'Name', sortable: true },
  { key: 'geometry_area_m2', label: 'Area (m²)', sortable: true, format: 'integer' },
  { key: 'intersection_area_m2', label: 'Intersection (m²)', sortable: true, format: 'integer' },
  { key: 'intersection_pct', label: 'Intersection %', sortable: true, format: 'percent' },
  ...CENSUS_COLUMNS.map(c => ({
    key: c.id,
    label: c.label,
    sortable: true,
    format: c.format,
  })),
  { key: 'actions', label: ' ', sortable: false },
])

const geographiesTableReport = computed((): TableReport => ({
  columns: geographiesColumns.value,
  data: geographies.value.map(({ geoid, data }) => ({
    geoid,
    name: nameFor(geoid),
    geometry_area_m2: data.geometryArea,
    intersection_area_m2: data.intersectionArea,
    intersection_pct: data.intersectionRatio,
    ...(geographiesApportioned.value
      ? deriveApportionedRow(data.values, data.intersectionRatio)
      : deriveCensusRow(data.values)),
  })),
}))

// --- Raw ACS values tab ------------------------------------------------

// Union of every column key observed across all geographies. Gives a stable
// list of columns even if some geographies are missing some keys.
const allRawColumnKeys = computed((): string[] => {
  const keys = new Set<string>()
  for (const { data } of geographies.value) {
    for (const k of Object.keys(data.values)) {
      keys.add(k)
    }
  }
  return [...keys].sort()
})

const rawColumns = computed((): TableColumn[] => [
  { key: 'geoid', label: 'GEOID', sortable: true },
  { key: 'name', label: 'Name', sortable: true },
  ...allRawColumnKeys.value.map(k => ({
    key: k,
    label: k,
    sortable: true,
    format: 'integer' as const,
  })),
  { key: 'actions', label: ' ', sortable: false },
])

const rawTableReport = computed((): TableReport => ({
  columns: rawColumns.value,
  data: geographies.value.map(({ geoid, data }) => ({
    geoid,
    name: nameFor(geoid),
    ...data.values,
  })),
}))

// --- Helpers -----------------------------------------------------------

// Lookup geography name from the scenario's stop.census_geographies list
// (the same source stopGeoAggregateCsv uses). Keeps the modal self-sufficient
// without an extra fetch.
const geoMeta = computed((): Map<string, { name: string }> => {
  const m = new Map<string, { name: string }>()
  for (const stop of props.scenarioFilterResult.stops) {
    for (const g of stop.census_geographies || []) {
      if (!m.has(g.geoid)) {
        m.set(g.geoid, { name: g.name })
      }
    }
  }
  return m
})

function nameFor (geoid: string): string {
  return geoMeta.value.get(geoid)?.name || ''
}

function pluralize (label: string): string {
  // Simple "Census Tract" -> "Census Tracts". Handles the three aggregation
  // layers we expose; extend if more singular/plural quirks show up.
  if (label.endsWith('y')) {
    return `${label.slice(0, -1)}ies`
  }
  return `${label}s`
}

// --- Copy affordances --------------------------------------------------

const copiedMessage = ref('')
let copiedTimer: ReturnType<typeof setTimeout> | undefined

function flashCopied (msg: string) {
  copiedMessage.value = msg
  if (copiedTimer) { clearTimeout(copiedTimer) }
  copiedTimer = setTimeout(() => { copiedMessage.value = '' }, 2000)
}

async function copyText (text: string) {
  try {
    await navigator.clipboard.writeText(text)
    flashCopied(`Copied: ${text}`)
  } catch (err) {
    console.warn('clipboard write failed', err)
  }
}

async function copyJson (row: Record<string, unknown>) {
  // Strip internal fields before copying.
  const clean = Object.fromEntries(
    Object.entries(row).filter(([k]) => !k.startsWith('_')),
  )
  await copyText(JSON.stringify(clean, null, 2))
}

// --- Coverage tab ------------------------------------------------------

const displayCoverage = computed(() => {
  const total = geographies.value.length
  return CENSUS_COLUMNS.map((col) => {
    let nonNull = 0
    for (const { data } of geographies.value) {
      if (col.derive(data.values) !== null) {
        nonNull++
      }
    }
    return {
      id: col.id,
      label: col.label,
      nonNull,
      total,
      pct: total === 0 ? 0 : nonNull / total,
    }
  })
})

const tableCoverage = computed(() => {
  const total = geographies.value.length
  return REQUIRED_ACS_TABLES.map((table) => {
    const prefix = `${table}_`
    let withAny = 0
    for (const { data } of geographies.value) {
      const hasAny = Object.keys(data.values).some(k => k.startsWith(prefix))
      if (hasAny) { withAny++ }
    }
    return {
      table,
      withAny,
      total,
      pct: total === 0 ? 0 : withAny / total,
    }
  })
})

// --- Derivation inspector tab ------------------------------------------

const inspectorColumnId = ref<string>(CENSUS_COLUMNS[0]?.id ?? '')
const inspectorGeoid = ref<string>('')

// Default the inspector's geography to the highlighted one on open, or to
// the first available geography otherwise.
if (props.highlightedGeoid) {
  inspectorGeoid.value = props.highlightedGeoid
} else if (geographies.value.length > 0) {
  inspectorGeoid.value = geographies.value[0]!.geoid
}

const inspectorSelected = computed(() => {
  const col = CENSUS_COLUMNS.find(c => c.id === inspectorColumnId.value)
  const entry = geographies.value.find(g => g.geoid === inspectorGeoid.value)
  if (!col || !entry) { return null }
  return {
    column: col,
    geoid: entry.geoid,
    data: entry.data,
    result: col.derive(entry.data.values),
    // derive.toString() gives the actual function source — a more honest
    // "formula" than a hand-maintained string that could drift.
    deriveSource: col.derive.toString(),
    // Discovered at runtime from `derive`; no separate array to keep in sync.
    sourceKeys: detectCensusColumnSourceKeys(col),
  }
})

function formatRaw (v: number | undefined): string {
  if (v === undefined || v === null || !Number.isFinite(v)) {
    return '—'
  }
  return v.toLocaleString('en-US')
}
</script>

<style scoped lang="scss">
// Root intentionally has no padding — the enclosing <cat-modal> already
// provides it, matching the Route Timetable modal's layout.

.cal-census-details-header {
  margin-bottom: 12px;
}

.cal-census-details-actions {
  display: flex;
  gap: 4px;

  .button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding-left: 10px;
    padding-right: 10px;
  }
}

.cal-census-details-num {
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}

.cal-census-details-inspector-code {
  background: var(--bulma-scheme-main-bis);
  border: 1px solid var(--bulma-border);
  border-radius: 4px;
  padding: 10px 12px;
  font-size: 0.85em;
  overflow-x: auto;
  white-space: pre;
}

.cal-census-details-inspector-controls {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.cal-census-details-inspector-body {
  max-width: 640px;
}
</style>
