// Deferred / on-demand loading of scenario layers (#315 buffers, census
// values, flex areas). Each layer streams from its standalone endpoint into
// the existing ScenarioDataReceiver so the rest of the scenario state (stops,
// routes, departures, …) stays untouched.
//
// - Buffer demographics: explicit "Load" buttons + debounced radius/layer
//   auto-refetch once requested.
// - Census values: implicit auto-load, cached per aggregate layer — each
//   layer fetches at most once per scenario.
// - Flex areas: implicit auto-load the first time the Flex Services display
//   toggle is enabled.

import { shallowRef, watch, onScopeDispose, type Ref, type ShallowRef } from 'vue'
import { useScenarioInputs } from './useScenarioInputs'
import { useScenarioDisplay } from './useScenarioDisplay'
import { SCENARIO_DEFAULTS } from '~~/src/core'
import {
  ScenarioStreamReceiver,
  type BufferFetchConfig,
  type CensusValuesRequestBody,
  type FlexAreasRequestBody,
  type ScenarioConfig,
  type ScenarioData,
  type ScenarioDataReceiver,
  type ScenarioProgress,
} from '~~/src/scenario'

interface UseScenarioRefetchDeps {
  scenarioData: Ref<ScenarioData | undefined>
  // ComputedRef satisfies Ref for read access; the refetch only reads.
  scenarioConfig: Ref<ScenarioConfig>
  loadingProgress: Ref<ScenarioProgress | undefined>
  showLoadingModal: Ref<boolean>
  error: Ref<any>
}

export interface UseScenarioRefetchReturn {
  // Shared with the main fetch path so refetched layer state lands in the
  // same accumulator. Parent assigns into this after each main scenario fetch.
  scenarioReceiver: ShallowRef<ScenarioDataReceiver | undefined>
  // Whether buffer demographics were requested this session — true when the
  // scenario loaded with `includeStopBufferDemographics`, or after loadNow().
  // Gates the radius/layer auto-refetch watcher and the loading modal's
  // Demographics column. Parent resets it after each main scenario fetch.
  demographicsRequested: ShallowRef<boolean>
  // Explicit deferred load for the "Load stop buffer demographics" buttons.
  // Also ensures census values for the current layer (the aggregation table
  // seeds its rows from them).
  loadNow: () => Promise<void>
  // Implicit auto-load of census values for the current aggregate layer.
  // Idempotent per layer; safe to call from every trigger.
  ensureCensusValues: () => Promise<void>
  // Implicit auto-load of flex areas. Idempotent; safe to call repeatedly.
  ensureFlexAreas: () => Promise<void>
  // Re-sync the loaded-layer bookkeeping with the receiver's current data.
  // Parent calls it when a main scenario fetch starts (clears stale state)
  // and again when it completes (seeds from whatever the stream delivered —
  // covers inline loads, examples, and pre-feature captures uniformly).
  resetLayerState: () => void
}

// Without debounce a slider drag fires one request per step.
const DEBOUNCE_MS = 500

// Modal control for nested loads: loadNow() owns the modal around its
// Promise.all so the faster inner stream doesn't hide it early.
interface LoadOpts {
  silent?: boolean
}

