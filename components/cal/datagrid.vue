<template>
  <div class="cal-report">
    <div class="cal-report-total block">
      {{ total }} results found
    </div>

    <o-field grouped expanded>
      <o-field>
        <cal-csv-download
          :data="tableReport.data"
          :disabled="loading"
        />
      </o-field>
      <o-pagination
        v-model:current="current"
        expanded
        :total="total"
        order="centered"
        :per-page="perPage"
      />
    </o-field>

    <table class="cal-report-table table is-bordered is-striped">
      <thead>
        <tr>
          <th v-for="column in tableReport.columns" :key="column.key">
            {{ column.label }}
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
</template>

<script lang="ts">
export interface TableColumn {
  key: string
  label: string
  sortable: boolean
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
.cal-report-table {
    th, td {
    padding: 2px 5px;
    }
    th {
    background: #666;
    color: #fff;
    }
}
</style>
