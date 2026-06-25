import { describe, it, expect } from 'vitest'
import {
  getFlexAreaType,
  getFlexAdvanceNotice,
  bookingTypeToAdvanceNotice,
  getFlexAgencyName,
  getFlexAgencyNames,
  flexAreaMatchesFilters,
  isBookingAvailableOnDay,
  isBookingAvailableToday,
  formatBookingDays,
  transformLocationToFlexArea,
  type FlexAreaFeature,
  type FlexBookingDays,
  type FlexLocationGql,
} from './flex'

/**
 * Helper to create a minimal FlexAreaFeature for testing
 */
function createFlexFeature (overrides: Partial<FlexAreaFeature['properties']> = {}): FlexAreaFeature {
  return {
    type: 'Feature',
    id: 'test-feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
    },
    properties: {
      location_id: 'loc-1',
      agencies: [],
      agency_ids: [],
      routes: [],
      route_ids: [],
      route_types: [],
      pickup_available: false,
      pickup_types: [],
      pickup_booking_rule_ids: [],
      pickup_booking_rules: [],
      drop_off_available: false,
      drop_off_types: [],
      drop_off_booking_rule_ids: [],
      drop_off_booking_rules: [],
      ...overrides,
    },
  }
}

function createFlexLocationGql (geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): FlexLocationGql {
  return {
    id: 1,
    location_id: 'loc-1',
    feed_onestop_id: 'f-test',
    geometry,
    stop_times: [],
  }
}

