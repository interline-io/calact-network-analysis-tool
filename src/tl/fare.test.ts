import { describe, it, expect } from 'vitest'
import {
  combineFareSummaries,
  deriveRouteFareSummary,
  dropInactiveTimeframeRules,
  serviceRunsOn,
  type FareServiceGql,
  fareCategory,
  feedFaresFromGql,
  feedFaresUseStops,
  fareRouteFromGql,
  formatFareRange,
  type FeedFares,
  type FareRoute,
  type RouteFareSummary,
} from './fare'

function feed (partial: Partial<FeedFares>): FeedFares {
  return {
    fareAttributes: [],
    fareRules: [],
    legRules: [],
    products: [],
    riderCategories: [],
    timeframes: [],
    truncated: false,
    ...partial,
  }
}

function route (partial: Partial<FareRoute> = {}): FareRoute {
  return { id: 1, agencyId: 10, stops: [], ...partial }
}

const usd = (id: number, price: number, agencyId?: number) => ({ id, price, currency: 'USD', agencyId })
const noZones = { originId: '', destinationId: '', containsId: '' }
const leg = (fareProductId: string, extra: Partial<FeedFares['legRules'][number]> = {}) => ({
  networkId: '',
  fromAreaId: '',
  toAreaId: '',
  fromTimeframeGroupId: '',
  toTimeframeGroupId: '',
  fareProductId,
  ...extra,
})
const product = (fareProductId: string, amount: number, riderCategoryId = '') => ({ fareProductId, amount, riderCategoryId, currency: 'USD' })
const adultDefault = [{ riderCategoryId: 'adult', isDefault: true }, { riderCategoryId: 'youth', isDefault: false }]

function range (s: RouteFareSummary) {
  return [s.minAmount, s.maxAmount]
}

describe('deriveRouteFareSummary: no fares', () => {
  it('is unknown with source none', () => {
    const s = deriveRouteFareSummary(feed({}), route())
    expect(s).toEqual({ source: 'none', flags: [] })
    expect(fareCategory(s)).toBe('unknown')
  })

  it('reports truncated fare data as unknown', () => {
    const s = deriveRouteFareSummary(feed({ fareAttributes: [usd(1, 2)], truncated: true }), route())
    expect(s.flags).toEqual(['fare-data-truncated'])
    expect(fareCategory(s)).toBe('unknown')
  })
})

describe('deriveRouteFareSummary: Fares v1', () => {
  it('applies a rule naming the route', () => {
    const s = deriveRouteFareSummary(feed({
      fareAttributes: [usd(1, 2), usd(2, 5)],
      fareRules: [{ fareAttributeId: 1, routeId: 1, ...noZones }, { fareAttributeId: 2, routeId: 2, ...noZones }],
    }), route())
    expect(s.source).toBe('fares-v1')
    expect(range(s)).toEqual([2, 2])
    expect(s.flags).toEqual([])
  })

  it('applies catch-all rules to every route of the fare\'s agency', () => {
    const fares = feed({
      fareAttributes: [usd(1, 1.5, 10), usd(2, 3, 20)],
      fareRules: [{ fareAttributeId: 1, ...noZones }, { fareAttributeId: 2, ...noZones }],
    })
    expect(range(deriveRouteFareSummary(fares, route({ agencyId: 10 })))).toEqual([1.5, 1.5])
    expect(range(deriveRouteFareSummary(fares, route({ agencyId: 20 })))).toEqual([3, 3])
  })

  it('applies every fare to every route when there are no fare rules', () => {
    const s = deriveRouteFareSummary(feed({ fareAttributes: [usd(1, 1.25)] }), route())
    expect(range(s)).toEqual([1.25, 1.25])
    expect(fareCategory(s)).toBe('always-paid')
  })

  it('flags several prices that no zone explains', () => {
    // VCTC-style: rider categories published as separate v1 fares.
    const s = deriveRouteFareSummary(feed({ fareAttributes: [usd(1, 1.75), usd(2, 0), usd(3, 0.8)] }), route())
    expect(range(s)).toEqual([0, 1.75])
    expect(s.flags).toEqual(['v1-indistinct-fares'])
    expect(fareCategory(s)).toBe('sometimes-paid')
  })

  it('uses zone rules only for zones the route serves, without flagging the range', () => {
    const fares = feed({
      fareAttributes: [usd(1, 2), usd(2, 4), usd(3, 6)],
      fareRules: [
        { fareAttributeId: 1, routeId: 1, originId: 'A', destinationId: 'A', containsId: '' },
        { fareAttributeId: 2, routeId: 1, originId: 'A', destinationId: 'B', containsId: '' },
        { fareAttributeId: 3, routeId: 1, originId: 'A', destinationId: 'C', containsId: '' },
      ],
    })
    const s = deriveRouteFareSummary(fares, route({ stops: [{ zoneId: 'A', areaIds: [] }, { zoneId: 'B', areaIds: [] }] }))
    expect(range(s)).toEqual([2, 4])
    expect(s.flags).toEqual([])
  })

  it('is unknown when no rule covers the route', () => {
    const s = deriveRouteFareSummary(feed({
      fareAttributes: [usd(1, 2)],
      fareRules: [{ fareAttributeId: 1, routeId: 2, ...noZones }],
    }), route())
    expect(s.minAmount).toBeUndefined()
    expect(s.flags).toEqual(['no-matching-rule'])
  })

  it('ignores non-USD fares', () => {
    const s = deriveRouteFareSummary(feed({ fareAttributes: [{ id: 1, price: 2, currency: 'CAD' }] }), route())
    expect(fareCategory(s)).toBe('unknown')
  })
})

