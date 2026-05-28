<template>
  <div class="cal-census-details">
    <!-- Header: entity context (buffer mode) OR scenario summary (census mode) -->
    <header class="cal-census-details-header">
      <template v-if="headerProps">
        <h2 class="title is-5">
          {{ headerProps.kindLabel }}: {{ headerProps.name }}
        </h2>
        <div class="field is-grouped is-grouped-multiline">
          <div class="control">
            <div class="tags has-addons">
              <span class="tag is-dark">{{ headerProps.kindLabel }} ID</span>
              <span class="tag is-light">{{ headerProps.id }}</span>
            </div>
          </div>
          <div v-if="headerProps.radius != null" class="control">
            <div class="tags has-addons">
              <span class="tag is-dark">Buffer radius</span>
              <span class="tag is-light">{{ headerProps.radius }} m</span>
            </div>
          </div>
          <div class="control">
            <div class="tags has-addons">
              <span class="tag is-dark">Contributing geographies</span>
              <span class="tag is-light">{{ entries.length }}</span>
            </div>
          </div>
          <div v-if="apportionmentSummary" class="control">
            <div class="tags has-addons">
              <span class="tag is-dark">Buffer area covered</span>
              <span class="tag is-light">
                {{ formatCensusValue(apportionmentSummary.pctCoverage, 'percent') }}
              </span>
            </div>
          </div>
        </div>
      </template>
      <template v-else>
        <h2 class="title is-5">
          Census Details
        </h2>
        <p class="subtitle is-6">
          {{ entries.length }}
          {{ entries.length === 1 ? layerLabel || 'geography' : (layerLabel ? pluralize(layerLabel) : 'geographies') }}
          fetched for the current scenario
        </p>
      </template>
    </header>

    <cat-msg v-if="highlightedGeoid" variant="warning" class="mb-3">
      Filtered to a single geography: <strong>{{ highlightedGeoid }}</strong>
      <span v-if="nameFor(highlightedGeoid)"> — {{ nameFor(highlightedGeoid) }}</span>.
      <a href="#" @click.prevent="$emit('clearFilter')">Show all geographies</a>
    </cat-msg>

    <cat-tabs v-model="activeTab" type="boxed">
      <cat-tab-item value="geographies" label="Geographies" />
      <cat-tab-item value="raw" label="Raw ACS values" />
      <cat-tab-item value="coverage" label="Coverage" />
      <cat-tab-item
        v-if="apportionmentSummary"
        value="apportionment"
        label="Apportionment"
      />
      <cat-tab-item value="inspector" label="Derivation inspector" />
      <cat-tab-item v-if="showMap" value="map" label="Map" />
    </cat-tabs>

    <!-- Geographies tab: one row per geography with metadata + derived columns -->
    <div v-if="activeTab === 'geographies'">
      <cat-msg variant="info" title="About this table" class="mb-4">
        <p class="mb-2">
          One row per census geography.
          <strong>Intersection %</strong> shows the fraction of each geography
          that falls inside the query area or stop buffer.
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
        :filename="csvFilename('geographies')"
        freeze-first-column
      >
        <template #column-geoid="{ value }">
          <span title="Select this geography on the map">
            <cat-button
              variant="text"
              size="small"
              class="cal-census-details-geoid-link"
              @click="$emit('selectGeography', String(value))"
            >
              {{ value }}
            </cat-button>
          </span>
        </template>
        <template #column-actions="{ row }">
          <cal-census-row-actions :row="row" />
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
        :filename="csvFilename('raw')"
        freeze-first-column
      >
        <template #column-geoid="{ value }">
          <span title="Select this geography on the map">
            <cat-button
              variant="text"
              size="small"
              class="cal-census-details-geoid-link"
              @click="$emit('selectGeography', String(value))"
            >
              {{ value }}
            </cat-button>
          </span>
        </template>
        <template #column-actions="{ row }">
          <cal-census-row-actions :row="row" />
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

    <!-- Apportionment tab: only rendered in buffer mode. Headline rolled-up
         values for each display column. -->
    <div v-if="activeTab === 'apportionment' && apportionmentSummary">
      <cat-msg variant="info" title="About this view" class="mb-4">
        <p class="mb-2">
          Each demographic column is computed as
          <code>Σ (raw × intersection %)</code> across contributing geographies,
          then run through the column's derivation. Use the Derivation inspector
          tab to see per-geography contributions for any column.
        </p>
      </cat-msg>
      <cal-datagrid
        v-model:table-report="apportionmentTableReport"
        :filename="csvFilename('apportionment')"
      />
    </div>

    <!-- Derivation inspector: pick a column (+ a geography in single-geo mode)
         to see the derive source and the inputs that feed it. -->
    <div v-if="activeTab === 'inspector'">
      <cat-msg variant="info" title="About this tool" class="mb-4">
        <p v-if="inspectorMode === 'apportioned'">
          Pick a column to see its derive function and how each contributing
          geography's raw value feeds into the apportioned sum.
        </p>
        <p v-else>
          Pick a column and a geography to see the derive function and the
          actual raw ACS values feeding into it.
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
        <cat-field v-if="inspectorMode === 'single'">
          <template #label>
            Geography
          </template>
          <cat-select v-model="inspectorGeoid">
            <option
              v-for="g of entries"
              :key="g.geoid"
              :value="g.geoid"
            >
              {{ g.geoid }} — {{ nameFor(g.geoid) || '(unnamed)' }}
            </option>
          </cat-select>
        </cat-field>
      </div>

      <div v-if="inspectorSingle" class="cal-census-details-inspector-body">
        <p>
          <strong>Derive function:</strong>
        </p>
        <pre class="cal-census-details-inspector-code">{{ inspectorSingle.deriveSource }}</pre>
        <p class="mt-3">
          <strong>Required ACS tables:</strong>
          {{ inspectorSingle.column.requiredTables.join(', ') }}
        </p>

        <h4 class="title is-6 mt-4">
          Input values for {{ inspectorSingle.geoid }}
        </h4>
        <table class="table is-striped is-narrow">
          <thead>
            <tr>
              <th>Raw column</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="key of inspectorSingle.sourceKeys" :key="key">
              <td><code>{{ key }}</code></td>
              <td class="cal-census-details-num">
                {{ formatRaw(inspectorSingle.entry.values[key]) }}
              </td>
            </tr>
          </tbody>
        </table>

        <p class="mt-3">
          <strong>Result:</strong>
          {{ formatCensusValue(inspectorSingle.result, inspectorSingle.column.format) }}
        </p>
      </div>

      <div v-else-if="inspectorApportioned" class="cal-census-details-inspector-body">
        <p>
          <strong>Derive function:</strong>
        </p>
        <pre class="cal-census-details-inspector-code">{{ inspectorApportioned.deriveSource }}</pre>
        <p class="mt-3">
          <strong>Source ACS tables:</strong>
          {{ inspectorApportioned.column.requiredTables.join(', ') }}
        </p>
        <p v-if="inspectorApportioned.isMedian" class="mt-3 has-text-grey">
          Median column — not apportioned across geographies; renders as "—".
        </p>
        <template v-else>
          <h4 class="title is-6 mt-4">
            Per-geography contribution
          </h4>
          <cal-datagrid
            v-model:table-report="inspectorApportioned.tableReport"
            :filename="csvFilename(`inspect-${inspectorColumnId}`)"
            freeze-first-column
          />
          <p class="mt-3">
            <strong>Apportioned value:</strong>
            {{ formatCensusValue(inspectorApportioned.apportionedValue, inspectorApportioned.column.format) }}
          </p>
        </template>
      </div>
    </div>

    <!-- Map tab: rendered geographies + intersection polygons. Geometry is
         fetched lazily by the parent on first activation. -->
    <div v-if="activeTab === 'map' && showMap">
      <cal-census-details-map
        :geographies="entries"
        :loading="mapLoading"
        :error="mapError"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { TableColumn, TableReport } from './datagrid.vue'
