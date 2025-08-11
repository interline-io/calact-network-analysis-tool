import type { ScenarioData } from '~/src/scenario'

interface WSDOTReport {
  stopCategories: Record<number, number>
}

export function wsdotReport (data: ScenarioData): WSDOTReport {
  const stopCategories: Record<number, number> = {}
  console.log('data:', data)
  return {
    stopCategories
  }
}