describe('transformLocationToFlexArea', () => {
  it('sets internal_id from location.id', () => {
    const location = createFlexLocationGql({
      type: 'Polygon',
      coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
    })
    const feature = transformLocationToFlexArea(location)
    expect(feature.properties.internal_id).toBe(location.id)
  })

  it('computes a positive area_m2 for a polygon', () => {
    // Rough 1-degree square near the equator — ~12,000 km²
    const location = createFlexLocationGql({
      type: 'Polygon',
      coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
    })
    const feature = transformLocationToFlexArea(location)
    expect(feature.properties.area_m2).toBeGreaterThan(0)
  })

  it('computes a larger area_m2 for a larger polygon', () => {
    const small = transformLocationToFlexArea(createFlexLocationGql({
      type: 'Polygon',
      coordinates: [[[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1], [0, 0]]],
    }))
    const large = transformLocationToFlexArea(createFlexLocationGql({
      type: 'Polygon',
      coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
    }))
    expect(large.properties.area_m2!).toBeGreaterThan(small.properties.area_m2!)
  })

  it('computes a positive area_m2 for a multipolygon', () => {
    const location = createFlexLocationGql({
      type: 'MultiPolygon',
      coordinates: [
        [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
        [[[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]]],
      ],
    })
    const feature = transformLocationToFlexArea(location)
    expect(feature.properties.area_m2).toBeGreaterThan(0)
  })
})

describe('getFlexAreaType', () => {
  it('returns "PU and DO" when both pickup and dropoff are available', () => {
    const feature = createFlexFeature({
      pickup_available: true,
      drop_off_available: true,
    })
    expect(getFlexAreaType(feature)).toBe('PU and DO')
  })

  it('returns "PU only" when only pickup is available', () => {
    const feature = createFlexFeature({
      pickup_available: true,
      drop_off_available: false,
    })
    expect(getFlexAreaType(feature)).toBe('PU only')
  })

  it('returns "DO only" when only dropoff is available', () => {
    const feature = createFlexFeature({
      pickup_available: false,
      drop_off_available: true,
    })
    expect(getFlexAreaType(feature)).toBe('DO only')
  })

  it('returns "PU and DO" as default when neither is available', () => {
    const feature = createFlexFeature({
      pickup_available: false,
      drop_off_available: false,
    })
    expect(getFlexAreaType(feature)).toBe('PU and DO')
  })
})

describe('bookingTypeToAdvanceNotice', () => {
  it('returns "On-demand" for booking_type 0', () => {
    expect(bookingTypeToAdvanceNotice(0)).toBe('On-demand')
  })

  it('returns "Same day" for booking_type 1', () => {
    expect(bookingTypeToAdvanceNotice(1)).toBe('Same day')
  })

  it('returns "More than 24 hours" for booking_type 2', () => {
    expect(bookingTypeToAdvanceNotice(2)).toBe('More than 24 hours')
  })

  it('returns "Same day" as default for unknown booking_type', () => {
    expect(bookingTypeToAdvanceNotice(99)).toBe('Same day')
    expect(bookingTypeToAdvanceNotice(-1)).toBe('Same day')
  })
})

describe('getFlexAdvanceNotice', () => {
  it('uses pickup booking rule when available', () => {
    const feature = createFlexFeature({
      pickup_booking_rules: [{ booking_rule_id: 'rule-1', booking_type: 0 }],
    })
    expect(getFlexAdvanceNotice(feature)).toBe('On-demand')
  })

  it('falls back to dropoff booking rule when no pickup rule', () => {
    const feature = createFlexFeature({
      pickup_booking_rules: [],
      drop_off_booking_rules: [{ booking_rule_id: 'rule-1', booking_type: 2 }],
    })
    expect(getFlexAdvanceNotice(feature)).toBe('More than 24 hours')
  })

  it('returns "Same day" when no booking rules exist', () => {
    const feature = createFlexFeature({
      pickup_booking_rules: [],
      drop_off_booking_rules: [],
    })
    expect(getFlexAdvanceNotice(feature)).toBe('Same day')
  })

  it('uses first pickup rule when multiple exist', () => {
    const feature = createFlexFeature({
      pickup_booking_rules: [
        { booking_rule_id: 'rule-1', booking_type: 0 },
        { booking_rule_id: 'rule-2', booking_type: 2 },
      ],
    })
    expect(getFlexAdvanceNotice(feature)).toBe('On-demand')
  })
})

describe('getFlexAgencyName', () => {
  it('returns first agency name', () => {
    const feature = createFlexFeature({
      agencies: [
        { agency_id: 'a1', agency_name: 'Agency One' },
        { agency_id: 'a2', agency_name: 'Agency Two' },
      ],
    })
    expect(getFlexAgencyName(feature)).toBe('Agency One')
  })

  it('returns "Unknown Agency" when no agencies', () => {
    const feature = createFlexFeature({ agencies: [] })
    expect(getFlexAgencyName(feature)).toBe('Unknown Agency')
  })

  it('returns "Unknown Agency" when agencies is undefined', () => {
    const feature = createFlexFeature()
    // @ts-expect-error - Testing undefined case
    feature.properties.agencies = undefined
    expect(getFlexAgencyName(feature)).toBe('Unknown Agency')
  })
})

describe('getFlexAgencyNames', () => {
  it('returns all agency names', () => {
    const feature = createFlexFeature({
      agencies: [
        { agency_id: 'a1', agency_name: 'Agency One' },
        { agency_id: 'a2', agency_name: 'Agency Two' },
      ],
    })
    expect(getFlexAgencyNames(feature)).toEqual(['Agency One', 'Agency Two'])
  })

  it('returns empty array when no agencies', () => {
    const feature = createFlexFeature({ agencies: [] })
    expect(getFlexAgencyNames(feature)).toEqual([])
  })
})

describe('isBookingAvailableOnDay', () => {
  const weekdaysOnly: FlexBookingDays = {
    sunday: false,
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true,
    saturday: false,
  }

  it('returns true when booking is available on the specified day', () => {
    const feature = createFlexFeature({ booking_days: weekdaysOnly })
    expect(isBookingAvailableOnDay(feature, 1)).toBe(true) // Monday
    expect(isBookingAvailableOnDay(feature, 5)).toBe(true) // Friday
  })

  it('returns false when booking is not available on the specified day', () => {
    const feature = createFlexFeature({ booking_days: weekdaysOnly })
    expect(isBookingAvailableOnDay(feature, 0)).toBe(false) // Sunday
    expect(isBookingAvailableOnDay(feature, 6)).toBe(false) // Saturday
  })

  it('returns true when no booking_days info exists', () => {
    const feature = createFlexFeature({ booking_days: undefined })
    expect(isBookingAvailableOnDay(feature, 0)).toBe(true)
    expect(isBookingAvailableOnDay(feature, 3)).toBe(true)
  })

  it('throws error for invalid weekday values', () => {
    const feature = createFlexFeature({ booking_days: weekdaysOnly })
    expect(() => isBookingAvailableOnDay(feature, -1)).toThrow('Invalid weekday')
    expect(() => isBookingAvailableOnDay(feature, 7)).toThrow('Invalid weekday')
    expect(() => isBookingAvailableOnDay(feature, 100)).toThrow('Invalid weekday')
  })
})

describe('isBookingAvailableToday', () => {
  it('uses current day of week', () => {
    const allDays: FlexBookingDays = {
      sunday: true,
      monday: true,
      tuesday: true,
      wednesday: true,
      thursday: true,
      friday: true,
      saturday: true,
    }
    const feature = createFlexFeature({ booking_days: allDays })
    // Should always return true since all days are enabled
    expect(isBookingAvailableToday(feature)).toBe(true)
  })
})

describe('formatBookingDays', () => {
  it('returns "Any day" for undefined booking days', () => {
    expect(formatBookingDays(undefined)).toBe('Any day')
  })

  it('returns "Any day" when all days are available', () => {
    const allDays: FlexBookingDays = {
      sunday: true,
      monday: true,
      tuesday: true,
      wednesday: true,
      thursday: true,
      friday: true,
      saturday: true,
    }
    expect(formatBookingDays(allDays)).toBe('Any day')
  })

  it('returns "Mon-Fri" for weekdays only', () => {
    const weekdays: FlexBookingDays = {
      sunday: false,
      monday: true,
      tuesday: true,
      wednesday: true,
      thursday: true,
      friday: true,
      saturday: false,
    }
    expect(formatBookingDays(weekdays)).toBe('Mon-Fri')
  })

  it('returns "Sat-Sun" for weekends only', () => {
    const weekend: FlexBookingDays = {
      sunday: true,
      monday: false,
      tuesday: false,
      wednesday: false,
      thursday: false,
      friday: false,
      saturday: true,
    }
    expect(formatBookingDays(weekend)).toBe('Sat-Sun')
  })

  it('returns comma-separated days for non-consecutive days', () => {
    const mixedDays: FlexBookingDays = {
      sunday: false,
      monday: true,
      tuesday: false,
      wednesday: true,
      thursday: false,
      friday: true,
      saturday: false,
    }
    expect(formatBookingDays(mixedDays)).toBe('Mon, Wed, Fri')
  })

  it('returns "No days" when no days are available', () => {
    const noDays: FlexBookingDays = {
      sunday: false,
      monday: false,
      tuesday: false,
      wednesday: false,
      thursday: false,
      friday: false,
      saturday: false,
    }
    expect(formatBookingDays(noDays)).toBe('No days')
  })
})

describe('flexAreaMatchesFilters', () => {
  // PU-only, On-demand area for filter targeting
  const puOnDemand = createFlexFeature({
    pickup_available: true,
    drop_off_available: false,
    pickup_booking_rules: [{ booking_rule_id: 'r1', booking_type: 0 }],
  })

  it('matches everything when no criteria are set', () => {
    expect(flexAreaMatchesFilters(puOnDemand, {})).toBe(true)
  })

  it('matches when the area type is in the area-type filter', () => {
    expect(flexAreaMatchesFilters(puOnDemand, { areaTypes: ['PU only'] })).toBe(true)
  })

  it('does not match when the area type is excluded by the area-type filter', () => {
    expect(flexAreaMatchesFilters(puOnDemand, { areaTypes: ['DO only'] })).toBe(false)
  })

  it('matches when the advance notice is in the filter', () => {
    expect(flexAreaMatchesFilters(puOnDemand, { advanceNotice: ['On-demand'] })).toBe(true)
  })

  it('does not match when the advance notice is excluded', () => {
    expect(flexAreaMatchesFilters(puOnDemand, { advanceNotice: ['Same day'] })).toBe(false)
  })

  it('ignores invalid filter values (treated as no match against a real type)', () => {
    // An all-invalid selection filters down to an empty list, which matches nothing.
    expect(flexAreaMatchesFilters(puOnDemand, { areaTypes: ['not-a-type'] })).toBe(false)
  })

  it('does not match when the area time window is outside the user window', () => {
    const area = createFlexFeature({ time_window_start: 100, time_window_end: 200 })
    expect(flexAreaMatchesFilters(area, { startSeconds: 500, endSeconds: 600 })).toBe(false)
  })

  it('matches when the time windows overlap', () => {
    const area = createFlexFeature({ time_window_start: 100, time_window_end: 200 })
    expect(flexAreaMatchesFilters(area, { startSeconds: 150, endSeconds: 600 })).toBe(true)
  })

  it('does not apply the time filter unless both start and end are set', () => {
    const area = createFlexFeature({ time_window_start: 100, time_window_end: 200 })
    expect(flexAreaMatchesFilters(area, { startSeconds: 500 })).toBe(true)
  })

  it('matches when the area declares no time window even if the user set one', () => {
    expect(flexAreaMatchesFilters(puOnDemand, { startSeconds: 500, endSeconds: 600 })).toBe(true)
  })
})
