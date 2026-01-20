<template>
  <div>
    <!-- Empty results warning -->
    <t-msg
      v-if="report.summary.totalRecords === 0"
      variant="warning"
      class="mt-4"
    >
      No matching NTD records found for {{ report.summary.state }} in {{ report.summary.year }}.
      This may occur if the selected state has no transit agencies reporting data for this year,
      or if all agencies are classified as Non-UZA (rural areas without urbanized area designation).
    </t-msg>

    <!-- Summary Card -->
    <t-card label="Analysis Summary" class="mt-4">
      <div class="columns">
        <div class="column">
          <div class="content">
            <p><strong>State:</strong> {{ report.summary.state }}</p>
            <p><strong>Year:</strong> {{ report.summary.year }}</p>
          </div>
        </div>
        <div class="column">
          <div class="content">
            <p><strong>Transit Agencies:</strong> {{ report.summary.totalAgencies }}</p>
            <p><strong>Urbanized Areas:</strong> {{ report.summary.totalUZAs }}</p>
          </div>
        </div>
        <div class="column">
          <div class="content">
            <p><strong>Total Records:</strong> {{ report.summary.totalRecords.toLocaleString() }}</p>
          </div>
        </div>
      </div>
    </t-card>

    <!-- Tabbed Interface -->
    <div class="mt-4">
      <t-tabs
        v-model="activeTab"
        expanded
      >
        <t-tab-item
          :value="0"
          :label="`Transit Service by UZA (${report.mareaTransitService.length})`"
          icon="city"
        >
          <div class="mt-4">
            <h4 class="title is-4">
              Vehicle Revenue Miles by Urbanized Area and VisionEval Mode
            </h4>
            <cal-datagrid
              :table-report="mareaDatagrid"
              :show-results-count="false"
              filename="marea_transit_service"
            >
              <template #column-DRRevMi="{ value }">
                {{ formatNumber(value) }}
              </template>
              <template #column-VPRevMi="{ value }">
                {{ formatNumber(value) }}
              </template>
              <template #column-MBRevMi="{ value }">
                {{ formatNumber(value) }}
              </template>
              <template #column-RBRevMi="{ value }">
                {{ formatNumber(value) }}
              </template>
              <template #column-MGRevMi="{ value }">
                {{ formatNumber(value) }}
              </template>
              <template #column-SRRevMi="{ value }">
                {{ formatNumber(value) }}
              </template>
              <template #column-HRRevMi="{ value }">
                {{ formatNumber(value) }}
              </template>
              <template #column-CRRevMi="{ value }">
                {{ formatNumber(value) }}
              </template>
            </cal-datagrid>
          </div>
        </t-tab-item>

        <t-tab-item
          :value="1"
          :label="`Cost per Mile (${report.costPerRevenueMile.length})`"
          icon="currency-usd"
        >
          <div class="mt-4">
            <h4 class="title is-4">
              Statewide Cost per Revenue Mile by Mode
            </h4>

            <cal-datagrid
              :table-report="costDatagrid"
              :show-results-count="false"
              filename="cost_per_revenue_mile"
            >
              <template #column-Mode="{ value }">
                <abbr :title="VISIONEVAL_MODE_NAMES[value] || value">{{ value }}</abbr>
              </template>
              <template #column-CostPerRevenueMile="{ value }">
                ${{ value.toFixed(2) }}
              </template>
            </cal-datagrid>
          </div>
        </t-tab-item>

        <t-tab-item
          :value="2"
          :label="`Raw Records (${report.rawRecords.length})`"
          icon="table"
        >
          <div class="mt-4">
            <h4 class="title is-4">
              Raw NTD Records
            </h4>

            <cal-datagrid
              :table-report="rawDatagrid"
              :show-results-count="false"
              filename="ntd_raw_records"
            >
              <template #column-vehicleRevenueMiles="{ value }">
                {{ formatNumber(value) }}
              </template>
              <template #column-totalOperatingExpenses="{ value }">
                ${{ formatNumber(value) }}
              </template>
            </cal-datagrid>
          </div>
        </t-tab-item>
      </t-tabs>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { VISIONEVAL_MODE_NAMES, type VisionEvalReport } from '~~/src/analysis/visioneval'
import type { TableColumn, TableReport } from '~/components/cal/datagrid.vue'

// Define models for props
const report = defineModel<VisionEvalReport>('report', { required: true })

// Tab state
const activeTab = ref(0)

// Format large numbers with commas
const formatNumber = (value: number): string => {
  return value.toLocaleString()
}

// marea_transit_service datagrid (per issue #260 column spec)
const mareaDatagrid = computed((): TableReport => {
  const data = report.value.mareaTransitService.map(row => ({
    id: `${row.Geo}-${row.Year}`,
    ...row,
  }))

  const columns: TableColumn[] = [
    { key: 'Geo', label: 'Urbanized Area (Geo)', sortable: true },
    { key: 'Year', label: 'Year', sortable: true },
    { key: 'DRRevMi', label: 'DR (Demand Response)', sortable: true },
    { key: 'VPRevMi', label: 'VP (Vanpool)', sortable: true },
    { key: 'MBRevMi', label: 'MB (Bus)', sortable: true },
    { key: 'RBRevMi', label: 'RB (BRT)', sortable: true },
    { key: 'MGRevMi', label: 'MG (Monorail)', sortable: true },
    { key: 'SRRevMi', label: 'SR (Streetcar)', sortable: true },
    { key: 'HRRevMi', label: 'HR (Heavy Rail)', sortable: true },
    { key: 'CRRevMi', label: 'CR (Commuter Rail)', sortable: true },
  ]

  return {
    data,
    columns,
  }
})

// cost_per_revenue_mile datagrid (per issue #260 column spec)
const costDatagrid = computed((): TableReport => {
  const data = report.value.costPerRevenueMile.map(row => ({
    id: `${row.YearOfDollars}-${row.Mode}`,
    ...row,
  }))

  const columns: TableColumn[] = [
    { key: 'YearOfDollars', label: 'YearOfDollars', sortable: true },
    { key: 'Mode', label: 'Mode', sortable: true },
    { key: 'CostPerRevenueMile', label: 'CostPerRevenueMile', sortable: true },
  ]

  return {
    data,
    columns,
  }
})

// Raw records datagrid (for verification/debugging)
const rawDatagrid = computed((): TableReport => {
  const data = report.value.rawRecords.map(row => ({
    id: `${row.ntdId}-${row.year}-${row.mode}-${row.typeOfService}`,
    ...row,
  }))

  const columns: TableColumn[] = [
    { key: 'ntdId', label: 'NTD ID', sortable: true },
    { key: 'agency', label: 'Agency', sortable: true },
    { key: 'state', label: 'State', sortable: true },
    { key: 'uzaName', label: 'UZA Name', sortable: true },
    { key: 'year', label: 'Year', sortable: true },
    { key: 'mode', label: 'Mode', sortable: true },
    { key: 'modeName', label: 'Mode Name', sortable: true },
    { key: 'typeOfService', label: 'Type of Service', sortable: true },
    { key: 'vehicleRevenueMiles', label: 'Vehicle Revenue Miles', sortable: true },
    { key: 'totalOperatingExpenses', label: 'Total Operating Expenses', sortable: true },
  ]

  return {
    data,
    columns,
  }
})
</script>
