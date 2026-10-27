// The query area from an uploaded or saved geography (#477), for tne.vue to
// pass down: the polygon a run uses, its name, and the loading of the saved
// geography the URL names.
//
// A saved upload becomes the run's polygon. A saved set of admin boundaries
// is written into geographyIds, the same path the Administrative Boundary
// mode uses, after checking the ids still name the same places.

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
  const { geomSource, savedGeography, geographyIds, geoDatasetName } = useScenarioInputs()
  const { upload, uploadPolygon } = useUploadedGeography()
  const { access, loadAccess, get } = useSavedGeographies()

  // Kept for the session, so coming back to the page doesn't fetch it again
  const loaded = useState<LoadedSavedGeography | null>('cal-loaded-saved-geography', () => null)
  const loading = ref(false)
  const loadError = ref('')
  // Counts loads, for the page to show each newly loaded geography
  const loads = ref(0)

  void loadAccess()

  // Writes a saved boundary set into the inputs the boundaries mode uses
  function applyAdminBoundaries (doc: AdminBoundaryDocument) {
    const ids = doc.geographies.map(g => g.id)
    if (ids.join(',') !== geographyIds.value.join(',')) {
      geographyIds.value = ids
    }
    if (doc.dataset !== geoDatasetName.value) {
      geoDatasetName.value = doc.dataset
    }
  }

  let requested = ''
  watch([geomSource, savedGeography], async ([source, id]) => {
    loadError.value = ''
    if (source !== 'custom' || !id) {
      return
    }
    if (loaded.value?.id === id) {
      if (loaded.value.adminBoundaries) {
        applyAdminBoundaries(loaded.value.adminBoundaries)
      }
      return
    }
    requested = id
    loading.value = true
    try {
      const saved = await get(id)
      // A later choice has replaced this one
      if (requested !== id) {
        return
      }
      if (isUploadDocument(saved.content)) {
        loaded.value = { id, name: saved.name, polygon: markRaw(uploadDocumentPolygon(saved.content)) }
        loads.value++
      } else if (isAdminBoundaryDocument(saved.content)) {
        loaded.value = { id, name: saved.name, adminBoundaries: saved.content }
        applyAdminBoundaries(saved.content)
        loads.value++
      } else {
        loadError.value = `"${saved.name}" isn't a geography this version of the app can read.`
      }
    } catch (e) {
      if (requested !== id) {
        return
      }
      const status = (e as { statusCode?: number }).statusCode
      loadError.value = status === 404
        ? 'This saved geography isn\'t in your account. Saved geographies belong to the person who saved them: ask them to download it from their profile and send you the file to upload.'
        : `Couldn't load the saved geography: ${savedGeographyErrorMessage(e)}`
    } finally {
      if (requested === id) {
        loading.value = false
      }
    }
  }, { immediate: true })

  const savedLoaded = computed(() => geomSource.value === 'custom' && savedGeography.value && loaded.value?.id === savedGeography.value ? loaded.value : null)

  // The polygon a run uses, if the area is an upload or a saved upload
  const queryPolygon = computed((): QueryPolygon | undefined => {
    if (geomSource.value !== 'custom') {
      return undefined
    }
    return savedGeography.value ? savedLoaded.value?.polygon : uploadPolygon.value
  })

  // What the area is called, for describing a run
  const queryAreaName = computed((): string | undefined => {
    if (geomSource.value === 'custom' && !savedGeography.value && upload.value?.result) {
      const names = upload.value.result.features.map(f => f.name)
      return names.length <= 3 ? names.join('; ') : `${names.length} features from ${upload.value.filename}`
    }
    return savedLoaded.value?.name
  })

  // Problems with the saved geography: it couldn't load, or its boundaries
  // have changed since it was saved
  const messages = computed((): QueryGeographyMessage[] => {
    if (geomSource.value !== 'custom' || !savedGeography.value) {
      return []
    }
    if (loadError.value) {
      return [{ variant: 'danger', text: loadError.value }]
    }
    const doc = savedLoaded.value?.adminBoundaries
    if (!doc || censusGeographiesSelected.value.length === 0) {
      return []
    }
    // Only once the selected geographies are this set's, not a previous one's
    const docIds = new Set(doc.geographies.map(g => g.id))
    if (!censusGeographiesSelected.value.every(g => docIds.has(g.id))) {
      return []
    }
    const found = new Map(censusGeographiesSelected.value.map(g => [g.id, g]))
    const changed = doc.geographies.filter(g => found.get(g.id)?.geoid !== g.geoid)
    if (changed.length === 0) {
      return []
    }
    return [{
      variant: 'warning',
      text: `The census data has changed since this was saved, so ${changed.length === 1 ? 'this boundary' : 'these boundaries'} may not match: ${changed.map(g => g.name).join('; ')}. Select the boundaries again and save them anew.`,
    }]
  })

  return {
    savedGeographyAccess: access,
    savedGeographyLoading: loading,
    queryPolygon,
    queryAreaName,
    queryGeographyMessages: messages,
    savedGeographyLoads: loads,
  }
}
