// Shared scaffolding for the two WSDOT report components: report config over
// the browse config, stream state, the report receiver, and the run
// lifecycle. Each component keeps its viewer, its own config fields, and
// whatever it derives from the finished report.

import { ref, shallowRef, type Ref, type ShallowRef } from 'vue'
import { useScenarioStream, type UseScenarioStreamReturn } from './useScenarioStream'
import { useToastNotification } from './useToastNotification'
import {
  WSDOTReportDataReceiver,
  type WSDOTLevelGeometryConfig,
  type WSDOTReport,
  type WSDOTReportConfig,
} from '~~/src/analysis/wsdot'
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
  // Fetch the map overlay's stop buffer outlines into the current report.
  // A no-op once they are loaded, so a caller can drive it from a toggle.
  loadLevelGeometry: () => Promise<void>
}

export function useWsdotReport (deps: UseWsdotReportDeps): UseWsdotReportReturn {
  const stream = useScenarioStream()
  const wsdotReport = shallowRef<WSDOTReport>()
  // Kept past the run so the overlay's outlines stream into the report it
  // built rather than replacing it.
  let reportReceiver: WSDOTReportDataReceiver | undefined
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
    reportReceiver = receiver

    await stream.run(receiver, '/api/wsdot', { config: wsdotReportConfig.value })
    return true
  }

  // The report whose outlines are loaded. Identity rather than a flag, so the
  // reassignment the fetch itself makes doesn't read as a second report, and a
  // report built by a later run isn't drawn with the previous one's outlines.
  let geometryLoadedFor: WSDOTReport | undefined

  // What to outline for a report, or undefined when there is nothing: no
  // buffer radius, or no level with qualifying stops.
  function levelGeometryRequest (report: WSDOTReport): WSDOTLevelGeometryConfig | undefined {
    const config = wsdotReportConfig.value
    const levels = Object.entries(report.levelStops)
      .filter(([, stopIds]) => stopIds.length > 0)
      .map(([level, stopIds]) => ({ level, stopIds }))
    if (!(config.stopBufferRadius > 0) || levels.length === 0) {
      return undefined
    }
    return {
      geoDatasetName: config.geoDatasetName,
      stopBufferRadius: config.stopBufferRadius,
      levels,
    }
  }

  const runQuery = () => stream.runQuery(fetchReport, deps.successToast)

  const loadLevelGeometry = async (): Promise<void> => {
    const report = wsdotReport.value
    const receiver = reportReceiver
    if (!report || !receiver || report === geometryLoadedFor) {
      return
    }
    // Claimed before the fetch so a re-entrant call can't start a second one.
    // A report with nothing to outline is claimed and never asked about again.
    geometryLoadedFor = report
    const body = levelGeometryRequest(report)
    if (!body) {
      return
    }
    await stream.runQuery(async () => {
      receiver.clearLevelGeometry()
      await stream.run(receiver, '/api/wsdot-level-geometry', body)
      // Reassigned rather than mutated: the viewer reads the report through a
      // shallowRef, which never sees a nested push.
      wsdotReport.value = receiver.getCurrentWSDOTReport()
      geometryLoadedFor = wsdotReport.value
      return true
    }, 'Stop buffer outlines loaded')
    // Released on failure, so toggling the overlay again retries.
    if (stream.error.value) {
      geometryLoadedFor = undefined
    }
  }

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
    loadLevelGeometry,
  }
}