describe('deriveRouteFareSummary: Fares v2', () => {
  it('uses the rules naming the route\'s network', () => {
    const s = deriveRouteFareSummary(feed({
      legRules: [leg('bus', { networkId: 'BUS' }), leg('rail', { networkId: 'RAIL' })],
      products: [product('bus', 2.8, 'adult'), product('rail', 5, 'adult')],
      riderCategories: adultDefault,
    }), route({ networkId: 'BUS' }))
    expect(s.source).toBe('fares-v2')
    expect(range(s)).toEqual([2.8, 2.8])
  })

  it('falls back to empty-network rules when no rule names the network', () => {
    const fares = feed({
      legRules: [leg('rail', { networkId: 'RAIL' }), leg('other')],
      products: [product('rail', 5), product('other', 2)],
    })
    expect(range(deriveRouteFareSummary(fares, route({ networkId: 'BUS' })))).toEqual([2, 2])
    expect(range(deriveRouteFareSummary(fares, route()))).toEqual([2, 2])
    expect(range(deriveRouteFareSummary(fares, route({ networkId: 'RAIL' })))).toEqual([5, 5])
  })

  it('flags a route with no network when every rule names one', () => {
    // NCTD / SJRTD: leg rules keyed by network, no route linked to a network.
    const s = deriveRouteFareSummary(feed({
      legRules: [leg('bus', { networkId: 'BUS' })],
      products: [product('bus', 2)],
    }), route())
    expect(fareCategory(s)).toBe('unknown')
    expect(s.flags).toEqual(['v2-route-without-network'])
  })

  it('takes the cheapest default-category product, leaving out passes and pricier media', () => {
    const s = deriveRouteFareSummary(feed({
      legRules: [leg('single'), leg('day'), leg('youth')],
      products: [
        product('single', 2.5, 'adult'),
        product('single', 2, 'adult'),
        product('day', 5, 'adult'),
        product('youth', 0, 'youth'),
      ],
      riderCategories: adultDefault,
    }), route())
    expect(range(s)).toEqual([2, 2])
    expect(s.flags).toEqual(['has-other-categories'])
  })

  it('prefers default-category products over uncategorized ones on the same rule', () => {
    // Sound Transit: a $0 youth product with no rider category beside the adult fare.
    const s = deriveRouteFareSummary(feed({
      legRules: [leg('adult'), leg('youth-free')],
      products: [product('adult', 3, 'adult'), product('youth-free', 0)],
      riderCategories: adultDefault,
    }), route())
    expect(range(s)).toEqual([3, 3])
    expect(fareCategory(s)).toBe('always-paid')
  })

  it('uses uncategorized products when a rule has no default-category product', () => {
    const s = deriveRouteFareSummary(feed({
      legRules: [leg('shuttle')],
      products: [product('shuttle', 0)],
      riderCategories: adultDefault,
    }), route())
    expect(fareCategory(s)).toBe('free')
    expect(s.flags).toEqual(['v2-uncategorized-products'])
  })

  it('is unknown with no default rider category and no uncategorized product', () => {
    const s = deriveRouteFareSummary(feed({
      legRules: [leg('adult'), leg('senior')],
      products: [product('adult', 2.5, 'adult'), product('senior', 1.25, 'senior')],
      riderCategories: [{ riderCategoryId: 'adult', isDefault: false }, { riderCategoryId: 'senior', isDefault: false }],
    }), route())
    expect(fareCategory(s)).toBe('unknown')
    expect(s.flags).toContain('v2-no-default-category')
  })

  it('falls back to v1 when v2 gives no standard fare', () => {
    // MTS: v2 has no default category, v1 has the published fare.
    const s = deriveRouteFareSummary(feed({
      legRules: [leg('adult')],
      products: [product('adult', 2.5, 'adult')],
      riderCategories: [{ riderCategoryId: 'adult', isDefault: false }],
      fareAttributes: [usd(1, 2.5)],
    }), route())
    expect(s.source).toBe('fares-v1')
    expect(range(s)).toEqual([2.5, 2.5])
    expect(s.flags).toEqual(['v2-no-default-category', 'v2-fallback-to-v1'])
  })

  it('prefers v2 when it prices the route', () => {
    const s = deriveRouteFareSummary(feed({
      legRules: [leg('adult')],
      products: [product('adult', 2.8)],
      fareAttributes: [usd(1, 2.5)],
    }), route())
    expect(s.source).toBe('fares-v2')
    expect(range(s)).toEqual([2.8, 2.8])
  })

  it('keeps time-limited fares as part of the range', () => {
    // C-TRAN: a $0 New Year's Eve timeframe beside the regular fare.
    const s = deriveRouteFareSummary(feed({
      legRules: [leg('regular'), leg('nye', { fromTimeframeGroupId: 'nye' })],
      products: [product('regular', 3.25), product('nye', 0)],
    }), route())
    expect(range(s)).toEqual([0, 3.25])
    expect(fareCategory(s)).toBe('sometimes-paid')
  })

  it('prices each pair of areas the route serves, with the empty-area fallback', () => {
    const fares = feed({
      legRules: [
        leg('ab', { fromAreaId: 'A', toAreaId: 'B' }),
        leg('ba', { fromAreaId: 'B', toAreaId: 'A' }),
        leg('ac', { fromAreaId: 'A', toAreaId: 'C' }),
        leg('local'),
      ],
      products: [product('ab', 4), product('ba', 4), product('ac', 9), product('local', 2)],
    })
    const A = { zoneId: '', areaIds: ['A'] }
    const B = { zoneId: '', areaIds: ['B'] }
    const D = { zoneId: '', areaIds: ['D'] }
    // A to B and B to A cost 4. A to C is out of reach: no stop in C.
    expect(range(deriveRouteFareSummary(fares, route({ stops: [A, B] })))).toEqual([4, 4])
    // D is named by no rule, so a D-to-D leg falls back to the empty-area rule.
    // A to D does not: A is named as a from area, so the empty from area
    // stops matching it, and no rule runs from A to an unnamed area.
    expect(range(deriveRouteFareSummary(fares, route({ stops: [A, B, D, D] })))).toEqual([2, 4])
    // One stop in D pairs with no other D stop.
    expect(range(deriveRouteFareSummary(fares, route({ stops: [A, B, D] })))).toEqual([4, 4])
  })

  it('resolves rule_priority per leg and time', () => {
    const fares = feed({
      legRules: [
        leg('regular', { rulePriority: 0 }),
        leg('airport', { toAreaId: 'AIR', rulePriority: 1 }),
        leg('holiday', { fromTimeframeGroupId: 'holiday', rulePriority: 2 }),
      ],
      products: [product('regular', 2), product('airport', 5), product('holiday', 0)],
    })
    const town = { zoneId: '', areaIds: [] }
    const airport = { zoneId: '', areaIds: ['AIR'] }
    // Legs to the airport cost 5 (the airport rule outranks the empty one),
    // other legs 2; the holiday rule outranks both, but only on holidays.
    expect(range(deriveRouteFareSummary(fares, route({ stops: [town, town, airport] })))).toEqual([0, 5])
    // Without the airport, the regular fare still applies outside holidays.
    expect(range(deriveRouteFareSummary(fares, route({ stops: [town, town] })))).toEqual([0, 2])
  })

  it('flags a negative fare as unknown', () => {
    const s = deriveRouteFareSummary(feed({
      legRules: [leg('discount')],
      products: [product('discount', -1)],
    }), route())
    expect(fareCategory(s)).toBe('unknown')
    expect(s.flags).toEqual(['negative-amount'])
  })
})

