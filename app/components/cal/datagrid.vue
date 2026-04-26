<template>
  <div class="mb-6">
    <div class="is-flex is-align-items-center mb-4" style="gap: 0.5rem;">
      <cat-input
        v-model="searchQuery"
        type="search"
        placeholder="Search..."
        icon="magnify"
      />

      <!-- Slot for additional download buttons, such as GeoJSON -->
      <slot name="additional-downloads" :data="tableReport.data" :loading="loading" />

      <cat-field style="margin-left: auto;">
        <cal-csv-download
          :data="tableReport.data"
          :disabled="loading"
          :filename="props.filename"
        />
      </cat-field>
    </div>

    <div class="table-container" :class="{ 'is-freeze-first': props.freezeFirstColumn }">
      <table class="cal-report-table table is-bordered is-striped is-hoverable is-fullwidth">
        <thead>
          <tr>
            <th v-for="column in tableReport.columns" :key="column.key">
              <cat-tooltip v-if="column.tooltip" :text="column.tooltip" position="bottom" class="col-header-tooltip">
                {{ column.label }}
                <cat-icon icon="information" size="small" />
              </cat-tooltip>
              <span v-else>{{ column.label }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, idx) in currentRows" :key="row.id ?? row.geoid ?? row.location_id ?? idx">
            <td v-for="column in tableReport.columns" :key="column.key">
              <slot
                :name="`column-${column.key}`"
                :row="row"
                :column="column"
                :value="row[column.key]"
              >
                {{ renderCell(column, row[column.key]) }}
              </slot>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="total > 0" class="is-flex is-align-items-center mt-4" style="gap: 0.5rem;">
      <span class="has-text-grey">Showing {{ rangeStart }}-{{ rangeEnd }} of {{ total }} results</span>
      <cat-pagination
        v-model:current="current"
        :total="total"
        :per-page="perPage"
        style="margin-left: auto;"
      />
    </div>
    <div v-else class="has-text-grey mt-4">
      No results found
    </div>
  </div>
</template>

<script lang="ts">
import type { CensusFormat } from '~~/src/core'
</script>

<script setup lang="ts">
import { formatCensusValue } from '~~/src/core'

export interface TableColumn {
  key: string
  label: string
  sortable: boolean
  tooltip?: string
  // When set, the default cell renderer routes the value through formatCensusValue.
  format?: CensusFormat
}

export interface TableReport {
  columns: TableColumn[]
  data: Record<string, any>[]
}

const perPage = 20
const loading = defineModel<boolean>('loading', { default: false })
const tableReport = defineModel<TableReport>('tableReport', { required: true })
const current = defineModel<number>('current', { default: 1 })

function toNumOrNull (value: unknown): number | null {
  if (typeof value === 'number') { return Number.isFinite(value) ? value : null }
  if (value == null) { return null }
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function renderCell (column: TableColumn, value: unknown): string {
  if (column.format !== undefined) {
    return formatCensusValue(toNumOrNull(value), column.format)
  }
  return value == null ? '' : String(value)
}

const props = defineProps<{
  filename?: string
  // Horizontally scrollable, with the first column pinned.
  freezeFirstColumn?: boolean
}>()

const searchQuery = ref('')

const filteredData = computed(() => {
  const data = tableReport?.value?.data || []
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) {
    return data
  }
  return data.filter(row =>
    Object.values(row).some(val =>
      String(val ?? '').toLowerCase().includes(query),
    ),
  )
})

watch(searchQuery, () => {
  current.value = 1
})

watch(() => tableReport.value?.columns, () => {
  searchQuery.value = ''
})

// Reset pagination when data changes (e.g. tab switch, filter update)
watch(() => tableReport.value?.data, () => {
  current.value = 1
})

const currentRows = computed(() => {
  const start = (current.value - 1) * perPage
  const end = start + perPage
  return filteredData.value.slice(start, end)
})
const total = computed(() => {
  return filteredData.value.length
})
const rangeStart = computed(() => {
  return total.value === 0 ? 0 : (current.value - 1) * perPage + 1
})
const rangeEnd = computed(() => {
  return Math.min(current.value * perPage, total.value)
})
</script>

<style scoped lang="scss">
.table-container {
  border: 1px solid var(--bulma-border);
  border-radius: var(--bulma-radius);
  position: relative;
}

.cal-report-table {
  th, td {
    padding: 0.5rem 0.75rem;
    white-space: nowrap;
    vertical-align: middle;
  }

  th {
    background: var(--bulma-scheme-main-ter);
    color: var(--bulma-text-strong);
    font-weight: 600;
    border-bottom: 2px solid var(--bulma-border);

    .col-header-tooltip {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      cursor: default;
    }
  }

  td {
    background: var(--bulma-scheme-main);
  }

  tr:hover td {
    background: var(--bulma-scheme-main-bis);
  }

  td:first-child {
    background: var(--bulma-scheme-main);
  }
}

// `border-collapse: collapse` on Bulma's .table suppresses cell box-shadows,
// so the right-edge shade comes from a ::after instead.
.table-container.is-freeze-first {
  overflow-x: auto;

  .cal-report-table {
    th:first-child,
    td:first-child {
      position: sticky;
      left: 0;
      z-index: 2;
      background: var(--bulma-scheme-main);

      &::after {
        content: '';
        position: absolute;
        top: 0;
        bottom: 0;
        right: -8px;
        width: 8px;
        pointer-events: none;
        background: linear-gradient(
          to right,
          rgba(0, 0, 0, 0.12),
          rgba(0, 0, 0, 0)
        );
      }
    }

    thead th:first-child {
      background: var(--bulma-scheme-main-ter);
      z-index: 3;
    }
  }
}

// Fix pagination element ordering
:deep(.t-pagination) {
  .pagination-previous {
    order: 1;
  }
  .pagination-list {
    order: 2;
  }
  .pagination-next {
    order: 3;
  }
}
</style>
