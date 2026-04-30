# Implementation plan — issue #315 (stop statistical radius)

> Working document, not for merge. Delete before squashing the PR.

## Goal

Per-stop "stop statistical radius" buffer producing ACS-demographic apportionment for the Stops, Routes, Agencies individual-results tables, and changing the aggregation table to report buffer-coverage-weighted values plus a new "% area covered" column. Tract resolution; server-side; no client geometry; no new map visualization.

## Locked decisions

- **Resolution**: tract layer for now. `STOP_BUFFER_TRACT_LAYER = 'tract'` constant in `src/core/constants.ts` so swapping to block-group later is one line. **Spec deviation** — the issue calls for block group; transitland-server doesn't have BG loaded yet. Comment on the issue when the PR opens so Tom and Nome see this before review.
- **Default radius**: 402 m (quarter mile), per Tom's comment. On out of the box. `radius === 0` is the user-facing **off switch** (sets the input to 0 to skip Passes C / D / E / F and the bbox padding on Pass A).
- **Columns**: identical 11 columns from `CENSUS_COLUMNS` in `src/core/census-columns.ts`. Median income (`NON_ADDITIVE_CENSUS_COLUMNS`) renders as `—` for any apportioned row.
- **Apportionment math**: `value × (intersection_area / geometry_area)` — even-distribution-within-tract assumption, matching the Frequent Transit Service Study calculation referenced in the spec.
- **Margin of error (MoE)**: deferred. Spec calls it a future enhancement; #338 already deferred MoE pending transitland-lib support, and we inherit that.
- **Server-side PostGIS unions only**. No client-side geometry. No clamp-at-1.0 anywhere.
- **Routes / agencies clipping deferred**: `Route.census_geographies` and `Agency.census_geographies` return unions over the entity's full stop set including stops outside the bbox; we silently drop tracts not present in Pass A's store. Documented as a known limitation; revisit later.
- **No map visualization** — choropleth and census panel keep current behavior in this issue.

## Data flow

Five census-related passes; non-census passes (feed-versions, stops, routes, schedules, flex-areas) untouched. Passes C / D / E / F are independent and run in parallel.

| Pass | Trigger | What it fetches | Returns into client store |
|---|---|---|---|
| **A** (broadens existing `fetchCensusValues`) | always when `tableDatasetName` + `aggregateLayer` are set | One request per layer in `censusLayerLabels` (state, county, tract, place, cbsa, csa, uac20, fta-uac20-nonurban). Bbox padded by `radius` when `radius > 0`. Each request returns `geoid, name, geometry_area, intersection_area, values`. **No geometries.** | `censusGeographies: Map<geoid, CensusGeographyData>` — flat across layers (TIGER GEOIDs unique by length). |
| **C** (new) | `radius > 0` | `stops(ids: [...]) { id, census_geographies(where: {dataset, layer, radius}) { geoid, geometry_area, intersection_area } }`. `chunkArray(markedStopIds, 100)` through `stopBufferQueue: TaskQueue` (8-concurrent, like existing queues). | `stopBufferTracts: Map<stopId, [{geoid, geometry_area, intersection_area}]>`. |
| **D** (new) | `radius > 0` | `routes(ids: [...]) { id, census_geographies(where: {dataset, layer, radius}) { ... } }`, chunked 50/request. Server-side union over the route's stops (full set, not bbox-clipped — known limitation). | `routeBufferTracts: Map<routeId, [...]>`. |
| **E** (new) | `radius > 0` | `agencies(ids: [...]) { id, census_geographies(where: {dataset, layer, radius}) { ... } }`, chunked 50/request. Same known limitation. | `agencyBufferTracts: Map<agencyId, [...]>`. |
| **F** (new) | `radius > 0` | Top-level `geographies` query with `location: {stop_buffer: {stop_ids: [all markedStopIds], radius}}`, layer=tract. Single request. True union over the marked-stop set, naturally bounded by what's in the scenario. | `aggregationBufferTracts: [{geoid, geometry_area, intersection_area}]`. |

Geometries continue to come from the separate on-demand `geographyLayerQuery` for whatever layer the choropleth is rendering — unchanged.

## GraphQL queries

**Pass A** — same `geographyIntersectionQuery` as today, called once per layer in parallel (`Promise.all`). No query changes.

**Pass C** (new, in `src/tl/stop-buffer.ts`):

```graphql
query ($ids: [Int!], $radius: Float, $dataset: String, $layer: String) {
  stops(ids: $ids) {
    id
    census_geographies(where: {dataset: $dataset, layer: $layer, radius: $radius}) {
      geoid
      geometry_area
      intersection_area
    }
  }
}
```

**Pass D** (new):

