import { describe, it, expect } from 'vitest'
import { censusGeographyName, censusGeographyStateName, sortCensusLayerOptions } from './census-layers'

describe('sortCensusLayerOptions', () => {
  it('lists layers from smallest to largest, unknown ones last by label', () => {
    const options = [
      { value: 'uac20', label: 'Urban Area (2020)' },
      { value: 'cbsa', label: 'Core-Based Statistical Area (CBSA)' },
      { value: 'zcta520', label: 'ZIP Code (ZCTA, 2020)' },
      { value: 'csa', label: 'Combined Statistical Area (CSA)' },
      { value: 'state', label: 'State' },
      { value: 'county', label: 'County' },
      { value: 'cd119', label: 'Congressional District (119th)' },
      { value: 'place', label: 'City / Place' },
      { value: 'tract', label: 'Census Tract' },
      { value: 'bg', label: 'Block Group' },
    ]
    expect(sortCensusLayerOptions(options).map(o => o.value)).toEqual([
      'bg',
      'tract',
      'place',
      'county',
      'uac20',
      'cbsa',
      'csa',
      'state',
      'cd119',
      'zcta520',
    ])
  })
})

describe('censusGeographyName', () => {
  it('names a tract by its number, whether the dataset holds it bare, long or not at all', () => {
    expect(censusGeographyName('tract', '1400000US41051005102', '51.02')).toBe('Census Tract 51.02')
    expect(censusGeographyName('tract', '1400000US41051005101', 'Census Tract 51.01')).toBe('Census Tract 51.01')
    expect(censusGeographyName('tract', '1400000US41051005102', '')).toBe('Census Tract 51.02')
  })

  it('drops the leading zeros and a .00 suffix from the tract number', () => {
    expect(censusGeographyName('tract', '1400000US41051010100', '')).toBe('Census Tract 101')
    expect(censusGeographyName('tract', '1400000US41051000100', '')).toBe('Census Tract 1')
    expect(censusGeographyName('tract', '1400000US41051980000', '')).toBe('Census Tract 9800')
  })

  it('names a block group with its tract', () => {
    expect(censusGeographyName('bg', '1500000US410510051021', '')).toBe('Block Group 1, Census Tract 51.02')
    expect(censusGeographyName('bg', '1500000US410510051012', 'Block Group 2')).toBe('Block Group 2, Census Tract 51.01')
  })

  it('takes a bare FIPS code as well as the summary-level form', () => {
    expect(censusGeographyName('bg', '410510051021', null)).toBe('Block Group 1, Census Tract 51.02')
  })

  it('keeps the name of any other layer', () => {
    expect(censusGeographyName('county', '0500000US41051', 'Multnomah')).toBe('Multnomah')
    expect(censusGeographyName('place', '1600000US4159000', 'Portland')).toBe('Portland')
  })

  it('keeps the name when the GEOID is not a tract or block group FIPS code', () => {
    expect(censusGeographyName('tract', 'custom-7', 'Downtown')).toBe('Downtown')
    expect(censusGeographyName(undefined, '1400000US41051005102', '51.02')).toBe('51.02')
  })

  it('falls back to the GEOID when there is no name', () => {
    expect(censusGeographyName('place', '1600000US4159000', '')).toBe('1600000US4159000')
  })
})

describe('censusGeographyStateName', () => {
  it('adds the state', () => {
    expect(censusGeographyStateName({
      geoid: '1500000US410510051021',
      name: '',
      layer: { name: 'bg' },
      adm1_name: 'Oregon',
    })).toBe('Block Group 1, Census Tract 51.02, Oregon')
  })

  it('leaves the state off when there is none', () => {
    expect(censusGeographyStateName({ geoid: '0500000US41051', name: 'Multnomah', layer: { name: 'county' } })).toBe('Multnomah')
  })
})
