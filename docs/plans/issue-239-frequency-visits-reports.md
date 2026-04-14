# Plan: Revise frequency/visits report columns (Issue #239)

## Goal

Bring the tabular reports (Routes, Stops, Stop geo-aggregate) in line with the definitions of **Frequency** (route attribute = headway between trips) and **Visits** (stop_times events at a stop). Column set and tooltip wording should change based on whether the Timeframes tab is set to "all day" or a specific hour window.

Reference: https://github.com/interline-io/calact-network-analysis-tool/issues/239

## Issue text → plan mapping

Definitions in the issue (Frequency = route attribute; Visits = stop_times, summed across all routes at the stop) match the existing code structure. `stopVisits()` already sums across all routes per the "all routes" default. No change driven by the definitions themselves.

### Route columns (same 8 columns in both modes)

| # | Column | Status | Action |
|---|--------|--------|--------|
| 1 | Average trips per day *(all-day)* / per hour *(specific-hours)* | Per-day computed; per-hour new | Add `averageTripsPerHour` (Calc §1); render column in `routeColumns` with mode-aware label + tooltip |
| 2 | Average frequency | Computed, rendered | Update tooltip per mode; see Semantic note re: rep.-stop wording |
| 3 | Fastest frequency | Computed, rendered | Update tooltip per mode |
| 4 | Slowest frequency | Computed, rendered | Update tooltip per mode |
| 5–8 | Earliest/Latest trip start/end time | Computed for all-day; **bug in specific-hours** | Render 4 columns; fix two-pass trip span in Calc §2 |

### Stop columns (same 3 columns in both modes)


| # | Column | Status | Action |
|---|--------|--------|--------|
| 1 | Routes served | Computed, rendered | Update tooltip per mode ("during days" vs "during days and times") |
| 2 | Agencies served | Computed, rendered | Update tooltip per mode |
| 3 | Total visits during time period | `visit_count` computed; replaces per-@NAT-mb amendment | Surface `visit_count` in `stopToStopCsv` / `stopGeoAggregateCsv`; render with mode-aware tooltip |

### Amendment (from @NAT-mb comment)

"Change visit stats to be totals, not averages" — supersedes the issue body's "Average visits per day/hour" for both modes. Reflected in row 3 above.

### Out of scope for v1

The issue's "concept" column (variance of frequency within service days) is flagged as a concept, not a requirement. Skip.

## Target columns

Column sets are enumerated in the Issue-mapping tables above. Additional notes:

- **Route report** keeps existing identity columns (route_id, route_name, route_mode, agency_name) on the left of the 8 new data columns.
- **Tooltips** follow the issue text verbatim in both modes. Every tooltip changes between modes (all-day uses "across all service days"; specific-hours uses "across all service days and times").
- **Stop geo-aggregate** gets the same column/tooltip treatment as the flat stop view. (Not spelled out in the issue; treating as an obvious derivative.)

## Semantic note: "trip start time" vs. representative stop

Issue #239 defines frequency as "time in seconds between sequential trip start times." The current implementation measures at a **representative stop** — the stop with the most departures for each (route, direction, date) — not at each trip's literal first stop. This is deliberate: trips on the same route often have different starting points (short-turns, branch patterns, pull-out stops), and a literal reading conflates those into misleading frequency numbers.

**Approach:** keep the representative-stop logic. Read the issue's "trip start time" as shorthand for "departure at the representative stop" and reflect that in the tooltip wording. In specific-hours mode this also changes *which trips count* toward fastest/slowest/average — a trip that starts elsewhere at 07:45 but passes the rep. stop at 09:10 is counted in a 09:00–10:00 window. Confirm this reading with the requester before shipping.

## Calculation-layer changes

Two real changes. The rep.-stop approach is preserved, so the calculation work is narrower than a literal reading of #239 would suggest.

### 1. `RouteTripStats` shape and `averageTripsPerHour`

