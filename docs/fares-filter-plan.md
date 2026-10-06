# Fare filtering plan (#454)

Status: draft plan, not yet implemented.

## Goal

Let users filter the Transit Network Explorer by fare:

- free vs paid service
- cost of a single trip (minimum / maximum fare thresholds)
- standard adult fare only for the first version (other rider categories deferred, see Open questions)
- data from both GTFS Fares v1 and Fares v2

None of these needs a journey fare calculator. Each one is answered by a
**per-route fare summary**: the range of adult single-ride fares that can apply
to a trip on the route, plus where that range came from.

## Approach ("small")

1. **transitland-lib:** expose the already-imported fare tables read-only through GraphQL.
2. **calact:** fetch them per feed version in a new server-side scenario
   phase, derive the per-route summary in a pure, tested module, and filter and
   report on it client-side like the existing route filters.

The derivation lives in calact so the rules are cheap to iterate on. It is
written as a self-contained module so it can later move into transitland-lib
as a computed `Route.fares` field ("medium") if other API clients need it.

Out of scope: journey or stop-to-stop costing, transfers, the RG coster in
mtc-regional-feed.

## Part 1: transitland-lib GraphQL

All of these tables are already populated by the importer. None are exposed in
`schema/graphql/schema.graphqls` today. Add read-only types and fields
following `server/gql/RESOLVER_GUIDE.md` (schema, model, finder, loader,
resolver, tests):

| GraphQL field | Table | Notes |
|---|---|---|
| `FeedVersion.fare_attributes` | `gtfs_fare_attributes` | v1; include `agency` |
| `FeedVersion.fare_rules` | `gtfs_fare_rules` | v1; `route_id` resolves to Route, zone ids as text |
| `FeedVersion.fare_products` | `gtfs_fare_products` | v2 |
| `FeedVersion.fare_leg_rules` | `gtfs_fare_leg_rules` | v2; ids stored as text |
| `FeedVersion.rider_categories` | `gtfs_rider_categories` | v2; includes `is_default_fare_category` |
| `FeedVersion.route_networks` | `gtfs_route_networks` | v2 |
| `FeedVersion.networks` | `gtfs_networks` | v2 |
| `Route.network_id` | `gtfs_routes.network_id` | v2 alternative to route_networks; already selected by the finder |

Deferred unless the data review shows they are needed for the summary: areas,
stop_areas, timeframes, fare_media, fare_transfer_rules, fare_leg_join_rules.
Area- and timeframe-based leg rules only widen a route's min/max range, so the
summary can be computed without resolving them.

Also verify the `FeedVersion.files` row counts cover the new tables so that
coverage can be checked without the new resolvers.

## Part 2: calact

### Fetch

- New scenario phase `src/scenario/phases/fares.ts`, run after `routes`, keyed by
  the distinct feed version sha1s of the fetched routes (one query per feed
  version, not per route batch).
- New `src/tl/fare.ts` with the GraphQL query, types, and the derivation.
- Results added to `ScenarioData` and streamed like the other phases.

### Per-route fare summary

```ts
interface RouteFareSummary {
  source: 'fares-v2' | 'fares-v1' | 'none'
  minAmount?: number      // adult / default category, in currency units
  maxAmount?: number
  currency?: string
  hasReducedFares: boolean // v2 products exist for non-default rider categories
}
```

Derivation rules (to be confirmed against real feeds in the data review):

**Fares v2** (used when the feed version has fare_leg_rules)

- A route's networks are its `route_networks` rows, or else `routes.network_id`.
- Matching leg rules are those whose `network_id` is one of the route's networks,
  or is empty (applies to all routes). Exclude `transfer_only` rules.
- Products for those rules, keeping only the adult fare: the rider category with
  `is_default_fare_category = 1`, or products with no rider category.
  If a feed marks no default category, fall back to a category whose id or name
  matches "adult" or "regular". Otherwise treat it as unknown.
- min/max of `amount` across the remaining products (across areas,
  timeframes, and fare media).

**Fares v1** (used when there are no leg rules but there are fare_attributes)

- Rules with this route's `route_id` contribute their fare's price.
- Rules with no `route_id` (zone-only or catch-all) apply to every route of the
  fare's agency.
- If the feed has fare_attributes but no fare_rules, every fare applies to all
  routes of its agency (`fare_attributes.agency_id`, or the only agency).
- min/max of `price` across contributing fares. v1 has no rider categories, so
  its prices are treated as the adult fare.

**Neither:** `source: 'none'`, meaning unknown. It is never treated as free.

### Filter semantics

- Free: `maxAmount === 0`.
- Paid: `minAmount > 0`. Routes with a 0 to N range (for example free zones)
  match neither "free only" nor "paid only". Confirm this choice in review.
- Max fare $X: `minAmount <= X` (some trip on the route costs at most X).
- Min fare $X: `maxAmount >= X`.
- Unknown-fare routes: a separate "Include routes without fare data" toggle,
  defaulting to on, so turning on a fare filter does not silently hide
  most of the network.
- Fare filters count as route filters for `routeFiltersActive`, so stops and
  agencies follow the marked routes as they do for frequency.

### UI and URL state

- Enable the existing stubs in `app/components/cal/filter-fixed-route.vue`
  (Fares section) and add a free/paid choice and the unknown toggle.
- `useScenarioFilters.ts`: switch `maxFare` / `minFare` from `parseInt` to
  `parseFloat` (cents), add the new params.
- Add fare fields to `ScenarioFilter` (`src/scenario/scenario.ts`) and pass
  them in `tne.vue`.
- Apply in `routeMarked` in `src/scenario/scenario-filter.ts`, next to the
  frequency checks.

### Reports and export

- Route report and CSV: `Fare` (formatted range, "Free", or blank) and
  `Fare source` columns (`src/scenario/report/tables.ts`, `src/tl/route.ts`).
- Agency report and CSV: min and max fare across the agency's marked routes
  (rollup in `scenario-filter.ts`).
- Optional follow-up: "Color by Fare" map mode (`routeColorModes` already lists it).

### Tests

- Unit tests for the derivation using small fixture feeds covering: v1 route
  rule, v1 catch-all, v1 no rules, v1 zone range, v2 network rule, v2 empty
  network, v2 default category, v2 no default category, free routes, both v1 and v2.
- Filter tests in `scenario-filter.test.ts` for each threshold and the unknown toggle.

## Data review

Survey of current active feed versions in CA, OR, and WA: which publish fares,
v1 vs v2, and representative edge cases. Results to be added here before
implementation.

## Open questions

- Other rider categories: is adult-only enough for v1 of this feature, with a
  "reduced fares available" indicator? A rider-category picker only makes
  sense for v2 feeds.
- Currency: assume USD across the three states. Hide the filter for non-USD products?
- Free vs paid for routes whose range spans 0.
- Should flex services get fares later? Flex fares in v2 use areas, so they
  would need areas and stop_areas exposed.
