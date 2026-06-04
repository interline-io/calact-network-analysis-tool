# Scenario data flow

> Describes the current scenario-fetching pipeline. Useful as a reference when adding new passes or debugging streaming behavior.

## Big picture

```
Browser SPA              Nitro server endpoint            Transitland GraphQL
─────────────            ───────────────────────          ──────────────────
useAnalysisResults
  ┌──────────────┐  POST  ┌────────────────────┐  query  ┌──────────────┐
  │ POST /api/   │ ─────▶ │ scenario.post.ts   │ ──────▶ │  /query      │
  │ scenario     │        │   streamScenario() │ ◀────── │              │
  │              │ ◀───── │                    │  data   └──────────────┘
  └──────────────┘ NDJSON └────────────────────┘
       │                       (ScenarioFetcher
       ▼                        + ScenarioStreamSender)
  ScenarioStreamReceiver
       │
       ▼
  ScenarioDataReceiver
  (accumulates stops/routes/
   feedVersions/departures/
   flex/censusGeographies)
       │
       ▼
  Reactive props on
  pages/tne.vue → cal-* components
```

- Browser kicks off a single POST to `server/api/scenario.post.ts` with a `ScenarioConfig`.
- The endpoint wraps `streamScenario(controller, config, client)` from `src/scenario/scenario.ts` and sets `content-type: application/x-ndjson`.
- The server side runs `ScenarioFetcher.fetch()`. Each progress event is serialized as one JSON line and pushed through the stream by `ScenarioStreamSender`.
- The browser's `ScenarioStreamReceiver` parses NDJSON line-by-line and dispatches into a `ScenarioDataReceiver`, which accumulates partial results into the typed maps/arrays the UI renders from.
- SSR is disabled (`ssr: false`) — this is a pure SPA. The Nitro endpoint exists only to (a) hold the GraphQL API key and (b) compose the multi-pass fetch logic in one place.

## ScenarioConfig (request shape)

`ScenarioConfig` (defined in `src/scenario/scenario.ts`) is the single object that drives every pass:

| Field | Used by |
|---|---|
| `bbox` or `geographyIds` | feed-versions (resolves bbox), stops (location filter), census-values |
| `startDate` / `endDate` | schedules (per-day date matrix), flex-areas (active service date) |
| `aggregateLayer` + `tableDatasetName` + `geoDatasetName` | census-values (skipped if either is unset) |
| `includeFixedRoute` (default true) | gates stops + routes + schedules |
| `includeFlexAreas` (default true) | gates flex-areas (the SPA defaults this off and defers — see "Scenario layers") |
| `includeStopBufferDemographics` (default true) | gates the #315 buffer passes (SPA defers by default) |
| `includeCensusValues` (default true) | gates census-values (SPA defers by default) |
| `stopLimit`, `departureMode` | tuning knobs for stop pagination + departure query shape |

All three `include*` layer flags use `!== false` semantics: `undefined` (CLI/WSDOT callers) counts as enabled, so only the SPA's explicit `false` defers a layer.

## ScenarioFetcher orchestration

`fetchMain()` (`src/scenario/scenario.ts:549`) runs passes in this order:

1. **`fetchFeedVersions()`** — sequential, must run first (sets `resolvedBbox` and `resolvedWithin` for every other pass that needs them).
2. If `includeFixedRoute`:
   - Enqueue one `stopFetchQueue` task per feed version. **All three queues below run concurrently**: stop fetches enqueue route fetches and stop-departure fetches as they discover IDs, so the queues drain in parallel.
   - **Stops + Routes + Schedules** all run concurrently from there.
   - Awaited via `stopFetchQueue.wait()`, `routeFetchQueue.wait()`, `stopDepartureQueue.wait()`.
3. **Flex-areas** and **census-values** run concurrently via `Promise.all([fetchFlexAreas(), fetchCensusValues()])` since both only depend on `resolvedBbox` (already set in step 1).
4. Final `updateProgress('complete', false)`.

Concurrency: four `TaskQueue<T>` instances, each capped at `maxConcurrentRequests = 8`. Each queue has its own task type and its own dispatcher method.

## Passes

