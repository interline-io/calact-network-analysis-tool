// The query area from an uploaded or saved geography (#477), for tne.vue to
// pass down: the polygon a run uses, the census geography ids, its name, and
// the loading of the saved boundaries the URL names.
//
// Several saved boundaries of one kind combine into one area. Saved uploads
// become the run's polygon, their parts listed together. Saved sets of admin
// boundaries become the run's geography ids (the server merges them), checked
// against the geoids they were saved with. The server takes one kind of area
// at a time, so the two kinds can't be combined.

import { computed, markRaw, ref, watch } from 'vue'
import {
  isAdminBoundaryDocument,
  isUploadDocument,
  mergePolygons,
  uploadDocumentPolygon,
  type AdminBoundaryDocument,
  type QueryPolygon,
} from '~~/src/core'
import type { CensusGeography } from '~~/src/tl'
import { useScenarioInputs } from './useScenarioInputs'
import { iwaErrorMessage, useSavedGeographies } from './useSavedGeographies'
import { useUploadedGeography } from './useUploadedGeography'

export interface LoadedSavedGeography {
  name: string
  polygon?: QueryPolygon
  adminBoundaries?: AdminBoundaryDocument
}

export interface QueryGeographyMessage {
  variant: 'danger' | 'warning'
  text: string
}

export type SavedSelectionKind = 'upload' | 'admin_boundary'

// What keeps chosen saved boundaries from running together
type SelectionProblem = 'mixed' | 'datasets'

