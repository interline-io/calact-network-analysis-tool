/**
 * Naming stop clusters from their stops' GTFS names.
 *
 * A cluster's name is always one of its stops' own values, exactly as the
 * agency published it; the logic only chooses which field to read and whose
 * value to show, and never edits a name. Fields, in order: the stop's parent
 * station name (`parent_station`'s `stop_name`), where a feed models the hub as
 * a station, then the stop's own `stop_name`.
 *
 * Among the values: a place name before a one-word name (a city, as intercity
 * carriers name stops) before a street description ("A & B", "E/S of A"); then
 * the value the most distinct feeds use, so one agency's many bays do not
 * outvote the others; then the shorter. Worked out against live stop names at
 * hubs across Oregon and Washington.
 */

import { CLUSTER_NEAR_MIN_FEEDS } from '~~/src/core'

export interface NamedStop {
  // GTFS stop_name.
  name: string
  // The parent station's stop_name, where the feed gives the stop a parent.
  parentName?: string
  feedOnestopId: string
}

export interface ClusterNameChoice {
  name: string
  // Distinct feeds that use this value.
  feeds: number
  // 0 a place name, 1 a one-word name, 2 a street description.
  rank: number
}

// The value a stop names its place by: its station's name if it has one.
function stopValue (stop: NamedStop): string {
  return stop.parentName || stop.name
}

// A street position rather than a place: an intersection ("A & B", "A @ B")
// or a side-of-street note ("E/S of A"). Read only, to rank; a misjudged name
// only loses to another of the stops' own names.
export function isStreetDescription (name: string): boolean {
  return /&|\s@\s|\sand\s|\b[nsew]\/s\b|\s[nsew]\s+of\s/i.test(name)
}

function nameRank (name: string): number {
  if (isStreetDescription(name)) {
    return 2
  }
  return name.trim().split(/\s+/).length === 1 ? 1 : 0
}

/**
 * The stops' best value, verbatim. Undefined when no stop has a name, or no
 * value has `minFeeds` feeds behind it.
 */
export function chooseStopName (stops: NamedStop[], minFeeds = 1): ClusterNameChoice | undefined {
  const feedsByValue = new Map<string, Set<string>>()
  for (const stop of stops) {
    const value = stopValue(stop)
    if (!value) {
      continue
    }
    const feeds = feedsByValue.get(value) || new Set<string>()
    feeds.add(stop.feedOnestopId)
    feedsByValue.set(value, feeds)
  }
  const ranked = [...feedsByValue]
    .map(([name, feeds]) => ({ name, feeds: feeds.size, rank: nameRank(name) }))
    .filter(c => c.feeds >= minFeeds)
    .sort((a, b) => a.rank - b.rank || b.feeds - a.feeds || a.name.length - b.name.length || a.name.localeCompare(b.name))
  return ranked[0]
}

/**
 * A better-known place just outside the cluster, for "near …": the best value
 * among stops near the cluster that are not its members and do not share a
 * member's value, where at least CLUSTER_NEAR_MIN_FEEDS feeds use it and it is
 * a place name. Given only where it says more than the cluster's own name: more
 * feeds use it, or the cluster's own name is a lesser kind (a city, a street
 * corner). So the intercity curb beside Portland Union Station is near Union
 * Station, while Union Station itself is near nothing.
 */
export function chooseNearName (
  own: ClusterNameChoice | undefined,
  memberStops: NamedStop[],
  nearbyStops: NamedStop[],
): string | undefined {
  const memberValues = new Set(memberStops.map(stopValue))
  const near = chooseStopName(nearbyStops.filter(s => !memberValues.has(stopValue(s))), CLUSTER_NEAR_MIN_FEEDS)
  if (!near || near.rank > 0) {
    return undefined
  }
  if (own && near.feeds <= own.feeds && own.rank === 0) {
    return undefined
  }
  return near.name
}

// A cluster as the app names it: its own name, and the place it is near.
export function clusterDisplayName (name: string, nearName?: string): string {
  return nearName ? `${name}, near ${nearName}` : name
}
