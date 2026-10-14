import { gql } from 'graphql-tag'
import { fmtDate, WEEKDAY_BY_GETDAY } from '~~/src/core'

// Per-route fare summary from GTFS Fares v1 and v2 (#454). The rules use only
// GTFS spec semantics, never names or other strings in the data. See
// docs/fares-filter-plan.md for the reasoning and the data review behind them.

//////////
// Queries
//////////

// Most feeds fit well under this; the regional Bay Area feed has ~11k fare
// products. A list that comes back this long is treated as truncated.
export const FARE_TABLE_LIMIT = 100_000

export const feedVersionFaresQuery = gql`
query FeedVersionFares($sha1: String!, $limit: Int!) {
  feed_versions(where: {sha1: $sha1}) {
    fare_attributes(limit: $limit) {
      id
      price
      currency_type
      agency {
        id
      }
    }
    fare_rules(limit: $limit) {
      fare_attribute {
        id
      }
      route {
        id
      }
      origin_id
      destination_id
      contains_id
    }
    fare_leg_rules(limit: $limit) {
      network_id
      from_area {
        area_id
      }
      to_area {
        area_id
      }
      from_timeframe_group_id
      to_timeframe_group_id
      fare_product_id
      rule_priority
    }
    fare_products(limit: $limit) {
      fare_product_id
      rider_category_id
      amount
      currency
    }
    rider_categories(limit: $limit) {
      rider_category_id
      is_default_fare_category
    }
    # Their service calendars say when a time-limited fare applies. A
    # calendar_dates-only service lists every date, so the date limit is high.
    timeframes(limit: $limit) {
      timeframe_group_id
      service {
        start_date
        end_date
        monday
        tuesday
        wednesday
        thursday
        friday
        saturday
        sunday
        added_dates(limit: 10000)
        removed_dates(limit: 10000)
      }
    }
  }
}`

// The route fields the summary needs: the agency (v1 catch-all rules) and the
// network (v2). A feed uses either route_networks.txt or routes.network_id.
export const fareRoutesQuery = gql`
query FareRoutes($ids: [Int!], $limit: Int!) {
  routes(ids: $ids, limit: $limit) {
    id
    network_id
    networks {
      network_id
    }
    agency {
      id
    }
  }
}`

// Zones (v1) and areas (v2) of the scenario's stops. Areas that name a parent
// station apply to its platforms too.
export const fareStopsQuery = gql`
query FareStops($ids: [Int!], $limit: Int!) {
  stops(ids: $ids, limit: $limit) {
    id
    zone_id
    areas {
      area_id
    }
    parent {
      areas {
        area_id
      }
    }
  }
}`

export interface FeedVersionFaresGql {
  fare_attributes: {
    id: number
    price: number | null
    currency_type: string | null
    agency: { id: number } | null
  }[]
  fare_rules: {
    fare_attribute: { id: number } | null
    route: { id: number } | null
    origin_id: string | null
    destination_id: string | null
    contains_id: string | null
  }[]
  fare_leg_rules: {
    network_id: string | null
    from_area: { area_id: string } | null
    to_area: { area_id: string } | null
    from_timeframe_group_id: string | null
    to_timeframe_group_id: string | null
    fare_product_id: string | null
    rule_priority: number | null
  }[]
  fare_products: {
    fare_product_id: string
    rider_category_id: string | null
    amount: number | null
    currency: string | null
  }[]
  rider_categories: {
    rider_category_id: string
    is_default_fare_category: number | null
  }[]
  timeframes?: {
    timeframe_group_id: string
    service: FareServiceGql | null
  }[]
}

export interface FareServiceGql {
  start_date: string | null
  end_date: string | null
  monday: number
  tuesday: number
  wednesday: number
  thursday: number
  friday: number
  saturday: number
  sunday: number
  added_dates: string[] | null
  removed_dates: string[] | null
}

export interface FareRouteGql {
  id: number
  network_id: string | null
  networks: { network_id: string }[] | null
  agency: { id: number } | null
}

export interface FareStopGql {
  id: number
  zone_id: string | null
  areas: { area_id: string }[] | null
  parent: { areas: { area_id: string }[] | null } | null
}

