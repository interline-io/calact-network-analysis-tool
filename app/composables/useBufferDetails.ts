// Buffer details modal state (#315): payload, open/close, derived props for
// `<cal-census-details>` in buffer mode, and the lazy Map-tab geometry fetch.

import { computed, ref, type ComputedRef, type Ref, type WritableComputedRef } from 'vue'
import { useApolloClient } from '@vue/apollo-composable'
import type { BufferDetailsPayload } from '~/components/cal/report.vue'
import {
  apportionBuffer,
  REQUIRED_ACS_TABLES,
  type CensusGeographyEntry,
} from '~~/src/core'
import {
  BUFFER_QUERY_BY_KIND,
  parseBufferEntityResult,
  type BufferEntityKind,
  type BufferQueryResponse,
} from '~~/src/tl'

const BUFFER_KIND_LABELS: Record<BufferDetailsPayload['kind'], string> = {
  stop: 'Stop',
  route: 'Route',
  agency: 'Agency',
}

const DETAILS_KIND_TO_BUFFER_KIND: Record<BufferDetailsPayload['kind'], BufferEntityKind> = {
  stop: 'stops',
  route: 'routes',
  agency: 'agencies',
}

export interface BufferDetailsHeader {
  kindLabel: string
  id: number | string
  name: string
  radius?: number
  layer?: string
}

export interface BufferApportionmentSummary {
  values: Record<string, number | null>
  pctCoverage: number
}

export interface UseBufferDetailsReturn {
  payload: Ref<BufferDetailsPayload | undefined>
  show: WritableComputedRef<boolean>
  open: (next: BufferDetailsPayload) => void
  entries: ComputedRef<CensusGeographyEntry[]>
  headerProps: ComputedRef<BufferDetailsHeader | undefined>
  apportionment: ComputedRef<BufferApportionmentSummary | undefined>
  filenamePrefix: ComputedRef<string>
  geometryLoading: Ref<boolean>
  geometryError: Ref<string | null>
  loadGeometry: () => Promise<void>
}

export function useBufferDetails (): UseBufferDetailsReturn {
  const payload = ref<BufferDetailsPayload | undefined>(undefined)

  // Populated lazily on first Map-tab activation via `loadGeometry`.
  const geometryEntries = ref<CensusGeographyEntry[] | undefined>(undefined)
  const geometryLoading = ref(false)
  const geometryError = ref<string | null>(null)

  const show = computed({
    get: () => payload.value !== undefined,
    set: (v: boolean) => {
      if (!v) { payload.value = undefined }
    },
  })

  function open (next: BufferDetailsPayload): void {
    geometryEntries.value = undefined
    geometryLoading.value = false
    geometryError.value = null
    payload.value = next
  }

  const entries = computed<CensusGeographyEntry[]>(() => {
    return geometryEntries.value ?? payload.value?.entries ?? []
  })

  const headerProps = computed(() => {
    const p = payload.value
    if (!p) { return undefined }
    return {
      kindLabel: BUFFER_KIND_LABELS[p.kind],
      id: p.entityId,
      name: p.entityLabel,
      radius: p.radius,
      layer: p.layer,
    }
  })

  // Locked to the original payload entries — apportionment math doesn't need
  // geometry, so this stays stable while the Map tab fetches.
  const apportionment = computed(() => {
    const p = payload.value
    if (!p) { return undefined }
    return apportionBuffer(p.entries)
  })

  const filenamePrefix = computed(() => {
    const p = payload.value
    return p ? `${p.kind}-${p.entityId}-buffer` : 'buffer'
  })

  const { resolveClient } = useApolloClient()

  async function loadGeometry (): Promise<void> {
    const p = payload.value
    if (!p) { return }
    // Drop the response if the user pivoted to another entity before we resolved.
    const requestEntityId = p.entityId
    const isStale = () => payload.value?.entityId !== requestEntityId

    geometryLoading.value = true
    geometryError.value = null
    try {
      const bufferKind = DETAILS_KIND_TO_BUFFER_KIND[p.kind]
      const result = await resolveClient().query<BufferQueryResponse>({
        query: BUFFER_QUERY_BY_KIND[bufferKind],
        variables: {
          ids: [p.entityId],
          dataset: p.geoDatasetName,
          layer: p.layer,
          radius: p.radius,
          tableDataset: p.tableDatasetName,
          tableNames: REQUIRED_ACS_TABLES,
          includeGeometry: true,
        },
        fetchPolicy: 'no-cache',
      })
      if (isStale()) { return }
      geometryEntries.value = parseBufferEntityResult(result.data, bufferKind, p.tableDatasetName)
    } catch (err: any) {
      if (isStale()) { return }
      geometryError.value = err?.message || String(err)
    } finally {
      if (!isStale()) {
        geometryLoading.value = false
      }
    }
  }

  return {
    payload,
    show,
    open,
    entries,
    headerProps,
    apportionment,
    filenamePrefix,
    geometryLoading,
    geometryError,
    loadGeometry,
  }
}
