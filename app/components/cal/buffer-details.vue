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
            <span class="tag is-dark">Contributing tracts</span>
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

    <cat-msg variant="info" title="About this view" class="mb-4">
      <p>
        Demographic columns shown in the report are computed by apportioning each
        contributing tract's raw ACS value by <strong>intersection area / tract area</strong>,
        then summing across tracts and running the column's derivation.
        Median columns ({{ medianColumnLabels.join(', ') || 'none' }}) are not apportioned
        and render as "—".
      </p>
    </cat-msg>

    <p v-if="tracts.length === 0" class="has-text-grey">
      No contributing tracts. The buffer may fall outside the loaded census layer.
    </p>

    <template v-else>
      <cat-tabs v-model="activeTab" type="boxed">
        <cat-tab-item value="tracts" label="Contributing tracts" />
        <cat-tab-item value="raw" label="Raw ACS values" />
        <cat-tab-item value="apportionment" label="Apportionment" />
      </cat-tabs>

      <div v-if="activeTab === 'tracts'">
        <cat-msg variant="info" title="About this table" class="mb-4">
          <p>
            One row per contributing tract.
            <strong>Intersection %</strong> = intersection area ÷ tract area, the weight
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
            Every raw ACS column returned for the contributing tracts.
            Missing cells mean the backend had no value for that
            (tract, column) pair, or it was filtered as an ACS jam value.
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
            <code>Σ (raw × intersection %)</code> across contributing tracts, then run
            through the column's derivation. Pick a column below to see the
            per-tract breakdown.
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
              Median column — not apportioned across tracts; renders as "—" in tables.
            </p>
            <template v-else>
              <h4 class="title is-6 mt-4">
                Per-tract contribution
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
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { TableReport } from './datagrid.vue'
import type { BufferGeographyIntersection } from '~~/src/tl'
import {
  CENSUS_COLUMNS,
  NON_ADDITIVE_CENSUS_COLUMNS,
  apportionBuffer,
  detectCensusColumnSourceKeys,
  formatCensusValue,
} from '~~/src/core'

export type BufferDetailsKind = 'stop' | 'route' | 'agency'

const props = defineProps<{
  kind: BufferDetailsKind
  entityId: number
  entityLabel: string
  tracts: BufferGeographyIntersection[]
  radius: number
}>()

const activeTab = ref<'tracts' | 'raw' | 'apportionment'>('tracts')
const inspectorColumnId = ref<string>(CENSUS_COLUMNS[0]?.id ?? '')

const ENTITY_KIND_LABELS: Record<BufferDetailsKind, string> = {
  stop: 'Stop',
  route: 'Route',
  agency: 'Agency',
}
const entityKindLabel = computed(() => ENTITY_KIND_LABELS[props.kind])

const medianColumnLabels = computed(() =>
  CENSUS_COLUMNS.filter(c => NON_ADDITIVE_CENSUS_COLUMNS.has(c.id)).map(c => c.label),
)

function csvFilename (suffix: string): string {
  return `${props.kind}-${props.entityId}-buffer-${suffix}.csv`
}

const apportioned = computed(() => apportionBuffer(props.tracts))

const tractsTableReport = computed((): TableReport => ({
  columns: [
    { key: 'geoid', label: 'GEOID', sortable: true },
    { key: 'layer', label: 'Layer', sortable: true },
    { key: 'intersection_area_m2', label: 'Intersection (m²)', sortable: true, format: 'integer' },
    { key: 'geometry_area_m2', label: 'Tract area (m²)', sortable: true, format: 'integer' },
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
