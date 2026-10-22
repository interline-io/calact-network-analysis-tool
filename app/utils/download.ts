import { stringify } from 'csv-stringify/browser/esm/sync'
import { sanitizeFilename } from '@interline-io/catenary'

// Rows as CSV, their first row's keys as the header.
export function csvBlob (rows: Record<string, unknown>[]): Blob {
  const columns: Record<string, string> = {}
  for (const k of Object.keys(rows[0] ?? {})) {
    columns[k] = k
  }
  return new Blob([stringify(rows, { header: true, columns })], { type: 'application/csv' })
}

// A file the browser saves, by name.
export function saveBlob (blob: Blob, filename: string): void {
  const a = document.createElement('a')
  a.download = sanitizeFilename(filename)
  a.href = URL.createObjectURL(blob)
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
