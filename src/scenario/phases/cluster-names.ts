/**
 * Naming stop clusters from their stops' names.
 *
 * Feeds rarely model a hub as a parent station with platforms; around Portland
 * Union Station, a dozen feeds each have a standalone stop, named their own way
 * ("Portland Union Station", "Union Station, Portland", "Portland (Union
 * Station)"). So a cluster takes the name its members' feeds most agree on,
 * rather than the name of whichever stop the cluster happens to center on.
 *
 * Tried against hubs across Oregon and Washington before settling on:
 * - one vote per feed, so one agency's many bays do not outvote the rest;
 * - a name said with a bay, zone, platform, or direction is the same name;
 * - a place name beats a one-word city name (as intercity carriers name their
 *   stops) and both beat a street description ("A & B", "E/S of A").
 */

export interface NamedStop {
  name: string
  feedOnestopId: string
}

export interface ClusterNameChoice {
  name: string
  // Distinct feeds that call the place this.
  feeds: number
  // 0 a place name, 1 a one-word name, 2 a street description.
  rank: number
}

// Without bracketed notes ("[Shelter]") and the bay, zone, platform, or
// direction a feed adds to a stop's name: "Everett Station Bay C1",
// "EVERETT STATION - E1", and "Everett Station - SB" are all Everett Station.
export function cleanStopName (name: string): string {
  return name
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s*[-,]?\s*\b(bay|zone|platform|gate|stall|track|berth)\s*[a-z]?\d*[a-z]?\b/gi, ' ')
    .replace(/\s+-\s+[a-z]?\d+[a-z]?\b/gi, ' ')
    .replace(/\s*-?\s*\b(nb|sb|eb|wb|northbound|southbound|eastbound|westbound)\b/gi, ' ')
    .replace(/\s+-\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Case, punctuation, and word order aside: "Union Station, Portland" and
// "Portland Union Station" are one name.
export function stopNameKey (name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9& ]+/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ')
}

const STREET_WORD = '(st|street|ave|avenue|rd|road|blvd|way|dr|drive|pl|place|ln|lane|hwy|highway|pkwy|parkway|ct)'
// "W Riverside Ave/N Howard St", but not "Downtown Transit Center/City Hall".
const SLASH_INTERSECTION = new RegExp(`\\b${STREET_WORD}\\.?\\s*/\\s*\\S.*\\b${STREET_WORD}\\b`, 'i')

// A street position rather than a place: an intersection ("A & B", "A and B",
// "A @ B", "A St/B Ave") or a side-of-street note ("E/S of Olive S of 10th").
export function isStreetDescription (name: string): boolean {
  return /&|\s@\s|\sand\s|\b[nsew]\/s\b|\s[nsew]\s+of\s/i.test(name) || SLASH_INTERSECTION.test(name)
}

export function stopNameRank (cleanName: string): number {
  if (isStreetDescription(cleanName)) {
    return 2
  }
  return stopNameKey(cleanName).split(' ').length === 1 ? 1 : 0
}

// A spelling in capitals reads as shouting next to one in mixed case.
function isAllCaps (s: string): boolean {
  return /[A-Z]/.test(s) && s === s.toUpperCase()
}

/**
 * The name most of the stops' feeds agree on: the best-ranked kind of name,
 * then the most feeds, then the fewest words; shown in its most common
 * spelling, preferring mixed case. Undefined when no stop has a name, or no
 * name has `minFeeds` feeds behind it.
 */
export function chooseStopName (stops: NamedStop[], minFeeds = 1): ClusterNameChoice | undefined {
  const groups = new Map<string, { words: number, rank: number, feeds: Set<string>, spellings: Map<string, number> }>()
  for (const stop of stops) {
    const clean = cleanStopName(stop.name)
    const key = stopNameKey(clean)
    if (!key) {
      continue
    }
    let g = groups.get(key)
    if (!g) {
      g = { words: key.split(' ').length, rank: stopNameRank(clean), feeds: new Set(), spellings: new Map() }
      groups.set(key, g)
    }
    g.feeds.add(stop.feedOnestopId)
    g.spellings.set(clean, (g.spellings.get(clean) || 0) + 1)
  }
  const best = [...groups.values()]
    .filter(g => g.feeds.size >= minFeeds)
    .sort((a, b) => a.rank - b.rank || b.feeds.size - a.feeds.size || a.words - b.words)[0]
  if (!best) {
    return undefined
  }
  const spelling = [...best.spellings]
    .sort((a, b) => Number(isAllCaps(a[0])) - Number(isAllCaps(b[0])) || b[1] - a[1] || a[0].length - b[0].length)[0]![0]
  return { name: spelling, feeds: best.feeds.size, rank: best.rank }
}

// Feeds that must agree on a nearby place before a cluster is said to be near it.
export const CLUSTER_NEAR_MIN_FEEDS = 2

/**
 * A better-known place just outside the cluster, for "near …": the place name
 * most feeds agree on among stops near the cluster that are not its members and
 * do not share its members' names. Given only where it says more than the
 * cluster's own name: more feeds agree on it, or the cluster's name is a street
 * description. So the intercity curb beside Portland Union Station is "near
 * Union Station, Portland", while Union Station itself is near nothing.
 */
export function chooseNearName (
  own: ClusterNameChoice | undefined,
  memberStops: NamedStop[],
  nearbyStops: NamedStop[],
): string | undefined {
  const memberKeys = new Set(memberStops.map(s => stopNameKey(cleanStopName(s.name))))
  const candidates = nearbyStops.filter((s) => {
    const clean = cleanStopName(s.name)
    return !memberKeys.has(stopNameKey(clean)) && stopNameRank(clean) === 0
  })
  const near = chooseStopName(candidates, CLUSTER_NEAR_MIN_FEEDS)
  if (!near) {
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
