// The query area from an uploaded or saved geography (#477), for tne.vue to
// pass down: the polygon a run uses, its name, and the loading of the saved
// boundaries the URL names.
//
// Several saved boundaries of one kind combine into one area. Saved uploads
// become the run's polygon, their parts listed together. Saved sets of admin
// boundaries are written into geographyIds, the same path the Administrative
// Boundary mode uses (the server merges them), after checking the ids still
// name the same places. The server takes one kind of area at a time, so the
// two kinds can't be combined.

import { computed, markRaw, ref, watch, type Ref } from 'vue'
import {
  isAdminBoundaryDocument,
  isUploadDocument,
  uploadDocumentPolygon,
  type AdminBoundaryDocument,
  type QueryPolygon,
} from '~~/src/core'
import type { CensusGeography } from '~~/src/tl'
import { useScenarioInputs } from './useScenarioInputs'
import { savedGeographyErrorMessage, useSavedGeographies } from './useSavedGeographies'
import { useUploadedGeography } from './useUploadedGeography'

export interface LoadedSavedGeography {
  id: string
  name: string
  polygon?: QueryPolygon
  adminBoundaries?: AdminBoundaryDocument
}

export interface QueryGeographyMessage {
  variant: 'danger' | 'warning'
  text: string
}

export function useQueryGeography (censusGeographiesSelected: Ref<CensusGeography[]>) {
  const { geomSource, savedGeographies, geographyIds, geoDatasetName } = useScenarioInputs()
  const { upload, uploadPolygon } = useUploadedGeography()
  const { access, geographies, manageUrl, loadAccess, get } = useSavedGeographies()

  // Kept for the session by id, so coming back to the page, or adding a
  // boundary to the selection, doesn't fetch the others again
  const loaded = useState<Record<string, LoadedSavedGeography>>('cal-loaded-saved-geographies', () => ({}))
  const loading = ref(false)
  const loadErrors = ref<string[]>([])
  // Counts loads, for the page to show each newly loaded selection
  const loads = ref(0)

  void loadAccess()

  const selectedIds = computed(() => geomSource.value === 'custom' ? savedGeographies.value : [])

  // The chosen boundaries, once all have loaded
  const selection = computed((): LoadedSavedGeography[] | null => {
    const all = selectedIds.value.map(id => loaded.value[id])
    return all.length > 0 && all.every(g => !!g) ? all as LoadedSavedGeography[] : null
  })

  const selectionKind = computed((): 'upload' | 'admin_boundary' | 'mixed' | null => {
    const s = selection.value
    if (!s) {
      return null
    }
    const uploads = s.filter(g => g.polygon).length
    if (uploads === s.length) {
      return 'upload'
    }
    return uploads === 0 ? 'admin_boundary' : 'mixed'
  })

  const adminDatasets = computed(() => new Set((selection.value || []).map(g => g.adminBoundaries?.dataset).filter(Boolean)))

  // Writes the chosen boundary sets into the inputs the boundaries mode uses
  function applyAdminBoundaries (docs: AdminBoundaryDocument[]) {
    const ids = [...new Set(docs.flatMap(doc => doc.geographies.map(g => g.id)))]
    if (ids.join(',') !== geographyIds.value.join(',')) {
      geographyIds.value = ids
    }
    const dataset = docs[0]?.dataset
    if (dataset && dataset !== geoDatasetName.value) {
      geoDatasetName.value = dataset
    }
  }

  async function loadOne (id: string): Promise<void> {
    try {
      const saved = await get(id)
      if (isUploadDocument(saved.content)) {
        loaded.value = { ...loaded.value, [id]: { id, name: saved.name, polygon: markRaw(uploadDocumentPolygon(saved.content)) } }
      } else if (isAdminBoundaryDocument(saved.content)) {
        loaded.value = { ...loaded.value, [id]: { id, name: saved.name, adminBoundaries: saved.content } }
      } else {
        loadErrors.value.push(`"${saved.name}" isn't a boundary this version of the app can read.`)
      }
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      loadErrors.value.push(status === 404
        ? 'A boundary in this link isn\'t in your account. Saved boundaries belong to the person who saved them: ask them to download it from their profile and send you the file to upload.'
        : `Couldn't load a saved boundary: ${savedGeographyErrorMessage(e)}`)
    }
  }

  let requested = ''
  watch(selectedIds, async (ids) => {
    loadErrors.value = []
    const key = ids.join(',')
    requested = key
    const missing = ids.filter(id => !loaded.value[id])
    if (missing.length > 0) {
      loading.value = true
      await Promise.all(missing.map(loadOne))
      // A later choice has replaced this one
      if (requested !== key) {
        return
      }
      loading.value = false
    }
    const s = selection.value
    if (!s) {
      return
    }
    if (selectionKind.value === 'admin_boundary' && adminDatasets.value.size <= 1) {
      applyAdminBoundaries(s.map(g => g.adminBoundaries!))
    } else if (geographyIds.value.length > 0) {
      // Uploads (or a selection that can't run) leave no boundaries behind
      geographyIds.value = []
    }
    if (missing.length > 0) {
      loads.value++
    }
  }, { immediate: true })

  // The polygon a run uses: the upload, or the chosen saved uploads together
  const queryPolygon = computed((): QueryPolygon | undefined => {
    if (geomSource.value !== 'custom') {
      return undefined
    }
    if (selectedIds.value.length === 0) {
      return uploadPolygon.value
    }
    if (selectionKind.value !== 'upload') {
      return undefined
    }
    return { type: 'MultiPolygon', coordinates: selection.value!.flatMap(g => g.polygon!.coordinates) }
  })

  // What the area is called, for describing a run
  const queryAreaName = computed((): string | undefined => {
    if (geomSource.value !== 'custom') {
      return undefined
    }
    if (selectedIds.value.length === 0 && upload.value?.result) {
      const names = upload.value.result.features.map(f => f.name)
      return names.length <= 3 ? names.join('; ') : `${names.length} features from ${upload.value.filename}`
    }
    return selection.value?.map(g => g.name).join('; ')
  })

  // Problems with the chosen boundaries: they couldn't load, can't be
  // combined, may overlap, or have changed since they were saved
  const messages = computed((): QueryGeographyMessage[] => {
    if (selectedIds.value.length === 0) {
      return []
    }
    if (loadErrors.value.length > 0) {
      return loadErrors.value.map(text => ({ variant: 'danger', text }))
    }
    const s = selection.value
    if (!s) {
      return []
    }
    if (selectionKind.value === 'mixed') {
      return [{ variant: 'danger', text: 'Uploaded boundaries and Census boundary sets can\'t be combined in one query. Remove one kind.' }]
    }
    if (selectionKind.value === 'admin_boundary' && adminDatasets.value.size > 1) {
      return [{ variant: 'danger', text: 'These Census boundary sets are from different Census datasets, so they can\'t be combined. Remove one.' }]
    }
    if (selectionKind.value === 'upload') {
      return s.length > 1
        ? [{ variant: 'warning', text: 'Where these boundaries overlap, census figures count the overlap twice.' }]
        : []
    }

    // Only once the selected geographies are these sets', not a previous one's
    const docGeographies = s.flatMap(g => g.adminBoundaries!.geographies)
    const docIds = new Set(docGeographies.map(g => g.id))
    if (censusGeographiesSelected.value.length === 0 || !censusGeographiesSelected.value.every(g => docIds.has(g.id))) {
      return []
    }
    const found = new Map(censusGeographiesSelected.value.map(g => [g.id, g]))
    const changed = docGeographies.filter(g => found.get(g.id)?.geoid !== g.geoid)
    if (changed.length === 0) {
      return []
    }
    return [{
      variant: 'warning',
      text: `The census data has changed since this was saved, so ${changed.length === 1 ? 'this boundary' : 'these boundaries'} may not match: ${changed.map(g => g.name).join('; ')}. Select the boundaries again and save them anew.`,
    }]
  })

  // Whether the chosen boundaries make an area a query can run on
  const savedSelectionRunnable = computed(() => {
    if (selectedIds.value.length === 0 || loading.value || loadErrors.value.length > 0) {
      return false
    }
    return selectionKind.value === 'upload' || (selectionKind.value === 'admin_boundary' && adminDatasets.value.size <= 1)
  })

  return {
    savedGeographyAccess: access,
    // Only once there's something saved to manage
    savedGeographyManageUrl: computed(() => (geographies.value?.length ?? 0) > 0 ? manageUrl.value : ''),
    savedGeographyLoading: loading,
    savedSelectionRunnable,
    queryPolygon,
    queryAreaName,
    queryGeographyMessages: messages,
    savedGeographyLoads: loads,
  }
}
