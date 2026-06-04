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
        <caption v-if="props.caption" class="is-sr-only">
          {{ props.caption }}
        </caption>
        <thead>
          <tr>
            <th
              v-for="column in tableReport.columns"
              :key="column.key"
              :class="{ 'is-sortable-th': column.sortable, 'is-sorted': sortKey === column.key }"
              @click="cycleSort(column)"
            >
              <span class="th-content">
                <cat-tooltip v-if="column.tooltip" :text="column.tooltip" position="bottom" class="col-header-tooltip">
                  {{ column.label }}
                  <cat-icon icon="information" size="small" />
                </cat-tooltip>
                <span v-else>{{ column.label }}</span>
                <!-- Sort indicator slot. Always rendered for sortable
                     columns so adding/removing the active chevron doesn't
                     change column width. Inactive state uses a hidden
                     chevron-up as a width spacer. -->
                <span v-if="column.sortable" class="cal-datagrid-sort-icon">
                  <cat-icon
                    v-if="sortKey === column.key && sortDir === 'asc'"
                    icon="chevron-up"
                    size="small"
                  />
                  <cat-icon
                    v-else-if="sortKey === column.key && sortDir === 'desc'"
                    icon="chevron-down"
                    size="small"
                  />
                  <cat-icon
                    v-else
                    icon="chevron-up"
                    size="small"
                    class="cal-datagrid-sort-icon-placeholder"
                  />
                </span>
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          <!-- Width shim: invisible row carrying the per-column widest cell
               in the full filtered dataset, so the browser's auto-layout
               sizes each column to the worst case and widths stay constant
               across pagination / sort. -->
          <tr v-if="layoutShimRow" aria-hidden="true" class="cal-datagrid-shim">
            <td v-for="column in tableReport.columns" :key="column.key">
              <div class="cal-datagrid-shim-cell">
                <slot
                  :name="`column-${column.key}`"
                  :row="layoutShimRow"
                  :column="column"
                  :value="layoutShimRow[column.key]"
                >
                  {{ renderCell(column, layoutShimRow[column.key]) }}
                </slot>
              </div>
            </td>
          </tr>
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
import { formatCensusValue, toFiniteNumber } from '~~/src/core'

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

function renderCell (column: TableColumn, value: unknown): string {
  if (column.format !== undefined) {
    return formatCensusValue(toFiniteNumber(value), column.format)
  }
  return value == null ? '' : String(value)
}

const props = defineProps<{
  filename?: string
  // Horizontally scrollable, with the first column pinned.
  freezeFirstColumn?: boolean
  // Accessible table caption. Rendered as a visually-hidden <caption> so screen
  // readers announce the table's purpose; sighted users still see surrounding
  // heading/tab UI for context.
  caption?: string
}>()

const searchQuery = ref('')
const sortKey = ref<string | null>(null)
const sortDir = ref<'asc' | 'desc' | null>(null)

function cycleSort (column: TableColumn) {
  if (!column.sortable) {
    return
  }
  if (sortKey.value !== column.key) {
    sortKey.value = column.key
    sortDir.value = 'asc'
    return
  }
  if (sortDir.value === 'asc') {
    sortDir.value = 'desc'
  } else if (sortDir.value === 'desc') {
    sortKey.value = null
    sortDir.value = null
  } else {
    sortDir.value = 'asc'
  }
}

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

// Sort the filtered data. Nullish values are pushed to the end regardless
// of direction so they don't pollute either tail of a sorted column.
const sortedData = computed(() => {
  const base = filteredData.value
  const key = sortKey.value
  const dir = sortDir.value
  if (!key || !dir) {
    return base
  }
  const col = tableReport.value?.columns.find(c => c.key === key)
  const numeric = col?.format !== undefined
  const sign = dir === 'asc' ? 1 : -1
  return [...base].sort((a, b) => {
    const va = a[key]
    const vb = b[key]
    const aNil = va == null || va === ''
    const bNil = vb == null || vb === ''
    if (aNil && bNil) { return 0 }
    if (aNil) { return 1 }
    if (bNil) { return -1 }
    if (numeric) {
      const na = toFiniteNumber(va)
      const nb = toFiniteNumber(vb)
      if (na === null && nb === null) { return 0 }
      if (na === null) { return 1 }
      if (nb === null) { return -1 }
      return sign * (na - nb)
    }
    return sign * String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' })
  })
})

watch(searchQuery, () => {
  current.value = 1
})

watch(() => tableReport.value?.columns, () => {
  searchQuery.value = ''
  sortKey.value = null
  sortDir.value = null
})

// Reset pagination when data changes (e.g. tab switch, filter update)
watch(() => tableReport.value?.data, () => {
  current.value = 1
})

// Reset pagination when sort changes so the user sees the new top of the list
watch([sortKey, sortDir], () => {
  current.value = 1
})

const currentRows = computed(() => {
  const start = (current.value - 1) * perPage
  const end = start + perPage
  return sortedData.value.slice(start, end)
})

// One synthetic row whose per-column values are taken from whichever real
// row renders longest in that column. Rendered hidden at the top of tbody
// so the browser's table auto-layout sees the worst-case width for every
// column and never reflows as pagination/sort change the visible 20 rows.
// Driven by the full dataset (not the search-filtered subset) so widths
// stay truly stable across filter changes — Vue's computed cache means
// this only re-runs when `tableReport.data` itself changes.
const layoutShimRow = computed((): Record<string, any> | null => {
  const cols = tableReport.value?.columns ?? []
  const data = tableReport.value?.data ?? []
  if (cols.length === 0 || data.length === 0) {
    return null
  }
  const widest: Record<string, { value: any, len: number }> = {}
  for (const col of cols) {
    widest[col.key] = { value: undefined, len: -1 }
  }
  for (const row of data) {
    for (const col of cols) {
      const rendered = renderCell(col, row[col.key])
      if (rendered.length > widest[col.key]!.len) {
        widest[col.key] = { value: row[col.key], len: rendered.length }
      }
    }
  }
  const shim: Record<string, any> = {}
  for (const col of cols) {
    shim[col.key] = widest[col.key]!.value
  }
  return shim
})
const total = computed(() => {
  return sortedData.value.length
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
    // Floor so short-header + short-data columns (e.g. "ID" / "1") stay
    // readable instead of collapsing to a few pixels wide.
    min-width: 4rem;
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

    .th-content {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
    }

    .cal-datagrid-sort-icon {
      display: inline-flex;
      align-items: center;
    }

    .cal-datagrid-sort-icon-placeholder {
      visibility: hidden;
    }

    &.is-sortable-th {
      cursor: pointer;
      user-select: none;

      &:hover {
        background: var(--bulma-scheme-main-bis);
      }
    }

    &.is-sorted {
      background: var(--bulma-scheme-main-bis);
    }
  }

  td {
    background: var(--bulma-scheme-main);
  }

  tr:hover td {
    background: var(--bulma-scheme-main-bis);
  }

  // Width-shim row: zero vertical footprint, no hover, but still contributes
  // its content width to the browser's table-layout calculation.
  tr.cal-datagrid-shim {
    pointer-events: none;

    td {
      padding-top: 0;
      padding-bottom: 0;
      border-top-width: 0;
      border-bottom-width: 0;
      background: var(--bulma-scheme-main);
    }

    .cal-datagrid-shim-cell {
      height: 0;
      overflow: hidden;
      visibility: hidden;
    }
  }

  tr.cal-datagrid-shim:hover td {
    background: var(--bulma-scheme-main);
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
