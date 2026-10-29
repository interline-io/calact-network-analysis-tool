import { computed, type ComputedRef, type WritableComputedRef } from 'vue'
import {
  AGG_CLIP_MODE_OPTIONS,
  choroplethDefaultElement,
  type AggClipMode,
  type DataDisplayMode,
  type UnitSystem,
} from '~~/src/core'
import { useUrlQuery } from './useUrlQuery'

// The overlay is off until asked for, so when it is asked for, answer the
// question people actually have: what the transit service reaches. The less
// clipped modes stay available for context.
const AGG_CLIP_MODE_DEFAULT: AggClipMode = 'buffer'

interface ScenarioDisplay {
  showAggAreas: WritableComputedRef<boolean>
  aggClipMode: WritableComputedRef<AggClipMode>
  showStopBuffer: WritableComputedRef<boolean>
  aggregateLayer: WritableComputedRef<string>
  choroplethElement: WritableComputedRef<string>
  shadeByDensity: WritableComputedRef<boolean>
  onlyWithStops: WritableComputedRef<boolean>
  dataDisplayMode: WritableComputedRef<DataDisplayMode>
  hideUnmarked: WritableComputedRef<boolean>
  baseMap: WritableComputedRef<string>
  unitSystem: WritableComputedRef<UnitSystem>
  showBbox: WritableComputedRef<boolean>
  showVehicles: WritableComputedRef<boolean>
  isAllDayMode: ComputedRef<boolean>
}

// URL-backed display state shared between tne.vue, cal-filter, cal-map and
// their descendants. Each consumer calls this directly instead of receiving
// values as props, so adding a new flag is a one-file change.
export function useScenarioDisplay (): ScenarioDisplay {
  const { query, setQuery } = useUrlQuery()

  const showAggAreas = computed<boolean>({
    get: () => query.value.showAggAreas?.toString() === 'true',
    set: (v) => { setQuery({ showAggAreas: v ? 'true' : undefined }) }
  })

  // How the overlay measures each geography. Separate from the checkbox above:
  // whether to draw and what to measure are different questions, and only the
  // off state of each is worth a URL parameter.
  const aggClipMode = computed<AggClipMode>({
    get: () => {
      const v = query.value.aggClip?.toString()
      return AGG_CLIP_MODE_OPTIONS.find(o => o.value === v)?.value || AGG_CLIP_MODE_DEFAULT
    },
    set: (v) => { setQuery({ aggClip: v === AGG_CLIP_MODE_DEFAULT ? undefined : v }) }
  })

  const showStopBuffer = computed<boolean>({
    get: () => query.value.showStopBuffer?.toString() === 'true',
    set: (v) => { setQuery({ showStopBuffer: v ? 'true' : undefined }) }
  })

  const aggregateLayer = computed<string>({
    get: () => query.value.aggregateLayer?.toString() || 'tract',
    set: (v) => { setQuery({ aggregateLayer: v }) }
  })

  // The default follows the clip, so an explicit pick is always persisted,
  // even one that matches the current clip's default.
  const choroplethElement = computed<string>({
    get: () => query.value.choroplethElement?.toString() || choroplethDefaultElement(aggClipMode.value),
    set: (v) => { setQuery({ choroplethElement: v }) }
  })

  // Default true; only the off state is persisted to the URL.
  const shadeByDensity = computed<boolean>({
    get: () => query.value.shadeByDensity !== 'false',
    set: (v) => { setQuery({ shadeByDensity: v ? undefined : 'false' }) }
  })

  const onlyWithStops = computed<boolean>({
    get: () => query.value.onlyWithStops === 'true',
    set: (v) => { setQuery({ onlyWithStops: v ? 'true' : undefined }) }
  })

  const dataDisplayMode = computed<DataDisplayMode>({
    get: () => (query.value.dataDisplayMode?.toString() || 'Transit mode') as DataDisplayMode,
    set: (v) => { setQuery({ dataDisplayMode: v === 'Transit mode' ? undefined : v }) }
  })

  // Default true; only the off state is persisted to the URL.
  const hideUnmarked = computed<boolean>({
    get: () => query.value.hideUnmarked?.toString() !== 'false',
    set: (v) => { setQuery({ hideUnmarked: v ? undefined : 'false' }) }
  })

  const baseMap = computed<string>({
    get: () => query.value.baseMap?.toString() || 'Streets',
    set: (v) => { setQuery({ baseMap: v === 'Streets' ? undefined : v }) }
  })

  const unitSystem = computed<UnitSystem>({
    get: () => query.value.unitSystem === 'eu' ? 'eu' : 'us',
    set: (v) => { setQuery({ unitSystem: v === 'us' ? undefined : v }) }
  })

  // Default true; only the off state is persisted to the URL.
  const showBbox = computed<boolean>({
    get: () => query.value.showBbox?.toString() !== 'false',
    set: (v) => { setQuery({ showBbox: v ? undefined : 'false' }) }
  })

  // The map's vehicle playback. Off by default, since turning the playback on
  // fetches a day of schedules.
  const showVehicles = computed<boolean>({
    get: () => query.value.showVehicles?.toString() === 'true',
    set: (v) => { setQuery({ showVehicles: v ? 'true' : undefined }) }
  })

  // Derived from filter state; read-only.
  const isAllDayMode = computed(() => !query.value.startTime && !query.value.endTime)

  return {
    showAggAreas,
    aggClipMode,
    showStopBuffer,
    aggregateLayer,
    choroplethElement,
    shadeByDensity,
    onlyWithStops,
    dataDisplayMode,
    hideUnmarked,
    baseMap,
    unitSystem,
    showBbox,
    showVehicles,
    isAllDayMode,
  }
}
