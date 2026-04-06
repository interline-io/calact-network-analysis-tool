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

    <div class="table-container">
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
          <tr v-for="row in currentRows" :key="row.id">
            <td v-for="column in tableReport.columns" :key="column.key">
              <slot
                :name="`column-${column.key}`"
                :row="row"
                :column="column"
                :value="row[column.key]"
              >
                {{ row[column.key] }}
              </slot>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="is-flex is-align-items-center mt-4" style="gap: 0.5rem;">
      <span class="has-text-grey">Showing {{ rangeStart }}-{{ rangeEnd }} of {{ total }} results</span>
      <cat-pagination
        v-model:current="current"
        :total="total"
        :per-page="perPage"
        style="margin-left: auto;"
      />
    </div>
  </div>
</template>

<script lang="ts">
export interface TableColumn {
  key: string
  label: string
  sortable: boolean
  tooltip?: string
}

export interface TableReport {
  columns: TableColumn[]
  data: Record<string, any>[]
}
</script>

<script setup lang="ts">
const perPage = 20
const loading = defineModel<boolean>('loading', { default: false })
const tableReport = defineModel<TableReport>('tableReport', { required: true })
const current = defineModel<number>('current', { default: 1 })

const props = defineProps<{
  filename?: string
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
