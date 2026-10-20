import { describe, it, expect } from 'vitest'
import { chooseNearName, chooseStopName, cleanStopName, isStreetDescription, type NamedStop } from './cluster-names'

// Cases drawn from live stop names at Oregon and Washington hubs.
function stops (...rows: [string, string][]): NamedStop[] {
  return rows.map(([name, feedOnestopId]) => ({ name, feedOnestopId }))
}

describe('cleanStopName', () => {
  it('drops bays, zones, platforms, directions, and bracketed notes', () => {
    expect(cleanStopName('Everett Station Bay C1')).toBe('Everett Station')
    expect(cleanStopName('EVERETT STATION - E1')).toBe('EVERETT STATION')
    expect(cleanStopName('EVERETT STATION - F1 - SB')).toBe('EVERETT STATION')
    expect(cleanStopName('Tacoma Dome Station - Zone H')).toBe('Tacoma Dome Station')
    expect(cleanStopName('Eugene Station, Bay B')).toBe('Eugene Station')
    expect(cleanStopName('Downtown Transit Center/City Hall [Shelter]')).toBe('Downtown Transit Center/City Hall')
  })
})

describe('isStreetDescription', () => {
  it('recognizes intersections and side-of-street notes', () => {
    expect(isStreetDescription('4th Ave S & S Jackson St')).toBe(true)
    expect(isStreetDescription('W Riverside Ave/N Howard St')).toBe(true)
    expect(isStreetDescription('E/S of Olive S of 10th')).toBe(true)
  })

  it('leaves place names alone, slashes included', () => {
    expect(isStreetDescription('Downtown Transit Center/City Hall')).toBe(false)
    expect(isStreetDescription('Int\'l Dist/Chinatown')).toBe(false)
    expect(isStreetDescription('Portland Union Station')).toBe(false)
  })
})

describe('chooseStopName', () => {
  it('counts one vote per feed and merges word order and punctuation', () => {
    const name = chooseStopName(stops(
      ['Union Station Portland', 'shuttle'],
      ['Portland Union Station', 'intercity'],
      ['Portland Union Station', 'intercity'],
      ['Portland Union Station', 'pacificcrest'],
      ['Union Station, Portland', 'tillamook'],
      ['Portland Amtrak Station', 'intercity'],
    ))
    expect(name).toEqual({ name: 'Portland Union Station', feeds: 4, rank: 0 })
  })

  it('prefers a place name over a one-word city name', () => {
    expect(chooseStopName(stops(
      ['Tacoma', 'intercity'],
      ['Tacoma', 'nwsl'],
      ['Tacoma Dome Station - Zone H', 'piercetransit'],
      ['Tacoma (G St & Puyallup Ave)', 'flixbus'],
    ))?.name).toBe('Tacoma Dome Station')
  })

  it('prefers a place name over street corners, whatever the count', () => {
    expect(chooseStopName(stops(
      ['5th Ave S & S Weller St', 'metro'],
      ['Int\'l Dist/Chinatown', 'soundtransit'],
    ))?.name).toBe('Int\'l Dist/Chinatown')
  })

  it('falls back to a street corner when that is all there is', () => {
    expect(chooseStopName(stops(
      ['2nd Ave & James St', 'metro'],
      ['2nd Ave & James St', 'piercetransit'],
    ))).toEqual({ name: '2nd Ave & James St', feeds: 2, rank: 2 })
  })

  it('takes the shorter name on a tie, and mixed case over capitals', () => {
    expect(chooseStopName(stops(
      ['Wenatchee Columbia Station', 'linktransit'],
      ['Link Transit Columbia Station - Wenatchee', 'intercity'],
    ))?.name).toBe('Wenatchee Columbia Station')
    expect(chooseStopName(stops(
      ['EVERETT STATION - D2', 'everetttransit'],
      ['Everett Station', 'communitytransit'],
    ))?.name).toBe('Everett Station')
  })
})

describe('chooseNearName', () => {
  const curb = stops(
    ['Portland Curbside Bus Stop', 'intercity'],
    ['Portland Flix/Greyhound', 'intercity'],
    ['Portland Flix/Greyhound', 'pacificcrest'],
    ['Portland Curbside Bus Stop', 'flixbus'],
  )
  const unionStation = stops(
    ['Portland Union Station', 'intercity'],
    ['Portland Union Station', 'pacificcrest'],
    ['Union Station, Portland', 'tillamook'],
    ['Portland (Union Station)', 'nwsl'],
    ['NW 9th & Lovejoy', 'trimet'],
  )

  it('names the better-known place next door', () => {
    expect(chooseNearName(chooseStopName(curb), curb, unionStation)).toBe('Portland Union Station')
  })

  it('says nothing when the cluster already has the stronger name', () => {
    expect(chooseNearName(chooseStopName(unionStation), unionStation, curb)).toBeUndefined()
  })

  it('names a place near a cluster called for a street corner', () => {
    const corner = stops(['2nd Ave Ext S & S Jackson St', 'metro'], ['2nd Ave Ext & Jackson St S', 'piercetransit'])
    const amtrak = stops(['Seattle (Amtrak)', 'intercity'], ['Seattle (Amtrak)', 'nwsl'])
    expect(chooseNearName(chooseStopName(corner), corner, amtrak)).toBe('Seattle (Amtrak)')
  })

  it('needs two feeds to agree on the nearby place', () => {
    const corner = stops(['Broadway & 34th St', 'everetttransit'], ['Broadway & 34th St', 'communitytransit'])
    expect(chooseNearName(chooseStopName(corner), corner, stops(['Everett Station', 'communitytransit']))).toBeUndefined()
  })
})
