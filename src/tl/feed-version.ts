import { gql } from 'graphql-tag'

export interface FeedVersion {
  id: string
  sha1: string
  feed: {
    id: number
    onestop_id: string
  }
}

export const feedVersionQuery = gql`
query ($where: FeedFilter, $limit: Int, $after: Int) {
  feeds(where: $where, limit: $limit, after: $after) {
    id
    onestop_id
    feed_state {
      feed_version {
        id
        sha1
        feed {
          id
          onestop_id
        }
      }
    }
  }
}`

export interface FeedGql {
  id: string
  onestop_id: string
  feed_state: {
    feed_version: FeedVersion | null
  } | null
}

// Hardcoded denylist of feeds with broken bbox metadata that pollute
// otherwise-unrelated bbox queries (their reported geometry covers far more
// area than the actual service). Apply this in any flow that consumes the
// bbox-feeds query — picker and scenario fetcher — so users never see them.
export const HIDDEN_FEED_ONESTOP_IDS: ReadonlySet<string> = new Set([
  'f-r6-nswtrainlink~sydneytrains~buswayswesternsydney~interlinebus',
])

// Batched lookup for the picker overrides — fetches the explicit feed
// version ids the user picked so the scenario fetcher knows their sha1s.
export const feedVersionsByIdsQuery = gql`
query ($ids: [Int!]) {
  feed_versions(ids: $ids) {
    id
    sha1
    feed {
      id
      onestop_id
    }
  }
}`

// --- Feed version browser (used by the picker on the Query tab) ---

// Per-day seconds of scheduled service for one week of a FV.
export interface FeedVersionServiceLevelRow {
  start_date: string
  end_date: string
  monday: number
  tuesday: number
  wednesday: number
  thursday: number
  friday: number
  saturday: number
  sunday: number
}

export interface FeedVersionGtfsImportRow {
  id: number
  in_progress: boolean
  success: boolean
  exception_log: string
  entity_count: Record<string, number> | null
  warning_count: Record<string, number> | null
  created_at: string | null
  updated_at: string | null
}

export interface FeedVersionServiceWindow {
  feed_start_date: string | null
  feed_end_date: string | null
  earliest_calendar_date: string | null
  latest_calendar_date: string | null
  fallback_week: string | null
  default_timezone: string | null
}

export interface FeedVersionDetail {
  id: number
  sha1: string
  fetched_at: string
  name: string | null
  earliest_calendar_date: string
  latest_calendar_date: string
  service_window: FeedVersionServiceWindow | null
  service_levels: FeedVersionServiceLevelRow[]
  feed_version_gtfs_import: FeedVersionGtfsImportRow | null
}

export interface FeedWithVersions {
  id: number
  onestop_id: string
  name: string | null
  spec: string | null
  feed_state: {
    feed_version: {
      id: number
      agencies: { agency_name: string }[]
    } | null
  } | null
  feed_versions: FeedVersionDetail[]
}

// Browse feeds in a bbox, their candidate feed versions overlapping a date
// window, plus weekly service-level rows for an in-page timeline. `covers`
// is intentionally NOT applied to feed_versions so operators can see FVs
// that *almost* cover the window and choose to import one regardless. The
// service_levels date filter is also disabled for now while we diagnose
// why filtered queries return no rows on the demo DB.
export const feedsForImportQuery = gql`
query ($bbox: BoundingBox!) {
  feeds(limit: 100, where: { bbox: $bbox, spec: [GTFS] }) {
    id
    onestop_id
    name
    spec
    feed_state {
      feed_version {
        id
        agencies { agency_name }
      }
    }
    feed_versions(limit: 10) {
      id
      sha1
      fetched_at
      name
      earliest_calendar_date
      latest_calendar_date
      service_window {
        feed_start_date
        feed_end_date
        earliest_calendar_date
        latest_calendar_date
        fallback_week
        default_timezone
      }
      service_levels(limit: 1000) {
        start_date
        end_date
        monday
        tuesday
        wednesday
        thursday
        friday
        saturday
        sunday
      }
      feed_version_gtfs_import {
        id
        in_progress
        success
        exception_log
        entity_count
        warning_count
        created_at
        updated_at
      }
    }
  }
}`

// Returns true if any day in [start, end] (inclusive) has > 0 seconds of
// scheduled service in the FV's weekly service_levels rows. start/end are
// 'YYYY-MM-DD' strings; comparisons are string-based to dodge TZ drift.
// FVs with empty service_levels return false (e.g. unimported FVs).
export function feedVersionHasServiceInRange (
  rows: FeedVersionServiceLevelRow[] | null | undefined,
  start: string,
  end: string
): boolean {
  return feedVersionServiceSecondsInRange(rows, start, end) > 0
}