//////////
// Derivation inputs
//////////

// One feed version's fare tables, with GraphQL nulls flattened to ''.
export interface FeedFares {
  fareAttributes: {
    id: number
    price: number
    currency: string
    agencyId?: number
  }[]
  fareRules: {
    fareAttributeId: number
    routeId?: number
    originId: string
    destinationId: string
    containsId: string
  }[]
  legRules: {
    networkId: string
    fromAreaId: string
    toAreaId: string
    fromTimeframeGroupId: string
    toTimeframeGroupId: string
    fareProductId: string
    rulePriority?: number
  }[]
  products: {
    fareProductId: string
    riderCategoryId: string
    amount: number
    currency: string
  }[]
  riderCategories: {
    riderCategoryId: string
    isDefault: boolean
  }[]
  // Each timeframe's service calendar, by timeframe_group_id.
  timeframes: {
    timeframeGroupId: string
    service?: FareServiceGql
  }[]
  // Which fare versions the feed publishes, from the tables as loaded. They
  // stay set when dropInactiveTimeframeRules narrows legRules.
  hasV1: boolean
  hasV2: boolean
  // Some table hit FARE_TABLE_LIMIT, so the data may be incomplete.
  truncated: boolean
}

// What the summary needs to know about one route.
export interface FareRoute {
  id: number
  agencyId?: number
  // The route's network: its route_networks row, else routes.network_id.
  networkId?: string
  // The route's stops in the scenario.
  stops: FareStop[]
}

export interface FareStop {
  zoneId: string
  // The stop's own areas plus its parent station's.
  areaIds: string[]
}

export function feedFaresFromGql (fv: FeedVersionFaresGql, limit = FARE_TABLE_LIMIT): FeedFares {
  const lists = [fv.fare_attributes, fv.fare_rules, fv.fare_leg_rules, fv.fare_products, fv.rider_categories]
  return {
    hasV1: (fv.fare_attributes?.length ?? 0) > 0,
    hasV2: (fv.fare_leg_rules?.length ?? 0) > 0,
    fareAttributes: (fv.fare_attributes || []).filter(a => a.price != null).map(a => ({
      id: a.id,
      price: a.price!,
      currency: a.currency_type || '',
      agencyId: a.agency?.id,
    })),
    fareRules: (fv.fare_rules || []).filter(r => r.fare_attribute != null).map(r => ({
      fareAttributeId: r.fare_attribute!.id,
      routeId: r.route?.id,
      originId: r.origin_id || '',
      destinationId: r.destination_id || '',
      containsId: r.contains_id || '',
    })),
    legRules: (fv.fare_leg_rules || []).map(r => ({
      networkId: r.network_id || '',
      fromAreaId: r.from_area?.area_id || '',
      toAreaId: r.to_area?.area_id || '',
      fromTimeframeGroupId: r.from_timeframe_group_id || '',
      toTimeframeGroupId: r.to_timeframe_group_id || '',
      fareProductId: r.fare_product_id || '',
      rulePriority: r.rule_priority ?? undefined,
    })),
    products: (fv.fare_products || []).filter(p => p.amount != null).map(p => ({
      fareProductId: p.fare_product_id,
      riderCategoryId: p.rider_category_id || '',
      amount: p.amount!,
      currency: p.currency || '',
    })),
    riderCategories: (fv.rider_categories || []).map(c => ({
      riderCategoryId: c.rider_category_id,
      isDefault: c.is_default_fare_category === 1,
    })),
    timeframes: (fv.timeframes || []).map(t => ({
      timeframeGroupId: t.timeframe_group_id,
      service: t.service ?? undefined,
    })),
    truncated: lists.some(l => (l?.length ?? 0) >= limit),
  }
}

export function fareRouteFromGql (route: FareRouteGql, stops: FareStop[]): FareRoute {
  return {
    id: route.id,
    agencyId: route.agency?.id,
    networkId: route.networks?.[0]?.network_id || route.network_id || undefined,
    stops,
  }
}

export function fareStopFromGql (stop: FareStopGql): FareStop {
  const areaIds = new Set<string>()
  for (const a of [...(stop.areas || []), ...(stop.parent?.areas || [])]) {
    areaIds.add(a.area_id)
  }
  return { zoneId: stop.zone_id || '', areaIds: [...areaIds] }
}

