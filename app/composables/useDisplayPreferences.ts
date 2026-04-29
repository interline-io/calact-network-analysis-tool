import { computed, type ComputedRef, type WritableComputedRef } from 'vue'
import type { UnitSystem } from '~~/src/core'
import { useUrlQuery } from './useUrlQuery'

interface DisplayPreferences {
  unitSystem: WritableComputedRef<UnitSystem>
  isAllDayMode: ComputedRef<boolean>
}

// Cross-cutting display preferences read by descendants of cal-map (legend,
// map-viewer-ts, census-panel) without needing to be plumbed through props.
export function useDisplayPreferences (): DisplayPreferences {
  const route = useRoute()
  const { setQuery } = useUrlQuery()

  const unitSystem = computed<UnitSystem>({
    get: () => route.query.unitSystem === 'eu' ? 'eu' : 'us',
    set: (v) => { setQuery({ unitSystem: v }) }
  })

  const isAllDayMode = computed(() => !route.query.startTime && !route.query.endTime)

  return { unitSystem, isAllDayMode }
}
