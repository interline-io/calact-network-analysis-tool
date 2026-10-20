import { describe, it, expect } from 'vitest'
import { chooseNearName, chooseStopName, isStreetDescription, type NamedStop } from './cluster-names'

// Cases drawn from live stop names at Oregon and Washington hubs.
function stops (...rows: ([string, string] | [string, string, string])[]): NamedStop[] {
  return rows.map(([name, feedOnestopId, parentName]) => ({ name, feedOnestopId, parentName }))
}

describe('isStreetDescription', () => {
  it('recognizes intersections and side-of-street notes', () => {
    expect(isStreetDescription('4th Ave S & S Jackson St')).toBe(true)
    expect(isStreetDescription('E/S of Olive S of 10th')).toBe(true)
  })

  it('leaves place names alone, slashes included', () => {
    expect(isStreetDescription('Downtown Transit Center/City Hall')).toBe(false)
    expect(isStreetDescription('Int\'l Dist/Chinatown')).toBe(false)
    expect(isStreetDescription('Portland Union Station')).toBe(false)
  })
})

describe('chooseStopName', () => {
  it('shows a stop\'s name exactly as the feed gives it', () => {
    expect(chooseStopName(stops(
      ['Tacoma Dome Station - Zone C', 'piercetransit'],
      ['Tacoma', 'intercity'],
    ))?.name).toBe('Tacoma Dome Station - Zone C')
  })

  it('counts one vote per feed, matching names exactly', () => {
    const name = chooseStopName(stops(
      ['Portland Union Station', 'intercity'],
      ['Portland Union Station', 'intercity'],
      ['Portland Union Station', 'pacificcrest'],
      ['Portland Union Station', 'cobreeze'],
      ['Union Station, Portland', 'tillamook'],
      ['Union Station, Portland', 'clatsop'],
    ))
    expect(name).toEqual({ name: 'Portland Union Station', feeds: 3, rank: 0 })
  })

  it('reads a stop\'s parent station name before its own', () => {
    expect(chooseStopName(stops(
      ['EVERETT STATION - D2', 'everetttransit', 'Everett Station'],
      ['Everett Station Bay C1', 'communitytransit', 'Everett Station'],
      ['Everett Bus Stop', 'flixbus'],
    ))).toEqual({ name: 'Everett Station', feeds: 2, rank: 0 })
  })

  it('prefers a place name to a one-word city name', () => {
    expect(chooseStopName(stops(
      ['Tacoma', 'intercity'],
      ['Tacoma', 'nwsl'],
      ['Tacoma Dome Station', 'soundtransit'],
    ))?.name).toBe('Tacoma Dome Station')
  })

  it('prefers a place name to street corners, whatever the count', () => {
    expect(chooseStopName(stops(
      ['4th Ave S & S Jackson St', 'metro'],
      ['4th Ave S & S Jackson St', 'communitytransit'],
      ['Seattle (Amtrak)', 'intercity'],
    ))?.name).toBe('Seattle (Amtrak)')
  })

  it('falls back to a street corner when that is all there is', () => {
    expect(chooseStopName(stops(
      ['2nd Ave & James St', 'metro'],
      ['2nd Ave & James St', 'piercetransit'],
    ))).toEqual({ name: '2nd Ave & James St', feeds: 2, rank: 2 })
  })

  it('takes the shorter of equally supported names', () => {
    expect(chooseStopName(stops(
      ['Portland Curbside Bus Stop', 'intercity'],
      ['Portland Curbside Bus Stop', 'flixbus'],
      ['Portland Flix/Greyhound', 'intercity'],
      ['Portland Flix/Greyhound', 'pacificcrest'],
    ))?.name).toBe('Portland Flix/Greyhound')
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
    ['Portland Union Station', 'cobreeze'],
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

  it('never says a cluster is near a street corner or a city', () => {
    const station = stops(['Tacoma Dome Station - Zone A', 'piercetransit'])
    expect(chooseNearName(chooseStopName(station), station, stops(['Tacoma', 'intercity'], ['Tacoma', 'nwsl']))).toBeUndefined()
    expect(chooseNearName(chooseStopName(station), station, stops(['E 26th St & D St', 'a'], ['E 26th St & D St', 'b']))).toBeUndefined()
  })

  it('needs two feeds to use the nearby name', () => {
    const corner = stops(['Broadway & 34th St', 'everetttransit'], ['Broadway & 34th St', 'communitytransit'])
    expect(chooseNearName(chooseStopName(corner), corner, stops(['Everett Station', 'communitytransit']))).toBeUndefined()
  })
})
