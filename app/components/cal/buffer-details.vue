<template>
  <div class="cal-buffer-details">
    <header class="cal-buffer-details-header mb-4">
      <h3 class="title is-3">
        {{ entityKindLabel }}: {{ entityLabel }}
      </h3>
      <div class="field is-grouped is-grouped-multiline">
        <div class="control">
          <div class="tags has-addons">
            <span class="tag is-dark">{{ entityKindLabel }} ID</span>
            <span class="tag is-light">{{ entityId }}</span>
          </div>
        </div>
        <div class="control">
          <div class="tags has-addons">
            <span class="tag is-dark">Buffer radius</span>
            <span class="tag is-light">{{ radius }} m</span>
          </div>
        </div>
        <div class="control">
          <div class="tags has-addons">
            <span class="tag is-dark">Contributing geographies</span>
            <span class="tag is-light">{{ tracts.length }}</span>
          </div>
        </div>
        <div class="control">
          <div class="tags has-addons">
            <span class="tag is-dark">Buffer area covered</span>
            <span class="tag is-light">{{ formatCensusValue(apportioned.pctCoverage, 'percent') }}</span>
          </div>
        </div>
      </div>
    </header>

    <p v-if="tracts.length === 0" class="has-text-grey">
      No contributing geographies. The buffer may fall outside the loaded census layer.
    </p>

    <template v-else>
      <cat-tabs v-model="activeTab" type="boxed">
        <cat-tab-item value="tracts" label="Contributing geographies" />
        <cat-tab-item value="raw" label="Raw ACS values" />
        <cat-tab-item value="apportionment" label="Apportionment" />
        <cat-tab-item value="map" label="Map" />
      </cat-tabs>

      <div v-if="activeTab === 'tracts'">
        <cat-msg variant="info" title="About this table" class="mb-4">
          <p>
            One row per contributing geography.
            <strong>Intersection %</strong> = intersection area ÷ geography area, the weight
            used to apportion raw ACS values.
          </p>
        </cat-msg>
        <cal-datagrid
          :table-report="tractsTableReport"
          :filename="csvFilename('tracts')"
        />
      </div>

      <div v-if="activeTab === 'raw'">
        <cat-msg variant="info" title="About this table" class="mb-4">
          <p>
            Every raw ACS column returned for the contributing geographies.
            Missing cells mean the backend had no value for that
            (geography, column) pair, or it was filtered as an ACS jam value.
          </p>
        </cat-msg>
        <cal-datagrid
          :table-report="rawTableReport"
          :filename="csvFilename('raw')"
          freeze-first-column
        />
      </div>

      <div v-if="activeTab === 'apportionment'">
        <cat-msg variant="info" title="About this view" class="mb-4">
          <p class="mb-2">
            For each demographic column the apportioned value is computed as
            <code>Σ (raw × intersection %)</code> across contributing geographies, then run
            through the column's derivation. Pick a column below to see the
            per-geography breakdown.
          </p>
        </cat-msg>

        <cal-datagrid
          :table-report="summaryTableReport"
          :filename="csvFilename('summary')"
        />

        <div class="cal-buffer-details-inspector mt-5">
          <cat-field>
            <template #label>
              Inspect column
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

          <div v-if="inspectorSelected" class="cal-buffer-details-inspector-body">
            <p class="mb-2">
              <strong>Source ACS tables:</strong>
              {{ inspectorSelected.column.requiredTables.join(', ') }}
            </p>
            <p class="mb-2">
              <strong>Derive function:</strong>
            </p>
            <pre class="cal-buffer-details-inspector-code">{{ inspectorSelected.deriveSource }}</pre>
            <p v-if="inspectorSelected.isMedian" class="mt-3 has-text-grey">
              Median column — not apportioned across geographies; renders as "—" in tables.
            </p>
            <template v-else>
              <h4 class="title is-6 mt-4">
                Per-geography contribution
              </h4>
              <cal-datagrid
                :table-report="inspectorSelected.tableReport"
                :filename="csvFilename(`inspect-${inspectorColumnId}`)"
                freeze-first-column
              />
              <p class="mt-3">
                <strong>Apportioned value:</strong>
                {{ formatCensusValue(inspectorSelected.apportionedValue, inspectorSelected.column.format) }}
              </p>
            </template>
          </div>
        </div>
      </div>

      <div v-if="activeTab === 'map'">
        <cat-msg variant="info" title="About this view" class="mb-4">
          <p>
            Geographies fetched on demand — the main scenario response stays
            slim. Outlines show each contributing geography's full boundary;
            filled shapes are the buffer ∩ geography intersection used for the
            apportionment math.
          </p>
        </cat-msg>
        <cal-buffer-details-map
          :key="props.entityId"
          :geographies="geographyResult.geographies"
          :loading="geographyResult.loading"
          :error="geographyResult.error"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useLazyQuery } from '@vue/apollo-composable'