```graphql
query ($ids: [Int!], $radius: Float, $dataset: String, $layer: String) {
  routes(ids: $ids) {
    id
    census_geographies(where: {dataset: $dataset, layer: $layer, radius: $radius}) {
      geoid
      geometry_area
      intersection_area
    }
  }
}
```

**Pass E** (new): identical shape with `agencies(ids: ...)`.

**Pass F** (new): existing `geographyIntersectionQuery` reused, called with `bbox: undefined`, `within: undefined`, `stopIds: [all markedStopIds]`, `stopBufferRadius: radius`, `tableNames: []` (we only need geoid + areas).

Schema confirmation:

- `Stop.census_geographies(where: CensusGeographyFilter)` at `transitland-lib/schema/graphql/schema.graphqls:640`.
- `Route.census_geographies(where: CensusGeographyFilter)` at `schema.graphqls:560`.
- `Agency.census_geographies(where: CensusGeographyFilter)` at `schema.graphqls:502`.
- `CensusGeographyFilter { dataset, layer, radius, search }` at `schema.graphqls:2160-2165`.

## Client-side rollup module

**`src/core/census-buffer.ts`** (new). Pure, deterministic, no Vue, no DOM.

Inputs: `tractValues = censusGeographies.filter(layer === 'tract')` (from Pass A); the relevant `*BufferTracts` map (from C / D / E / F).

```ts
// Each consumer feeds its own list of {geoid, intersection_area, geometry_area}.
function apportionBuffer(
  intersections: TractIntersection[],
  tractValues: Map<string, CensusGeographyData>,
): { values: Record<string, number | null>, pctCoverage: number } {
  const apportioned: CensusValues = {}
  let totalGeomArea = 0
  let totalIntersectArea = 0
  for (const { geoid, intersection_area, geometry_area } of intersections) {
    const tract = tractValues.get(geoid)
    if (!tract || geometry_area === 0) {
      continue
    }
    const ratio = intersection_area / geometry_area
    for (const [k, v] of Object.entries(tract.values)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        apportioned[k] = (apportioned[k] ?? 0) + v * ratio
      }
    }
    totalGeomArea += geometry_area
    totalIntersectArea += intersection_area
  }
  const derived: Record<string, number | null> = {}
  for (const col of CENSUS_COLUMNS) {
    derived[col.id] = NON_ADDITIVE_CENSUS_COLUMNS.has(col.id)
      ? null  // medians don't apportion → render '—'
      : col.derive(apportioned)
  }
  return {
    values: derived,
    pctCoverage: totalGeomArea > 0 ? totalIntersectArea / totalGeomArea : 0,
  }
}
```

Same `apportionBuffer` powers the stops table (per-stop intersections), routes table (per-route intersections), agencies table (per-agency intersections), and Pass F (aggregation-row intersections).

For the aggregation table, rows at non-tract layers use the GEOID-prefix match against Pass F's tract list to sum into each row. Single helper.

## File-by-file changes

### Constants & inputs

- **`src/core/constants.ts`** — add `STOP_BUFFER_DEFAULT_RADIUS = 402`, `STOP_BUFFER_TRACT_LAYER = 'tract'`. `SCENARIO_DEFAULTS.stopBufferRadius` stays 0.
- **`app/composables/useScenarioInputs.ts`** — add URL-backed `stopBufferRadius` (default `STOP_BUFFER_DEFAULT_RADIUS`).
- **`src/scenario/scenario.ts` `ScenarioConfig`** — add `stopBufferRadius?: number`. Server endpoint just forwards it.

### UI

- **`app/components/cal/filter.vue` — `transit-layers` tab** — slider + numeric input + tooltip ("Apportions census data to the area within this radius of each stop. Used in the Stops, Routes, Agencies, and Aggregation tables. Set to 0 to disable.") under Frequency.

### Pipeline

- **`src/scenario/scenario.ts`**
  - Broaden private `fetchCensusValues()`: parallel call per layer in `censusLayerLabels`, bbox padded by `radius` when `radius > 0`. Single accumulated `Map`.
  - New `fetchStopBufferTracts()` — chunked per-stop (Pass C). New stage `'stop-buffer-tracts'`.
  - New `fetchRouteBufferTracts()` — chunked per-route (Pass D). New stage `'route-buffer-tracts'`.
  - New `fetchAgencyBufferTracts()` — chunked per-agency (Pass E). New stage `'agency-buffer-tracts'`.
  - New `fetchAggregationBuffer()` — single call (Pass F). New stage `'aggregation-buffer-tracts'`.
  - C / D / E / F dispatched via `Promise.all`; each streams partial progress.
  - `ScenarioData` extended with the four new maps.
  - `markedStopIds` / route-ids / agency-ids derive from already-loaded scenario state, so no extra fetch hops.

