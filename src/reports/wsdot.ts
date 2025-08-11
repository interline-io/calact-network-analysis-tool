import type { ScenarioData } from '~/src/scenario'

interface WSDOTReport {
  stopCategories: Record<number, number>
}

export function wsdotReport (data: ScenarioData, weekday: string,): WSDOTReport {
  const stopCategories: Record<number, number> = {}
  console.log('data:', data)
  for (const stop of data.stops) {
    const deps = data.stopDepartureCache.get(stop.id, weekday)
    console.log('departures:', deps)
  }

  return {
    stopCategories
  }
}
