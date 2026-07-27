import type { CensusFormat } from './census-columns'

// Generic table model consumed by cal-datagrid and the report/analysis views
// that feed it. Lives in src/core so pure data modules (e.g. report table
// builders) can produce these without importing from app components.
export interface TableColumn {
  key: string
  label: string
  sortable: boolean
  tooltip?: string
  // When set, the default cell renderer routes the value through formatCensusValue.
  format?: CensusFormat
  // Sort this column numerically. Implied by `format`; set explicitly for
  // numeric columns rendered through a slot rather than formatCensusValue,
  // where string collation would order negative values incorrectly.
  numeric?: boolean
}

export interface TableReport {
  columns: TableColumn[]
  data: Record<string, any>[]
}
