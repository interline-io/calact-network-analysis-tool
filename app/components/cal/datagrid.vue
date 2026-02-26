<template>
  <div>
    <div v-if="showResultsCount" class="cal-report-total block">
      {{ total }} results found
    </div>

    <div class="is-flex is-align-items-center mb-4" style="gap: 0.5rem;">
      <t-field>
        <cal-csv-download
          :data="tableReport.data"
          :disabled="loading"
          :filename="props.filename"
        />
      </t-field>

      <!-- Slot for additional download buttons, such as GeoJSON -->
      <slot name="additional-downloads" :data="tableReport.data" :loading="loading" />

      <t-pagination
        v-model:current="current"
        :total="total"
        :per-page="perPage"
        style="margin-left: auto;"
      />
    </div>

    <div class="table-container">
      <table class="cal-report-table table is-bordered is-striped is-hoverable is-fullwidth">
        <thead class="is-sticky">
          <tr>
            <th v-for="column in tableReport.columns" :key="column.key">
              <t-tooltip v-if="column.tooltip" :text="column.tooltip" position="bottom" class="col-header-tooltip">
                {{ column.label }}
                <t-icon icon="information" size="small" />
              </t-tooltip>
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
const showResultsCount = defineModel<boolean>('showResultsCount', { default: true })

const props = defineProps<{
  filename?: string
}>()
const currentRows = computed(() => {
  const start = (current.value - 1) * perPage
  const end = start + perPage
  return tableReport?.value?.data.slice(start, end) || []
})
const total = computed(() => {
  return (tableReport?.value?.data || []).length
})
</script>

<style scoped lang="scss">
.table-container {
  max-height: 70vh;
  overflow: auto;
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
    position: sticky;
    top: 0;
    z-index: 10;
    border-bottom: 2px solid var(--bulma-border);

    // Promote the hovered th so its ::after tooltip paints above table rows
    &:hover {
      z-index: 20;
    }

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

  // Ensure sticky header works properly
  thead.is-sticky {
    position: sticky;
    top: 0;
    z-index: 10;
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