import {
  CENSUS_COLUMNS,
  NON_ADDITIVE_CENSUS_COLUMNS,
  REQUIRED_ACS_TABLES,
  type CensusGeographyEntry,
  deriveApportionedRow,
  deriveCensusRow,
  detectCensusColumnSourceKeys,
  formatCensusValue,
  toFiniteNumber,
} from '~~/src/core'

// Inspector + tab union — kept narrow so accidental string typos fail fast.
type TabId = 'geographies' | 'raw' | 'coverage' | 'apportionment' | 'inspector' | 'map'

const props = defineProps<{
  // The geographies to show — unified shape produced from either the scenario
  // pipeline's CensusGeographyData map or the buffer fetch's array.
  entries: CensusGeographyEntry[]
  // Default-mode summary text — only used when `headerProps` is unset.
  layerLabel?: string
  // Single-geography filter banner (census-modal use case).
  highlightedGeoid?: string
  // Entity context (buffer modal use case): swaps the header for a per-entity
  // title + tag row.
  headerProps?: {
    kindLabel: string
    id: number | string
    name: string
    radius?: number
    layer?: string
  }
  // Buffer-mode rolled-up values — drives the Apportionment tab and switches
  // the Inspector tab into multi-geography mode.
  apportionmentSummary?: {
    values: Record<string, number | null>
    pctCoverage: number
  }
  // Map tab gating. Parent is responsible for fetching geometry and merging
  // it into `entries` after `loadGeometry` is emitted.
  showMap?: boolean
  mapLoading?: boolean
  mapError?: string | null
  // CSV filename prefix; the suffix encodes the tab.
  filenamePrefix?: string
}>()