Extend [calculateRouteTripStats()](src/scenario/route-headway.ts#L168) to return:

```ts
interface RouteTripStats {
  tripCount: number           // included trips across all dates
  dateCount: number           // dates with ≥ 1 included trip (service days)
  hoursInWindow: number       // (endSeconds - startSeconds) / 3600; 24 in all-day
  averageTripsPerDay: number  // tripCount / dateCount
  averageTripsPerHour: number // tripCount / (hoursInWindow * dateCount)
  earliestTripStart?: number  // actual min departureTime across included trips (see §2)
  earliestTripEnd?: number
  latestTripStart?: number
  latestTripEnd?: number
}
```

`dateCount` is `selectedDateRange.length` — the number of calendar days in the filter, regardless of which of them the route actually runs. This matches the issue's literal "calendar days included within the current filters" wording. Specific-hours tooltip updated to match ("calendar days" instead of "service days").

Trip inclusion is "trip has any stop_time in window" — matches the issue's specific-hours tooltip: "have any visit at any stop during the days and times included."

### 2. Earliest / latest trip start & end — fix span calculation

Currently [route-headway.ts:197-208](src/scenario/route-headway.ts#L197-L208) filters each stop_time against the window *before* grouping by tripId, so a trip's reported "start" in specific-hours mode is its earliest *in-window* stop_time, not its actual first stop_time. Tooltip promises the latter.

Fix: single pass, track two things per trip — (a) whether any stop_time falls in the window (determines inclusion), (b) min/max `departureTime` across *all* its stop_times (the reported span). Included trips contribute their full span. Same shape works in all-day mode with the inclusion test always true.

Trip "end time": use `arrivalTime` of the last stop if `StopTimeCacheItem` has one; otherwise `departureTime` is close enough (usually within 1–2 minutes). Decide during implementation.

### Items with no code change

- **Slowest-frequency cross-day exclusion** — already correct (headways accumulated per-date, never spanning).
- **2-minute headway noise filter** in `calculateHeadwayStats()` — not mentioned in the issue. Keep as-is; flag in PR.
- **Variance-of-frequency concept column** — skipped per the issue.

## UI wiring

- `report.vue` derives `isAllDayMode` locally from the start/end time props (undefined/undefined = all-day). No new prop, `tne.vue` unchanged. Same pattern as [filter.vue:686-697](app/components/cal/filter.vue#L686-L697).
- Build one column factory per view (route / stop / geo-aggregate) taking `isAllDayMode`, returning labels + tooltips. Switch in `reportData`.
- CSV fields rename cleanly: `visit_count_daily_average` → `visit_count_total` (and per-weekday), and add `average_trips_per_hour` next to `average_trips_per_day`. Grepped `map-share.vue` — no references to any of these fields, so no URL-serialization risk.
- Stop map popup in `map-viewer-ts.vue` gets the same column label + value swap.

## File-by-file change list

| File | Change |
|------|--------|
| `src/scenario/route-headway.ts` | Extend `RouteTripStats` shape (Calc §1). Fix per-date pass so each trip's full span is computed independently of window filter (Calc §2). |
| `src/scenario/scenario-filter.ts` | Assign `average_trips_per_hour` alongside `average_trips_per_day` on `Route`. |
| `src/tl/route.ts` | Add `average_trips_per_hour` to `RouteDerived` / `RouteCsv`. |
| `src/tl/stop.ts` | Rename `visit_count_daily_average` → `visit_count_total` (and per-weekday) in `StopCsv` / `StopGeoAggregateCsv`; surface `stop.visits.total.visit_count`. |
| `app/components/cal/report.vue` | Mode-aware `routeColumns` / `stopColumns` / `stopGeoAggregateColumns`; derive `isAllDayMode` locally. |
| `app/components/cal/map-viewer-ts.vue` | Swap hardcoded `'Avg. visits/day'` + `visit_count_daily_average` to "Total visits during time period" + `visit_count_total` (mode-aware label). |
| Tests | `averageTripsPerHour` math; trip-span fix (trip whose full span exits the window); visit totals in both modes. |

## Open questions

### Resolved

1. ~~Reconcile "trip start time" language with representative-stop behavior.~~ Resolved: tooltips updated to describe the rep.-stop method accurately. Methodology unchanged. If Thomas later wants to switch to literal trip start times, both the calc and the tooltips will need updating.
2. ~~All-day "Average trips per day" denominator~~ — resolved: denominator is calendar days in the filter range (matches issue's literal reading).
3. ~~2-minute headway noise filter in `calculateHeadwayStats()`~~ — resolved: kept intentionally to suppress sub-2-min bunching that riders don't perceive as higher frequency.

### Resolve during implementation

4. Trip "end time" — use `arrivalTime` if `StopTimeCacheItem` has it; otherwise `departureTime` of last stop.

## Browser test plan

Automated via Playwright (`pnpm test:browser`) against the local tlserver and the Portland bbox already used by `query.test.ts` / `filters.test.ts`. Lives in `test/browser/report-frequency.test.ts`. The tests cover every user-visible surface the PR touches; numeric values are checked for shape (present, finite, well-formed `MM:SS` / `HH:MM`), not exact magnitudes, so they remain stable as long as the test feed has fixed-route service in the bbox.

### Surfaces covered

1. **Report > Routes table — all-day mode**
   - Column headers present in order: Route ID, Route Name, Mode, Agency, Average Trips per Day, Average Frequency, Fastest Frequency, Slowest Frequency, Earliest Trip Start, Earliest Trip End, Latest Trip Start, Latest Trip End.
   - Tooltips on the four frequency columns describe the representative-stop method and contain the issue's "calendar days" / "service days" wording per mode.
   - At least one row's frequency cells render as `MM:SS` or `HH:MM:SS`; trip start/end cells render as `HH:MM` (after-midnight values like `25:30` allowed).
   - "Average Trips per Day" cell parses as a finite number ≥ 0.

2. **Report > Routes table — specific-hours mode**
   - Same flow after toggling "All Day" off in Filter > Time of Day (default window `06:00–10:00`).
   - Column 5 label flips to "Average Trips per Hour" and tooltip text contains "calendar days" (not "service days").
   - Column header re-renders without page reload.

3. **Report > Stops (Individual) table**
   - Column headers: Stop ID, Stop Name, Modes, Routes Served, Agencies Served, Total Visits During Time Period.
   - "Total Visits During Time Period" cell parses as a non-negative integer.
   - Stale "Average Visits per Day" header is gone in both modes.

4. **Report > Stops (Aggregated) table**
   - Same column changes as the flat stop view; aggregation selector still works.

5. **Map popup label is mode-aware**
   - With aggregation enabled, hovering a choropleth feature shows "Total visits" in all-day mode and "Total visits in window" in specific-hours mode.

6. **Legend label is mode-aware**
   - In Stop visits display mode, legend heading is "Total visits:" (all-day) or "Total visits in window:" (specific-hours). Choropleth subtitle matches.

7. **CSV column rename**
   - Downloaded stop CSV contains `visit_count_total` column (and per-weekday `visit_count_*_total`); the old `visit_count_daily_average` columns are absent. Route CSV contains `average_trips_per_day` and `average_trips_per_hour`.

8. **Filter > Time of Day default window**
   - Toggling "All Day" off populates Start = `06:00` and End = `10:00` (regression: was previously `00:00`–`23:59`).

### Out of scope for browser tests

- Exact frequency / visit count magnitudes — covered by unit tests with synthetic fixtures (`route-headway.test.ts`, `scenario-filter.test.ts`).
- Choropleth color banding magnitude shift — visual regression, not assertable cheaply; flag during QA.

## Test plan (manual)

Use a Portland bbox with mixed-frequency routes.

1. All-day, all weekdays: route table shows all 8 columns; avg / fastest / slowest frequency match a spot-checked route.
2. Specific-hours 07:00–09:00: row-1 label is "Average trips per hour"; trips per hour ≈ trips per day / 2; frequency reflects departures at the rep. stop within the window.
3. Stop tab: "Total visits during time period" matches a hand-counted stop across the filter window.
4. Flip modes repeatedly — columns, labels, and values all re-render without stale state.
5. CSV export in both modes: field names match the UI; no stale `_average` columns.
6. Stop with no visits in the window: "Total visits" shows 0 (not blank).
7. Route with a trip that starts before the window but has stop_times within it: "Earliest trip start time" shows the trip's actual start, not its earliest in-window stop_time.
8. Stop map popup label + value swap in both modes.
9. Geo-aggregate view matches the flat stop view.

## Implementation vs. issue: differences and ambiguities

Recorded after the initial implementation, to bring to Thomas.

### Substantive differences

1. **Frequency uses the representative stop, not literal trip start times.** Average / Fastest / Slowest frequency (and the specific-hours trip inclusion for frequency) are measured at the stop with the most departures per (route, direction, date), not at each trip's literal first stop. See Semantic note for rationale. **Tooltips updated** to describe this method accurately ("measured at the route's representative stop, the stop with the most departures on each service day"). If Thomas later wants to switch to literal trip start times, both the calc and the tooltips will need a follow-up — for now they reflect the actual method.

2. **"Routes served" / "Agencies served" are NOT filter-aware (deferred — accepted).** Issue tooltips promise filter-awareness ("during days" / "during days and times included within the current filters"), but the implementation emits `stop.route_stops.length` — the static count of all routes ever associated with the stop. Pre-existing behavior; **explicitly accepted for this PR** and tracked as a follow-up: in `stopVisits()`, accumulate the set of `routeId`s that had an in-window departure, derive agency counts from there, and surface those on `StopCsv` / `StopGeoAggregateCsv`.

3. ~~**"Average trips per day" divides by service days, not calendar days in filter.**~~ Resolved: denominator is now `selectedDateRange.length` (calendar days in filter), matching the issue's literal reading. A weekday-only route in a 7-day filter shows `trips / 7`. Applies to `averageTripsPerDay` and `averageTripsPerHour` alike; specific-hours tooltip updated to say "calendar days" instead of "service days."

### Ambiguities — defaults assumed, flag in PR

4. **Trip "end time" = `departure_time` of last stop, not arrival.** Issue says "first/last visit at a stop that ends a trip." `StopTimeCacheItem` doesn't have `arrivalTime`, so implementation uses `max(departureTime)` per trip. Usually within 1–2 min of arrival.

5. **Specific-hours trip inclusion for earliest/latest trip start/end = "any visit in window."** Issue tooltip describes *what is reported* (the trip's first/last stop_time) but not the inclusion rule. Implementation: trip is included iff it has any stop_time in window, and reports its full span.

6. **2-minute headway noise filter** in `calculateHeadwayStats()` kept as-is — not mentioned in the issue but **intentionally retained**. It removes situations where extra buses are scheduled for capacity (or general schedule weirdness) at sub-2-min intervals; those aren't perceived by riders as higher frequency, so dropping them produces a more meaningful average/fastest/slowest.

7. ~~**Map popup label** shows "Total visits" (short form), not mode-aware.~~ Resolved: popup label is now mode-aware ("Total visits" in all-day mode, "Total visits in window" in specific-hours mode). Column header keeps the full "Total Visits During Time Period."

8. **Choropleth color scale magnitude shift — needs a smoke-test pass.** `stopGeoAggregateCsv` previously divided by `dateCount`; the rename to `visit_count_total` drops that division, so absolute values are now ~5–30× larger depending on the filter date range. The quantile-based breakpoints in [tne.vue:1269](app/pages/tne.vue#L1269) self-adjust, but the legend scale and visual banding will look different. Track during QA; may want a pass on the breakpoint labels and/or legend formatting.

### Matches the issue verbatim

- 8 route data columns + 4 identity columns, both modes, with issue's exact tooltip text.
- Stop columns use the @NAT-mb amendment text verbatim.
- `averageTripsPerHour` denominator: `tripCount / (hoursInWindow × serviceDateCount)` — matches "hours across all service days."
- Cross-service-day gap exclusion preserved.
- Trip times rendered as `HH:MM` in GTFS time (no wrap at 24h — an after-midnight trip at GTFS time `25:30` renders as `25:30`).
- Trip-span bug fixed — trips include full start/end even when starting before the window.