export function useScenarioRefetch (deps: UseScenarioRefetchDeps): UseScenarioRefetchReturn {
  // Shared with the main fetch path so refetched layer state lands in the
  // same accumulator.
  const scenarioReceiver = shallowRef<ScenarioDataReceiver>()
  const demographicsRequested = shallowRef(false)

  const { stopBufferRadius, stopBufferLayer, geoDatasetName } = useScenarioInputs()
  const { aggregateLayer } = useScenarioDisplay()

  // ---------------------------------------------------------------------
  // Buffer demographics (#315) — explicit load + debounced auto-refetch
  // ---------------------------------------------------------------------

  // Aborted on the next radius/layer change before issuing the new request.
  let bufferAbort: AbortController | undefined
  let bufferTimer: ReturnType<typeof setTimeout> | undefined

  async function refetchBuffers (opts: LoadOpts = {}): Promise<void> {
    const receiver = scenarioReceiver.value
    const data = deps.scenarioData.value
    if (!receiver || !data) {
      return
    }
    bufferAbort?.abort()

    // Radius 0 means "feature off" — clear loaded demographics rather than
    // POSTing radius 0 (which /api/buffer-geographies rejects).
    if (stopBufferRadius.value <= 0) {
      receiver.clearBufferGeographies()
      deps.scenarioData.value = receiver.getCurrentData()
      return
    }

    const localAbort = new AbortController()
    bufferAbort = localAbort

    receiver.clearBufferGeographies()
    deps.scenarioData.value = receiver.getCurrentData()

    if (!opts.silent) {
      deps.showLoadingModal.value = true
      deps.loadingProgress.value = {
        isLoading: true,
        currentStage: 'ready',
        currentStageMessage: 'Recomputing buffer demographics...',
      }
    }

    const agencyIds = [...new Set(
      data.routes.map(r => r.agency?.id).filter((id): id is number => id != null),
    )]
    const body: BufferFetchConfig = {
      radius: stopBufferRadius.value,
      layer: stopBufferLayer.value,
      geoDatasetName: geoDatasetName.value,
      tableDatasetName: deps.scenarioConfig.value.tableDatasetName ?? SCENARIO_DEFAULTS.tableDatasetName,
      stopIds: data.stops.map(s => s.id),
      routeIds: data.routes.map(r => r.id),
      agencyIds,
    }

    try {
      await streamIntoReceiver('/api/buffer-geographies', body, receiver, localAbort.signal)
      deps.scenarioData.value = receiver.getCurrentData()
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return
      }
      deps.error.value = err
    } finally {
      if (bufferAbort === localAbort) {
        bufferAbort = undefined
        if (!opts.silent) {
          deps.showLoadingModal.value = false
          deps.loadingProgress.value = undefined
        }
      }
    }
  }

  // Deferred load for the "Load stop buffer demographics" buttons. Once
  // called, the radius/layer watcher takes over for subsequent changes.
  // Census values load alongside (concurrent streams into one receiver are
  // safe — the layers touch disjoint accumulator fields).
  async function loadNow (): Promise<void> {
    if (stopBufferRadius.value <= 0) {
      return
    }
    demographicsRequested.value = true
    deps.showLoadingModal.value = true
    deps.loadingProgress.value = {
      isLoading: true,
      currentStage: 'ready',
      currentStageMessage: 'Loading census + buffer demographics...',
    }
    try {
      await Promise.all([
        ensureCensusValues({ silent: true }),
        refetchBuffers({ silent: true }),
      ])
    } finally {
      deps.showLoadingModal.value = false
      deps.loadingProgress.value = undefined
    }
  }

  // Initial query reads radius/layer via `scenarioConfig` directly; this
  // watch only kicks in once a scenario is loaded — and only after the user
  // has requested demographics (with the scenario or via loadNow()).
  watch([stopBufferRadius, stopBufferLayer], () => {
    if (!scenarioReceiver.value || !deps.scenarioData.value) {
      return
    }
    if (!demographicsRequested.value) {
      return
    }
    if (bufferTimer) {
      clearTimeout(bufferTimer)
    }
    bufferTimer = setTimeout(() => {
      bufferTimer = undefined
      refetchBuffers()
    }, DEBOUNCE_MS)
  })

  // ---------------------------------------------------------------------
  // Census values — implicit auto-load, cached per aggregate layer
  // ---------------------------------------------------------------------

  // Layers fetched this scenario. Tracked separately from the data so a
  // layer that legitimately returned zero geographies isn't refetched.
  const loadedCensusLayers = new Set<string>()
  let censusInFlight: Promise<void> | undefined
  let censusInFlightLayer: string | undefined
  let censusAbort: AbortController | undefined

  async function ensureCensusValues (opts: LoadOpts = {}): Promise<void> {
    const receiver = scenarioReceiver.value
    const data = deps.scenarioData.value
    const cfg = deps.scenarioConfig.value
    const layer = cfg.aggregateLayer
    const tableDatasetName = cfg.tableDatasetName ?? SCENARIO_DEFAULTS.tableDatasetName
    if (!receiver || !data || !layer || !tableDatasetName) {
      return
    }
    if (loadedCensusLayers.has(layer)) {
      return
    }
    // Same-layer concurrent triggers (tab open + toggle) await the running
    // fetch; a different layer aborts and reissues.
    if (censusInFlight && censusInFlightLayer === layer) {
      return censusInFlight
    }
    censusAbort?.abort()
    const localAbort = new AbortController()
    censusAbort = localAbort
    censusInFlightLayer = layer

    const run = (async () => {
      if (!opts.silent) {
        deps.showLoadingModal.value = true
        deps.loadingProgress.value = {
          isLoading: true,
          currentStage: 'census-values',
          currentStageMessage: 'Loading census data...',
        }
      }
      const body: CensusValuesRequestBody = {
        geoDatasetName: geoDatasetName.value,
        tableDatasetName,
        layer,
        // Padding for edge-crossing stop buffers — tied to the radius so a
        // later buffer load rolls up against the right geographies.
        stopBufferRadius: stopBufferRadius.value,
        bbox: cfg.bbox,
        geographyIds: cfg.geographyIds,
      }
      try {
        await streamIntoReceiver('/api/census-values', body, receiver, localAbort.signal)
        deps.scenarioData.value = receiver.getCurrentData()
        loadedCensusLayers.add(layer)
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          return
        }
        deps.error.value = err
      } finally {
        if (censusAbort === localAbort) {
          censusAbort = undefined
          censusInFlight = undefined
          censusInFlightLayer = undefined
          if (!opts.silent) {
            deps.showLoadingModal.value = false
            deps.loadingProgress.value = undefined
          }
        }
      }
    })()
    censusInFlight = run
    return run
  }

  // Aggregate-layer changes load the new layer on demand; switching back to
  // an already-loaded layer hits the per-layer cache (no request).
  watch(aggregateLayer, () => {
    if (!scenarioReceiver.value || !deps.scenarioData.value) {
      return
    }
    ensureCensusValues()
  })

  // ---------------------------------------------------------------------
  // Flex areas — implicit auto-load on first Flex Services enable
  // ---------------------------------------------------------------------

  let flexAreasLoaded = false
  let flexInFlight: Promise<void> | undefined
  let flexAbort: AbortController | undefined

  async function ensureFlexAreas (): Promise<void> {
    const receiver = scenarioReceiver.value
    const data = deps.scenarioData.value
    const cfg = deps.scenarioConfig.value
    if (!receiver || !data || flexAreasLoaded) {
      return
    }
    if (flexInFlight) {
      return flexInFlight
    }
    if (data.feedVersions.length === 0) {
      // Nothing to fetch from; don't retry on every toggle.
      flexAreasLoaded = true
      return
    }
    const localAbort = new AbortController()
    flexAbort = localAbort

    const run = (async () => {
      deps.showLoadingModal.value = true
      deps.loadingProgress.value = {
        isLoading: true,
        currentStage: 'flex-areas',
        currentStageMessage: 'Loading flex service areas...',
      }
      const body: FlexAreasRequestBody = {
        feedVersions: data.feedVersions,
        startDate: deps.scenarioConfig.value.startDate,
        endDate: cfg.endDate,
      }
      try {
        await streamIntoReceiver('/api/flex-areas', body, receiver, localAbort.signal)
        deps.scenarioData.value = receiver.getCurrentData()
        flexAreasLoaded = true
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          return
        }
        deps.error.value = err
      } finally {
        if (flexAbort === localAbort) {
          flexAbort = undefined
          flexInFlight = undefined
          deps.showLoadingModal.value = false
          deps.loadingProgress.value = undefined
        }
      }
    })()
    flexInFlight = run
    return run
  }

  // ---------------------------------------------------------------------
  // Shared
  // ---------------------------------------------------------------------

  async function streamIntoReceiver (
    endpoint: string,
    body: unknown,
    receiver: ScenarioDataReceiver,
    signal: AbortSignal,
  ): Promise<void> {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${endpoint}`)
    }
    if (!response.body) {
      throw new Error(`No response body from ${endpoint}`)
    }
    const streamer = new ScenarioStreamReceiver()
    const { success } = await streamer.processStream(response.body, receiver)
    if (!success) {
      throw new Error(`Stream from ${endpoint} ended unexpectedly`)
    }
  }

  function resetLayerState (): void {
    const cfg = deps.scenarioConfig.value
    const data = scenarioReceiver.value?.getCurrentData()
    loadedCensusLayers.clear()
    for (const [layer, layerMap] of data?.censusGeographiesByLayer ?? []) {
      if (layerMap.size > 0) {
        loadedCensusLayers.add(layer)
      }
    }
    flexAreasLoaded = cfg.includeFlexAreas === true || (data?.flexAreas.length ?? 0) > 0
  }

  onScopeDispose(() => {
    if (bufferTimer) { clearTimeout(bufferTimer) }
    bufferAbort?.abort()
    censusAbort?.abort()
    flexAbort?.abort()
  })

  return {
    scenarioReceiver,
    demographicsRequested,
    loadNow,
    ensureCensusValues: () => ensureCensusValues(),
    ensureFlexAreas,
    resetLayerState,
  }
}