| # | Stage name | Method | Concurrency | What it does |
|---|---|---|---|---|
| 1 | `feed-versions` | `fetchFeedVersions()` | sequential, 1 query (or 2 if `geographyIds` is set — fetches admin polygons first, then bbox-derived feed versions) | Resolves the user's query into a concrete bbox + list of active `FeedVersion`s for that bbox + date range. Sets `resolvedBbox` and (for admin-boundary queries) `resolvedWithin`. Also sets `multiAdminWarning` for the multi-polygon case (#347). |
| 2 | `stops` | `fetchStops(task)` via `stopFetchQueue` | up to 8 in flight | Per feed version, paginates `stops(limit, after, where: {feed_version_sha1, location: {bbox|geography_ids}})`. Each page batches `PROGRESS_LIMIT_STOPS = 1000` stops per progress event. Each stop carries nested `census_geographies` (containment) and `route_stops` so we discover route IDs without an extra hop. |
| 3 | `routes` | `fetchRoutes(task)` via `routeFetchQueue` | up to 8 in flight | One query per route ID batch (a single `routes(ids: [...])` per feed version). Routes-IDs come from the stops step's `route_stops`. `fetchedRouteIds` deduplicates pre-emptively so the same route isn't re-requested. |
| 4 | `schedules` | `fetchStopDepartures(task)` via `stopDepartureQueue` | up to 8 in flight | One query per `(stopId batch, date-window)` task. Stops are chunked at `stopTimeBatchSize = 100`, dates chunked into 7-day windows. The result is parsed into `StopDepartureTuple` (a memory-tight `[stop_id, date, time_seconds, trip_id, direction, route_id]` array) and accumulated into `StopDepartureCache`. Trip-ID strings are stripped from the wire format and shipped separately in a sidecar `tripIdStrings` map (one entry per unique trip). |
| 5 | `flex-areas` | `fetchFlexArea(fv)` via `flexFetchQueue` | up to 8 in flight, concurrent with census-values | One pass per feed version: fetches GTFS-Flex `Location` objects + slim multi-date `stop_times` to populate `FlexDepartureCache`. Same week-window chunking as schedules. |
| 6 | `census-values` | `fetchCensusValues()` | one query, concurrent with flex-areas | When `tableDatasetName` + `aggregateLayer` are both set: calls `fetchCensusIntersection` at the user's `aggregateLayer`, returning per-geography `intersection_area` + raw ACS values for `REQUIRED_ACS_TABLES`. Skipped otherwise. Powers the choropleth, aggregation table, and census details panel. |

Terminal stages on the wire: `complete` (final event), `ready` (initial event with `config`), `extra` (out-of-band debug payloads).

## Streaming wire protocol

- One JSON object per line (NDJSON). Each object is a `ScenarioProgress` with `currentStage`, optional `currentStageMessage`, optional progress counters, and optional `partialData` (any of `stops`, `routes`, `feedVersions`, `stopDepartures`, `flexAreas`, `flexDepartures`, `tripIdStrings`, `censusGeographies`).
- Sender side: `ScenarioStreamSender` (in `src/scenario/scenario.ts`) is the queue's `onProgress` adapter — it wraps each progress event into a JSON line and writes it to the response stream.
- Receiver side: `ScenarioStreamReceiver` reads NDJSON via `multiplexStream`, hands events to `ScenarioDataReceiver` which merges incoming partials into the accumulated `ScenarioData`. Two-stream multiplexing (`runScenarioFetcher`) lets a single fetch simultaneously stream to the network *and* accumulate locally.
- The wire format intentionally drops large strings. Two examples:
  - `StopDepartureTuple` is a 6-element array (no `__typename`, no nested objects). Trip IDs are integers; the `tripId → string` mapping is shipped as a sidecar map.
  - Census `geometries` are not included in `census-values`. Geometries come from `geographyLayerQuery` later, on demand, only for the layer the choropleth is rendering.

## Caches and memory shape

The receiver maintains:

- `stops: StopGql[]`, `routes: RouteGql[]`, `feedVersions: FeedVersion[]` — append-only arrays.
- `stopDepartureCache: StopDepartureCache` — internally a `Map<stopId, StopDepartureTuple[]>` for fast per-stop lookup.
- `flexDepartureCache: FlexDepartureCache` — same shape for flex.
- `flexAreas: FlexAreaFeature[]`.
- `tripIdStrings: Map<number, string>` (sidecar).
- `censusGeographiesByLayer: Map<layer, Map<geoid, CensusGeographyData>>` — per-layer census cache; each streamed entry carries `.layer` so the receiver routes it to its layer's own map. `applyScenarioResultFilter` selects the current `aggregateLayer`'s map into `ScenarioFilterResult.censusGeographies`, so UI consumers see a flat per-geoid map.

Memory tracking via `logMemory(stage)` calls bookend each pass (`fetchMain-start`, `after-feed-versions`, `after-stops`, `after-routes`, `after-departures`, `after-flex-and-census`, `fetchMain-complete`).

