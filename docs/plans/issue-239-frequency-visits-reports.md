# Plan: Revise frequency/visits report columns (Issue #239)

## Goal

Bring the tabular reports (Routes, Stops, Stop geo-aggregate) in line with the definitions of **Frequency** (route attribute = headway between trips) and **Visits** (stop_times events at a stop). Column set and tooltip wording should change based on whether the Timeframes tab is set to "all day" or a specific hour window.

Reference: https://github.com/interline-io/calact-network-analysis-tool/issues/239

## Issue text → plan mapping

Each quote below is pulled from the body of issue #239 or its comments. Each is followed by where/how it's addressed in this plan.

### Definitions

- **"Frequency" is a route attribute. It is synonymous with headway. It represents the time (usually an average) between different trips of a route. Frequency is the primary term that that NAT interface uses when describing the service intensity of a (fixed-)route. Frequency is never used to refer to activity at a stop in the NAT interface."**
  Route report uses frequency columns; stop report does not. Matches existing structure. No calculation change (kept representative-stop semantic — see "Semantic note" section).

- **"Individual "Visits" are equivalent to stop_times, and are a separate entity rather than an attribute of stops. They happen at a stop, by a trip that is part of a route. The NAT interface uses either number of visits or number of visits per hour to describe the intensity of (fixed-route) service at a stop. Visits at a stop are generally assumed to refer to all routes that use that stop, unless describe explicitly as applying to only an individual route (e.g. 8 visits per hour by route X)."**
  Stop report has a visits column. `stopVisits()` already sums across all routes that use the stop, matching the "all routes" default in the issue text. Amended by follow-up comment (see bottom) to use totals rather than averages.

### Route columns — all-day mode

- **"Average trips per day ('The sum of all trips on the indicated route, divided by the number of calendar days included within the current filters.')"**
  Already computed as `route.average_trips_per_day` in `calculateRouteTripStats()`. Already in CSV. Needs to be added to `routeColumns` in `report.vue` with this tooltip.

- **"Average frequency ('The mean average of all times between trips on the indicated route, calculated as the time in seconds between sequential trip start times, excepting the time between trips on different service days, across all service days included within the current filters.')"**
  Already computed as `route.average_frequency`. Measured at the representative stop (see Semantic note). Tooltip wording may need adjustment to reflect rep.-stop semantic rather than literal "trip start times." Column already rendered.

- **"Fastest frequency ('The shortest time in seconds between two trips of a route, across all service days included within the current filters.')"**
  Already computed as `route.fastest_frequency`. Column already rendered. Update tooltip to match.

- **"Slowest frequency ('The longest time in seconds between two trips of a route, across all service days included within the current filters, excepting the time in between trips on different service days.')"**
  Already computed as `route.slowest_frequency`. Cross-service-day gap exclusion is already correct (per-date accumulation). Column rendered; update tooltip.

- **"Earliest trip start time / Earliest trip end time / Latest trip start time / Latest trip end time"**
  Already computed as `earliest_trip_start`, `earliest_trip_end`, `latest_trip_start`, `latest_trip_end`. Already in CSV. Needs four columns added to `routeColumns` with issue tooltips. Open question: should "trip end" use last-stop `arrivalTime` rather than max `departureTime`?

### Stop columns — all-day mode (original)

- **"Routes served ('The number of routes that visit this stop during days included within the current filters.')"**
  Already rendered as `routes_count` with matching tooltip.

- **"Agencies served ('The number of agencies that visit this stop during days included within the current filters.')"**
  Already rendered as `agencies_count` with matching tooltip.

- **"Average visits per day ('The sum of all visits at the stop by any route, divided by the number of calendar days included within the current filters.')"**
  Superseded by follow-up comment — see "Amendments" below.

### Specific-hours mode

- **"There are slight changes to most of the tool tips, and the 'average X per day' column has changed to 'per hour'"**
  Column set stays the same between modes; labels and tooltips change. Drives the `isAllDayMode` prop wiring in `report.vue` + `tne.vue`.

