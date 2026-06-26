import type { CensusGeographyEntry } from '~~/src/core'

// Payload for the buffer-details drill-down (#315): emitted by report.vue when a
// census cell is clicked, handled by tne.vue, consumed by useBufferDetails. Lives
// in src/ so the composable doesn't have to import a type out of a .vue component.

export type BufferDetailsKind = 'stop' | 'route' | 'agency'

export interface BufferDetailsPayload {
  kind: BufferDetailsKind
  entityId: number
  entityLabel: string
  entries: CensusGeographyEntry[]
  radius: number
  layer: string
  geoDatasetName: string
  tableDatasetName: string
}