// censusGeographiesSelected is read lazily, as it comes from the geography ids
// this returns
export function useQueryGeography (censusGeographiesSelected: () => CensusGeography[]) {
  const { geomSource, savedGeographies, geographyIds, geoDatasetName } = useScenarioInputs()
  const { upload } = useUploadedGeography()
  const { access, geographies, manageUrl, loadAccess, get } = useSavedGeographies()

  // Kept for the session by id, so coming back to the page, or adding a
  // boundary to the selection, doesn't fetch the others again
  const loaded = useState<Record<string, LoadedSavedGeography>>('cal-loaded-saved-geographies', () => ({}))
  const loading = ref(false)
  const loadErrors = ref<string[]>([])
  // Counts loads, for the page to show each newly loaded selection
  const loads = ref(0)

  void loadAccess()

  // The URL's list is a new array whenever any parameter changes, so keep the
  // previous one while the ids are the same, or the area would be rebuilt and
  // redrawn on every filter change
  const selectedIds = computed<string[]>((prev) => {
    const ids = geomSource.value === 'custom' ? savedGeographies.value : []
    return prev && prev.join(',') === ids.join(',') ? prev : ids
  })

  // The chosen boundaries, once all have loaded
  const selection = computed((): LoadedSavedGeography[] | null => {
    const all = selectedIds.value.map(id => loaded.value[id])
    return all.length > 0 && all.every(g => !!g) ? all as LoadedSavedGeography[] : null
  })

  const selectionKind = computed((): SavedSelectionKind | undefined => {
    const s = selection.value
    if (!s) {
      return undefined
    }
    return s.every(g => g.polygon) ? 'upload' : 'admin_boundary'
  })

  const selectionProblem = computed((): SelectionProblem | null => {
    const s = selection.value
    if (!s) {
      return null
    }
    const uploads = s.filter(g => g.polygon).length
    if (uploads > 0 && uploads < s.length) {
      return 'mixed'
    }
    if (new Set(s.map(g => g.adminBoundaries?.dataset).filter(Boolean)).size > 1) {
      return 'datasets'
    }
    return null
  })

  // The saved boundary sets that make up the area, when that's what's chosen
  // and nothing being uploaded takes their place
  const adminDocs = computed((): AdminBoundaryDocument[] => {
    if (upload.value || selectionKind.value !== 'admin_boundary' || selectionProblem.value) {
      return []
    }
    return selection.value!.map(g => g.adminBoundaries!)
  })

  // The census geography ids a run uses: those picked in the Administrative
  // boundaries mode, or those of the chosen saved sets
  const queryGeographyIds = computed((): number[] => {
    if (geomSource.value === 'adminBoundary') {
      return geographyIds.value
    }
    return [...new Set(adminDocs.value.flatMap(doc => doc.geographies.map(g => g.id)))]
  })

  // A saved set's ids name geographies in its dataset, so the dataset follows
  watch(adminDocs, (docs) => {
    const dataset = docs[0]?.dataset
    if (dataset && dataset !== geoDatasetName.value) {
      geoDatasetName.value = dataset
    }
  })

  // Keeps a saved upload's polygon, as when it was just saved, so choosing it
  // doesn't fetch it back
  function remember (id: string, name: string, polygon: QueryPolygon) {
    loaded.value = { ...loaded.value, [id]: { name, polygon: markRaw(polygon) } }
  }

  async function loadOne (id: string): Promise<void> {
    try {
      const saved = await get(id)
      if (isUploadDocument(saved.content)) {
        remember(id, saved.name, uploadDocumentPolygon(saved.content))
      } else if (isAdminBoundaryDocument(saved.content)) {
        loaded.value = { ...loaded.value, [id]: { name: saved.name, adminBoundaries: saved.content } }
      } else {
        loadErrors.value.push(`"${saved.name}" isn't a boundary this version of the app can read.`)
      }
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      loadErrors.value.push(status === 404
        ? 'A boundary in this link isn\'t in your account. Saved boundaries belong to the person who saved them: ask them to download it from their profile and send you the file to upload.'
        : `Couldn't load a saved boundary: ${iwaErrorMessage(e)}`)
    }
  }

  let requested = ''
  watch(selectedIds, async (ids) => {
    loadErrors.value = []
    const missing = ids.filter(id => !loaded.value[id])
    if (missing.length === 0) {
      return
    }
    const key = ids.join(',')
    requested = key
    loading.value = true
    await Promise.all(missing.map(loadOne))
    // A later choice has replaced this one
    if (requested === key) {
      loading.value = false
      loads.value++
    }
  }, { immediate: true })

  // The polygon a run uses: a file being reviewed, or else the chosen saved
  // uploads together
  const queryPolygon = computed((): QueryPolygon | undefined => {
    if (geomSource.value !== 'custom') {
      return undefined
    }
    if (upload.value || selectedIds.value.length === 0) {
      return upload.value?.result?.polygon
    }
    if (selectionKind.value !== 'upload' || selectionProblem.value) {
      return undefined
    }
    return mergePolygons(selection.value!.map(g => g.polygon!))
  })

  // What the area is called, for describing a run
  const queryAreaName = computed((): string | undefined => {
    if (geomSource.value !== 'custom') {
      return undefined
    }
    if (upload.value?.result) {
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
    if (selectionProblem.value === 'mixed') {
      return [{ variant: 'danger', text: 'Uploaded boundaries and Census boundary sets can\'t be combined in one query. Remove one kind.' }]
    }
    if (selectionProblem.value === 'datasets') {
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
    const selected = censusGeographiesSelected()
    if (selected.length === 0 || !selected.every(g => docIds.has(g.id))) {
      return []
    }
    const found = new Map(selected.map(g => [g.id, g]))
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
  const savedSelectionRunnable = computed(() =>
    selectedIds.value.length > 0 && !loading.value && loadErrors.value.length === 0 && !!selectionKind.value && !selectionProblem.value)

  return {
    savedGeographyAccess: computed(() => access.value ?? undefined),
    // Only once there's something saved to manage
    savedGeographyManageUrl: computed(() => (geographies.value?.length ?? 0) > 0 ? manageUrl.value : undefined),
    savedGeographyLoading: loading,
    savedSelectionRunnable,
    savedSelectionKind: selectionKind,
    queryPolygon,
    queryGeographyIds,
    queryAreaName,
    queryGeographyMessages: messages,
    savedGeographyLoads: loads,
    rememberSavedGeography: remember,
  }
}