// Sums all scheduled service seconds in [start, end] (inclusive) across a
// FV's weekly service_levels rows. Used both for the empty-FV filter and as
// a sort key for ordering feeds by total in-window activity.
export function feedVersionServiceSecondsInRange (
  rows: FeedVersionServiceLevelRow[] | null | undefined,
  start: string,
  end: string
): number {
  if (!rows || rows.length === 0) { return 0 }
  const dayCols: (keyof FeedVersionServiceLevelRow)[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  let total = 0
  for (const r of rows) {
    const startIso = (r.start_date || '').slice(0, 10)
    if (!startIso) { continue }
    const startOrd = isoToOrdinalDays(startIso)
    for (let i = 0; i < 7; i++) {
      const seconds = r[dayCols[i]!] as number
      if (seconds <= 0) { continue }
      const dayIso = ordinalDaysToIso(startOrd + i)
      if (dayIso >= start && dayIso <= end) { total += seconds }
    }
  }
  return total
}

function isoToOrdinalDays (iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
}

function ordinalDaysToIso (ord: number): string {
  const dt = new Date(ord * 86_400_000)
  const y = dt.getUTCFullYear()
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const d = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// --- fvids URL param ---
//
// The /tne Query tab's picker modal persists explicit feed version picks
// (and per-feed excludes) in a single CSV-shaped URL param:
//
//   ?fvids=onestop_id:fv_id,onestop_id:fv_id,onestop_id:0
//
// Per token:
//   - `osid:N`   (N > 0) — use feed version N for this feed.
//   - `osid:0`   — exclude this feed from the scenario.
//   - `osid`     — same as `osid:0` (compact exclude form).
// Tokens for feeds with no entry are absent: the scenario fetcher uses the
// feed's active feed version as before.

export interface ParsedFvids {
  picks: Map<string, number>
  excluded: Set<string>
}

export function parseFvids (raw: string | null | undefined): ParsedFvids {
  const picks = new Map<string, number>()
  const excluded = new Set<string>()
  if (!raw) { return { picks, excluded } }
  for (const tok of raw.split(',')) {
    const trimmed = tok.trim()
    if (!trimmed) { continue }
    const [osidRaw, fvidRaw] = trimmed.split(':')
    const osid = (osidRaw || '').trim()
    if (!osid) { continue }
    const fvid = parseInt((fvidRaw || '').trim(), 10)
    if (!fvid || fvid <= 0 || !Number.isFinite(fvid)) {
      // Exclude wins over any earlier pick for the same osid; later tokens
      // override earlier ones so URLs can be merged without re-parsing.
      excluded.add(osid)
      picks.delete(osid)
    } else {
      picks.set(osid, fvid)
      excluded.delete(osid)
    }
  }
  return { picks, excluded }
}

// Pure projection used by the scenario fetcher to turn the bbox-derived feed
// list + picker overrides into the concrete list of feed versions to pull.
// `overrideById` is the result of the batched lookup keyed by fv_id.
//
// Drops feeds in `excluded`. For remaining feeds: when an override exists it
// substitutes that FV; otherwise falls back to the feed's active FV. Feeds
// with no active FV and no resolvable override are dropped silently. Picks
// that point at FVs the API didn't return (deleted? wrong feed?) are surfaced
// in `missing` so the caller can warn the user — silent drop would be a bad
// UX since the user explicitly picked them.
export interface AppliedFeedVersions {
  feedVersions: FeedVersion[]
  // (onestop_id, fv_id) pairs the user picked but couldn't be resolved.
  missing: { onestop_id: string, fv_id: number }[]
}

export function applyFeedVersionOverrides (
  allFeeds: FeedGql[],
  overrides: Map<string, number>,
  excluded: Set<string>,
  overrideById: Map<number, FeedVersion>
): AppliedFeedVersions {
  const feedVersions: FeedVersion[] = []
  const missing: { onestop_id: string, fv_id: number }[] = []
  for (const f of allFeeds) {
    if (excluded.has(f.onestop_id)) { continue }
    const overrideId = overrides.get(f.onestop_id)
    if (overrideId != null) {
      const fv = overrideById.get(overrideId)
      if (fv) {
        feedVersions.push(fv)
      } else {
        missing.push({ onestop_id: f.onestop_id, fv_id: overrideId })
      }
      continue
    }
    const active = f.feed_state?.feed_version
    if (active) { feedVersions.push(active) }
  }
  return { feedVersions, missing }
}

export function serializeFvids (parsed: ParsedFvids): string {
  const tokens: string[] = []
  // Sort keys for stable URL output — avoids needless history churn when
  // picks shuffle.
  const pickKeys = [...parsed.picks.keys()].sort()
  for (const osid of pickKeys) {
    if (parsed.excluded.has(osid)) { continue }
    tokens.push(`${osid}:${parsed.picks.get(osid)}`)
  }
  const excludeKeys = [...parsed.excluded].sort()
  for (const osid of excludeKeys) {
    tokens.push(`${osid}:0`)
  }
  return tokens.join(',')
}

export type FeedVersionImportStatus = 'not_imported' | 'in_progress' | 'imported' | 'error'

// Reduce the gtfs_import row plus any in-flight job into a single badge state.
// `scheduleRemoved` is intentionally not surfaced — legacy state per project lead.
export function feedVersionImportStatus (
  gtfs: FeedVersionGtfsImportRow | null | undefined,
  hasActiveJob: boolean
): FeedVersionImportStatus {
  if (hasActiveJob) { return 'in_progress' }
  if (!gtfs) { return 'not_imported' }
  if (gtfs.in_progress) { return 'in_progress' }
  if (gtfs.success) { return 'imported' }
  return 'error'
}