- **New file `src/tl/stop-buffer.ts`** — three GraphQL strings (stops/routes/agencies variants) + types `TractIntersection`, `BufferBatchResult` + the three batch-fetch helpers.

- **`src/scenario/scenario-filter.ts`** — `ScenarioFilterResult` exposes the four buffer maps to the report tab.

### Census math

- **`src/core/census-buffer.ts`** (new) — `apportionBuffer` + `aggregationRowFromTracts` + a small helper to roll Pass F tract list up to non-tract aggregation rows by GEOID prefix.
- **`src/core/census-columns.ts`** — no API changes; `NON_ADDITIVE_CENSUS_COLUMNS` already accommodates the median-renders-as-`—` rule.

### Report tables

- **`src/tl/stop.ts`**
  - `stopToStopCsv` accepts optional `stopBufferTracts + tractValues`; merges in derived columns when present.
  - `stopGeoAggregateCsv` extended: when Pass F data is present, demographic columns + `pct_buffer_coverage` come from the aggregation-buffer tract list rolled up to the row's layer; otherwise existing path.
- **`src/tl/route.ts`** — `routeToRouteCsv` accepts optional `routeBufferTracts + tractValues`.
- **`src/tl/agency.ts`** — `agencyToAgencyCsv` accepts optional `agencyBufferTracts + tractValues`.
- **`app/components/cal/report.vue`**
  - Append `censusColumns` to `stopColumns`, `routeColumns`, `agencyColumns`.
  - Add `pct_buffer_coverage` to `stopGeoAggregateColumns` only.
  - Pass the new args (`stopBufferTracts`, `routeBufferTracts`, `agencyBufferTracts`, `aggregationBufferTracts`, `tractValues`) into the CSV builders.
  - Tooltip text on demographic columns updates to mention "within stop statistical radii" when `radius > 0`.

### CSV / GeoJSON export

- Flows through automatically once table data has the columns. Verify in the test plan.

### Tests

- **`src/core/census-buffer.test.ts`** (new):
  - Apportionment math: single-tract intersection, multi-tract intersection.
  - GEOID prefix rollup for non-tract aggregation rows (county / place / state).
  - Buffer extends beyond Pass A's known tracts → missing values handled gracefully (no crash, dropped from sum).
  - Median income → `—` always for apportioned rows.
  - `pctCoverage` arithmetic correct for various intersection mixes.
- **`src/tl/stop.test.ts`** — extend with buffer-aware aggregation; verify `radius === 0` path is byte-identical to today.

## Phasing (single PR; built in this order so each step is independently verifiable)

1. URL-backed `stopBufferRadius` input + UI control. No behavior change yet.
2. `ScenarioConfig` plumbing + Pass A broadened to fetch all layers in parallel. Aggregation-table layer-switch becomes free (verify: switching from county → place no longer triggers a refetch).
3. New file `src/tl/stop-buffer.ts` + Pass C wired in (per-stop). Verify shape and chunking in network panel.
4. Passes D, E, F wired in. Verify data shapes.
5. `src/core/census-buffer.ts` + tests. Pure module, no UI yet.
6. Aggregation table: read from Pass F + new `pct_buffer_coverage` column.
7. Stops table: append demographic columns, wired to Pass C.
8. Routes table: append demographic columns, wired to Pass D.
9. Agencies table: append demographic columns, wired to Pass E.
10. CSV/GeoJSON export verification + tooltip / label pass.
11. `pnpm check` final.

## Risks / open questions

- **Pass C scale**: 20k stops × 100/request × 8-concurrent ≈ 200 round-trips. Streams progressively; partial results render. If too slow, the lever is filtering to `marked` stops only at fetch time.
- **Pass F payload**: 20k+ `stop_ids` in one request body. Probably fine but worth load-testing at WA/OR/CA scale during step 4 verification.
- **Routes/agencies extent clipping**: deferred. The resolver gives a union over the entity's full stop set; tracts outside Pass A's store get silently dropped on the join. Tooltip note explains.
- **Padded bbox for large radii**: 402m is small relative to typical tract size. A user cranking radius to 5 km starts to matter — covered by tests.
- **Aggregation-table semantic shift** when `radius > 0`: columns become "geography ∩ marked-stop-buffer-union" instead of "geography ∩ query-bbox". Tooltip updates required.
- **Median rendering**: `—` everywhere apportioned. Matches existing #338 behavior for sums across geographies.
- **Spec deviation (block group → tract)**: shipping at tract until backend supports BG. **Action**: post a comment on the issue when the PR opens explaining the substitution so Tom and Nome can sign off.
- **MoE deferred**: spec calls MoE a future enhancement. Not in scope for this PR; will be addressed when transitland-lib surfaces MoE values.