describe('fareCategory', () => {
  const s = (minAmount?: number, maxAmount?: number): RouteFareSummary => ({ source: 'fares-v1', minAmount, maxAmount, flags: [] })
  it.each([
    [0, 0, 'free'],
    [0, 2, 'sometimes-paid'],
    [0.5, 2, 'always-paid'],
    [undefined, undefined, 'unknown'],
  ] as const)('%s to %s is %s', (min, max, expected) => {
    expect(fareCategory(s(min, max))).toBe(expected)
  })
})

describe('formatFareRange', () => {
  it('formats a single fare and a range', () => {
    expect(formatFareRange({ source: 'fares-v1', minAmount: 1.5, maxAmount: 1.5, flags: [] })).toBe('$1.50')
    expect(formatFareRange({ source: 'fares-v1', minAmount: 0, maxAmount: 3.25, flags: [] })).toBe('$0.00 to $3.25')
    expect(formatFareRange({ source: 'none', flags: [] })).toBe('')
  })
})

describe('GraphQL conversion', () => {
  it('flattens nulls and detects truncation', () => {
    const fares = feedFaresFromGql({
      id: 1,
      fare_attributes: [{ id: 1, fare_id: 'a', price: 2, currency_type: 'USD', agency: null }],
      fare_rules: [{ fare_attribute: { id: 1 }, route: null, origin_id: 'Z1', destination_id: null, contains_id: null }],
      fare_leg_rules: [],
      fare_products: [],
      rider_categories: [],
    }, 1)
    expect(fares.fareRules).toEqual([{ fareAttributeId: 1, routeId: undefined, originId: 'Z1', destinationId: '', containsId: '' }])
    expect(fares.truncated).toBe(true)
    expect(feedFaresUseStops(fares)).toBe(true)
  })

  it('takes a route\'s network from route_networks, else routes.network_id, and stop areas from the parent too', () => {
    const r = fareRouteFromGql(
      { id: 1, network_id: 'N2', networks: [{ network_id: 'N1' }], agency: { id: 10 } },
      [{ id: 5, zone_id: null, areas: [{ area_id: 'A' }], parent: { areas: [{ area_id: 'S' }] } }],
    )
    expect(r).toEqual({ id: 1, agencyId: 10, networkId: 'N1', stops: [{ zoneId: '', areaIds: ['A', 'S'] }] })
    expect(fareRouteFromGql({ id: 1, network_id: 'N2', networks: [], agency: null }, []).networkId).toBe('N2')
  })
})

