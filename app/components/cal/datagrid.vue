<template>
  <div class="mb-6">
    <div class="is-flex is-align-items-center mb-4" style="gap: 0.5rem;">
      <!-- Search landmark so screen-reader users can jump to the table filter;
           labelled (via filterLabel) to distinguish it from other filters. -->
      <div class="cal-datagrid-filter" role="search" :aria-label="filterLabel">
        <!-- ariaLabel/aria-controls passed via a v-bind object: cat-search-bar
             sets inheritAttrs:false, so vue-tsc checks attributes against its
             declared props and rejects a plain :aria-controls; the object also
             keeps vue/attribute-hyphenation from rewriting ariaLabel to kebab
             (which vue-tsc then couldn't map back to the prop). -->
        <cat-search-bar
          v-model="searchQuery"
          placeholder="Search..."
          v-bind="{ 'ariaLabel': filterLabel, 'aria-controls': tableId }"
        >
          <!-- Announced politely to screen readers as the filter changes. -->
          <template #status>
            {{ filterStatus }}
          </template>
        </cat-search-bar>
      </div>

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
      <table :id="tableId" class="cal-report-table table is-bordered is-striped is-hoverable is-fullwidth">
        <caption v-if="props.caption" class="is-sr-only">
          {{ props.caption }}
        </caption>
        <thead>
          <tr>
            <th
              v-for="column in tableReport.columns"
              :key="column.key"
              scope="col"
              :class="{ 'is-sortable-th': column.sortable, 'is-sorted': sortKey === column.key }"
              :aria-sort="column.sortable ? ariaSort(column) : undefined"
            >
              <!-- Sortable columns render the header as a real <button> so
                   sorting is keyboard-operable (Enter/Space) and announced as a
                   button; aria-sort on the <th> conveys the current direction.
                   When the column also has a tooltip, the button lives inside
                   cat-tooltip — cat-tooltip detects the focusable button and
                   describes it (aria-describedby) rather than adding its own tab
                   stop, so there's no nested interactive content. -->
              <cat-tooltip
                v-if="column.sortable && column.tooltip"
                :text="column.tooltip"
                position="bottom"
                class="cal-datagrid-sort-tooltip"
              >
                <button type="button" class="cal-datagrid-sort-button" @click="cycleSort(column)">
                  {{ column.label }}
                  <cat-icon icon="information" size="small" />
                  <span class="cal-datagrid-sort-icon">
                    <cat-icon
                      :icon="sortIcon(column)"
                      size="small"
                      :class="{ 'cal-datagrid-sort-icon-placeholder': sortKey !== column.key }"
                    />
                  </span>
                </button>
              </cat-tooltip>
              <button
                v-else-if="column.sortable"
                type="button"
                class="cal-datagrid-sort-button"
                @click="cycleSort(column)"
              >
                {{ column.label }}
                <!-- Sort indicator. Always rendered for sortable columns so
                     toggling the active chevron doesn't change column width;
                     the inactive state shows a hidden chevron as a spacer. -->
                <span class="cal-datagrid-sort-icon">
                  <cat-icon
                    :icon="sortIcon(column)"
                    size="small"
                    :class="{ 'cal-datagrid-sort-icon-placeholder': sortKey !== column.key }"
                  />
                </span>
              </button>
              <!-- Non-sortable columns: plain header content. -->
              <span v-else class="th-content">
                <cat-tooltip v-if="column.tooltip" :text="column.tooltip" position="bottom" class="col-header-tooltip">
                  {{ column.label }}
                  <cat-icon icon="information" size="small" />
                </cat-tooltip>
                <span v-else>{{ column.label }}</span>
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

<script setup lang="ts">
import { formatCensusValue, toFiniteNumber, type TableColumn, type TableReport } from '~~/src/core'

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

// cat-search-bar clears to null (not ''), so the model is nullable.
const searchQuery = ref<string | null>('')
const sortKey = ref<string | null>(null)
const sortDir = ref<'asc' | 'desc' | null>(null)

// SSR-stable id so the filter's aria-controls can point at this table.
const tableId = useId()

// Accessible name for the filter (search fields have no visible label).
const filterLabel = computed(() =>
  props.caption ? `Filter ${props.caption}` : 'Filter table rows')

// aria-sort value for a sortable column's <th>, reflecting the current sort so
// screen readers announce the direction (WCAG 4.1.2).
function ariaSort (column: TableColumn): 'ascending' | 'descending' | 'none' {
  if (sortKey.value !== column.key || !sortDir.value) {
    return 'none'
  }
  return sortDir.value === 'asc' ? 'ascending' : 'descending'
}

// Chevron shown in a sortable header: down when this column is the active
// descending sort, up otherwise (ascending, or the hidden inactive spacer).
function sortIcon (column: TableColumn): string {
  return sortKey.value === column.key && sortDir.value === 'desc'
    ? 'chevron-down'
    : 'chevron-up'
}

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
  const query = (searchQuery.value || '').trim().toLowerCase()
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

// Screen-reader announcement of the filter's effect, fed into cat-search-bar's
// polite live region (its #status slot) so filtering has audible feedback.
const totalRowCount = computed(() => tableReport.value?.data?.length ?? 0)
const filterStatus = computed(() => {
  const all = totalRowCount.value
  if (all === 0) {
    return ''
  }
  if (!searchQuery.value) {
    return `Showing all ${all} ${all === 1 ? 'row' : 'rows'}`
  }
  const shown = total.value
  if (shown === 0) {
    return 'No rows match the filter'
  }
  return `Showing ${shown} of ${all} rows`
})
</script>

<style scoped lang="scss">
// cat-search-bar renders full-width; cap it so it stays a filter box in the
// toolbar rather than stretching to the download buttons.
.cal-datagrid-filter {
  flex: 0 1 22rem;
  min-width: 12rem;
}

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

    // Sortable header rendered as a button. Reset to look like plain header
    // text, but fill the cell so the whole header stays a click target.
    .cal-datagrid-sort-button {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      width: 100%;
      margin: 0;
      padding: 0;
      border: none;
      background: transparent;
      font: inherit;
      color: inherit;
      text-align: left;
      cursor: pointer;

      &:focus-visible {
        outline: 2px solid var(--bulma-primary);
        outline-offset: -2px;
      }
    }

    // When a sortable header also has a tooltip, the tooltip wraps the button;
    // keep it filling the cell so the button underneath still spans the header.
    .cal-datagrid-sort-tooltip {
      display: block;
      width: 100%;
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
