// The open isochrone's bands (#486), fetched from the router as its settings
// change. Called from tne.vue, which passes the results to the panel and the
// map as props.

import { onScopeDispose, reactive, ref, shallowRef, toValue, watch, type MaybeRefOrGetter, type Ref, type ShallowRef } from 'vue'
import {
  isochroneIsEmpty,
  isochroneQuery,
  parseIsochroneResponse,
  type IsochroneBand,
  type IsochroneParams,
  type IsochroneRenderOptions,
} from '~~/src/tl'

// Settings changes, a dragged origin among them, wait this long for the next
// before asking the router.
const ISOCHRONE_DEBOUNCE_MS = 350

// A response that arrives sooner never shows the loading state.
const ISOCHRONE_LOADING_DELAY_MS = 250

// One request to the router: the only thing tests replace.
export type IsochroneFetcher = (query: URLSearchParams, signal: AbortSignal) => Promise<{ status: number, body: string }>

// Fetches through the API proxy, given its URL for /routing/isochrone.
export function isochroneFetcher (url: string): IsochroneFetcher {
  return async (query, signal) => {
    const response = await fetch(`${url}?${query}`, { signal })
    return { status: response.status, body: await response.text() }
  }
}

export interface UseIsochroneReturn {
  // Shortest time first; empty while none are open, or none have arrived.
  bands: ShallowRef<IsochroneBand[]>
  // The settings the bands are for.
  bandsParams: ShallowRef<IsochroneParams | undefined>
  loading: Ref<boolean>
  // loading, once it has lasted long enough to show.
  showLoading: Ref<boolean>
  error: Ref<string | null>
  // The bands arrived, and none has any area.
  empty: Ref<boolean>
  // Contouring knobs from the debug menu.
  render: IsochroneRenderOptions
}

export function useIsochrone (
  params: MaybeRefOrGetter<IsochroneParams | undefined>,
  fetcher: IsochroneFetcher,
): UseIsochroneReturn {
  const bands = shallowRef<IsochroneBand[]>([])
  const bandsParams = shallowRef<IsochroneParams | undefined>(undefined)
  const loading = ref(false)
  const showLoading = ref(false)
  const error = ref<string | null>(null)
  const empty = ref(false)
  const render = reactive<IsochroneRenderOptions>({})

  // The newest request; a response checks it, so one superseded by a later
  // request (an earlier drag of the origin) never overwrites newer bands.
  let seq = 0
  let controller: AbortController | undefined
  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  let loadingTimer: ReturnType<typeof setTimeout> | undefined

  function setLoading (v: boolean) {
    loading.value = v
    clearTimeout(loadingTimer)
    if (v) {
      loadingTimer = setTimeout(() => { showLoading.value = true }, ISOCHRONE_LOADING_DELAY_MS)
    } else {
      showLoading.value = false
    }
  }

  function reset () {
    bands.value = []
    bandsParams.value = undefined
    error.value = null
    empty.value = false
  }

  async function compute () {
    // Claimed before anything else, so whatever is in flight is superseded
    // even when this run has nothing to ask.
    const mySeq = ++seq
    controller?.abort()
    controller = undefined
    const p = toValue(params)
    if (!p || p.cutoffs.length === 0) {
      setLoading(false)
      reset()
      return
    }
    const myController = new AbortController()
    controller = myController
    setLoading(true)
    try {
      const { status, body } = await fetcher(isochroneQuery(p, { ...render }), myController.signal)
      if (mySeq !== seq) {
        return
      }
      const result = parseIsochroneResponse(status, body)
      if (result.error !== undefined) {
        bands.value = []
        bandsParams.value = undefined
        error.value = result.error
        empty.value = false
      } else {
        bands.value = result.bands
        bandsParams.value = p
        error.value = null
        empty.value = isochroneIsEmpty(result.bands)
      }
    } catch (err: any) {
      if (mySeq !== seq || err?.name === 'AbortError') {
        return
      }
      bands.value = []
      bandsParams.value = undefined
      error.value = err?.message || String(err)
    } finally {
      if (mySeq === seq) {
        controller = undefined
        setLoading(false)
      }
    }
  }

  // Keyed by value, so a recomputed but equal settings object asks nothing.
  watch(
    () => JSON.stringify([toValue(params) ?? null, render]),
    () => {
      clearTimeout(debounceTimer)
      if (!toValue(params)) {
        // Closed: drop the bands now, not after the debounce.
        compute()
        return
      }
      debounceTimer = setTimeout(compute, ISOCHRONE_DEBOUNCE_MS)
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    clearTimeout(debounceTimer)
    clearTimeout(loadingTimer)
    seq++
    controller?.abort()
  })

  return { bands, bandsParams, loading, showLoading, error, empty, render }
}