describe('flex service', () => {
  it('notes that zone fares are not matched for a route with no stops', () => {
    const fares = feed({
      fareAttributes: [usd(1, 2), usd(2, 4)],
      fareRules: [{ fareAttributeId: 1, routeId: 1, ...noZones }, { fareAttributeId: 2, routeId: 1, originId: 'Z', destinationId: '', containsId: '' }],
    })
    const s = deriveRouteFareSummary(fares, route({ stops: [] }))
    expect(range(s)).toEqual([2, 2])
    expect(s.flags).toEqual(['zones-not-matched'])
    // A feed without zone rules has nothing to note.
    expect(deriveRouteFareSummary(feed({ fareAttributes: [usd(1, 0)] }), route()).flags).toEqual([])
  })

  it('combines the fares of the routes serving an area', () => {
    const free: RouteFareSummary = { source: 'fares-v1', minAmount: 0, maxAmount: 0, flags: [] }
    const paid: RouteFareSummary = { source: 'fares-v2', minAmount: 2, maxAmount: 3, flags: ['has-other-categories'] }
    const unknown: RouteFareSummary = { source: 'none', flags: [] }
    expect(combineFareSummaries([])).toBeUndefined()
    expect(combineFareSummaries([free])).toBe(free)
    const both = combineFareSummaries([free, paid, unknown])!
    expect(both).toMatchObject({ source: 'fares-v2', minAmount: 0, maxAmount: 3, flags: ['has-other-categories'] })
    expect(fareCategory(both)).toBe('sometimes-paid')
    expect(fareCategory(combineFareSummaries([unknown, { source: 'fares-v1', flags: ['no-matching-rule'] }])!)).toBe('unknown')
  })
})