- **"Average trips per hour ('The sum of all trips on the indicated route that have any visit at any stop during the days and times included within the current filters, divided by the number of hours across all service days included within the current filters.')"**
  New calculation — add `averageTripsPerHour` to `RouteTripStats` (denominator = `hoursInWindow × dateCount`). Counted trips are those with "any visit at any stop" in window, matching the current trip filter in `calculateRouteTripStats()`.

- **"Average frequency ('The mean average of all times between trips on the indicated route, calculated as the time in seconds between sequential trip start times, for all trips of the indicated route that have a trip start time within the service days and times included within the current filters.')"**
  Already computed. Time-window filter is applied at the representative stop rather than at literal trip start times (see Semantic note). Tooltip language may need reconciling.

- **"Fastest frequency" / "Slowest frequency" / "Earliest/Latest trip start/end time" (specific-hours)**
  Same fields as all-day mode; only tooltip copy differs ("and times" added). No calculation change.

- **"Average visits per hour ('The sum of all visits at the stop by any route during days and times included within the current filters, divided by the number of hours across all service days included within the current filters.')"**
  Superseded by follow-up comment — see "Amendments" below.

- **"Routes served ('The number of routes that visit this stop during days and times included within the current filters.')" / "Agencies served ('The number of agencies that visit this stop during days and times included within the current filters.')" (specific-hours)**
  Same column values as all-day mode; tooltip text gains "and times" language. Wire through the mode-aware tooltip in `stopColumns`.

### Concept columns (out of scope for v1)

- **"concept: maybe we should have a column like 'variance of frequency within service days'"**
  Skipped for v1 (marked as concept in the issue). Not tied to either mode.

### Amendments (from @NAT-mb comment)

- **"change visit stats to be totals, not averages"**
  Replaces the per-day/per-hour average visit columns with a single "Total visits during time period" column in both modes.

- **"Total visits during time period ('The sum of all visits at the stop by any route across all calendar days included within the current filters.')"** (all-day)
  `stop.visits.total.visit_count` already holds this raw total. Change is in `stopToStopCsv` (surface `visit_count` rather than `visit_average`) plus column label + tooltip in `report.vue`.

- **"Total visits during time period ('The sum of all visits at the stop by any route across all calendar days and hours included within the current filters.')"** (specific-hours)
  Same raw `visit_count` field — existing per-stop-time time-window filter already restricts to the selected hours. Also applies to the stop geo-aggregate (`stopGeoAggregateCsv`).

## Target columns

### Route report
Same columns in both modes. Only row 1's label changes ("per day" vs "per hour"). **Every tooltip changes between modes** — the issue's all-day tooltips use "across all service days included within the current filters," while the specific-hours tooltips use "across all service days and times included within the current filters" and add mode-specific language where applicable.

| Column | All-day label | Specific-hours label |
|--------|---------------|----------------------|
| 1 | Average trips per day | Average trips per hour |
| 2 | Average frequency | Average frequency |
| 3 | Fastest frequency | Fastest frequency |
| 4 | Slowest frequency | Slowest frequency |
| 5 | Earliest trip start time | Earliest trip start time |
| 6 | Earliest trip end time | Earliest trip end time |
| 7 | Latest trip start time | Latest trip start time |
| 8 | Latest trip end time | Latest trip end time |

(Keep existing identity columns: route_id, route_name, route_mode, agency_name.)

Tooltip wording follows the issue text verbatim in both modes.

### Stop report
Per the latest @NAT-mb comment, switch from "Average visits per day/hour" to a single **Total visits during time period** column (raw sum across the filter window) in both modes. Column labels are identical across modes; **tooltips change** — all-day uses "during days included…" / "across all calendar days," specific-hours uses "during days and times included…" / "across all calendar days and hours."

| Column | Label (both modes) |
|--------|-------|
| 1 | Routes served |
| 2 | Agencies served |
| 3 | Total visits during time period |

