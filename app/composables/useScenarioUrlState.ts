import { computed, type WritableComputedRef } from 'vue'
import { CHOROPLETH_DEFAULT_ELEMENT, type DataDisplayMode } from '~~/src/core'
import { useUrlQuery } from './useUrlQuery'

interface ScenarioUrlState {
  showAggAreas: WritableComputedRef<boolean>
  aggregateLayer: WritableComputedRef<string>
  choroplethElement: WritableComputedRef<string>
  shadeByDensity: WritableComputedRef<boolean>
  onlyWithStops: WritableComputedRef<boolean>
  dataDisplayMode: WritableComputedRef<DataDisplayMode | undefined>
  hideUnmarked: WritableComputedRef<boolean>
  baseMap: WritableComputedRef<string | undefined>
}

// URL-backed display state shared between tne.vue, cal-filter, cal-map, etc.
// Each consumer calls this directly instead of receiving the values as props,
// so adding a new flag is a one-file change.
export function useScenarioUrlState (): ScenarioUrlState {
  const route = useRoute()
  const { setQuery } = useUrlQuery()

  const showAggAreas = computed<boolean>({
    get: () => route.query.showAggAreas?.toString() === 'true',
    set: (v) => { setQuery({ showAggAreas: v ? 'true' : undefined }) }
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

  const dataDisplayMode = computed<DataDisplayMode | undefined>({
    get: () => (route.query.dataDisplayMode?.toString() || 'Transit mode') as DataDisplayMode,
    set: (v) => { setQuery({ dataDisplayMode: v }) }
  })

  // Default true: hide filtered routes/stops unless explicitly set to false.
  const hideUnmarked = computed<boolean>({
    get: () => route.query.hideUnmarked?.toString() !== 'false',
    set: (v) => { setQuery({ hideUnmarked: v ? '' : 'false' }) }
  })

  const baseMap = computed<string | undefined>({
    get: () => route.query.baseMap?.toString() || 'Streets',
    set: (v) => { setQuery({ baseMap: v }) }
  })

  return {
    showAggAreas,
    aggregateLayer,
    choroplethElement,
    shadeByDensity,
    onlyWithStops,
    dataDisplayMode,
    hideUnmarked,
    baseMap,
  }
}
