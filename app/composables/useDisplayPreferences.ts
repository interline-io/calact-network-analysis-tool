import { computed, type ComputedRef, type WritableComputedRef } from 'vue'
import type { UnitSystem } from '~~/src/core'

interface DisplayPreferences {
  unitSystem: WritableComputedRef<UnitSystem>
  isAllDayMode: ComputedRef<boolean>
}

// Cross-cutting display preferences read by descendants of cal-map (legend,
// map-viewer-ts, census-panel) without needing to be plumbed through props.
export function useDisplayPreferences (): DisplayPreferences {
  const route = useRoute()

  const unitSystem = computed<UnitSystem>({
    get: () => route.query.unitSystem === 'eu' ? 'eu' : 'us',
    set: (v) => {
      const merged: Record<string, any> = {}
      const source: Record<string, any> = { ...route.query, unitSystem: v }
      for (const k in source) {
        if (source[k] !== null && source[k] !== undefined) { merged[k] = source[k] }
      }
      navigateTo({ replace: true, query: merged })
    }
  })

  const isAllDayMode = computed(() => !route.query.startTime && !route.query.endTime)

  return { unitSystem, isAllDayMode }
}