// Drops the leg rules whose timeframes never apply on the given dates, so a
// fare limited to a holiday drops out of a scenario that doesn't include it.
// Only dates are checked, not times of day. A rule whose timeframe group has
// no timeframes in the data is kept.
export function dropInactiveTimeframeRules (fares: FeedFares, dates: Date[]): FeedFares {
  if (fares.timeframes.length === 0 || dates.length === 0) {
    return fares
  }
  const days = dates.map(serviceDay)
  const groups = new Map<string, boolean>()
  for (const t of fares.timeframes) {
    const active = !!t.service && runsOnAny(t.service, days)
    groups.set(t.timeframeGroupId, (groups.get(t.timeframeGroupId) ?? false) || active)
  }
  const applies = (group: string) => group === '' || groups.get(group) !== false
  const legRules = fares.legRules.filter(r => applies(r.fromTimeframeGroupId) && applies(r.toTimeframeGroupId))
  return legRules.length === fares.legRules.length ? fares : { ...fares, legRules }
}

// GTFS calendar semantics: added dates always run, removed dates never do,
// and otherwise the weekday flags apply between the start and end dates.
export function serviceRunsOn (service: FareServiceGql, date: Date): boolean {
  return runsOnAny(service, [serviceDay(date)])
}

interface ServiceDay {
  ymd: string
  weekday: typeof WEEKDAY_BY_GETDAY[number]
}

function serviceDay (date: Date): ServiceDay {
  return { ymd: fmtDate(date), weekday: WEEKDAY_BY_GETDAY[date.getDay()]! }
}

function runsOnAny (service: FareServiceGql, days: ServiceDay[]): boolean {
  const added = new Set(service.added_dates)
  const removed = new Set(service.removed_dates)
  const { start_date: start, end_date: end } = service
  return days.some(({ ymd, weekday }) => added.has(ymd)
    || (!removed.has(ymd) && !!start && !!end && ymd >= start && ymd <= end && service[weekday] === 1))
}

// Whether matching any rule depends on the stops' zones or areas, so the phase
// only fetches stops when it has to.
export function feedFaresUseStops (fares: FeedFares): boolean {
  return fares.legRules.some(r => r.fromAreaId || r.toAreaId)
    || fares.fareRules.some(r => r.originId || r.destinationId || r.containsId)
}

//////////
// Summary
//////////

export type RouteFareSource = 'fares-v2' | 'fares-v1' | 'none'

// Data-quality notes on a summary; fareFlagDescriptions explains each one.
export type RouteFareFlag
  = 'v1-indistinct-fares'
    | 'v2-route-without-network'
    | 'v2-no-default-category'
    | 'v2-uncategorized-products'
    | 'has-other-categories'
    | 'v2-fallback-to-v1'
    | 'no-matching-rule'
    | 'negative-amount'
    | 'fare-data-truncated'
    | 'zones-not-matched'

export interface RouteFareSummary {
  source: RouteFareSource
  // Standard (default rider category) single-ride fares that can apply to a
  // trip on the route, in currency units. Absent when the fare is unknown.
  minAmount?: number
  maxAmount?: number
  flags: RouteFareFlag[]
}

export type FareCategory = 'free' | 'sometimes-paid' | 'always-paid' | 'unknown'

export const FARE_CATEGORIES: readonly FareCategory[] = ['free', 'sometimes-paid', 'always-paid', 'unknown']

export const fareCategoryLabels: Record<FareCategory, string> = {
  'free': 'Free',
  'sometimes-paid': 'Sometimes paid',
  'always-paid': 'Always paid',
  'unknown': 'Unknown fare',
}

export const fareCategoryDescriptions: Record<FareCategory, string> = {
  'free': 'Every standard fare that can apply to a trip on the route is $0.',
  'sometimes-paid': 'The route\'s standard fares range from $0 to a paid fare, for example a free zone or direction, or a time-limited free fare. The Fare Notes column says when the range comes from a data problem.',
  'always-paid': 'Every standard fare that can apply to a trip on the route is above $0.',
  'unknown': 'The feed publishes no fares, or its fare data gives no standard fare for this route.',
}