import type { TableReport } from './datagrid.vue'
import {
  BUFFER_QUERY_BY_KIND,
  type BufferGeographyIntersection,
  type BufferEntityKind,
  parseGeographyRow,
} from '~~/src/tl'
import {
  CENSUS_COLUMNS,
  NON_ADDITIVE_CENSUS_COLUMNS,
  REQUIRED_ACS_TABLES,
  apportionBuffer,
  detectCensusColumnSourceKeys,
  formatCensusValue,
} from '~~/src/core'

export type BufferDetailsKind = 'stop' | 'route' | 'agency'

const DETAILS_KIND_TO_BUFFER_KIND: Record<BufferDetailsKind, BufferEntityKind> = {
  stop: 'stops',
  route: 'routes',
  agency: 'agencies',
}

const props = defineProps<{
  kind: BufferDetailsKind
  entityId: number
  entityLabel: string
  tracts: BufferGeographyIntersection[]
  radius: number
  layer: string
  geoDatasetName: string
  tableDatasetName: string
}>()

const activeTab = ref<'tracts' | 'raw' | 'apportionment' | 'map'>('tracts')
const inspectorColumnId = ref<string>(CENSUS_COLUMNS[0]?.id ?? '')

const ENTITY_KIND_LABELS: Record<BufferDetailsKind, string> = {
  stop: 'Stop',
  route: 'Route',
  agency: 'Agency',
}
const entityKindLabel = computed(() => ENTITY_KIND_LABELS[props.kind])

function csvFilename (suffix: string): string {
  return `${props.kind}-${props.entityId}-buffer-${suffix}.csv`
}

const apportioned = computed(() => apportionBuffer(props.tracts))

const tractsTableReport = computed((): TableReport => ({
  columns: [
    { key: 'geoid', label: 'GEOID', sortable: true },
    { key: 'layer', label: 'Layer', sortable: true },
    { key: 'intersection_area_m2', label: 'Intersection (m²)', sortable: true, format: 'integer' },
    { key: 'geometry_area_m2', label: 'Geography area (m²)', sortable: true, format: 'integer' },
    { key: 'fraction', label: 'Intersection %', sortable: true, format: 'percent' },
  ],
  data: props.tracts.map(t => ({
    geoid: t.geoid,
    layer: t.layer,
    intersection_area_m2: t.intersectionArea,
    geometry_area_m2: t.geometryArea,
    fraction: t.geometryArea > 0 ? t.intersectionArea / t.geometryArea : 0,
  })),
}))

const allRawKeys = computed((): string[] => {
  const keys = new Set<string>()
  for (const t of props.tracts) {
    for (const k of Object.keys(t.values)) {
      keys.add(k)
    }
  }
  return [...keys].sort()
})

const rawTableReport = computed((): TableReport => ({
  columns: [
    { key: 'geoid', label: 'GEOID', sortable: true },
    ...allRawKeys.value.map(k => ({ key: k, label: k, sortable: true, format: 'integer' as const })),
  ],
  data: props.tracts.map((t) => {
    const row: Record<string, string | number | null> = { geoid: t.geoid }
    for (const k of allRawKeys.value) {
      const v = t.values[k]
      row[k] = typeof v === 'number' ? v : null
    }
    return row
  }),
}))

const summaryTableReport = computed((): TableReport => ({
  columns: [
    { key: 'column', label: 'Demographic column', sortable: true },
    { key: 'apportioned', label: 'Apportioned value', sortable: false },
    { key: 'tables', label: 'ACS source tables', sortable: false },
  ],
  data: CENSUS_COLUMNS.map((c) => {
    const value = apportioned.value.values[c.id] ?? null
    return {
      column: c.label,
      apportioned: NON_ADDITIVE_CENSUS_COLUMNS.has(c.id)
        ? '— (median, not apportioned)'
        : formatCensusValue(value, c.format),
      tables: c.requiredTables.join(', '),
    }
  }),
}))

function buildInspectorRows (sourceKeys: string[], geographies: BufferGeographyIntersection[]): Record<string, string | number | null>[] {
  return geographies.map((g) => {
    const fraction = g.geometryArea > 0 ? g.intersectionArea / g.geometryArea : 0
    const row: Record<string, string | number | null> = { geoid: g.geoid, fraction }
    for (const k of sourceKeys) {
      const raw = g.values[k]
      const rawNum = typeof raw === 'number' ? raw : null
      row[`raw_${k}`] = rawNum
      row[`contrib_${k}`] = rawNum != null ? rawNum * fraction : null
    }
    return row
  })
}

