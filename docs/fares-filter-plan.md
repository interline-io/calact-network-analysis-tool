# Fare filtering plan (#454)

Status: draft plan, not yet implemented.

## Goal

Let users filter the Transit Network Explorer by fare, using data from both
GTFS Fares v1 and Fares v2, for the standard fare only: the spec's default
rider category in v2, or the published fare in v1, which has no rider
categories (other categories deferred, see Open questions).

Neither phase needs a journey fare calculator. Both are answered by a
**per-route fare summary**: the range of standard single-ride fares that can
apply to a trip on the route, plus where that range came from.

### Phases

1. **Phase 1 (this plan):** filter routes by fare category:
   - **Free:** every fare that can apply is $0.
   - **Sometimes paid:** the range spans $0 and a paid fare.
   - **Always paid:** every fare that can apply is above $0.
   - **Unknown:** no usable fare data.

   The route and agency reports show the fare range and data-quality flags
   as information only.
2. **Phase 2 (later):** minimum / maximum fare thresholds (the "cost of a
   single trip" part of #454). Deferred until the reports have shown how far
   the published amounts can be trusted, and until time-limited fares
   (see Open questions) are handled.

The fare category is robust to most of the problems found in the data review.
Passes, cash vs card prices, zone and area ranges, and time-limited fares change
the amounts, but they either leave a route's category alone or move it into
"sometimes paid". They never make it look free.

## Approach ("small")

1. **transitland-lib:** expose the already-imported fare tables read-only through GraphQL.
2. **calact:** fetch them per feed version in a new server-side scenario
   phase, derive the per-route summary in a pure, tested module, and filter and
   report on it client-side like the existing route filters.

All derivation rules use only GTFS spec semantics. No inference from names
or other strings in the data.

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

## Part 2: calact

### Fetch

- New scenario phase `src/scenario/phases/fares.ts`, run after `routes`, keyed by
  the distinct feed version sha1s of the fetched routes (one query per feed
  version, not per route batch).
- New `src/tl/fare.ts` with the GraphQL query, types, and the derivation.
- Results added to `ScenarioData` and streamed like the other phases.

### Per-route fare summary

Rules use only what the GTFS spec defines. No matching on ids, names, or
other strings: a feed's names are not reliable signals of meaning.

```ts
interface RouteFareSummary {
  source: 'fares-v2' | 'fares-v1' | 'none'
  minAmount?: number      // default rider category, in currency units
  maxAmount?: number
  currency?: string
  // Structural data-quality flags, derived from the spec, shown in the report
  flags: RouteFareFlag[]
}

type RouteFareFlag =
  | 'v1-indistinct-fares'     // several prices apply with no zone fields to tell them apart
  | 'v2-networks-unlinked'    // leg rules name networks that no route belongs to
  | 'v2-no-default-category'  // rider categories exist, none is the default
  | 'v2-uncategorized-products' // feed defines rider categories, but some products have none
  | 'has-other-categories'    // v2 products exist for non-default rider categories
```

**Fares v2** (used when the feed version has fare_leg_rules)

- A route's networks are its `route_networks` rows, or else `routes.network_id`.
- Matching leg rules are those whose `network_id` is one of the route's networks,
  or is empty (applies to all routes). Exclude `transfer_only` rules.
- Eligible products: those for the rider category with
  `is_default_fare_category = 1`, and products with an empty
  `rider_category_id` (the spec makes those eligible for every category).
- Group the matching rules by (leg_group_id, network_id, from/to area, from/to
  timeframe). Within a group, the spec offers the products as alternatives for
  the same leg, so take the cheapest eligible product. This leaves out
  passes sold on the same rule and picks the cheapest fare media.
- min/max across groups.
- No route matches any leg rule and the networks are not linked: unknown,
  flag `v2-networks-unlinked`.
- Feed has rider categories but none is default and no uncategorized product
  matches: unknown, flag `v2-no-default-category`.

**Fares v1** (used when there are no leg rules but there are fare_attributes)

- Rules with this route's `route_id` contribute their fare's price.
- Rules with no `route_id` (zone-only or catch-all) apply to every route of the
  fare's agency.
- If the feed has fare_attributes but no fare_rules, every fare applies to all
  routes of its agency (`fare_attributes.agency_id`, or the only agency).
- min/max of `price` across contributing fares. v1 has no rider categories.
- If more than one distinct price applies through rules with no
  origin/destination/contains zone (or through no rules at all), flag
  `v1-indistinct-fares`: the data gives no way to say which applies.

**Neither:** `source: 'none'`, meaning unknown. It is never treated as free.

### Filter semantics

Phase 1: each route gets one category from its summary.

| Category | Rule |
|---|---|
| `free` | `maxAmount === 0` |
| `sometimes-paid` | `minAmount === 0 && maxAmount > 0` |
| `always-paid` | `minAmount > 0` |
| `unknown` | no summary (`source: 'none'`, or unknown because of a flag) |

- The filter is a multi-select over the four categories, with all four selected
  by default, which means no filtering. Unknown is a category like the others, so
  turning off "free" does not silently hide the ~40% of agencies with no fare data.
- `sometimes-paid` covers both real cases (free zones or free directions, such as
  Washington State Ferries) and data problems (VCTC's free youth fare published as
  a plain v1 fare, C-TRAN's New Year's Eve fare). The flags in the report tell them
  apart. The filter doesn't try to.
- Narrowing the selection counts as a route filter for `routeFiltersActive`, so
  stops and agencies follow the marked routes as they do for frequency.

Phase 2 (deferred): thresholds use containment, so a route matches only if
**every** fare it can charge satisfies the filter (max fare $X:
`maxAmount <= X`; min fare $X: `minAmount >= X`). Wide or ambiguous ranges then
never pass a "cheap" filter by accident.

### UI and URL state

- `app/components/cal/filter-fixed-route.vue`: replace the disabled max/min fare
  stubs in the Fares section with four checkboxes (Free, Sometimes paid,
  Always paid, Unknown fare), following the route-type checkbox pattern in
  `filter-agencies.vue`. Each one gets a tooltip with its definition.
- `useScenarioFilters.ts`: replace the unused `maxFareEnabled` / `maxFare` /
  `minFareEnabled` / `minFare` params with `fareCategories` (comma-joined;
  absent means all, matching `selectedRouteTypes`). Phase 2 reintroduces
  thresholds, parsed with `parseFloat` so cents are kept.
- Add `selectedFareCategories` to `ScenarioFilter` (`src/scenario/scenario.ts`),
  pass it in `tne.vue`, and add it to the reset block.
- Apply in `routeMarked` in `src/scenario/scenario-filter.ts`, next to the
  route type check.

### Reports and export

- Route report and CSV (`src/scenario/report/tables.ts`, `src/tl/route.ts`):
  - `Fare category`.
  - `Fare` (formatted range such as "$1.50" or "$0.00 to $3.25", blank if unknown).
  - `Fare source` (v1 / v2).
  - `Fare notes` (flags, in plain language).
- Agency report and CSV: count of marked routes in each fare category, plus the
  overall min and max fare (rollup in `scenario-filter.ts`).
- Optional follow-up: "Color by Fare" map mode (`routeColorModes` already lists
  it), coloring by category.

### Tests

- Unit tests for the derivation using small fixture feeds covering: v1 route
  rule, v1 catch-all, v1 no rules, v1 zone range, v2 network rule, v2 empty
  network, v2 default category, v2 no default category, free routes, both v1 and v2.
- Category assignment tests for each boundary ($0 only, $0 to N, all above $0, unknown).
- Filter tests in `scenario-filter.test.ts` for each category selection, including
  stop and agency follow-through.

## Data review

Survey of active feed versions on Transitland for agencies in US-CA, US-OR,
and US-WA (`agencies(where: {adm1_iso})`, then `FeedVersion.files` row and
value counts), run 2026-10-05. The derivation rules above were prototyped in
Python against 90 downloaded feed versions: all 30 with Fares v2 plus a random
60 of the v1-only feeds.

### Coverage

Agencies in each state, by the fare data in their active feed version:

| State | Agencies | v1 only | v2 only | v1 + v2 | No fares |
|---|---|---|---|---|---|
| CA | 267 | 77 | 48 | 18 | 124 (46%) |
| OR | 89 | 51 | 1 | 3 | 34 (38%) |
| WA | 103 | 59 | 1 | 5 | 38 (37%) |

Across the 353 distinct feed versions: 168 v1 only, 9 v2 only, 21 both, 155 none.

- **v1 must be supported.** It is the only fare data for most agencies with
  fares in OR and WA, and for many rural CA agencies.
- **v2 matters mostly in CA**, where the Bay Area regional feed (RG) alone
  covers 40+ agencies. Other v2 feeds include TriMet, C-TRAN, King County Metro,
  Sound Transit, Spokane, MTS, NCTD, and Santa Barbara MTD.
- **Unknown is the common case.** About 40% of agencies publish no fares,
  so the "include routes without fare data" toggle must default to on.

### v1 shapes (v1-only feed versions)

| fare_rules shape | Feed versions |
|---|---|
| route_id only | 75 |
| no fare_rules (catch-all fares) | 47 |
| route + origin/destination zones | 21 |
| zones, some rules without route | 12 |
| route + zones, some rules without route | 9 |
| route + zones + contains | 5 |

89 feeds have exactly one fare_attributes row. The prototype assigned a fare to
90% of routes in the sampled v1 feeds (534 routes, 52 unknown). The unknown
routes are those not named in any rule of a route-based feed, for example
Nevada County Gold Country Stage, which has a rule for only one of its routes.

### Results with spec-only rules

v1 sample (60 feed versions, 534 routes):

| Per-route result | Routes |
|---|---|
| single price | 395 (74%) |
| range explained by zone fields | 56 (10%) |
| unknown (route not named by any rule) | 52 (10%) |
| `v1-indistinct-fares` | 31 (6%), from 4 feeds |

The indistinct cases are feeds that publish rider categories as separate v1
fares (VCTC: Adult $1.75, Free Youth $0, Free College $0, Reduced $0.80;
Seattle Monorail: Adult $4, Senior $2, and others), plus Torrance Transit and
one Redwood Coast route. Unknown routes are mostly routes left out of rules in
route-based feeds (Nevada County Gold Country Stage has a rule for one route).

v2 sample (30 feed versions, 1401 routes, 204 unknown):

- **Passes and alternative media.** Several feeds attach day, monthly, and
  annual passes to the same leg rule as the single ride (Unitrans $1.50 to
  $270, SCMTD $2 to $145, Omnitrans, Auburn, Pasadena). Taking the cheapest
  product per rule group resolves all of them without looking at names.
  King County Metro's max drops from $7.00 (cash) to $6.00 (ORCA).
- **Unlinked networks.** NCTD and San Joaquin RTD key every leg rule by
  `network_id` but have neither `route_networks.txt` nor `routes.network_id`, so
  none of their 88 routes match. Neither has v1 fares.
- **No default rider category.** MTS has 9 categories, all with
  `is_default_fare_category = 0`, so 103 of 105 routes are unknown. Auburn,
  Guadalupe Flyer, and Unitrans have no default either, but they also have
  uncategorized products that supply a fare.
- **Uncategorized reduced products.** Sound Transit defines youth, LIFT, and
  RRFP categories but attaches none to its products. Its $0 youth product is
  therefore eligible for everyone, and two routes come out free. Huntington
  Park, Yurok, Glendora, and West Covina have the same pattern on a smaller
  scale.
- **Time-limited free fares.** C-TRAN has a $0 leg rule limited to a New Year's
  Eve timeframe, so all 31 routes span $0 to $3.25.
- **Direction-dependent fares.** Washington State Ferries publishes $0 for the
  free direction of several routes (v1). This is faithful to the data.

In phase 1, every one of these problems shows up as "sometimes paid" or as
unknown, never as a false "free". The exceptions are Sound Transit's two
shuttle routes and other routes whose uncategorized products are all $0, which
the data literally says are free.

### Decision on v1

Keep v1. Under spec-only rules, v1 is no messier than v2: 84% of sampled v1
routes get a single price or a zone-explained range. The main v2 feeds lose
more routes to structural problems (unlinked networks, no default category).
It is also the only source for most agencies with fares in OR and WA. Dropping
v1 would leave the filter almost empty outside California.

### Data-quality follow-ups

The flags double as a list of feed fixes to report upstream: NCTD and SJRTD
(link networks to routes), MTS (mark adult as default), Sound Transit
(assign rider categories to products), VCTC and Seattle Monorail (publish
rider categories in v2 instead of v1 fare ids).

Not needed for the summary: areas, stop_areas, fare_media, fare_transfer_rules,
and the Trillium-style `fare_rider_categories.txt` (6 feeds).

## Open questions

- Other rider categories: start with the default category only and show
  `has-other-categories`. A category picker only makes sense for v2 feeds, and
  most feeds lack a stable category vocabulary across agencies.
- Time-limited fares (C-TRAN). The spec-faithful fix is to expose timeframes
  and drop rules whose timeframe `service_id` is not active in the scenario
  date range. That needs calendar data for those service ids. In phase 1 these
  routes land in "sometimes paid". Resolve this before phase 2's thresholds.
- Surface the flags in the route report as a "Fare notes" column, or keep them
  in the CSV export only?
- Currency: every sampled amount is USD. Ignore non-USD products.
- Flex: flex fares in v2 use areas, so they would need areas and stop_areas
  exposed. Out of scope for now.