export const fareSourceLabels: Record<RouteFareSource, string> = {
  'fares-v2': 'GTFS Fares v2',
  'fares-v1': 'GTFS Fares v1',
  'none': 'None',
}

export const fareFlagDescriptions: Record<RouteFareFlag, string> = {
  'v1-indistinct-fares': 'Several fares apply to this route with nothing in the data to say which one, often fares for different rider categories published as plain fares.',
  'v2-route-without-network': 'The feed\'s fare rules are keyed by network, but this route belongs to no network.',
  'v2-no-default-category': 'The feed defines rider categories but marks none as the default, so the standard fare can\'t be identified.',
  'v2-uncategorized-products': 'Some of the fares used have no rider category, so they apply to every rider.',
  'has-other-categories': 'Fares for other rider categories (such as youth or senior) also exist and are not shown.',
  'v2-fallback-to-v1': 'The feed\'s Fares v2 data gives no standard fare for this route, so its Fares v1 data was used.',
  'no-matching-rule': 'The feed publishes fares, but none of its rules gives this route a standard fare.',
  'negative-amount': 'A matched fare is negative (a discount), so the route has no fare category.',
  'fare-data-truncated': 'The feed\'s fare data is too large to load in full.',
  'zones-not-matched': 'Some of the feed\'s fares depend on fare zones or areas, which are not matched for service with no stops in the study area, such as flex service areas.',
}

export function fareCategory (summary: RouteFareSummary): FareCategory {
  const { minAmount, maxAmount } = summary
  if (minAmount == null || maxAmount == null || minAmount < 0) {
    return 'unknown'
  }
  if (maxAmount === 0) {
    return 'free'
  }
  if (minAmount === 0) {
    return 'sometimes-paid'
  }
  return 'always-paid'
}

