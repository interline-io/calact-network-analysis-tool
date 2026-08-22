import { requestStream, type GraphQLClient } from '~~/src/core'
import {
  runProgressStream,
  ScenarioFetcher,
  ScenarioDataReceiver,
  type ScenarioData,
} from '~~/src/scenario'
import { WSDOTFrequencyAggregator } from './frequency'
import { WSDOTStopCollector } from './stops'
import {
  runWsdotLevelsPhase,
  runWsdotGeographiesPhase,
  wsdotDepartureDates,
  wsdotReportDates,
  WSDOT_PHASE_PLAN,
  type WSDOTReport,
  type WSDOTReportConfig,
  type WSDOTProgress,
} from './report-phases'

// Re-export the report's phases, config, and types so consumers keep
// importing everything from ~~/src/analysis/wsdot.
export * from './report-phases'
export { SERVICE_LEVELS, levelColors, type LevelKey } from './service-levels'
export { WSDOTFrequencyAggregator, type FrequencyData, type FrequencyLabels } from './frequency'
export { WSDOTStopCollector, type WSDOTStopRecord } from './stops'

export interface WSDOTAnalysisOptions {
  // Populate the returned ScenarioData with whole stops and route shapes, for
  // callers that read the return value (the stops-and-routes report). Left
  // off, both still go out on the wire untouched; the server just avoids
  // holding a second copy of what it relays.
  retainScenarioEntities?: boolean
}

export async function runAnalysis (
  controller: ReadableStreamDefaultController,
  config: WSDOTReportConfig,
  client: GraphQLClient,
  opts: WSDOTAnalysisOptions = {},
): Promise<{ scenarioData: ScenarioData, wsdotResult: WSDOTReport }> {
  // The envelope owns the stream lifecycle. 'complete' fires only after the
  // report phases finish, so a mid-analysis failure can never arrive as a
  // successful empty report — which would read as a statewide service desert.
  return runProgressStream(requestStream(controller), client, {
    startMessage: 'Starting WSDOT fetcher',
    config,
    phasePlan: WSDOT_PHASE_PLAN,
  }, async (emit, onError) => {
    // Phase gating comes from the declared plan, never from browse flags; the
    // copy pins only parameters. departureDates defaults to the report's own
    // days so departure cost doesn't follow the scenario range.
    const configCopy = {
      ...config,
      routeHourCompatMode: true,
      departureDates: config.departureDates ?? wsdotDepartureDates(config),
    }

    // Departures are folded into per-hour counters rather than accumulated —
    // holding every one is what put a statewide run over the Worker's memory
    // limit. Retention only: the tuples still stream through to the client.
    const frequency = new WSDOTFrequencyAggregator(wsdotReportDates(config))
    const stops = new WSDOTStopCollector(config.aggregateLayer)

    const receiver = new ScenarioDataReceiver({
      onProgress: (progress) => {
        // Folded off the events, so the report is built from the same records
        // whether or not whole stops are also being retained for the caller.
        const batch = progress.partialData?.stops
        if (batch) {
          stops.add(batch)
        }
        // Returned so the phases pace themselves against the client.
        return emit(progress)
      },
    }, {
      onStopDepartures: batch => frequency.addDepartures(batch),
      dropStops: !opts.retainScenarioEntities,
      dropRouteGeometry: !opts.retainScenarioEntities,
    })

    // Progress routes through the receiver (accumulation + folds) on its way
    // to the client.
    const fetcher = new ScenarioFetcher(configCopy, client, p => receiver.onProgress(p), {
      onError,
      plan: WSDOT_PHASE_PLAN,
    })
    const { resolvedGeography } = await fetcher.fetch()
    const scenarioData = receiver.getCurrentData()

    const levels = await runWsdotLevelsPhase(configCopy, {
      frequency,
      stops,
      routes: scenarioData.routes,
    }, emit)
    const { bboxIntersection } = await runWsdotGeographiesPhase(configCopy, {
      levelSets: levels.levelSets,
      resolved: resolvedGeography,
    }, client, emit)

    // levelLayers is empty by design: the layers went out on the stream as
    // they were fetched, and the client rebuilds them in its receiver.
    // levelGeometry likewise, and it is only ever fetched on request.
    return {
      scenarioData,
      wsdotResult: {
        stops: levels.stops,
        levelStops: levels.levelStops,
        levelLayers: {},
        levelGeometry: {},
        bboxIntersection,
      },
    }
  })
}

// Receiver for browser consumers, which reassemble the report from the
// stream's typed payloads; the server builds it in-process instead.
export class WSDOTReportDataReceiver extends ScenarioDataReceiver {
  private wsdotReport: WSDOTReport = { stops: [], levelStops: {}, levelLayers: {}, levelGeometry: {}, bboxIntersection: [] }

  // Narrower than the base signature; safe since every WSDOT field is optional.
  override onProgress (progress: WSDOTProgress): void {
    super.onProgress(progress)

    const p = progress.partialData
    if (p?.wsdotStops) {
      this.wsdotReport.stops.push(...p.wsdotStops)
    }
    if (p?.wsdotLevelStops) {
      Object.assign(this.wsdotReport.levelStops, p.wsdotLevelStops)
    }
    if (p?.wsdotLevelLayers) {
      for (const chunk of p.wsdotLevelLayers) {
        const layers = this.wsdotReport.levelLayers[chunk.level] || (this.wsdotReport.levelLayers[chunk.level] = {})
        const features = layers[chunk.layer] || (layers[chunk.layer] = [])
        features.push(...chunk.features)
      }
    }
    if (p?.wsdotBboxIntersection) {
      this.wsdotReport.bboxIntersection.push(...p.wsdotBboxIntersection)
    }
    if (p?.wsdotLevelGeometry) {
      for (const chunk of p.wsdotLevelGeometry) {
        const geometry = this.wsdotReport.levelGeometry[chunk.level] || (this.wsdotReport.levelGeometry[chunk.level] = [])
        geometry.push(...chunk.geometry)
      }
    }
  }

  // Drop the outlines before refetching them, so a second overlay load appends
  // to nothing. The rest of the report is untouched — it is not refetched.
  clearLevelGeometry (): void {
    this.wsdotReport.levelGeometry = {}
  }

  // A shallow copy of the report accumulated so far.
  getCurrentWSDOTReport (): WSDOTReport {
    return { ...this.wsdotReport }
  }
}
