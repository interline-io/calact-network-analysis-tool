<template>
  <div class="cal-report">
    <div class="cal-report-total block">
      {{ tableReport.total }} results found
    </div>

    <o-pagination
      v-model:current="current"
      :total="tableReport.total"
      order="centered"
      :per-page="tableReport.perPage"
    />

    <table class="cal-report-table table is-bordered is-striped">
      <thead>
        <tr>
          <th v-for="column in tableReport.columns" :key="column.key">
            {{ column.label }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in tableReport.data" :key="row.id">
          <td v-for="column in tableReport.columns" :key="column.key">
            {{ row[column.key] }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script lang="ts">
export interface TableReport {
  total: number
  perPage: number
  columns: { key: string, label: string, sortable: boolean }[]
  data: Record<string, any>[]
}
</script>

<script setup lang="ts">

const tableReport = defineModel<TableReport>('tableReport', { required: true })
const current = defineModel<number>('current', { required: true })

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
