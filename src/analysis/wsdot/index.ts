import { requestStream, type GraphQLClient } from '~~/src/core'
import {
  runProgressStream,
  ScenarioFetcher,
  ScenarioDataReceiver,
  StopDepartureTuple,
  type ScenarioData,
  type ScenarioProgress,
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
  /**
   * Populate the returned ScenarioData with whole stops and routes.
   *
   * The report is built from folded records, so nothing here needs them, and
   * the HTTP endpoint discards the return value entirely while browser
   * consumers rebuild from the stream. Only a caller that reads the returned
   * ScenarioData sets this, which today is the stops-and-routes report.
   *
   * Left off, `scenarioData.stops` is empty and its routes carry no geometry.
   * Both still go out on the wire untouched; the server just does not hold a
   * second copy of what it is relaying.
   */
  retainScenarioEntities?: boolean
}

export async function runAnalysis (
  controller: ReadableStreamDefaultController,
  config: WSDOTReportConfig,
  client: GraphQLClient,
  opts: WSDOTAnalysisOptions = {},
): Promise<{ scenarioData: ScenarioData, wsdotResult: WSDOTReport }> {
  // The envelope owns the stream lifecycle: the opening 'ready' (carrying the
  // config and the declared phase plan), error reporting,
  // the single 'complete' — only emitted once the report phases after the
  // fetch have finished, so a failure during them can never arrive as a
  // successful empty report — and the close. Errors rethrow for the
  // in-process callers that build a report out of the return value: an empty
  // WSDOTReport is structurally valid and would export as a plausible report
  // of a total service desert.
  return runProgressStream(requestStream(controller), client, {
    startMessage: 'Starting WSDOT fetcher',
    config,
    phasePlan: WSDOT_PHASE_PLAN,
  }, async (emit, onError) => {
    // Nothing downstream of here reads a departure. The browser shows two
    // numbers from them, so the numbers are what it gets: the tuples are folded
    // and dropped rather than forwarded, keeping several million of them off the
    // wire and out of the browser's heap.
    let departures = 0
    const stopsWithDepartures = new Set<number>()
    const departureSummary = () => ({ departures, stopsWithDepartures: stopsWithDepartures.size })

    // Every event bound for the client goes through here, including the ones
    // the report phases emit after the fetch phases are done. Attaching the
    // totals at each call site instead would leave those events without them.
    // Awaited by the phases, so the run slows to the rate the client reads at
    // rather than queuing what it has not taken yet.
    const send = (progress: ScenarioProgress) => emit({
      ...withoutDepartures(progress),
      departureSummary: departureSummary(),
    })

    // The phases come from the declared plan, so the browse flags that gate
    // phases never apply here: flex, census, buffers and clusters are absent
    // because they are not declared, not because a flag turned them off. What
    // the copy pins are parameters — routeHourCompatMode for the analysis,
    // and departureDates, which defaults to the report's own days so the
    // departure cost stops following the scenario range (a caller narrowing
    // further is a reasonable thing to want).
    const configCopy = {
      ...config,
      routeHourCompatMode: true,
      departureDates: config.departureDates ?? wsdotDepartureDates(config),
    }

    // Departures are folded into per-hour counters as they stream rather than
    // accumulated. The report reads only counts, and holding every departure is
    // what put a statewide run over the Worker's memory limit. Stops, routes and
    // feed versions are still accumulated: the stop table is built from them,
    // and so is the stops-and-routes report layered on top of this one.
    const frequency = new WSDOTFrequencyAggregator(wsdotReportDates(config))
    const stops = new WSDOTStopCollector(config.aggregateLayer)

    const receiver = new ScenarioDataReceiver({
      onProgress: (progress) => {
        // Folded off the progress events rather than in place of accumulation,
        // so the report is built from the same records whether or not the whole
        // stops are being kept alongside for the caller.
        const batch = progress.partialData?.stops
        if (batch) {
          stops.add(batch)
        }
        return send(progress)
      },
    }, {
      onStopDepartures: (batch) => {
        frequency.addDepartures(batch)
        departures += batch.length
        for (const departure of batch) {
          stopsWithDepartures.add(StopDepartureTuple.stopId(departure))
        }
      },
      dropStops: !opts.retainScenarioEntities,
      dropRouteGeometry: !opts.retainScenarioEntities,
    })

    // The fetch phases, gated by the declared plan. Progress routes through
    // the receiver (accumulation + folds) on its way to the client.
    const fetcher = new ScenarioFetcher(configCopy, client, p => receiver.onProgress(p), {
      onError,
      plan: WSDOT_PHASE_PLAN,
    })
    const { resolvedGeography } = await fetcher.fetch()
    const scenarioData = receiver.getCurrentData()

    // The report phases, over the folded records the fetch just produced.
    const levels = await runWsdotLevelsPhase(configCopy, {
      frequency,
      stops,
      routes: scenarioData.routes,
    }, send)
    const { bboxIntersection } = await runWsdotGeographiesPhase(configCopy, {
      levelSets: levels.levelSets,
      resolved: resolvedGeography,
    }, client, send)

    // levelLayers is empty by design: the geography layers went out on the
    // stream as they were fetched, and the client rebuilds them in its receiver.
    return {
      scenarioData,
      wsdotResult: {
        stops: levels.stops,
        levelStops: levels.levelStops,
        levelLayers: {},
        bboxIntersection,
      },
    }
  })
}

// Strips the departure payload from an event bound for the client, along with
// the trip-id sidecar that only names departures. Returns the event unchanged
// when it carries neither, so the common case allocates nothing.
function withoutDepartures (progress: ScenarioProgress): ScenarioProgress {
  const partial = progress.partialData
  if (!partial?.stopDepartures && !partial?.tripIdStrings) {
    return progress
  }
  const { stopDepartures: _departures, tripIdStrings: _tripIds, ...rest } = partial
  return { ...progress, partialData: rest }
}

/**
 * Receiver for browser consumers, which reassemble the report from the NDJSON
 * stream; the server builds it in-process and returns it from runAnalysis.
 * Extends ScenarioDataReceiver with the report phases' typed payloads.
 */
export class WSDOTReportDataReceiver extends ScenarioDataReceiver {
  private wsdotReport: WSDOTReport = { stops: [], levelStops: {}, levelLayers: {}, bboxIntersection: [] }

  // Narrower than the base signature (method-position bivariance permits it);
  // structurally safe since every WSDOT payload field is optional.
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
  }

  /**
   * Get the current accumulated WSDOT report
   */
  getCurrentWSDOTReport (): WSDOTReport {
    return { ...this.wsdotReport }
  }
}
