// Shared scaffolding for the two WSDOT report components: the report config
// built over the browse scenario config, the stream state, the receiver that
// reassembles the report from the NDJSON stream, and the run lifecycle around
// the loading modal. Each component keeps its viewer, its own config fields,
// and whatever it derives from the finished report.

import { ref, shallowRef, type Ref, type ShallowRef } from 'vue'
import { useScenarioStream } from './useScenarioStream'
import { useToastNotification } from './useToastNotification'
import { WSDOTReportDataReceiver, type WSDOTReport, type WSDOTReportConfig } from '~~/src/analysis/wsdot'
import { SCENARIO_DEFAULTS } from '~~/src/core'
import type { ScenarioConfig, ScenarioData, ScenarioProgress } from '~~/src/scenario'

export interface UseWsdotReportDeps {
  // The browse config the report is built from.
  scenarioConfig: Ref<ScenarioConfig>
  // Owned by the component (local ref or parent model); written as the
  // stream accumulates, for the loading modal's counters.
  scenarioData: Ref<ScenarioData | undefined>
  // Report-specific config fields layered over the browse config.
  configExtras?: Partial<WSDOTReportConfig>
  successToast: string
  // Runs once the report is rebuilt on completion, for reports derived on top.
  onComplete?: (data: ScenarioData, report: WSDOTReport) => void
}

export interface UseWsdotReportReturn {
  loadingProgress: Ref<ScenarioProgress | undefined>
  error: Ref<Error | undefined>
  requestErrors: ReturnType<typeof useScenarioStream>['requestErrors']
  phasePlan: ReturnType<typeof useScenarioStream>['phasePlan']
  phaseFractions: ReturnType<typeof useScenarioStream>['phaseFractions']
  stopDepartureCount: Ref<number>
  stopsWithDepartures: Ref<number>
  showLoadingModal: Ref<boolean>
  wsdotReport: ShallowRef<WSDOTReport | undefined>
  wsdotReportConfig: Ref<WSDOTReportConfig>
  // Run the report; pass a canned-example URL to replay it instead of a live
  // /api/wsdot request.
  runQuery: (exampleUrl?: string) => Promise<void>
}

export function useWsdotReport (deps: UseWsdotReportDeps): UseWsdotReportReturn {
  const stream = useScenarioStream()
  const showLoadingModal = ref(false)
  const wsdotReport = shallowRef<WSDOTReport>()
  const wsdotReportConfig = ref<WSDOTReportConfig>({
    ...SCENARIO_DEFAULTS,
    ...deps.scenarioConfig.value,
    reportName: 'wsdot-report',
    weekdayDate: deps.scenarioConfig.value.startDate!,
    weekendDate: deps.scenarioConfig.value.endDate!,
    ...deps.configExtras,
  })

  const fetchReport = async (exampleUrl?: string): Promise<void> => {
    const config = wsdotReportConfig.value
    if (!exampleUrl && !config.bbox && (!config.geographyIds || config.geographyIds.length === 0)) {
      useToastNotification().showToast('Please provide a bounding box or geography IDs.')
      return
    }

    // Create receiver to accumulate scenario data and the WSDOT report
    const receiver = new WSDOTReportDataReceiver({
      onProgress: (progress: ScenarioProgress) => {
        stream.foldProgress(progress)
        if ((progress.partialData?.routes?.length ?? 0) === 0 && (progress.partialData?.stops?.length ?? 0) === 0) {
          return
        }
        // Counts for the loading modal. Deriving anything heavier is left to
        // completion: rebuilding per batch is quadratic in the stop count, and
        // a statewide run doing so made the client too slow to keep up with
        // the stream, which is what backed the server's output up until it ran
        // out of memory.
        deps.scenarioData.value = receiver.getCurrentData()
      },
      onComplete: () => {
        stream.loadingProgress.value = undefined
        deps.scenarioData.value = receiver.getCurrentData()
        wsdotReport.value = receiver.getCurrentWSDOTReport()
        if (deps.scenarioData.value && wsdotReport.value) {
          deps.onComplete?.(deps.scenarioData.value, wsdotReport.value)
        }
      },
      onError: (err: any) => {
        stream.loadingProgress.value = undefined
        stream.error.value = err
      },
    })

    await stream.run(receiver, exampleUrl
      ? { url: exampleUrl }
      : { url: '/api/wsdot', body: { config: wsdotReportConfig.value } })
  }

  const runQuery = async (exampleUrl?: string): Promise<void> => {
    showLoadingModal.value = true
    try {
      await fetchReport(exampleUrl)
    } catch (err: any) {
      stream.error.value = err
    }
    // Request failures hold the modal open too — the run finished, but the
    // results are incomplete and the user has to see that.
    if (!stream.error.value && stream.requestErrors.value.length === 0) {
      useToastNotification().showToast(deps.successToast)
      showLoadingModal.value = false
    }
    stream.loadingProgress.value = undefined
  }

  return {
    loadingProgress: stream.loadingProgress,
    error: stream.error,
    requestErrors: stream.requestErrors,
    phasePlan: stream.phasePlan,
    phaseFractions: stream.phaseFractions,
    stopDepartureCount: stream.stopDepartureCount,
    stopsWithDepartures: stream.stopsWithDepartures,
    showLoadingModal,
    wsdotReport,
    wsdotReportConfig,
    runQuery,
  }
}