export function formatFareAmount (amount: number): string {
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

// Only USD amounts are compared: every sampled feed in CA/OR/WA uses USD, and
// mixing currencies would make the range meaningless.
const FARE_CURRENCY = 'USD'

export const NO_FARES_SUMMARY: Readonly<RouteFareSummary> = Object.freeze({ source: 'none', flags: [] })

export function deriveRouteFareSummary (fares: FeedFares, route: FareRoute): RouteFareSummary {
  if (!fares.hasV2 && !fares.hasV1) {
    return { ...NO_FARES_SUMMARY, flags: [] }
  }
  if (fares.truncated) {
    return { source: fares.hasV2 ? 'fares-v2' : 'fares-v1', flags: ['fare-data-truncated'] }
  }
  const index = feedIndex(fares)
  const summary = deriveWithFallback(index, route)
  // Flex service has no stops to match zones and areas against.
  if (route.stops.length === 0 && index.usesStops) {
    summary.flags.push('zones-not-matched')
  }
  return summary
}

function deriveWithFallback (index: FeedIndex, route: FareRoute): RouteFareSummary {
  if (!index.fares.hasV2) {
    return summarize('fares-v1', deriveV1(index, route))
  }
  const v2 = deriveV2(index, route)
  if (v2.amounts.size > 0 || !index.fares.hasV1) {
    return summarize('fares-v2', v2)
  }
  // The spec prefers v2 when a feed has both, but does not forbid using v1
  // for a route v2 cannot price (MTS: no default rider category).
  const v1 = deriveV1(index, route)
  if (v1.amounts.size === 0) {
    return summarize('fares-v2', v2)
  }
  // Keep only the v2 flags that say why v2 failed; its products went unused.
  const v2Reasons = [...v2.flags].filter(f => f === 'v2-route-without-network' || f === 'v2-no-default-category')
  const flags = new Set<RouteFareFlag>([...v2Reasons, 'v2-fallback-to-v1', ...v1.flags])
  return summarize('fares-v1', { amounts: v1.amounts, flags })
}

// Distinct amounts, so a route with many legs at the same few prices stays small.
interface Derived {
  amounts: Set<number>
  flags: Set<RouteFareFlag>
}

function summarize (source: RouteFareSource, d: Derived): RouteFareSummary {
  const flags = new Set(d.flags)
  const amounts = [...d.amounts]
  if (amounts.some(a => a < 0)) {
    flags.add('negative-amount')
    return { source, flags: [...flags] }
  }
  if (amounts.length === 0) {
    const explained = flags.has('v2-route-without-network') || flags.has('v2-no-default-category')
    if (!explained) {
      flags.add('no-matching-rule')
    }
    return { source, flags: [...flags] }
  }
  return {
    source,
    minAmount: Math.min(...amounts),
    maxAmount: Math.max(...amounts),
    flags: [...flags],
  }
}

// The fare columns of a route or flex area row, shared by the report tables
// and CSV export. A row with no summary yet reads "Not loaded".
export interface FareReportFields {
  fare_category: string
  fare_min?: number
  fare_max?: number
  fare_source?: string
  fare_notes?: string
}

export function fareReportFields (fare?: RouteFareSummary): FareReportFields {
  if (!fare) {
    return { fare_category: 'Not loaded' }
  }
  return {
    fare_category: fareCategoryLabels[fareCategory(fare)],
    fare_min: fare.minAmount,
    fare_max: fare.maxAmount,
    fare_source: fare.source !== 'none' ? fareSourceLabels[fare.source] : undefined,
    fare_notes: fare.flags.map(f => fareFlagDescriptions[f]).join(' ') || undefined,
  }
}

// One summary for a flex area served by several routes: the range across
// the routes with a known fare. Undefined when none of the routes has a
// summary yet; unknown when none of them has a known fare.
export function combineFareSummaries (summaries: RouteFareSummary[]): RouteFareSummary | undefined {
  if (summaries.length <= 1) {
    return summaries[0]
  }
  const known = summaries.filter(s => s.minAmount != null && s.maxAmount != null)
  const sources = new Set(summaries.map(s => s.source))
  // A mix of v1 and v2 is reported as v2, the spec's preferred source.
  const source: RouteFareSource = sources.has('fares-v2') ? 'fares-v2' : sources.has('fares-v1') ? 'fares-v1' : 'none'
  const flags = [...new Set(summaries.flatMap(s => s.flags))]
  if (known.length === 0) {
    return { source, flags }
  }
  return {
    source,
    minAmount: Math.min(...known.map(s => s.minAmount!)),
    maxAmount: Math.max(...known.map(s => s.maxAmount!)),
    flags,
  }
}

//////////
// Per-feed index
//////////

type LegRule = FeedFares['legRules'][number]
type FareRule = FeedFares['fareRules'][number]

// Lookups the derivation needs for every route of a feed version, built once
// per FeedFares rather than per route. A regional feed has thousands of
// products and leg rules and a hundred or more routes.
interface FeedIndex {
  fares: FeedFares
  usesStops: boolean
  // v1: USD fares by id, and fare rules by route (undefined = no route_id).
  usdAttrs: FeedFares['fareAttributes']
  usdAttrsById: Map<number, FeedFares['fareAttributes'][number]>
  fareRulesByRoute: Map<number | undefined, FareRule[]>
  // v2
  priorityMode: boolean
  legRulesByNetwork: Map<string, LegRule[]>
  productsById: Map<string, FeedFares['products']>
  defaultCategories: Set<string>
  hasCategories: boolean
}

const feedIndexes = new WeakMap<FeedFares, FeedIndex>()

function feedIndex (fares: FeedFares): FeedIndex {
  let index = feedIndexes.get(fares)
  if (!index) {
    const usdAttrs = fares.fareAttributes.filter(a => a.currency === FARE_CURRENCY)
    index = {
      fares,
      usesStops: feedFaresUseStops(fares),
      usdAttrs,
      usdAttrsById: new Map(usdAttrs.map(a => [a.id, a])),
      fareRulesByRoute: groupBy(fares.fareRules, r => r.routeId),
      // The spec has two matching modes. With a rule_priority column, empty
      // fields match anything and the highest-priority matches win. Without
      // one, an empty field means "everything not named by another rule".
      // GraphQL can't tell an absent column from an empty one, so any value
      // turns on priority mode.
      priorityMode: fares.legRules.some(r => r.rulePriority != null),
      legRulesByNetwork: groupBy(fares.legRules, r => r.networkId),
      productsById: groupBy(fares.products.filter(p => p.currency === FARE_CURRENCY), p => p.fareProductId),
      defaultCategories: new Set(fares.riderCategories.filter(c => c.isDefault).map(c => c.riderCategoryId)),
      hasCategories: fares.riderCategories.length > 0,
    }
    feedIndexes.set(fares, index)
  }
  return index
}

function groupBy<T, K> (items: T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>()
  for (const item of items) {
    const k = key(item)
    const list = groups.get(k)
    if (list) {
      list.push(item)
    } else {
      groups.set(k, [item])
    }
  }
  return groups
}

//////////
// Fares v1
//////////

function deriveV1 (index: FeedIndex, route: FareRoute): Derived {
  const flags = new Set<RouteFareFlag>()
  const amounts = new Set<number>()
  // Prices reached through rules with no zone fields, or through no rules.
  // Zones explain a range; without them several prices are indistinct.
  const zonelessPrices = new Set<number>()
  const zones = new Set(route.stops.map(s => s.zoneId).filter(Boolean))
  // fare_attributes.agency_id is required only when a feed has several
  // agencies, so an empty one means the feed's only agency.
  const agencyMatches = (agencyId?: number) => agencyId == null || agencyId === route.agencyId

  if (index.fares.fareRules.length === 0) {
    // No fare_rules.txt: every fare applies to all routes of its agency.
    for (const a of index.usdAttrs) {
      if (agencyMatches(a.agencyId)) {
        amounts.add(a.price)
        zonelessPrices.add(a.price)
      }
    }
  } else {
    // Rules naming this route, and rules naming no route (which apply to
    // every route of the fare's agency). A fare with no rules in a feed that
    // has rules applies to nothing.
    const rules = [...(index.fareRulesByRoute.get(route.id) || []), ...(index.fareRulesByRoute.get(undefined) || [])]
    for (const rule of rules) {
      const attr = index.usdAttrsById.get(rule.fareAttributeId)
      if (!attr || (rule.routeId == null && !agencyMatches(attr.agencyId))) {
        continue
      }
      // A zone rule applies only when the route serves that zone in the scenario.
      const ruleZones = [rule.originId, rule.destinationId, rule.containsId]
      if (!ruleZones.every(z => z === '' || zones.has(z))) {
        continue
      }
      amounts.add(attr.price)
      if (ruleZones.every(z => z === '')) {
        zonelessPrices.add(attr.price)
      }
    }
  }
  if (zonelessPrices.size > 1) {
    flags.add('v1-indistinct-fares')
  }
  return { amounts, flags }
}

//////////
// Fares v2
//////////

// One leg's stop areas, restricted to the areas the rules name.
interface Leg {
  from: string[]
  to: string[]
}

function deriveV2 (index: FeedIndex, route: FareRoute): Derived {
  const flags = new Set<RouteFareFlag>()
  const amounts = new Set<number>()
  const { priorityMode, legRulesByNetwork, productsById, defaultCategories, hasCategories } = index

  const network = route.networkId ?? ''
  const named = network !== '' ? legRulesByNetwork.get(network) || [] : []
  const unnamed = legRulesByNetwork.get('') || []
  const rules = priorityMode ? [...unnamed, ...named] : (named.length > 0 ? named : unnamed)
  if (rules.length === 0) {
    flags.add(network ? 'no-matching-rule' : 'v2-route-without-network')
    return { amounts, flags }
  }

  // The standard fare for a group of rules the spec offers as alternatives for
  // the same leg: the cheapest eligible product. Default-category products are
  // preferred; uncategorized ones (eligible for every category) are used only
  // when the group has no default-category product. Taking the cheapest leaves
  // out passes sold on the same rule and picks the cheapest fare media.
  const groupAmount = (group: LegRule[]): number | undefined => {
    const products = group.flatMap(r => productsById.get(r.fareProductId) || [])
    // Only meaningful against a default: without one, every category is "other".
    if (defaultCategories.size > 0 && products.some(p => p.riderCategoryId !== '' && !defaultCategories.has(p.riderCategoryId))) {
      flags.add('has-other-categories')
    }
    let eligible = products.filter(p => defaultCategories.has(p.riderCategoryId))
    if (eligible.length === 0) {
      eligible = products.filter(p => p.riderCategoryId === '')
      if (eligible.length > 0 && hasCategories) {
        flags.add('v2-uncategorized-products')
      }
    }
    if (eligible.length === 0) {
      if (products.length > 0 && hasCategories && defaultCategories.size === 0) {
        flags.add('v2-no-default-category')
      }
      return undefined
    }
    return Math.min(...eligible.map(p => p.amount))
  }

  // Rules that match the same leg at the same time are alternatives; rules
  // that differ in area or timeframe price different legs or times.
  const addGroups = (matched: LegRule[]) => {
    const groups = groupBy(matched, r => [r.fromAreaId, r.toAreaId, r.fromTimeframeGroupId, r.toTimeframeGroupId].join('\u0000'))
    for (const group of groups.values()) {
      const amount = groupAmount(group)
      if (amount != null) {
        amounts.add(amount)
      }
    }
  }

  for (const leg of routeLegs(rules, route)) {
    if (priorityMode) {
      const matched = rules.filter(r => (r.fromAreaId === '' || leg.from.includes(r.fromAreaId))
        && (r.toAreaId === '' || leg.to.includes(r.toAreaId)))
      // Priority is resolved per leg and per time, so a higher-priority
      // holiday rule does not hide the regular fare at other times.
      const times = new Set(matched.map(r => r.fromTimeframeGroupId + '\u0000' + r.toTimeframeGroupId))
      for (const time of times) {
        const [fromTf, toTf] = time.split('\u0000')
        const atTime = matched.filter(r => (r.fromTimeframeGroupId === '' || r.fromTimeframeGroupId === fromTf)
          && (r.toTimeframeGroupId === '' || r.toTimeframeGroupId === toTf))
        const top = Math.max(...atTime.map(r => r.rulePriority ?? 0))
        addGroups(atTime.filter(r => (r.rulePriority ?? 0) === top))
      }
    } else {
      const fromValues = leg.from.length > 0 ? leg.from : ['']
      const toValues = leg.to.length > 0 ? leg.to : ['']
      addGroups(rules.filter(r => fromValues.includes(r.fromAreaId) && toValues.includes(r.toAreaId)))
    }
  }
  return { amounts, flags }
}

// The distinct legs a trip between two of the route's scenario stops can
// make, described by the stops' areas that the rules name. Legs between stops
// outside the scenario are not considered, so the range describes trips in the
// study area. Direction is not checked: a leg from A to B counts whenever the
// route serves both.
function routeLegs (rules: LegRule[], route: FareRoute): Leg[] {
  const fromNamed = new Set(rules.map(r => r.fromAreaId).filter(Boolean))
  const toNamed = new Set(rules.map(r => r.toAreaId).filter(Boolean))
  if ((fromNamed.size === 0 && toNamed.size === 0) || route.stops.length === 0) {
    return [{ from: [], to: [] }]
  }
  // Stops with the same named areas make the same legs, so pair signatures
  // rather than stops. A signature pairs with itself only if two stops share it.
  const sigs = new Map<string, { from: string[], to: string[], count: number }>()
  for (const stop of route.stops) {
    const from = stop.areaIds.filter(a => fromNamed.has(a)).sort()
    const to = stop.areaIds.filter(a => toNamed.has(a)).sort()
    const key = from.join(',') + '|' + to.join(',')
    const entry = sigs.get(key) || { from, to, count: 0 }
    entry.count++
    sigs.set(key, entry)
  }
  // A route with one stop in the scenario has no leg inside it; pair the stop
  // with itself rather than leave the route unpriced.
  const single = route.stops.length < 2
  // Only a leg's from and to areas matter, so different signature pairs often
  // make the same leg; keep each once.
  const legs = new Map<string, Leg>()
  for (const [ka, a] of sigs) {
    for (const [kb, b] of sigs) {
      if (ka !== kb || a.count >= 2 || single) {
        legs.set(a.from.join(',') + '|' + b.to.join(','), { from: a.from, to: b.to })
      }
    }
  }
  return [...legs.values()]
}