function buildInspectorColumns (sourceKeys: string[]): TableReport['columns'] {
  return [
    { key: 'geoid', label: 'GEOID', sortable: true },
    { key: 'fraction', label: 'Intersection %', sortable: true, format: 'percent' as const },
    ...sourceKeys.flatMap(k => [
      { key: `raw_${k}`, label: `${k} (raw)`, sortable: true, format: 'integer' as const },
      { key: `contrib_${k}`, label: `${k} × intersection %`, sortable: true, format: 'integer' as const },
    ]),
  ]
}

const inspectorSelected = computed(() => {
  const col = CENSUS_COLUMNS.find(c => c.id === inspectorColumnId.value)
  if (!col) {
    return null
  }
  const isMedian = NON_ADDITIVE_CENSUS_COLUMNS.has(col.id)
  const deriveSource = col.derive.toString()
  const apportionedValue = apportioned.value.values[col.id] ?? null
  if (isMedian) {
    return { column: col, isMedian, deriveSource, tableReport: null, apportionedValue }
  }
  const sourceKeys = detectCensusColumnSourceKeys(col)
  const tableReport: TableReport = {
    columns: buildInspectorColumns(sourceKeys),
    data: buildInspectorRows(sourceKeys, props.tracts),
  }
  return { column: col, isMedian, deriveSource, tableReport, apportionedValue }
})

// Lazy geometry fetch (#315). Reuses the existing buffer queries; the
// `@include(if: $includeGeometry)` directive keeps geometry off the main
// pipeline payload and on the modal-only payload. Fires the first time
// the Map tab is opened; cached for subsequent activations.
interface BufferEntityWithGeographies {
  id: number
  census_geographies: Parameters<typeof parseGeographyRow>[0][]
}
interface BufferQueryResponse {
  stops?: BufferEntityWithGeographies[]
  routes?: BufferEntityWithGeographies[]
  agencies?: BufferEntityWithGeographies[]
}

const geographyResult = reactive<{
  geographies: BufferGeographyIntersection[]
  loading: boolean
  error: string | null
  loadedFor: number | null
}>({
  geographies: [],
  loading: false,
  error: null,
  loadedFor: null,
})

const { load, onResult, onError } = useLazyQuery<BufferQueryResponse>(
  BUFFER_QUERY_BY_KIND[DETAILS_KIND_TO_BUFFER_KIND[props.kind]],
)

onResult((result) => {
  const bufferKind = DETAILS_KIND_TO_BUFFER_KIND[props.kind]
  const ent = result.data?.[bufferKind]?.[0]
  geographyResult.loading = false
  geographyResult.error = null
  if (!ent) {
    geographyResult.geographies = []
    return
  }
  const parsed: BufferGeographyIntersection[] = []
  for (const g of ent.census_geographies || []) {
    const row = parseGeographyRow(g, props.tableDatasetName)
    if (row) {
      parsed.push(row)
    }
  }
  geographyResult.geographies = parsed
  geographyResult.loadedFor = props.entityId
})

onError((err) => {
  geographyResult.loading = false
  geographyResult.error = err.message
})

// Reset cached geometry whenever the modal pivots to a new entity. Combined
// with `:key="props.entityId"` on cal-buffer-details-map this guarantees the
// map is torn down and rebuilt — no chance of stale geographies bleeding across
// stop/route/agency switches while the new fetch is in flight.
watch([activeTab, () => props.entityId], ([tab, id], [_prevTab, prevId]) => {
  if (id !== prevId) {
    geographyResult.geographies = []
    geographyResult.loadedFor = null
    geographyResult.error = null
  }
  if (tab !== 'map') {
    return
  }
  if (geographyResult.loadedFor === id) {
    return
  }
  geographyResult.loading = true
  geographyResult.error = null
  load(undefined, {
    ids: [id],
    dataset: props.geoDatasetName,
    layer: props.layer,
    radius: props.radius,
    tableDataset: props.tableDatasetName,
    tableNames: REQUIRED_ACS_TABLES,
    includeGeometry: true,
  }, { fetchPolicy: 'no-cache' })
})
</script>

<style scoped lang="scss">
.cal-buffer-details-header {
  margin-bottom: 12px;
}

.cal-buffer-details-inspector {
  border-top: 1px solid var(--bulma-border);
  margin-top: 1rem;
  padding-top: 1rem;
}

.cal-buffer-details-inspector-body {
  max-width: 720px;
}

.cal-buffer-details-inspector-code {
  background: var(--bulma-scheme-main-bis);
  border: 1px solid var(--bulma-border);
  border-radius: 4px;
  padding: 10px 12px;
  font-size: 0.85em;
  overflow-x: auto;
  white-space: pre;
}
</style>
