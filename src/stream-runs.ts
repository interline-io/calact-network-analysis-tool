// The streaming run behind each BFF endpoint, keyed by the endpoint's path
// under /api. The BFF serves these over HTTP; in direct mode the browser runs
// them itself. Request validation stays with the BFF endpoints.

import { logMemory, requestStream, type GraphQLClient } from '~~/src/core'
import {
  runBufferPasses,
  runCensusValuesPhase,
  runDeparturesPhase,
  runFaresPhase,
  runFeedVersionsPhase,
  runFlexPhase,
  runProgressStream,
  runRoutesPhase,
  runStopCensusPhase,
  runStopClustersPhase,
  runStopsPhase,
  streamScenario,
  type BufferFetchConfig,
  type CensusValuesPhaseConfig,
  type DeparturesPhaseConfig,
  type FaresPhaseConfig,
  type FeedVersionsPhaseConfig,
  type FlexPhaseConfig,
  type ProgressEmit,
  type RoutesPhaseConfig,
  type ScenarioConfig,
  type ScenarioPhaseName,
  type StopCensusPhaseConfig,
  type StopClusterFetchConfig,
  type StopsPhaseConfig,
} from '~~/src/scenario'
import {
  runAnalysis,
  runWsdotLevelGeometryPhase,
  type WSDOTLevelGeometryConfig,
  type WSDOTReportConfig,
} from '~~/src/analysis/wsdot'
import { runVisionEvalAnalysisStreaming, type VisionEvalConfig } from '~~/src/analysis/visioneval'

// Reads one request body and writes the run's NDJSON into the controller.
export type StreamRun = (body: any, client: GraphQLClient, controller: ReadableStreamDefaultController) => Promise<void>

// Wraps a run that reports its own failure on the stream and closes it before
// rethrowing. The rethrow stops here: reaching producerStream's error
// backstop would discard the queued error event.
function reported<B> (
  label: string,
  run: (body: B, client: GraphQLClient, controller: ReadableStreamDefaultController) => Promise<unknown>,
): StreamRun {
  return async (body, client, controller) => {
    await run(body, client, controller).catch(err => console.error(`${label} failed:`, err))
  }
}

// One phase inside the shared envelope; the phase is the stream's announced plan.
function phase<B> (
  name: ScenarioPhaseName,
  startMessage: string,
  run: (body: B, client: GraphQLClient, emit: ProgressEmit, onError: (error: any) => void) => Promise<unknown>,
): StreamRun {
  return reported(`Phase run (${name})`, (body: B, client, controller) =>
    runProgressStream(requestStream(controller), client, { startMessage, phasePlan: [name] },
      (emit, onError) => run(body, client, emit, onError)))
}

export const streamRuns = {
  'scenario': reported('Scenario run', async (config: ScenarioConfig, client, controller) => {
    await streamScenario(controller, config, client)
    logMemory('stream-complete')
  }),
  'wsdot': reported('WSDOT run', ({ config }: { config: WSDOTReportConfig }, client, controller) =>
    runAnalysis(controller, config, client)),
  'wsdot-level-geometry': phase('wsdot-geographies', 'Fetching stop buffer outlines', (config: WSDOTLevelGeometryConfig, client, emit) =>
    runWsdotLevelGeometryPhase(config, client, emit)),
  'visioneval': reported('VisionEval run', ({ config }: { config: VisionEvalConfig }, client, controller) =>
    runVisionEvalAnalysisStreaming(controller, config, client)),
  'buffer-geographies': phase('buffers', 'Starting buffer refetch', async (config: BufferFetchConfig, client, emit, onError) => {
    await runBufferPasses(config, client, emit, { onError })
    logMemory('buffer-stream-complete')
  }),
  'stop-clusters': phase('stop-clusters', 'Recomputing stop clusters', async (config: StopClusterFetchConfig, client, emit) => {
    await runStopClustersPhase(config, client, emit)
    logMemory('stop-clusters-stream-complete')
  }),
  'scenario/census-values': phase('census-values', 'Starting census-values phase', (config: CensusValuesPhaseConfig, client, emit) =>
    runCensusValuesPhase(config, client, emit)),
  'scenario/departures': phase('departures', 'Starting departures phase', (config: DeparturesPhaseConfig, client, emit, onError) =>
    runDeparturesPhase(config, client, emit, { onError })),
  'scenario/fares': phase('fares', 'Starting fares phase', (config: FaresPhaseConfig, client, emit, onError) =>
    runFaresPhase({
      ...config,
      feedVersionRouteIds: config.feedVersionRouteIds || {},
      routeStopIds: config.routeStopIds || {},
    }, client, emit, { onError })),
  'scenario/feed-versions': phase('feed-versions', 'Starting feed-versions phase', (config: FeedVersionsPhaseConfig, client, emit) =>
    runFeedVersionsPhase(config, client, emit)),
  'scenario/flex': phase('flex-areas', 'Starting flex phase', (config: FlexPhaseConfig, client, emit, onError) =>
    runFlexPhase(config, client, emit, { onError })),
  'scenario/routes': phase('routes', 'Starting routes phase', (config: RoutesPhaseConfig, client, emit, onError) =>
    runRoutesPhase(config, client, emit, { onError })),
  'scenario/stop-census': phase('stop-census', 'Starting stop census phase', (config: StopCensusPhaseConfig, client, emit, onError) =>
    runStopCensusPhase(config, client, emit, { onError })),
  'scenario/stops': phase('stops', 'Starting stops phase', (config: StopsPhaseConfig, client, emit, onError) =>
    runStopsPhase(config, client, emit, { onError })),
} satisfies Record<string, StreamRun>

// A BFF endpoint's path under /api.
export type StreamEndpoint = keyof typeof streamRuns
