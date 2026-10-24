<template>
  <div :class="props.fill ? 'cal-datagrid-fill' : 'mb-6'">
    <div v-if="props.searchable || props.downloadable || $slots['additional-downloads']" class="is-flex is-align-items-center mb-4" style="gap: 0.5rem;">
      <!-- Search landmark so screen-reader users can jump to the table filter;
           labelled (via filterLabel, from the caption) to distinguish it from
           other filters.
           Landmarks of the same role must be uniquely labelled when more than
           one is exposed at once. Views with several datagrids only ever show
           one — cat-tabs uses v-show (display:none drops it from the
           accessibility tree) and census-details uses v-if — so keep that
           invariant if a layout ever puts two datagrids side by side. -->
      <div v-if="props.searchable" class="cal-datagrid-filter" role="search" :aria-label="filterLabel">
        <!-- ariaLabel/aria-controls passed via a v-bind object: cat-search-bar
             sets inheritAttrs:false, so vue-tsc checks attributes against its
             declared props and rejects a plain :aria-controls; the object also
             keeps vue/attribute-hyphenation from rewriting ariaLabel to kebab
             (which vue-tsc then couldn't map back to the prop). -->
        <cat-search-bar
          v-model="searchQuery"
          :placeholder="FILTER_PLACEHOLDER"
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

      <cat-field v-if="props.downloadable" style="margin-left: auto;">
        <cal-csv-download
          :data="tableReport.data"
          :disabled="loading"
          :filename="props.filename"
        />
      </cat-field>
    </div>

    <!-- Announces sort changes. JAWS reads the aria-sort flip on the header,
         but NVDA and TalkBack stay silent without a live region (same approach
         as cat-table). Rendered from mount, and empty until the user sorts,
         since live regions inserted at announcement time are unreliable. -->
    <span class="is-sr-only" role="status">{{ sortStatus }}</span>

    <div ref="tableContainer" class="table-container" :class="{ 'is-freeze-first': props.freezeFirstColumn }">
      <table :id="tableId" class="cal-report-table table is-bordered is-striped is-hoverable is-fullwidth" :class="{ 'cal-report-table-dense': props.dense }">
        <caption class="is-sr-only">
          {{ props.caption }}
        </caption>
        <!-- With column groups, the groups as <colgroup>s, so a group's
             heading (scope="colgroup") is tied to its columns. -->
        <template v-if="headerRows.length > 1">
          <colgroup v-for="cell in headerRows[0]" :key="cell.column?.key ?? cell.group!.key" :span="cell.colspan ?? 1" />
        </template>
        <thead>
          <!-- With column groups, a row of their headings over the grouped
               columns; the others span both rows. -->
          <tr v-for="(headerRow, r) in headerRows" :key="r">
            <template v-for="cell in headerRow" :key="cell.column?.key ?? cell.group!.key">
              <th
                v-if="cell.group"
                scope="colgroup"
                :colspan="cell.colspan"
                class="cal-datagrid-colgroup"
              >
                <cat-tooltip v-if="cell.group.tooltip" :text="cell.group.tooltip" position="bottom" class="col-header-tooltip">
                  {{ cell.group.label }}
                  <cat-icon icon="information" size="small" />
                </cat-tooltip>
                <span v-else>{{ cell.group.label }}</span>
              </th>
              <th
                v-else
                scope="col"
                :rowspan="cell.rowspan"
                :class="[cell.column!.class, columnClass(cell.column!), { 'is-sortable-th': cell.column!.sortable, 'is-sorted': sortKey === cell.column!.key, 'cal-datagrid-group-th': isGroupColumn(cell.column!) }]"
                :aria-sort="ariaSort(cell.column!)"
              >
                <!-- Grouped: every group open or closed at once, from the first
                     column's header. -->
                <button
                  v-if="isGroupColumn(cell.column!)"
                  type="button"
                  class="cal-datagrid-group-toggle cal-datagrid-group-toggle-all"
                  :aria-label="anyOpen ? 'Collapse all groups' : 'Expand all groups'"
                  :title="anyOpen ? 'Collapse all' : 'Expand all'"
                  @click="setAllOpen(!anyOpen)"
                >
                  <cat-icon size="small" :icon="anyOpen ? 'chevron-down' : 'chevron-right'" />
                </button>
                <!-- Sortable columns render the header as a real <button> so
                     sorting is keyboard-operable (Enter/Space) and announced as a
                     button; aria-sort on the <th> conveys the current direction.
                     When the column also has a tooltip, the button lives inside
                     cat-tooltip — cat-tooltip detects the focusable button and
                     describes it (aria-describedby) rather than adding its own tab
                     stop, so there's no nested interactive content. -->
                <cat-tooltip
                  v-if="cell.column!.sortable && cell.column!.tooltip"
                  :text="cell.column!.tooltip"
                  position="bottom"
                  class="cal-datagrid-sort-tooltip"
                >
                  <button type="button" class="cal-datagrid-sort-button" @click="cycleSort(cell.column!)">
                    {{ cell.column!.label }}
                    <cat-icon icon="information" size="small" />
                    <span class="cal-datagrid-sort-icon">
                      <cat-icon
                        :icon="sortIcon(cell.column!)"
                        size="small"
                        :class="{ 'cal-datagrid-sort-icon-placeholder': sortKey !== cell.column!.key }"
                      />
                    </span>
                  </button>
                </cat-tooltip>
                <button
                  v-else-if="cell.column!.sortable"
                  type="button"
                  class="cal-datagrid-sort-button"
                  @click="cycleSort(cell.column!)"
                >
                  {{ cell.column!.label }}
                  <!-- Sort indicator. Always rendered for sortable columns so
                       toggling the active chevron doesn't change column width;
                       the inactive state shows a hidden chevron as a spacer. -->
                  <span class="cal-datagrid-sort-icon">
                    <cat-icon
                      :icon="sortIcon(cell.column!)"
                      size="small"
                      :class="{ 'cal-datagrid-sort-icon-placeholder': sortKey !== cell.column!.key }"
                    />
                  </span>
                </button>
                <!-- Non-sortable columns: plain header content. -->
                <span v-else class="th-content">
                  <cat-tooltip v-if="cell.column!.tooltip" :text="cell.column!.tooltip" position="bottom" class="col-header-tooltip">
                    {{ cell.column!.label }}
                    <cat-icon icon="information" size="small" />
                  </cat-tooltip>
                  <span v-else>{{ cell.column!.label }}</span>
                </span>
              </th>
            </template>
          </tr>
        </thead>
        <tbody>
          <!-- Width shim: invisible row carrying the per-column widest cell
               in the full filtered dataset, so the browser's auto-layout
               sizes each column to the worst case and widths stay constant
               across pagination / sort. -->
          <tr v-if="layoutShimRow" aria-hidden="true" class="cal-datagrid-shim">
            <td v-for="column in tableReport.columns" :key="column.key" :class="[column.class, columnClass(column)]">
              <!-- Grouped, the first column laid out as its rows are, indented
                   and bold as a heading, the widest either can be. -->
              <div class="cal-datagrid-shim-cell" :class="{ 'cal-datagrid-group-cell cal-datagrid-shim-group': isGroupColumn(column) }">
                <span v-if="isGroupColumn(column)" class="cal-datagrid-group-indent" />
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
          <tr
            v-for="(row, idx) in currentRows"
            :key="row.id ?? row.geoid ?? row.location_id ?? idx"
            :class="[rowClass?.(row), groupRowClass(row)]"
          >
            <td v-for="column in tableReport.columns" :key="column.key" :class="[column.class, columnClass(column)]">
              <!-- An open group's heading leaves its sums to the rows under
                   it. -->
              <template v-if="hidesValue(row, column)" />
              <!-- A group's heading opens and closes it. -->
              <span v-else-if="isGroupColumn(column)" class="cal-datagrid-group-cell">
                <button
                  v-if="opensGroup(row)"
                  type="button"
                  class="cal-datagrid-group-toggle"
                  :aria-expanded="!closed.has(groupOf(row))"
                  :aria-label="`${closed.has(groupOf(row)) ? 'Show' : 'Hide'} rows under ${props.groupLabel?.(row) ?? 'this row'}`"
                  @click="toggleGroup(groupOf(row))"
                >
                  <cat-icon size="small" :icon="closed.has(groupOf(row)) ? 'chevron-right' : 'chevron-down'" />
                </button>
                <span v-else :class="isGroupHead(row) ? 'cal-datagrid-group-toggle' : 'cal-datagrid-group-indent'" />
                <slot
                  :name="`column-${column.key}`"
                  :row="row"
                  :column="column"
                  :value="row[column.key]"
                >
                  {{ renderCell(column, row[column.key]) }}
                </slot>
              </span>
              <slot
                v-else
                :name="`column-${column.key}`"
                :row="row"
                :column="column"
                :value="row[column.key]"
              >
                {{ renderCell(column, row[column.key]) }}
              </slot>
            </td>
          </tr>
          <!-- Scrolling: more rows load as this comes into view. -->
          <tr v-if="props.scroll && shownCount < total" ref="more" class="cal-datagrid-more">
            <td :colspan="tableReport.columns.length">
              Loading more…
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Scrolling, the table says no more than its rows do. -->
    <div v-if="total > 0 && !props.scroll" class="is-flex is-align-items-center mt-4" style="gap: 0.5rem;">
      <span class="has-text-grey">Showing {{ rangeStart }}-{{ rangeEnd }} of {{ total }} results</span>
      <cat-pagination
        v-model:current="current"
        :total="total"
        :per-page="props.perPage"
        style="margin-left: auto;"
      />
    </div>
    <div v-else-if="total === 0" class="has-text-grey mt-4">
      No results found
    </div>
  </div>
</template>

<script setup lang="ts">
import { formatCensusValue, toFiniteNumber, type TableColumn, type TableColumnGroup, type TableReport } from '~~/src/core'

const loading = defineModel<boolean>('loading', { default: false })
const tableReport = defineModel<TableReport>('tableReport', { required: true })
const current = defineModel<number>('current', { default: 1 })

function renderCell (column: TableColumn, value: unknown): string {
  if (column.format !== undefined) {
    return formatCensusValue(toFiniteNumber(value), column.format)
  }
  return value == null ? '' : String(value)
}

const props = withDefaults(defineProps<{
  filename?: string
  // Horizontally scrollable, with the first column pinned.
  freezeFirstColumn?: boolean
  // Accessible table caption. Rendered as a visually-hidden <caption> so screen
  // readers announce the table's purpose; sighted users still see surrounding
  // heading/tab UI for context. Required so every grid is named (WCAG 1.3.1).
  // Also names the filter ("Filter rows in <caption>"), so it is re-read on
  // every focus: keep it to a few words naming what the grid holds ("Routes",
  // "Census geographies"), consistent with the visible heading or tab, and
  // leave out context the surrounding heading already gives (dates, the
  // selected route or area).
  caption: string
  // A class for a row, such as one marking it apart from the rest.
  rowClass?: (row: any) => string | undefined
  // Fill the parent's height (a flex column), with the table scrolling inside
  // and its header row pinned, so its scrollbars stay in view.
  fill?: boolean
  // Rows per page; 20 by default.
  perPage?: number
  // A text filter over the rows; true by default. A view that filters its
  // rows by its own controls can leave it out.
  searchable?: boolean
  // A CSV download button; true by default. A view that downloads its rows
  // from elsewhere on the page can leave it out.
  downloadable?: boolean
  // Smaller type and padding, for more rows in view.
  dense?: boolean
  // Rows in groups, by this field: each group's first row heads it. Sorting
  // orders the groups by their headings and the rows within each group;
  // pages hold whole groups; and a heading opens and closes its group.
  groupKey?: string
  // A group's heading row in words, naming its open and close button.
  groupLabel?: (row: any) => string
  // Rows load perPage at a time as the table scrolls, in place of pages.
  scroll?: boolean
  // Scrolling, what the rows are of: when it changes, loading starts over.
  resetKey?: string
}>(), {
  // Vue reads a missing boolean prop as false; these default to shown.
  searchable: true,
  downloadable: true,
  perPage: 20,
})

// cat-search-bar clears to null (not ''), so the model is nullable.
const searchQuery = ref<string | null>('')
const sortKey = ref<string | null>(null)
const sortDir = ref<'asc' | 'desc' | null>(null)

// SSR-stable id so the filter's aria-controls can point at this table.
const tableId = useId()

// Accessible name for the filter (search fields have no visible label). The
// placeholder is the field's only visible text, so the name must contain it
// verbatim — otherwise a speech-input user who says what they see gets no
// match (WCAG 2.5.3 Label in Name).
const FILTER_PLACEHOLDER = 'Filter rows'
const filterLabel = computed(() => `${FILTER_PLACEHOLDER} in ${props.caption}`)

// aria-sort for the <th> of the column that is currently sorted, so screen
// readers announce the direction (WCAG 4.1.2). Set only on the active column,
// per the APG sortable-table pattern — an explicit "none" on every sortable
// header makes screen readers announce "not sorted" column by column, which on
// a wide census table is pure noise.
function ariaSort (column: TableColumn): 'ascending' | 'descending' | undefined {
  if (sortKey.value !== column.key || !sortDir.value) {
    return undefined
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
  } else if (sortDir.value === 'asc') {
    sortDir.value = 'desc'
  } else if (sortDir.value === 'desc') {
    sortKey.value = null
    sortDir.value = null
  } else {
    sortDir.value = 'asc'
  }
  announceSort(sortDir.value
    ? `Sorted by ${column.label}, ${sortDir.value === 'asc' ? 'ascending' : 'descending'}`
    : `Sort by ${column.label} removed`)
}

// The header's rows: the columns; or with column groups, the groups'
// headings and the ungrouped columns, spanning both rows, over the grouped
// columns.
interface HeaderCell {
  column?: TableColumn
  group?: TableColumnGroup
  rowspan?: number
  colspan?: number
}
const headerRows = computed((): HeaderCell[][] => {
  const columns = tableReport.value?.columns ?? []
  if (!columns.some(c => c.group)) {
    return [columns.map(column => ({ column }))]
  }
  const top: HeaderCell[] = []
  const bottom: HeaderCell[] = []
  for (const column of columns) {
    if (!column.group) {
      top.push({ column, rowspan: 2 })
      continue
    }
    const last = top[top.length - 1]
    if (last?.group?.key === column.group.key) {
      last.colspan = (last.colspan ?? 1) + 1
    } else {
      top.push({ group: column.group, colspan: 1 })
    }
    bottom.push({ column })
  }
  return [top, bottom]
})

const sortStatus = ref('')
function announceSort (message: string) {
  // Clear first so repeating the same message still triggers an announcement.
  sortStatus.value = ''
  nextTick(() => {
    sortStatus.value = message
  })
}

function matches (row: Record<string, any>, query: string): boolean {
  return Object.values(row).some(val => String(val ?? '').toLowerCase().includes(query))
}

// The filter as typed, trimmed and in lower case.
const query = computed(() => (searchQuery.value || '').trim().toLowerCase())

// Grouped, the filter keeps whole groups, so is applied to them below.
const filteredData = computed(() => {
  const data = tableReport?.value?.data || []
  if (!query.value || props.groupKey) {
    return data
  }
  return data.filter(row => matches(row, query.value))
})

// The sort's comparison, if any. Nullish values are pushed to the end
// regardless of direction so they don't pollute either tail of a sorted
// column.
const compareRows = computed(() => {
  const key = sortKey.value
  const dir = sortDir.value
  if (!key || !dir) {
    return undefined
  }
  const col = tableReport.value?.columns.find(c => c.key === key)
  const numeric = col?.numeric === true || col?.format !== undefined
  const sign = dir === 'asc' ? 1 : -1
  return (a: Record<string, any>, b: Record<string, any>): number => {
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
  }
})

const sortedData = computed(() => {
  const compare = compareRows.value
  return compare ? [...filteredData.value].sort(compare) : filteredData.value
})

// Grouped: the rows by group, in their first row's order, filtered and
// sorted as groups. A row with no group stands alone, as its own.
const ownGroups = new WeakMap<object, string>()
let ownGroupCount = 0
function groupOf (row: Record<string, any>): string {
  const key = row[props.groupKey!]
  if (key != null) {
    return String(key)
  }
  let own = ownGroups.get(row)
  if (own === undefined) {
    own = `\u0000${ownGroupCount++}`
    ownGroups.set(row, own)
  }
  return own
}
const groups = computed((): Record<string, any>[][] => {
  if (!props.groupKey) {
    return []
  }
  const byGroup = new Map<string, Record<string, any>[]>()
  for (const row of filteredData.value) {
    const id = groupOf(row)
    const rows = byGroup.get(id)
    if (rows) {
      rows.push(row)
    } else {
      byGroup.set(id, [row])
    }
  }
  let list = [...byGroup.values()]
  if (query.value) {
    list = list.filter(rows => rows.some(row => matches(row, query.value)))
  }
  const compare = compareRows.value
  if (compare) {
    list = list.map(([head, ...rest]) => [head!, ...rest.sort(compare)]).sort((a, b) => compare(a[0]!, b[0]!))
  }
  return list
})

// Groups closed to their heading; all open to begin with.
const closed = ref(new Set<string>())
// Each heading row, and whether its group has rows under it to open.
const heads = computed(() => new Map(groups.value.map(rows => [rows[0], rows.length > 1])))
function isGroupHead (row: Record<string, any>): boolean {
  return heads.value.has(row)
}
function opensGroup (row: Record<string, any>): boolean {
  return heads.value.get(row) === true
}
function toggleGroup (id: string) {
  const next = new Set(closed.value)
  if (!next.delete(id)) {
    next.add(id)
  }
  closed.value = next
}
const anyOpen = computed(() => groups.value.some(rows => rows.length > 1 && !closed.value.has(groupOf(rows[0]!))))
function setAllOpen (open: boolean) {
  closed.value = open ? new Set() : new Set(groups.value.map(rows => groupOf(rows[0]!)))
}
// The grouped grid's first column, which holds the open and close buttons.
function isGroupColumn (column: TableColumn): boolean {
  return !!props.groupKey && column === tableReport.value.columns[0]
}

// A column's alignment and width, as classes on its header and cells; and
// the first column marked, as with column groups its header is not the
// first in its header row, for the frozen first column to pin.
function columnClass (column: TableColumn) {
  return {
    'cal-datagrid-col-center': column.align === 'center',
    'cal-datagrid-col-shrink': column.shrink,
    'cal-datagrid-first': column === tableReport.value?.columns[0],
  }
}

// An open group's heading row, in a column that sums up the rows under it;
// never the first column, which holds the group's button.
function hidesValue (row: Record<string, any>, column: TableColumn): boolean {
  return !!props.groupKey && !!column.groupSummary && !isGroupColumn(column) && opensGroup(row) && !closed.value.has(groupOf(row))
}

function groupRowClass (row: Record<string, any>): string | undefined {
  if (!props.groupKey) {
    return undefined
  }
  return isGroupHead(row) ? 'cal-datagrid-group-head' : 'cal-datagrid-group-row'
}

watch(searchQuery, () => {
  current.value = 1
})

watch(() => tableReport.value?.columns, () => {
  searchQuery.value = ''
  sortKey.value = null
  sortDir.value = null
  // Silently drop the last sort message so it isn't left describing a
  // column the new table may not have.
  sortStatus.value = ''
})

// Back to the first page, or scrolling, the first rows.
function resetPaging () {
  current.value = 1
  shown.value = props.perPage
}

// Reset pagination when data changes (e.g. tab switch, filter update).
// Scrolling, a refresh of the same rows keeps those loaded; resetKey says
// when the rows are new.
watch(() => tableReport.value?.data, () => {
  current.value = 1
})

// Reset when the sort changes, so the user sees the new top of the list, or
// when the rows are new.
watch([sortKey, sortDir, () => props.resetKey], resetPaging)
// New rows, or other groups or columns, start with every group open; a
// refresh of the same rows keeps groups as they were.
watch([() => props.resetKey, () => props.groupKey, () => tableReport.value?.columns], () => {
  closed.value = new Set()
})

// Scrolling: the rows (or groups) shown so far, and more as the last row
// nears the table's bottom edge.
const shown = ref(props.perPage)
const shownCount = computed(() => Math.min(shown.value, total.value))
const tableContainer = ref<HTMLElement>()
const more = ref<HTMLElement>()
let observer: IntersectionObserver | undefined
watch(more, (el) => {
  observer?.disconnect()
  if (!el) {
    return
  }
  // The table scrolls inside its container where it fills its parent, and
  // with the page otherwise.
  observer = new IntersectionObserver((entries) => {
    if (entries.some(e => e.isIntersecting)) {
      shown.value += props.perPage
    }
  }, { root: props.fill ? tableContainer.value : null, rootMargin: '200px' })
  observer.observe(el)
})
// After each load, looked at again: still in view, it loads more, as the
// observer reports only changes.
watch(shown, () => {
  if (observer && more.value) {
    observer.unobserve(more.value)
    observer.observe(more.value)
  }
}, { flush: 'post' })
onBeforeUnmount(() => observer?.disconnect())

const currentRows = computed(() => {
  const start = props.scroll ? 0 : (current.value - 1) * props.perPage
  const end = props.scroll ? shown.value : start + props.perPage
  if (props.groupKey) {
    return groups.value.slice(start, end).flatMap(rows => (closed.value.has(groupOf(rows[0]!)) ? rows.slice(0, 1) : rows))
  }
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
// Rows, or grouped, groups.
const total = computed(() => {
  return props.groupKey ? groups.value.length : sortedData.value.length
})
const rangeStart = computed(() => {
  return total.value === 0 ? 0 : (current.value - 1) * props.perPage + 1
})
const rangeEnd = computed(() => {
  return Math.min(current.value * props.perPage, total.value)
})

// Screen-reader announcement of the filter's effect, fed into cat-search-bar's
// polite live region (its #status slot) so filtering has audible feedback.
//
// Empty unless a filter is actually applied, for two reasons. The live region
// must start empty: a region inserted with content already in it gets read out
// immediately, and the filter is reset (not the component remounted) whenever
// the report sub-tab changes the columns, so clearing to '' keeps that silent.
// And a status message reports the outcome of a user action (WCAG 4.1.3) — row
// counts that move because the scenario re-ran or the user changed report
// sub-tabs are not the outcome of a search, and announcing them from inside the
// search landmark misattributes them to the filter.
const filterStatus = computed(() => {
  // Trimmed to match filteredData, so a whitespace-only query (which filters
  // nothing) stays silent rather than claiming "Showing N of N".
  if (!(searchQuery.value || '').trim()) {
    return ''
  }
  // Grouped, the rows in the groups kept, against all rows.
  const shown = props.groupKey ? groups.value.reduce((n, rows) => n + rows.length, 0) : total.value
  if (shown === 0) {
    return 'No rows match the filter'
  }
  const all = tableReport.value?.data?.length ?? 0
  return `Showing ${shown} of ${all} ${all === 1 ? 'row' : 'rows'}`
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

.cal-report-table.cal-report-table-dense {
  font-size: 0.875rem;

  th, td {
    padding: 0.3rem 0.5rem;
  }
}

.cal-datagrid-fill {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;

  .table-container {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    margin-bottom: 0;
  }

  // The whole header, with any row of column groups, pinned as one.
  .cal-report-table thead {
    position: sticky;
    top: 0;
    z-index: 3;
  }
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

  // A column group's heading, centered over its columns.
  th.cal-datagrid-colgroup {
    text-align: center;
    font-size: 0.8em;
    border-bottom-width: 1px;
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
    // text, but carry the cell's own padding (see .is-sortable-th below) so the
    // button fills the header rather than shrinking the target to the label's
    // line box — which would leave a ring that still shows the pointer cursor
    // and hover highlight but no longer sorts.
    .cal-datagrid-sort-button {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      width: 100%;
      margin: 0;
      padding: 0.5rem 0.75rem;
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
      // Padding lives on the inner button instead, so the padded area is part
      // of the click target and matches the pointer/hover affordance below.
      padding: 0;
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
    th.cal-datagrid-first,
    td.cal-datagrid-first {
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

    thead th.cal-datagrid-first {
      background: var(--bulma-scheme-main-ter);
      z-index: 3;
    }

    // A group's heading row keeps its shade in the pinned cell too.
    tr.cal-datagrid-group-head td.cal-datagrid-first {
      background: var(--bulma-scheme-main-bis);
    }
  }
}

// Scrolling: the row that loads more, quietly.
.cal-datagrid-more td {
  text-align: center;
  color: var(--bulma-text-weak);
  font-size: 0.8em;
}

// A column only as wide as its content, and one centered, its sort button
// too.
.cal-report-table {
  .cal-datagrid-col-shrink {
    width: 1%;
    white-space: nowrap;
  }

  .cal-datagrid-col-center {
    text-align: center;

    .cal-datagrid-sort-button {
      justify-content: center;
    }
  }

  // A group's heading row, set apart from the rows under it.
  tr.cal-datagrid-group-head td {
    background: var(--bulma-scheme-main-bis);
    font-weight: 600;
    border-top: 2px solid var(--bulma-border);
  }
}

// Grouped rows: a heading's open and close button, and the rows under it
// indented past it.
.cal-datagrid-group-cell {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.cal-datagrid-group-toggle {
  flex: 0 0 1.25rem;
  background: none;
  border: 0;
  padding: 0;
  color: var(--bulma-text-weak);
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid var(--bulma-primary);
  }
}

.cal-datagrid-group-indent {
  display: inline-block;
  flex: 0 0 2.5rem;
  width: 2.5rem;
}

.cal-report-table th.cal-datagrid-group-th {
  position: relative;

  .cal-datagrid-group-toggle-all {
    position: absolute;
    left: 0.4rem;
    top: 50%;
    transform: translateY(-50%);
    z-index: 1;
  }

  .cal-datagrid-sort-button {
    padding-left: 1.9rem;
  }

  // An unsortable first column's label, past the button too.
  .th-content {
    margin-left: 1.15rem;
  }
}

.cal-datagrid-shim-group {
  font-weight: 600;
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
