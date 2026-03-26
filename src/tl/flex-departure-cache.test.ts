import { describe, it, expect } from 'vitest'
import { FlexDepartureCache } from './flex-departure-cache'

describe('FlexDepartureCache', () => {
  it('returns false for unknown locationId', () => {
    const cache = new FlexDepartureCache()
    expect(cache.hasService(1, '2024-01-15')).toBe(false)
  })

  it('returns false for a known location on a date with no service', () => {
    const cache = new FlexDepartureCache()
    cache.add(1, '2024-01-15')
    expect(cache.hasService(1, '2024-01-16')).toBe(false)
  })

  it('returns true after adding a location+date pair', () => {
    const cache = new FlexDepartureCache()
    cache.add(42, '2024-01-15')
    expect(cache.hasService(42, '2024-01-15')).toBe(true)
  })

  it('tracks multiple dates independently for the same location', () => {
    const cache = new FlexDepartureCache()
    cache.add(1, '2024-01-15')
    cache.add(1, '2024-01-22')
    expect(cache.hasService(1, '2024-01-15')).toBe(true)
    expect(cache.hasService(1, '2024-01-22')).toBe(true)
    expect(cache.hasService(1, '2024-01-16')).toBe(false)
  })

  it('tracks multiple locations independently', () => {
    const cache = new FlexDepartureCache()
    cache.add(1, '2024-01-15')
    cache.add(2, '2024-01-16')
    expect(cache.hasService(1, '2024-01-15')).toBe(true)
    expect(cache.hasService(2, '2024-01-16')).toBe(true)
    // locations don't bleed into each other
    expect(cache.hasService(1, '2024-01-16')).toBe(false)
    expect(cache.hasService(2, '2024-01-15')).toBe(false)
  })

  it('is idempotent: adding the same pair twice does not cause errors', () => {
    const cache = new FlexDepartureCache()
    cache.add(1, '2024-01-15')
    cache.add(1, '2024-01-15')
    expect(cache.hasService(1, '2024-01-15')).toBe(true)
  })
})