## Progress UI

The browser maps each `currentStage` to a status line in `cal-scenario-loading.vue`. Stage transitions drive the progress text; `feedVersionProgress` and `stopDepartureProgress` counters drive any percentage indicators.

## Scenario layers (deferred / on-demand loading)

The pipeline has a tightly-coupled **core** and loosely-coupled **layers**:

```
fetchFeedVersions ──→ resolvedBbox/within, feed-version list
   ├─→ stops ──→ routes ──→ agencies          ┐
   │      └─→ departures/schedules            ┤ CORE — always /api/scenario
   ├─→ flex areas        (needs FV list)      ┐
   ├─→ census values     (needs area+layer)   ┤ LAYERS — deferrable
   └─→ buffer demographics (needs entity ids) ┘
```

The core trio is sequentially dependent and almost always needed together, so it stays combined in `/api/scenario`. Each layer follows the same pattern:

1. **A pure pass function** (`runBufferPasses`, `runCensusValuesPass`, `runFlexAreasPass`) shared by the inline pipeline and a standalone endpoint — same emit shape, same wire format.
2. **A standalone NDJSON endpoint** (`/api/buffer-geographies`, `/api/census-values`, `/api/flex-areas`) taking only the small client-known inputs the layer needs (entity ids / bbox+geographyIds+layer / feed versions+dates).
3. **A config flag** (`includeStopBufferDemographics` / `includeCensusValues` / `includeFlexAreas`) with `!== false` semantics so CLI/WSDOT (which never set them) keep inline behavior.
4. **Client-side `ensureX()` state** in `app/composables/useScenarioRefetch.ts`: idempotent, in-flight-deduped loads streaming into the *same* `ScenarioDataReceiver` as the main fetch (layers touch disjoint accumulator fields, so concurrent streams are safe).

What triggers each layer in the SPA:

| Layer | Loaded inline when | Deferred trigger |
|---|---|---|
| Buffer demographics | "Include Stop Buffer Demographics" checked | "Load stop buffer demographics" buttons (Filters, Report); radius/layer changes auto-refetch after the first load |
| Census values | demographics checkbox checked (aggregation seeding needs them) | Stops (Aggregated) tab opened, Show Agg. Areas enabled, aggregate-layer changed, or buffer `loadNow()` |
| Flex areas | "Include Flex Service Areas" checked | Flex Services display toggle first enabled |

Caching: loaded layer data persists in the receiver for the life of the scenario — display toggles only gate rendering. Census values cache **per aggregate layer**, so layer switches A → B → A refetch nothing. Only buffer radius/layer changes (values genuinely change) and a new query run refetch.

## Where to plug in a new pass

If you're adding a new pass:

1. Define a new value for `ScenarioProgress['currentStage']` (the union literal in `src/scenario/scenario.ts`).
2. Add a private async method on `ScenarioFetcher` that calls `this.updateProgress(stage, true, partialData?)` and emits its results.
3. Decide where it fits in `fetchMain()`:
   - Sequential after `fetchFeedVersions` if you need `resolvedBbox`/`resolvedWithin`.
   - Concurrent in the existing `Promise.all([fetchFlexAreas, fetchCensusValues])` block if you only need the resolved bbox.
   - Inside the fixed-route block (after `stopFetchQueue.wait()`) if you need the full stop/route/agency set.
4. If the pass dispatches many small queries, follow the `TaskQueue<T>` + `chunkArray` pattern used by stops/routes/schedules/flex.
5. Extend `ScenarioData` and the receiver's merge logic for the new partial-data field. Keep the wire format slim (drop strings/geometries that aren't needed downstream).
6. Add a status line for the new stage in `cal-scenario-loading.vue`.

## Key files

- `src/scenario/scenario.ts` — ScenarioFetcher, streaming senders/receivers, all pass definitions.
- `src/scenario/scenario-filter.ts` — post-fetch client-side filtering (frequency, agency, time-of-day, weekday, fare).
- `src/core/stream.ts` — generic stream multiplexing primitives.
- `src/core/task-queue.ts` — concurrency-capped task queue used by every pass that fans out.
- `src/core/census-intersection.ts` — the shared `fetchCensusIntersection` helper used by `fetchCensusValues` and the WSDOT analysis.
- `server/api/scenario.post.ts` — the Nitro endpoint that wraps `streamScenario`.
- `app/composables/useAnalysisResults.ts` — browser-side wrapper that POSTs to the endpoint and consumes the NDJSON stream.