const emit = defineEmits<{
  selectGeography: [geoid: string]
  clearFilter: []
  // Fired once when the user first activates the Map tab. Parent loads
  // geometry and merges it into `entries`.
  loadGeometry: []
}>()

const activeTab = ref<TabId>('geographies')

// Apportionment summary keys off the prop, so the inspector knows which mode
// to render without an extra prop.
const inspectorMode = computed<'single' | 'apportioned'>(() =>
  props.apportionmentSummary ? 'apportioned' : 'single',
)

// Map fetch is one-shot: emit only on the first activation. Parent caches.
let geometryRequested = false
watch(activeTab, (tab) => {
  if (tab === 'map' && props.showMap && !geometryRequested) {
    geometryRequested = true
    emit('loadGeometry')
  }
})

// Default off — apportioning silently changes the displayed number relative
// to the raw ACS value, which is misleading without an opt-in.
const geographiesApportioned = ref(false)

const filenamePrefix = computed(() => props.filenamePrefix || 'census')

function csvFilename (suffix: string): string {
  return `${filenamePrefix.value}-${suffix}.csv`
}

// Best-effort name lookup — entries can carry `name`; if absent we just show
// the bare GEOID.
function nameFor (geoid: string): string {
  return props.entries.find(e => e.geoid === geoid)?.name || ''
}

function pluralize (label: string): string {
  if (label.endsWith('y')) {
    return `${label.slice(0, -1)}ies`
  }
  return `${label}s`
}

// Either filtered to a single GEOID (single-geo modal mode) or every entry.
const visibleEntries = computed<CensusGeographyEntry[]>(() => {
  const filter = props.highlightedGeoid
  return filter ? props.entries.filter(e => e.geoid === filter) : props.entries
})

function entryRatio (entry: CensusGeographyEntry): number {
  if (entry.intersectionRatio != null) {
    return entry.intersectionRatio
  }
  return entry.geometryArea > 0 ? entry.intersectionArea / entry.geometryArea : 0
}

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
  data: visibleEntries.value.map((entry) => {
    const ratio = entryRatio(entry)
    return {
      geoid: entry.geoid,
      name: entry.name || '',
      geometry_area_m2: entry.geometryArea,
      intersection_area_m2: entry.intersectionArea,
      intersection_pct: ratio,
      ...(geographiesApportioned.value
        ? deriveApportionedRow(entry.values, ratio)
        : deriveCensusRow(entry.values)),
    }
  }),
}))

