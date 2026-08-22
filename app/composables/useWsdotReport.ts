// Shared scaffolding for the two WSDOT report components: report config over
// the browse config, stream state, the report receiver, and the run
// lifecycle. Each component keeps its viewer, its own config fields, and
// whatever it derives from the finished report.

import { ref, shallowRef, type Ref, type ShallowRef } from 'vue'
import { useScenarioStream, type UseScenarioStreamReturn } from './useScenarioStream'
import { useToastNotification } from './useToastNotification'
import { WSDOTReportDataReceiver, type WSDOTReport, type WSDOTReportConfig } from '~~/src/analysis/wsdot'
import { SCENARIO_DEFAULTS } from '~~/src/core'
import { hasSearchArea, type ScenarioConfig, type ScenarioData, type ScenarioProgress } from '~~/src/scenario'

export interface UseWsdotReportDeps {
  // The browse config the report is built from.
  scenarioConfig: Ref<ScenarioConfig>
  // Component-owned; written as the stream accumulates, for the modal's counters.
  scenarioData: Ref<ScenarioData | undefined>
  // Report-specific config fields layered over the browse config.
  configExtras?: Partial<WSDOTReportConfig>
  successToast: string
  // Runs once the report is rebuilt on completion, for reports derived on top.
  onComplete?: (data: ScenarioData, report: WSDOTReport) => void
}

// The stream state plus the report refs and its run entry point.
export interface UseWsdotReportReturn extends Pick<UseScenarioStreamReturn,
  'loadingProgress' | 'error' | 'requestErrors' | 'phasePlan' | 'phaseFractions'
  | 'stopDepartureCount' | 'showLoadingModal'> {
  wsdotReport: ShallowRef<WSDOTReport | undefined>
  wsdotReportConfig: Ref<WSDOTReportConfig>
  // Run the report inside the shared modal/toast lifecycle.
  runQuery: () => Promise<void>
}

export function useWsdotReport (deps: UseWsdotReportDeps): UseWsdotReportReturn {
  const stream = useScenarioStream()
  const wsdotReport = shallowRef<WSDOTReport>()
  const wsdotReportConfig = ref<WSDOTReportConfig>({
    ...SCENARIO_DEFAULTS,
    ...deps.scenarioConfig.value,
    reportName: 'wsdot-report',
    weekdayDate: deps.scenarioConfig.value.startDate!,
    weekendDate: deps.scenarioConfig.value.endDate!,
    ...deps.configExtras,
  })

  const fetchReport = async (): Promise<boolean> => {
    const config = wsdotReportConfig.value
    if (!hasSearchArea(config)) {
      useToastNotification().showToast('Please provide a bounding box or geography IDs.')
      return false
    }

    const receiver = new WSDOTReportDataReceiver({
      onProgress: (progress: ScenarioProgress) => {
        stream.foldProgress(progress)
        if ((progress.partialData?.routes?.length ?? 0) === 0 && (progress.partialData?.stops?.length ?? 0) === 0) {
          return
        }
        // Only refresh the modal's counters on stop/route batches; rebuilding
        // per event is quadratic in the stop count on statewide runs.
        deps.scenarioData.value = receiver.getCurrentData()
      },
      // No loadingProgress teardown here: this receiver only ever runs inside
      // stream.runQuery, whose final clear covers every path.
      onComplete: () => {
        deps.scenarioData.value = receiver.getCurrentData()
        wsdotReport.value = receiver.getCurrentWSDOTReport()
        if (deps.scenarioData.value && wsdotReport.value) {
          deps.onComplete?.(deps.scenarioData.value, wsdotReport.value)
        }
      },
      onError: (err: any) => {
        stream.error.value = err
      },
    })

    await stream.run(receiver, '/api/wsdot', { config: wsdotReportConfig.value })
    return true
  }

  const runQuery = () => stream.runQuery(fetchReport, deps.successToast)

  return {
    loadingProgress: stream.loadingProgress,
    error: stream.error,
    requestErrors: stream.requestErrors,
    phasePlan: stream.phasePlan,
    phaseFractions: stream.phaseFractions,
    stopDepartureCount: stream.stopDepartureCount,
    showLoadingModal: stream.showLoadingModal,
    wsdotReport,
    wsdotReportConfig,
    runQuery,
  }
}