Tooltip wording follows the issue comment verbatim in each mode.

### Stop geo-aggregate report
**Assumption (not spelled out in the issue):** the same column/tooltip changes apply to the Stop geo-aggregate view, since it's a derivative of the stop table. Confirm with the requester; if they want it unchanged, split this out of the plan.

## Semantic note: "trip start time" vs. representative stop

Issue #239 defines frequency as "time in seconds between sequential trip start times." The current implementation measures at a **representative stop** — the stop with the most departures for each (route, direction, date) — not at each trip's literal first stop. This is deliberate: trips on the same route often have different starting points (short-turns, branch patterns, pull-out stops), and a literal reading conflates those into misleading frequency numbers.

**Approach:** keep the representative-stop logic. Read the issue's "trip start time" as shorthand for "departure at the representative stop" and reflect that in the tooltip wording. In specific-hours mode this also changes *which trips count* toward fastest/slowest/average — a trip that starts elsewhere at 07:45 but passes the rep. stop at 09:10 is counted in a 09:00–10:00 window. Confirm this reading with the requester before shipping.

## Calculation-layer changes

With the representative-stop approach preserved, the calculation changes are narrower than a literal reading of #239 would suggest.

### 1. Route "Average trips per hour" in specific-hours mode

`calculateRouteTripStats()` currently returns `averageTripsPerDay = totalTrips / dateCount`, where `dateCount` counts **dates with service** (dates where at least one trip had an in-window stop_time; see [route-headway.ts:212-217](src/scenario/route-headway.ts#L212-L217)).

In specific-hours mode we need `totalTrips / (hoursInWindow * dateCount)` where `hoursInWindow = (endSeconds - startSeconds) / 3600`. Expose both values. Keep `averageTripsPerDay` for all-day mode.

This "service days" denominator matches the issue's specific-hours text verbatim: "the number of hours across all **service days** included within the current filters."

Trip counting should remain as it is today (trips that have any stop_time in the window). This matches the issue's tooltip language for specific-hours mode: "have any visit at any stop during the days and times included."

**Open question — all-day mode denominator:** the issue's all-day text says "divided by the number of **calendar days** included within the current filters," but the current code divides by dates with service. These diverge for routes that don't run every calendar day in the filter range. Literal reading of the issue would produce lower `averageTripsPerDay` for sparse-service routes. Current behavior is probably more useful (shows typical service-day trip count, not amortized-across-weekends); confirm with requester which they want.

### 2. Earliest / latest trip start & end times

Already computed in `calculateRouteTripStats()` for all-day mode. Just needs to be surfaced in the route report columns. Current implementation uses min/max `departureTime` per trip — the issue's "first visit at a stop that ends a trip" language implies the **last** stop's arrival time for the end; double-check whether `StopTimeCacheItem` has an `arrivalTime` field and whether using it meaningfully changes results.

**Bug in specific-hours mode (needs fixing):** the current code filters each stop_time against the time window *before* grouping by tripId ([route-headway.ts:197-208](src/scenario/route-headway.ts#L197-L208)). As a result, a trip that actually starts at 07:45 but is selected into a 09:00–10:00 window reports a "trip start time" of its earliest in-window stop_time, not its actual first stop_time. The tooltip says "the 24-hour time at which the first visit at a stop that begins a trip happens for this route" — the current number doesn't deliver that.

Fix: two passes. First, per (route, direction, date), compute each trip's actual min/max `departureTime` from *all* its stop_times (no window filter). Then apply the window filter to decide which trips are *included* (rep.-stop semantics per the Semantic note — include a trip iff it has an in-window departure at the representative stop, or a simpler proxy such as "any in-window stop_time" if that matches product intent). For included trips, report their actual start/end. Same two-pass shape works in all-day mode with a no-op filter.

Open product question: when a trip is included in specific-hours mode, should earliest/latest report the trip's full span (including stop_times outside the window) or only its in-window portion? Default recommendation: full span — it matches the intuitive reading of "when does the trip start/end."

### 3. Stop: Total visits during time period

`StopVisitCounts.visit_count` is already the raw total. CSV mapping just needs to surface `visit_count` in the relevant column (both `stopToStopCsv` and the geo-aggregate path). Existing time-window filtering in `stopVisits()` is correct as-is.

**CSV field strategy (decision needed before coding):** currently `stopToStopCsv` emits `visit_count_daily_average`, `visit_count_monday_average`, … `visit_count_sunday_average`; `routeToRouteCsv` emits `average_trips_per_day`. To avoid breaking existing CSV consumers (e.g., downloaded files shared externally), **emit both old and new fields in parallel** rather than renaming:

- Stop CSV: add `visit_count_total`, `visit_count_monday_total`, …, `visit_count_sunday_total` alongside the existing `_average` fields. UI reads `visit_count_total`.
- Route CSV: add `average_trips_per_hour` alongside `average_trips_per_day`. UI picks one based on mode.

If the product side confirms no external consumers, we can switch to a clean rename in a follow-up. Tracking this as an explicit decision rather than a refactor-in-flight avoids silently breaking anything.

### 4. "Slowest frequency" must still exclude cross-service-day gaps

Already handled: headways are computed per-date and accumulated, never spanning dates. No change needed.

### 5. 2-minute minimum threshold — decision point

`calculateHeadwayStats()` filters out gaps < 2 min as "noise." The issue's definitions do not mention this. Check with product before keeping or removing; default is to keep, but flag in the PR.

### 6. Variance of frequency (concept column)

Marked as a concept in the issue. Skip for v1.

### 7. Secondary surfaces that render the same fields

Grep turns up two other places that display these derived values:

- [app/components/cal/map-viewer-ts.vue:290](app/components/cal/map-viewer-ts.vue#L290) — stop map popup has a hardcoded label `'Avg. visits/day'` bound to `fp?.visit_count_daily_average`. Needs the same mode-aware swap: label to "Total visits during time period" and value to `visit_count_total`.
- [app/components/cal/map.vue:513,517](app/components/cal/map.vue#L513) — route map styling uses `route.average_frequency` for color coding. No change needed — frequency calculation itself is unchanged.
- [app/components/cal/map-share.vue](app/components/cal/map-share.vue) — if it serializes any of these fields into share URLs, changing CSV field names could break deep links. The parallel-field strategy in section 3 avoids this.

Include these in the UI wiring pass.

## UI wiring

- `report.vue` needs to know whether the scenario is in all-day or specific-hours mode. The start/end time props already flow into the report path as `undefined`/`undefined` in all-day mode, so `report.vue` can derive `isAllDayMode` locally without a new prop — matches the pattern in [filter.vue:686-697](app/components/cal/filter.vue#L686-L697).

- Build one column factory per view (route/stop/geo-aggregate) that takes `isAllDayMode` and returns the appropriate labels + tooltips. Switch in the `reportData` computed.

- CSV export uses the parallel-field strategy from Calculation change #3 — both `average_trips_per_day` and `average_trips_per_hour` are emitted; both `visit_count_*_average` and `visit_count_*_total` are emitted. Downstream CSV tooling is unaffected.

- Stop map popup in `map-viewer-ts.vue` also needs the mode-aware swap (see Calculation change #7).

## File-by-file change list

| File | Change |
|------|--------|
| `src/scenario/route-headway.ts` | Add `averageTripsPerHour` and `hoursInWindow` to `RouteTripStats`. Refactor the per-date pass so each trip's **actual** min/max `departureTime` is computed from all its stop_times (no window filter), then apply the window filter as a separate inclusion test. No change to the headway calculation itself — stays at the representative stop. |
| `src/scenario/scenario-filter.ts` | Assign `average_trips_per_hour` alongside `average_trips_per_day` on `Route`. |
| `src/tl/route.ts` | Add `average_trips_per_hour` to `RouteDerived` / `RouteCsv` (keep `average_trips_per_day`, both emitted in parallel). |
| `src/tl/stop.ts` | Add `visit_count_total` (and per-weekday `visit_count_monday_total`, …) to `StopCsv` / `StopGeoAggregateCsv` in parallel with the existing `_average` fields. |
| `app/components/cal/report.vue` | Build mode-aware `routeColumns` / `stopColumns` / `stopGeoAggregateColumns`; swap labels and tooltips per issue text; derive `isAllDayMode` from the start/end time props it already receives (see UI wiring). |
| `app/components/cal/map-viewer-ts.vue` | Replace hardcoded `'Avg. visits/day'` label + `visit_count_daily_average` value in the stop popup with mode-aware "Total visits during time period" + `visit_count_total`. |
| `app/components/cal/map.vue` | No change — `average_frequency` is unchanged. |
| `app/components/cal/map-share.vue` | Verify no serialized field names break under the parallel-field strategy. |
| `app/pages/tne.vue` | No change expected if `report.vue` derives the mode internally; otherwise pipe `isAllDayMode` through. |
| Tests | Vitest coverage for: `averageTripsPerHour` math, `dateCount` semantics, two-pass trip start/end (unfiltered span with window-based inclusion), visit totals in both modes, and a trip whose full span exits the window. |

## Open questions to confirm before coding

1. **Reconcile "trip start time" language with representative-stop behavior.** Issue #239 describes frequency as "time between sequential trip start times," but the implementation measures at a representative stop to avoid conflating trips with different starting points. Confirm that the tooltip wording can be adjusted to reflect actual behavior, or that the requester accepts the representative-stop semantic as a faithful realization of the intent.
2. Keep the 2-minute noise filter in `calculateHeadwayStats()`?
3. Trip "end time" definition — the issue says "first visit at a stop that ends a trip." Current code uses the max `departureTime` per trip. Should this be `arrivalTime` of the last stop? (Check `StopTimeCacheItem` for an arrival field.)
4. **All-day "Average trips per day" denominator:** issue text says "calendar days included within the current filters" (literal: every calendar day in the date range). Current code uses dates with service. Which does product want?
5. In specific-hours mode, when a trip is included, should Earliest/Latest trip start/end report the trip's full span (including stop_times outside the window) or only its in-window portion? Default recommendation: full span.
6. CSV consumers — are downloaded CSVs shared/consumed externally? Drives whether we need the parallel-field strategy or can rename cleanly.

## Test plan (manual)

1. Pick a bbox in Portland with a mix of frequent and infrequent routes.
2. All-day, all weekdays: verify route table shows the 8 columns with sensible values; avg frequency/fastest/slowest match a spot-checked route.
3. Switch to specific-hours 07:00–09:00: verify "per hour" label appears, trips per hour ≈ trips per day / 2, frequency only reflects trips departing the representative stop in the window.
4. Stop tab: verify "Total visits during time period" matches raw count for a known stop across the filter window.
5. Flip between all-day and specific-hours modes repeatedly; confirm columns, labels, and values all re-render and recompute without stale state.
6. Export CSV in both modes; confirm both old and new field names present and values match the UI.
7. Route with weekday-only service in a 7-day filter: verify which denominator is used for "Average trips per day" — matches whichever answer came out of open question #4.
8. Stop whose only visits fall outside the specific-hours window: verify "Total visits during time period" shows 0 (not undefined or blank).
9. Route with a trip that starts before the specific-hours window but has stop_times within it: verify "Earliest trip start time" shows the trip's actual start, not its earliest in-window stop_time.
10. Stop map popup (`map-viewer-ts.vue`): verify the popup label/value swap works in both modes.
11. Geo-aggregate stop view: verify the same column/tooltip treatment as the flat stop view (pending open-question confirmation).
12. Sanity check a GTFS feed with trips crossing midnight (>24:00:00 departure times) — confirm nothing crashes; document behavior.