// Union of every column key observed across all entries, so the column list
// is stable even when some entries miss some keys.
const allRawColumnKeys = computed((): string[] => {
  const keys = new Set<string>()
  for (const entry of visibleEntries.value) {
    for (const k of Object.keys(entry.values)) {
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
  data: visibleEntries.value.map(entry => ({
    geoid: entry.geoid,
    name: entry.name || '',
    ...entry.values,
  })),
}))

const displayCoverage = computed(() => {
  const total = visibleEntries.value.length
  return CENSUS_COLUMNS.map((col) => {
    let nonNull = 0
    for (const entry of visibleEntries.value) {
      if (col.derive(entry.values) !== null) {
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
  const total = visibleEntries.value.length
  return REQUIRED_ACS_TABLES.map((table) => {
    const prefix = `${table}_`
    let withAny = 0
    for (const entry of visibleEntries.value) {
      const hasAny = Object.keys(entry.values).some(k => k.startsWith(prefix))
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

// Apportionment summary tab: one row per CENSUS_COLUMN with the rolled-up
// apportioned value and the source ACS tables.
const apportionmentTableReport = computed((): TableReport => ({
  columns: [
    { key: 'column', label: 'Demographic column', sortable: true },
    { key: 'apportioned', label: 'Apportioned value', sortable: false },
    { key: 'tables', label: 'ACS source tables', sortable: false },
  ],
  data: CENSUS_COLUMNS.map((c) => {
    const value = props.apportionmentSummary?.values?.[c.id] ?? null
    return {
      column: c.label,
      apportioned: NON_ADDITIVE_CENSUS_COLUMNS.has(c.id)
        ? '— (median, not apportioned)'
        : formatCensusValue(value, c.format),
      tables: c.requiredTables.join(', '),
    }
  }),
}))

// Inspector state.
const inspectorColumnId = ref<string>(CENSUS_COLUMNS[0]?.id ?? '')
const inspectorGeoid = ref<string>('')

if (props.highlightedGeoid) {
  inspectorGeoid.value = props.highlightedGeoid
} else if (props.entries.length > 0) {
  inspectorGeoid.value = props.entries[0]!.geoid
}

// Single-geography inspector (census mode).
const inspectorSingle = computed(() => {
  if (inspectorMode.value !== 'single') {
    return null
  }
  const col = CENSUS_COLUMNS.find(c => c.id === inspectorColumnId.value)
  const entry = props.entries.find(e => e.geoid === inspectorGeoid.value)
  if (!col || !entry) {
    return null
  }
  return {
    column: col,
    geoid: entry.geoid,
    entry,
    result: col.derive(entry.values),
    deriveSource: col.derive.toString(),
    sourceKeys: detectCensusColumnSourceKeys(col),
  }
})

// Multi-geography apportioned inspector (buffer mode). Builds a per-geo
// breakdown table showing raw value × intersection % for each contributing
// geography, plus the rolled-up apportioned result.
const inspectorApportioned = computed(() => {
  if (inspectorMode.value !== 'apportioned') {
    return null
  }
  const col = CENSUS_COLUMNS.find(c => c.id === inspectorColumnId.value)
  if (!col) {
    return null
  }
  const isMedian = NON_ADDITIVE_CENSUS_COLUMNS.has(col.id)
  const deriveSource = col.derive.toString()
  const apportionedValue = props.apportionmentSummary?.values?.[col.id] ?? null
  if (isMedian) {
    return { column: col, isMedian, deriveSource, tableReport: null, apportionedValue }
  }
  const sourceKeys = detectCensusColumnSourceKeys(col)
  const tableReport: TableReport = {
    columns: [
      { key: 'geoid', label: 'GEOID', sortable: true },
      { key: 'fraction', label: 'Intersection %', sortable: true, format: 'percent' as const },
      ...sourceKeys.flatMap(k => [
        { key: `raw_${k}`, label: `${k} (raw)`, sortable: true, format: 'integer' as const },
        { key: `contrib_${k}`, label: `${k} × intersection %`, sortable: true, format: 'integer' as const },
      ]),
    ],
    data: props.entries.map((g) => {
      const fraction = entryRatio(g)
      const row: Record<string, string | number | null> = { geoid: g.geoid, fraction }
      for (const k of sourceKeys) {
        const raw = g.values[k]
        const rawNum = typeof raw === 'number' ? raw : null
        row[`raw_${k}`] = rawNum
        row[`contrib_${k}`] = rawNum != null ? rawNum * fraction : null
      }
      return row
    }),
  }
  return { column: col, isMedian, deriveSource, tableReport, apportionedValue }
})

function formatRaw (v: number | undefined): string {
  const n = toFiniteNumber(v)
  return n === null ? '—' : n.toLocaleString('en-US')
}
</script>

<style scoped lang="scss">
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

.cal-census-details-geoid-link {
  padding: 0 4px;
  height: auto;
  min-height: 0;
  font-family: inherit;
  font-variant-numeric: tabular-nums;
  color: var(--bulma-link);
  text-decoration: underline;
  text-underline-offset: 2px;

  &:hover {
    color: var(--bulma-link-hover);
    background: transparent;
  }
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
  max-width: 720px;
}
</style>
