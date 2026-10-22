import { stringify } from 'csv-stringify/browser/esm/sync'

// Rows as CSV, their first row's keys as the header; saved with catenary's
// useDownload.
export function csvString (rows: Record<string, unknown>[]): string {
  const columns: Record<string, string> = {}
  for (const k of Object.keys(rows[0] ?? {})) {
    columns[k] = k
  }
  return stringify(rows, { header: true, columns })
}
