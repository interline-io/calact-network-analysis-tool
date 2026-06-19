# Stop Clustering for Key Transit Hubs — Implementation Plan

Tracking issue: [#330](https://github.com/interline-io/calact-network-analysis-tool/issues/330)
Branch: `stop-clustering`
Status: **in progress** — see the Progress Checklist at the bottom.

This document is the source of truth for the work so it can be picked up from any
machine or after a restart. It captures the agreed design, the algorithm, and a
file-by-file plan. Line numbers are approximate (as of `main` @ `c93850e`) and are
navigational hints, not exact anchors.

---

## 1. Goal (from the issue)

Display **clusters of nearby stops that could serve as cross-agency transfer hubs**
(or "near-miss" hubs as the criteria are relaxed). The user adjusts a max distance
and a max transfer time to see which stops are close enough — physically *and*
temporally — to act as transfers between agencies.

Rules from the issue:
- A cluster must contain stops from **multiple agencies** within the max distance.
- A cluster includes **one stop per agency**.
- Clusters **maximize** the number of stops/agencies when multiple groupings are possible.
- A stop belongs to **at most one** cluster.
- Stop clusters become **another aggregation section** in the Reports tab.

Clarifications from issue comments (tsherlockcraig / NomeQ):
- Use a **numeric text input in meters** for the distance, not a slider.
- Include a **"Max transfer time"** temporal filter. Semantics: *each stop in a
  cluster must have a stop time within X minutes of at least one other stop in the
  cluster.* This supports the "near-miss" user story (relax criteria → clusters appear).
- Map popup on a cluster shows **agency + route(s) + stop id, connected to each other**
  (which agency, via which route(s), at which stop), and maybe arrival/departure times.
- Deferred to a future sprint: let the user manually remove stops from a cluster.

Wireframes (attached to the issue):
- Filter panel: a "Stop Clustering" block under **Fixed Route Services** with a distance
  input (meters) and a "Max transfer time" input (minutes), gated by an enable checkbox
  (inputs greyed when unchecked).
- Map: clicking a cluster draws a **dashed circle + translucent fill**, reveals member
  stops, greys out non-members, and opens a **"Stop Cluster"** popup (agency chips,
  routes, stop ids). New legend entry **"Stop Clusters"** (a multi-color dot).
  Clicking outside the circle (or closing the popup) collapses the selection; clicking a
  member stop shows the normal stop popup without collapsing.

---

## 2. Confirmed decisions

1. **Where clustering runs — "Server distance + client temporal".**
   - The **distance test** (which stops are within X meters of which) runs **server-side
     in PostGIS** via the Transitland GraphQL field `Stop.nearby_stops(radius)`
     (ST_DWithin). This honors the project geometry rule (no client-side geometry). No
     backend changes are needed — the primitive already exists.
   - The **cross-agency cluster assignment** (one-per-agency, maximize, disjoint) is plain
     graph/optimization logic in TypeScript (not geometry), computed **server-side** in a
     scenario phase from the proximity edges.
   - The **max-transfer-time prune** is pure time arithmetic over the already-loaded
     `StopDepartureCache`, computed **client-side** so that input retunes instantly with no
     server round-trip.
   - Changing the **distance** re-runs the server proximity step via a dedicated recompute
     endpoint (mirrors the existing stop-buffer `/api/buffer-geographies` retune pattern),
     so distance retuning does not require re-running the whole scenario.

2. **Defaults:** max distance **200 m**, max transfer time **15 min**.
   Clustering is **off** until the user enables it; these values seed the inputs on enable.

### Rejected alternatives
- *Fully client-side haversine clustering* — best slider interactivity but client-side
  distance math conflicts with the project geometry rule. Rejected.
- *Fully server-side (temporal filter in a server phase too)* — clean single source of
  truth but every transfer-time retune needs a round-trip. Rejected in favor of the
  client-side temporal prune for instant feedback.

---

## 3. Architecture / data flow

```
User enables clustering, sets distance (server input) + max transfer time (client input)
        │
        ▼
[SERVER] scenario phase "stop-clusters" (runs after "departures")
   1. GraphQL: per stop, nearby_stops(radius: distance) → proximity edges (+ agency ids)   ← PostGIS, ST_DWithin
   2. deriveStopClusters(): greedy cross-agency disjoint assignment → candidate clusters    ← pure TS, NOT geometry
   3. emit partialData.stopClusters (lean, JSON-serializable)
        │  (also exposed standalone via /api/stop-clusters for distance retuning)
        ▼
[CLIENT] ScenarioDataReceiver accumulates ScenarioData.stopClusters
        │
        ▼
[CLIENT] applyScenarioResultFilter():
   4. applyClusterTransferTime(): prune members lacking a within-X-min partner using
      StopDepartureCache; drop clusters that fall below 2 agencies                          ← pure time arithmetic
   5. attach result.stopClusters
        │
        ▼
[CLIENT] consumers: map.vue (dashed circle, reveal/grey, cluster popup, legend),
                    report.vue (new "Stop Clusters" aggregation tab)
```

### Why this respects the geometry rule
- The only geometric test (within X meters) is done by PostGIS via `nearby_stops`.
- Cluster assignment is set/graph logic; transfer-time pruning is time arithmetic — neither
  is a geometric operation whose correctness must agree with PostGIS.
- The map's dashed circle is drawn with MapLibre's **native `circle` paint** (a rendering
  primitive that converts meters→pixels at the current zoom/latitude), not a computed
  buffer polygon. The cluster centroid for framing is bbox/mean arithmetic (the sanctioned
  exception). The circle radius is the user's input value, not a computed distance.

---

## 4. The clustering algorithm (`deriveStopClusters`)

**Cluster model — anchor ball.** For each stop A, its candidate cluster is
`{A} ∪ {stops within `distance` of A}` (exactly what `nearby_stops(radius)` returns). A
circle of radius = `distance` centered on A therefore contains every member, which matches
the wireframe and keeps the map circle exactly correct.

**Agency identity.** A stop has **no direct agency field**; its agencies are derived as the
set over `stop.route_stops[].route.agency`. A stop may serve multiple agencies.

**Greedy disjoint assignment (deterministic):**
1. Build candidate balls from the proximity edges.
2. For each ball, choose at most **one representative stop per agency**. Tie-break by
   (route count desc, stop id asc) — deterministic and avoids needing pairwise distances.
3. Score each ball by the number of **distinct agencies** represented (since one-stop-per-
   agency means maximizing stops ≡ maximizing agencies).
4. Repeatedly take the highest-scoring ball with **≥ 2 agencies**, emit it as a cluster,
   remove its member stops from the pool, and re-score. Stop when no ball has ≥ 2 agencies.
5. Ties broken deterministically (e.g. by anchor stop id) so results are stable.

**Output `StopCluster`** (lean, serializable):
```ts
interface StopCluster {
  id: string                 // e.g. `cluster:<anchorStopId>`
  anchorStopId: number
  centroid: { lon: number, lat: number }   // mean of member coords (client framing)
  memberStopIds: number[]
  agencyIds: number[]
  routeIds: number[]
  maxDistanceMeters: number  // the input radius (for drawing the circle)
}
```

**Temporal prune (`applyClusterTransferTime`, client-side):** for a cluster, gather each
member's departure times (seconds-since-midnight) from `StopDepartureCache.get(stopId, date)`
across the selected date range. Keep a member only if it has at least one departure within
`maxTransferMinutes * 60` of some *other* member's departure. Drop the cluster if it falls
below 2 agencies. Reuses the exact `stopDepartureCache.get(...).map(st => st.departureTime)`
pattern already in `scenario-filter.ts` (`stopVisits`).

Both functions live in a pure, unit-tested module with a co-located `*.test.ts`
(mirroring `route-headway.ts` / `route-headway.test.ts`).

### Known v1 simplifications (documented, adjustable)
- Assignment is greedy/maximal, not provably optimal — acceptable per the issue's
  "maximize" language and is deterministic.
- A multi-agency stop can satisfy multiple agency slots at once (it is one physical shared
  location). If product wants strictly distinct physical stops, the scoring is easy to change.
- Temporal pruning happens *after* proximity assignment (proximity clusters, then time
  filter) — consistent with the "relax criteria → clusters develop" intent.
- Only `departure_time` is currently fetched (no `arrival_time`). The popup uses departure
  times; arrival would require extending `stopDepartureQuery`/`stopTimeQuery`, the wire
  tuple, and the cache.

---

## 5. File-by-file plan (by stage)

Each stage is independently `pnpm check`-clean (lint + typecheck) and reviewable.

### Stage 1 — Core (no UI) ✅ first
- `src/core/constants.ts` — add `STOP_CLUSTER_DEFAULT_DISTANCE = 200` and
  `STOP_CLUSTER_DEFAULT_MAX_TRANSFER_MINUTES = 15` near `STOP_BUFFER_DEFAULT_*` (~L256); add
  matching keys to `SCENARIO_DEFAULTS` (~L6) if needed for spreading. (auto-exported via
  `src/core/index.ts`).
- `src/scenario/stop-clusters.ts` — **new.** `StopCluster` type, `deriveStopClusters()`, and
  `applyClusterTransferTime()`. Pure, decoupled from GraphQL types (take a minimal input
  shape: `{ id, agencyIds, routeIds, coord, neighbors }`).
- `src/scenario/stop-clusters.test.ts` — **new.** Unit tests: multi-agency requirement,
  one-per-agency, disjointness, maximize-agencies greedy, temporal prune keep/drop.
- `src/scenario/index.ts` — `export * from './stop-clusters'`.

### Stage 2 — Server proximity + phase + retune endpoint
- `src/tl/stop.ts` (or **new** `src/tl/stop-cluster.ts`) — static `gql` query selecting
  `nearby_stops(radius: $radius) { id route_stops { route { agency { id } } } }` (bound
  vars only). Export from `src/tl/index.ts` if new file.
- `src/scenario/phases/common.ts` — add `'stop-clusters'` to `ScenarioPhaseName`,
  `SCENARIO_PHASE_ORDER` (after `'departures'`), and `SCENARIO_PHASE_WEIGHTS`.
- `src/scenario/scenario.ts` —
  - `ScenarioConfig` (~L43): add `stopClusterDistance?: number` (server input).
  - `PHASE_ENABLED` (~L94): `'stop-clusters'` enabled when fixed-route on AND
    `(stopClusterDistance ?? 0) > 0`.
  - `ScenarioData` (~L129) + `ScenarioProgress.partialData` (~L186): add `stopClusters?:`.
  - `ScenarioFetcher.fetchMain` (~L378): call a new `fetchStopClusters(stopIds)` after
    departures; `ScenarioDataReceiver` (~L531): init + merge incoming cluster batches.
- `src/scenario/stop-clusters.ts` — add the phase runner `runStopClustering(config, client,
  emit)` (mirror `buffer-passes.ts`: batched `TaskQueue`, chunked, emits `partialData`).
- `server/api/stop-clusters.post.ts` — **new**, mirror `server/api/buffer-geographies.post.ts`
  (read config, `setStreamHeaders`, `ReadableStream`, stream server-computed clusters).
- `src/scenario/scenario.ts` — add a `streamStopClusters()` wrapper (mirror
  `streamBufferGeographies`).
- `app/composables/useClusterRefetch.ts` — **new**, mirror `useBufferRefetch.ts`: watch
  `clusterDistance`, debounce, POST, AbortController-cancel, stream back into the receiver.

### Stage 3 — URL state + filter UI + client temporal wiring
- `app/composables/useScenarioInputs.ts` — add `clusterEnabled` (boolean) and
  `clusterDistance` (number, default-elided) WritableComputedRefs (mirror `stopBufferRadius`
  ~L125); add to interface (~L17) and return object.
- `app/composables/useScenarioFilters.ts` — add `clusterMaxTransferMinutes` (client prune,
  post-fetch; mirror `frequencyUnder`). Add to interface (~L11) and return.
- `src/scenario/scenario.ts` — `ScenarioFilter` (~L115): add `clusterMaxTransferMinutes?`.
- `app/components/cal/filter.vue` — in the Fixed-Route Services panel (tab `transit-layers`,
  ~L186–340, after the buffer-layer control ~L284): add a `<p class="menu-label">Stop
  Clustering</p>` block with an enable `cat-checkbox`, a distance `cat-input type="number"`
  (meters) and a "Max transfer time" `cat-input type="number"` (minutes), both
  `:disabled="!clusterEnabled"`. Destructure the new refs (~L724–763). Reuse
  `.cal-input-width-100`.
- `app/pages/tne.vue` — thread `clusterDistance`/`clusterEnabled` into `scenarioConfig`
  (~L1001) and `clusterMaxTransferMinutes` into `scenarioFilter` (~L1022).
- `src/scenario/scenario-filter.ts` — `ScenarioFilterResult` (~L501): add
  `stopClusters?: StopCluster[]`. In `applyScenarioResultFilter` (~L525), after stops are
  derived, run `applyClusterTransferTime(scenarioData.stopClusters, sdCache, dateRange,
  filter.clusterMaxTransferMinutes)` and assign `result.stopClusters`.

### Stage 4 — Map rendering
- `src/core/geom.ts` — `PopupFeature` (~L53): add `'cluster'` to the `featureType` union and
  cluster fields to `data` (agency_names[], route_short_names[], stop_ids[], optional times).
- `app/components/cal/map-popup.vue` — extend the local `featureType` union (~L92) and add a
  `<template v-else-if="feature.featureType === 'cluster'">` block (agency chips via
  `cat-tag`, routes, connected stop ids, departure times). XSS-safe (no innerHTML).
- `app/components/cal/map-viewer-ts.vue` —
  - `createSources()` (~L392): add `clusters` (centroid points) and `clusterCircle` sources.
  - `createLayers()` (~L429): add `cluster-circle-fill` (translucent), `cluster-circle-outline`
    (`line-dasharray:[4,4]`, copy `flex-polygons-outline-dashed`), and a `clusters` marker
    layer (multi-color dot). Order just under `points` so member stops stay clickable.
  - `defineModel`s for `clusterFeatures` + `clusterCircle`; `updateClusters()` watchers.
  - `mapClick()` (~L1029): add the cluster layers to the `layersToQuery` allow-list.
  - keep the `featureType` union (~L933) in sync.
- `app/components/cal/map.vue` —
  - `clusterFeatures` computed (one centroid Point per cluster) + `selectedClusterId` ref.
  - `displayFeatures` (~L761): when a cluster is selected, grey non-members (reuse the
    existing `#aaa`/0.1 marker-opacity path) and keep members full color.
  - `clusterCircle` computed: empty unless a cluster is selected; native circle paint driven
    by `maxDistanceMeters` + anchor coord.
  - `mapClickFeatures()` (~L974): clicking a cluster sets `selectedClusterId` and builds a
    `'cluster'` PopupFeature; clicking empty space clears selection; member stop clicks
    resolve to the normal stop popup. Give cluster features a namespaced id (`cluster:<id>`)
    to avoid dedup collisions with stop ids.
  - `hasClusterData` + pass to `<cal-legend>`.
- `app/components/cal/legend.vue` — add a `hasClusterData` prop, a "Stop Clusters" section
  with a multi-color pie swatch, and `hasClusterData` into `shouldShowLegend`.
- Multi-color marker: build with `createCategoryColorScale(agencyNames)` from
  `src/core/colors.ts` (Tableau10 ordinal) rendered as an SVG/conic-gradient dot — the fixed
  6-entry `colors` palette is positional and too small; do not reuse it here.

### Stage 5 — Reports aggregation tab
- `app/components/cal/report.vue` — add `'stop-clusters'` to the `ReportTab` union (~L331),
  `reportTabLabels` (~L335), `modeMap` (~L350); a `<cat-tab-item value="stop-clusters"
  label="Stop Clusters" v-if="fixedRouteEnabled && clusterEnabled"/>` (~L25); extend the
  tab-fallback watch (~L362) so a hidden tab bounces to `'stops'`; add `stopClusterColumns`
  + `stopClusterReportData` computeds and a `case 'stop-clusters'` in `activeTableReport`.
- `src/tl/stop-cluster.ts` (or `stop.ts`) — `stopClusterCsv()` row builder + `StopClusterCsv`
  row type (cluster id, agencies, stops, routes, member stop ids, transfer times). Export via
  `src/tl/index.ts`. CSV export is then free via `cal-datagrid`.

### Stage 6 — Polish
- When `clusterMaxTransferMinutes` is set (or clustering enabled), force
  `includeDepartures` (and `includeFixedRoute`) true in the config built in `tne.vue` —
  otherwise the temporal filter has no data. If departures are off, disable the transfer-time
  input.
- GeoJSON export of clusters (optional): the map must push cluster features into
  `exportFeatures` (`set-export-features` in `tne.vue`) — it won't appear automatically.
- Full `pnpm test` + `pnpm check`.

---

## 6. Key reference points in the codebase

| Concern | File | Notes |
|---|---|---|
| Filter sidebar / Fixed-Route panel | `app/components/cal/filter.vue` | tab `transit-layers` ~L178–341; enable-checkbox idiom ~L799–806 |
| URL-backed fetch inputs | `app/composables/useScenarioInputs.ts` | `stopBufferRadius` ~L125 is the number-with-default template |
| URL-backed client filters | `app/composables/useScenarioFilters.ts` | `frequencyUnder` is the nullable-number template |
| Config assembled + POSTed | `app/pages/tne.vue` | `scenarioConfig` ~L1001, `scenarioFilter` ~L1022, stream+filter watch ~L1229 |
| Scenario engine + phases | `src/scenario/scenario.ts`, `src/scenario/phases/common.ts` | phase registry, `ScenarioConfig`/`Data`/`Progress` |
| Geometry-only pass blueprint | `src/scenario/buffer-passes.ts` | mirror for `runStopClustering` |
| Retune endpoint blueprint | `server/api/buffer-geographies.post.ts` + `useBufferRefetch.ts` | mirror for `/api/stop-clusters` |
| Client result shape | `src/scenario/scenario-filter.ts` | `ScenarioFilterResult` ~L501, `applyScenarioResultFilter` ~L525 |
| Stop type + agency derivation | `src/tl/stop.ts` | agency = set over `route_stops[].route.agency` |
| Departure times | `src/tl/departure-cache.ts` | `StopDepartureCache.get(stopId, date)` → `{departureTime sec}` |
| Pure tested module style | `src/scenario/route-headway.ts` / `.test.ts` | model for the cluster module |
| Map sources/layers | `app/components/cal/map-viewer-ts.vue` | `createSources`/`createLayers`, dashed line precedent |
| Map container / popups | `app/components/cal/map.vue` | `displayFeatures`, `mapClickFeatures`, legend wiring |
| Popup union (3 files in sync) | `src/core/geom.ts`, `map-popup.vue`, `map-viewer-ts.vue` | add `'cluster'` to all three |
| Legend | `app/components/cal/legend.vue` | prop-driven sections + `shouldShowLegend` |
| Reports tab | `app/components/cal/report.vue` | `ReportTab` union + parallel computeds + switch |
| Colors | `src/core/colors.ts` | `createCategoryColorScale` (Tableau10) for multi-agency dot |
| Transitland schema | `transitland-server/schema/graphql/schema.graphqls` | `Stop.nearby_stops` ~L636, `StopFilter.location.near` ~L1767 |

---

## 7. Open / deferred questions (non-blocking)

- **Multi-agency physical stop:** does one shared stop satisfy multiple agency slots, or must
  members be distinct physical stops from distinct agencies? v1 = shared stop counts for all
  its agencies; flag for product if wrong.
- **Date semantics for the temporal filter:** any day in the selected range, a representative
  day, or per-day? And does the time-of-day window apply? v1 = any day in range, following
  the existing `stopVisits` date handling.
- **Arrival times in the popup:** only `departure_time` is fetched today; adding arrival is a
  query + wire + cache extension. v1 = departure times only.
- **Cluster GeoJSON export from Reports:** requires the map to emit cluster features; v1 may
  ship CSV only.
- **Multi-color marker style:** equal wedges per agency vs weighted; static legend swatch vs
  per-cluster. v1 = equal wedges, static swatch.
- **Future sprint:** manual removal of stops from a cluster (explicitly deferred in the issue).

---

## 8. Progress checklist

- [ ] Stage 1 — Core module (`deriveStopClusters`, `applyClusterTransferTime`), constants, unit tests
- [ ] Stage 2 — `nearby_stops` query, `stop-clusters` phase, wire/receiver, `/api/stop-clusters` + `useClusterRefetch`
- [ ] Stage 3 — URL state, filter UI control, temporal prune in `applyScenarioResultFilter`
- [ ] Stage 4 — Map cluster source/circle/markers, grey-out, `'cluster'` popup arm, legend entry
- [ ] Stage 5 — Reports "Stop Clusters" aggregation tab + CSV row builder
- [ ] Stage 6 — Force departures when transfer-time set, exports, full test + `pnpm check`

Verification each stage: `pnpm check` (lint --fix + typecheck) and `pnpm test` must pass.
