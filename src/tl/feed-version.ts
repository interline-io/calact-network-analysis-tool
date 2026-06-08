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

// Intercity / charter feeds that match many bboxes but rarely match user
// intent. Sorted last in the picker so they don't crowd local agencies.
export const DEPRIORITIZED_FEED_ONESTOP_IDS: ReadonlySet<string> = new Set([
  'f-9-flixbus',
  'f-utel~uiuc~intercity~bus',
  'f-9-amtrak~amtrakcalifornia~amtrakcharteredvehicle',
])

// Batched lookup for the picker overrides — fetches the explicit feed
// version ids the user picked so the scenario fetcher knows their sha1s.
// Also carries display fields (fetched_at, calendar range, names) so the
// Query panel's override summary can describe each pick without a second
// query; the scenario-side consumer just ignores the extras.
export const feedVersionsByIdsQuery = gql`
query ($ids: [Int!]) {
  feed_versions(ids: $ids) {
    id
    sha1
    fetched_at
    name
    earliest_calendar_date
    latest_calendar_date
    feed {
      id
      onestop_id
      name
    }
  }
}`

// Response row of feedVersionsByIdsQuery with the display fields included.
// Calendar dates are nullable — a feed version with no calendar entries (e.g.
// a flex-only or empty feed) returns null for both.
export interface FeedVersionSummaryRow extends FeedVersion {
  fetched_at: string
  name: string | null
  earliest_calendar_date: string | null
  latest_calendar_date: string | null
  feed: {
    id: number
    onestop_id: string
    name: string | null
  }
}

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

// `covers` is intentionally NOT applied so operators can see FVs that almost
// cover and import one anyway.
//
// service_levels filter is overlap-via-swap: server treats
// where.start_date as `row.start_date <= X` and where.end_date as
// `row.end_date >= Y`, so callers pass windowEnd → start_date and
// windowStart → end_date to get rows overlapping [windowStart, windowEnd].
// See transitland-lib/server/finders/dbfinder/feed_version.go.
export const feedsForImportQuery = gql`
query ($bbox: BoundingBox!, $serviceLevelStart: Date, $serviceLevelEnd: Date) {
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
      service_levels(limit: 1000, where: { start_date: $serviceLevelStart, end_date: $serviceLevelEnd }) {
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

// start/end are YYYY-MM-DD strings — string compare dodges TZ drift.
export function feedVersionHasServiceInRange (
  rows: FeedVersionServiceLevelRow[] | null | undefined,
  start: string,
  end: string
): boolean {
  return feedVersionServiceSecondsInRange(rows, start, end) > 0
}

export const SERVICE_LEVEL_DAY_COLS: ReadonlyArray<keyof FeedVersionServiceLevelRow> = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
]

export function feedVersionServiceSecondsInRange (
  rows: FeedVersionServiceLevelRow[] | null | undefined,
  start: string,
  end: string
): number {
  if (!rows || rows.length === 0) { return 0 }
  let total = 0
  for (const r of rows) {
    const startIso = (r.start_date || '').slice(0, 10)
    const endIso = (r.end_date || '').slice(0, 10)
    if (!startIso || !endIso) { continue }
    if (endIso < start || startIso > end) { continue }
    const startOrd = isoToOrdinal(startIso)
    const endOrd = isoToOrdinal(endIso)
    // Mon=0..Sun=6 column index of the row's start_date.
    let weekday = (new Date(startOrd * 86_400_000).getUTCDay() + 6) % 7
    for (let ord = startOrd; ord <= endOrd; ord++) {
      const seconds = r[SERVICE_LEVEL_DAY_COLS[weekday]!] as number
      if (seconds > 0) {
        const dayIso = ordinalToIso(ord)
        if (dayIso >= start && dayIso <= end) { total += seconds }
      }
      weekday = (weekday + 1) % 7
    }
  }
  return total
}

export function maxServiceSecondsPerDay (rows: FeedVersionServiceLevelRow[] | null | undefined): number {
  if (!rows || rows.length === 0) { return 0 }
  let max = 0
  for (const r of rows) {
    for (const col of SERVICE_LEVEL_DAY_COLS) {
      const v = r[col] as number
      if (v > max) { max = v }
    }
  }
  return max
}

export function isoToOrdinal (iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
}

export function ordinalToIso (ord: number): string {
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
      // Later tokens override earlier ones so URLs can be merged.
      excluded.add(osid)
      picks.delete(osid)
    } else {
      picks.set(osid, fvid)
      excluded.delete(osid)
    }
  }
  return { picks, excluded }
}

// Pure projection from bbox-derived feeds + picker state → concrete FVs.
// `missing` carries explicit picks the API didn't return so the caller can
// warn — silent drops would hide intent.
export interface AppliedFeedVersions {
  feedVersions: FeedVersion[]
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
  // Sorted output keeps URL stable across pick shuffles.
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

// Human-readable labels, shared by the import status badge and row tooltips
// so the wording can't drift between them.
export const FEED_VERSION_IMPORT_STATUS_LABELS: Record<FeedVersionImportStatus, string> = {
  imported: 'Imported',
  in_progress: 'In progress',
  error: 'Import error',
  not_imported: 'Not imported',
}

// Transient state for a feed-version-import/unimport job submitted in the
// current session — picker watches and propagates this down to the row so
// the UI tracks progress without a graphql refetch. `state` is the
// river/jobs API state string (queued, running, succeeded, failed,
// cancelled, ...). `kind` decides what a succeeded job means for the badge.
export type FeedVersionPendingJobKind = 'import' | 'unimport'
export interface FeedVersionPendingJob {
  jobId: string
  state: string
  kind: FeedVersionPendingJobKind
  // Populated on terminal failure so the button can show a tooltip without
  // a separate JobGet round-trip.
  errorMessage?: string
}

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

// A live pendingJob overrides the GraphQL-derived state so the UI tracks job
// progress without a refetch. `cancelled` falls through since nothing landed.
export function effectiveImportStatus (
  fv: FeedVersionDetail,
  pendingJob?: FeedVersionPendingJob | null
): FeedVersionImportStatus {
  if (pendingJob) {
    if (pendingJob.state === 'succeeded') {
      return pendingJob.kind === 'unimport' ? 'not_imported' : 'imported'
    }
    if (pendingJob.state === 'failed') { return 'error' }
    if (pendingJob.state !== 'cancelled') { return 'in_progress' }
  }
  return feedVersionImportStatus(fv.feed_version_gtfs_import, false)
}