describe('timeframes', () => {
  const service = (partial: Partial<FareServiceGql>): FareServiceGql => ({
    start_date: '2026-09-13',
    end_date: '2027-01-09',
    monday: 0,
    tuesday: 0,
    wednesday: 0,
    thursday: 0,
    friday: 0,
    saturday: 0,
    sunday: 0,
    added_dates: [],
    removed_dates: [],
    ...partial,
  })

  it('reads a service calendar like GTFS does', () => {
    const weekdays = service({ monday: 1, tuesday: 1, wednesday: 1, thursday: 1, friday: 1, removed_dates: ['2026-11-26'], added_dates: ['2026-11-28'] })
    expect(serviceRunsOn(weekdays, '2026-10-20')).toBe(true) // Tuesday
    expect(serviceRunsOn(weekdays, '2026-10-24')).toBe(false) // Saturday
    expect(serviceRunsOn(weekdays, '2026-11-26')).toBe(false) // removed
    expect(serviceRunsOn(weekdays, '2026-11-28')).toBe(true) // added Saturday
    expect(serviceRunsOn(weekdays, '2027-02-02')).toBe(false) // after end_date
  })

  // C-TRAN: a $0 New Year's Eve timeframe beside the regular fare.
  const ctran = feed({
    legRules: [leg('regular', { fromTimeframeGroupId: 'REGULAR' }), leg('free', { fromTimeframeGroupId: 'NYE' }), leg('anytime')],
    products: [product('regular', 3.25), product('free', 0), product('anytime', 3.25)],
    timeframes: [
      { timeframeGroupId: 'REGULAR', service: service({ monday: 1, tuesday: 1, wednesday: 1, thursday: 1, friday: 1, saturday: 1, sunday: 1 }) },
      { timeframeGroupId: 'NYE', service: service({ start_date: '2026-12-31', end_date: '2026-12-31', added_dates: ['2026-12-31'] }) },
    ],
  })

  it('drops rules whose timeframes never run in the scenario', () => {
    const october = dropInactiveTimeframeRules(ctran, ['2026-10-19', '2026-10-20'])
    expect(october.legRules.map(r => r.fareProductId)).toEqual(['regular', 'anytime'])
    expect(fareCategory(deriveRouteFareSummary(october, route()))).toBe('always-paid')
    const newYear = dropInactiveTimeframeRules(ctran, ['2026-12-31'])
    expect(newYear.legRules).toHaveLength(3)
    expect(fareCategory(deriveRouteFareSummary(newYear, route()))).toBe('sometimes-paid')
    expect(dropInactiveTimeframeRules(ctran, [])).toBe(ctran)
  })

  it('still treats a feed as Fares v2 when every rule is dropped', () => {
    const onlyNye = feed({ legRules: [leg('free', { fromTimeframeGroupId: 'NYE' })], products: [product('free', 0)], timeframes: ctran.timeframes })
    const s = deriveRouteFareSummary(dropInactiveTimeframeRules(onlyNye, ['2026-10-20']), route())
    expect(s.source).toBe('fares-v2')
    expect(fareCategory(s)).toBe('unknown')
  })
})
