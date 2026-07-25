import { computed, type ComputedRef, type WritableComputedRef } from 'vue'
import { AGG_AREA_MODE_DEFAULT, CHOROPLETH_DEFAULT_ELEMENT, type AggAreaMode, type DataDisplayMode, type UnitSystem } from '~~/src/core'
import { useUrlQuery } from './useUrlQuery'

interface ScenarioDisplay {
  aggAreaMode: WritableComputedRef<AggAreaMode>
  aggregateLayer: WritableComputedRef<string>
  choroplethElement: WritableComputedRef<string>
  shadeByDensity: WritableComputedRef<boolean>
  onlyWithStops: WritableComputedRef<boolean>
  dataDisplayMode: WritableComputedRef<DataDisplayMode>
  hideUnmarked: WritableComputedRef<boolean>
  baseMap: WritableComputedRef<string>
  unitSystem: WritableComputedRef<UnitSystem>
  showBbox: WritableComputedRef<boolean>
  isAllDayMode: ComputedRef<boolean>
}

// URL-backed display state shared between tne.vue, cal-filter, cal-map and
// their descendants. Each consumer calls this directly instead of receiving
// values as props, so adding a new flag is a one-file change.
export function useScenarioDisplay (): ScenarioDisplay {
  const route = useRoute()
  const { setQuery } = useUrlQuery()

  // `showAggAreas=true` predates the clipping modes and is still in shared
  // links and canned examples, so it maps onto the default mode.
  const aggAreaMode = computed<AggAreaMode>({
    get: () => {
      const raw = route.query.showAggAreas?.toString()
      if (raw === 'true') { return AGG_AREA_MODE_DEFAULT }
      if (raw === 'unclipped' || raw === 'queryArea' || raw === 'buffer') { return raw }
      return 'off'
    },
    set: (v) => { setQuery({ showAggAreas: v === 'off' ? undefined : v }) }
  })

  const aggregateLayer = computed<string>({
    get: () => route.query.aggregateLayer?.toString() || 'tract',
    set: (v) => { setQuery({ aggregateLayer: v }) }
  })

  const choroplethElement = computed<string>({
    get: () => route.query.choroplethElement?.toString() || CHOROPLETH_DEFAULT_ELEMENT,
    set: (v) => { setQuery({ choroplethElement: v === CHOROPLETH_DEFAULT_ELEMENT ? undefined : v }) }
  })

  // Default true; only the off state is persisted to the URL.
  const shadeByDensity = computed<boolean>({
    get: () => route.query.shadeByDensity !== 'false',
    set: (v) => { setQuery({ shadeByDensity: v ? undefined : 'false' }) }
  })

  const onlyWithStops = computed<boolean>({
    get: () => route.query.onlyWithStops === 'true',
    set: (v) => { setQuery({ onlyWithStops: v ? 'true' : undefined }) }
  })

  const dataDisplayMode = computed<DataDisplayMode>({
    get: () => (route.query.dataDisplayMode?.toString() || 'Transit mode') as DataDisplayMode,
    set: (v) => { setQuery({ dataDisplayMode: v === 'Transit mode' ? undefined : v }) }
  })

  // Default true; only the off state is persisted to the URL.
  const hideUnmarked = computed<boolean>({
    get: () => route.query.hideUnmarked?.toString() !== 'false',
    set: (v) => { setQuery({ hideUnmarked: v ? undefined : 'false' }) }
  })

  const baseMap = computed<string>({
    get: () => route.query.baseMap?.toString() || 'Streets',
    set: (v) => { setQuery({ baseMap: v === 'Streets' ? undefined : v }) }
  })

  const unitSystem = computed<UnitSystem>({
    get: () => route.query.unitSystem === 'eu' ? 'eu' : 'us',
    set: (v) => { setQuery({ unitSystem: v === 'us' ? undefined : v }) }
  })

  // Default true; only the off state is persisted to the URL.
  const showBbox = computed<boolean>({
    get: () => route.query.showBbox?.toString() !== 'false',
    set: (v) => { setQuery({ showBbox: v ? undefined : 'false' }) }
  })

  // Derived from filter state; read-only.
  const isAllDayMode = computed(() => !route.query.startTime && !route.query.endTime)

  return {
    aggAreaMode,
    aggregateLayer,
    choroplethElement,
    shadeByDensity,
    onlyWithStops,
    dataDisplayMode,
    hideUnmarked,
    baseMap,
    unitSystem,
    showBbox,
    isAllDayMode,
  }
}
