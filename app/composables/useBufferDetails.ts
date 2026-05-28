// Buffer details modal state machine (#315). Owns:
//   - the payload passed in from a report tab's drill-down click,
//   - the modal's open/close v-model,
//   - the props the unified `<cal-census-details>` consumes in buffer mode
//     (entries, header, apportionment summary, filename prefix),
//   - the lazy geometry fetch that fires when the Map tab is first opened.
//
// Pulled out of tne.vue so the page file stays focused on top-level page
// composition rather than per-modal plumbing.

import { computed, ref } from 'vue'
import { useApolloClient } from '@vue/apollo-composable'
import type { BufferDetailsPayload } from '~/components/cal/report.vue'
import {
  apportionBuffer,
  REQUIRED_ACS_TABLES,
  type CensusGeographyEntry,
} from '~~/src/core'
import {
  BUFFER_QUERY_BY_KIND,
  parseGeographyRow,
  type BufferEntityKind,
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

export function useBufferDetails () {
  const payload = ref<BufferDetailsPayload | undefined>(undefined)

  // Lazy-loaded geometry-enriched buffer entries. Populated on the first
  // activation of the Map tab via `loadGeometry`.
  const geometryEntries = ref<CensusGeographyEntry[] | undefined>(undefined)
  const geometryLoading = ref(false)
  const geometryError = ref<string | null>(null)

  // Modal v-model. Closing the modal clears the payload, which unmounts the
  // census-details component (so `:key` doesn't matter for cross-entity reset).
  const show = computed({
    get: () => payload.value !== undefined,
    set: (v: boolean) => {
      if (!v) { payload.value = undefined }
    },
  })

  function open (next: BufferDetailsPayload): void {
    // Reset lazy-geometry state for the new entity so the Map tab refetches.
    geometryEntries.value = undefined
    geometryLoading.value = false
    geometryError.value = null
    payload.value = next
  }

  // Entries swap to the geometry-enriched fetch result once the Map tab has
  // loaded; until then, the entries shipped with the payload are used.
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

  // Locked at modal-open time — uses the original payload entries, not the
  // geometry-enriched fetch result. Apportionment math doesn't depend on
  // geometry, so this stays stable while the Map tab loads.
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
    // Capture the entity at request time so a stale response (from a prior
    // entity whose fetch hadn't resolved before the user switched modals)
    // doesn't overwrite the current entity's state.
    const requestEntityId = p.entityId
    const isStale = () => payload.value?.entityId !== requestEntityId

    geometryLoading.value = true
    geometryError.value = null
    try {
      const bufferKind = DETAILS_KIND_TO_BUFFER_KIND[p.kind]
      const result = await resolveClient().query({
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
      const ent = (result.data as Record<string, { id: number, census_geographies?: any[] }[]>)
        ?.[bufferKind]?.[0]
      const parsed: CensusGeographyEntry[] = []
      for (const g of ent?.census_geographies || []) {
        const row = parseGeographyRow(g, p.tableDatasetName)
        if (row) {
          parsed.push(row)
        }
      }
      geometryEntries.value = parsed
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
