import type { DataDisplayMode, PopupFeature } from '../../core'

// Cross-referencing between the map and the Reports tables (#44): "See on map"
// from a table row, and "See in data table" from a map popup or the census
// panel. Pure, so the page, the map and the report agree on what names a
// feature and which table it is a row of.

// The Reports tab's tables.
export type ReportTab = 'routes' | 'stops' | 'stops-aggregated' | 'stop-clusters' | 'agencies' | 'flex' | 'transfers'

// One feature, as both the map and a report table name it. A flex area's
// location_id is unique only within its feed, so it carries the feed too.
export type CrossrefTarget
  = | { kind: 'route', id: number }
    | { kind: 'stop', id: number }
    | { kind: 'cluster', id: string }
    | { kind: 'flex', feedOnestopId: string, locationId: string }
    | { kind: 'geography', geoid: string }

// A request to show a target, on the map or in a table. A new key asks again,
// so the same feature can be shown twice in a row.
export interface CrossrefRequest {
  target: CrossrefTarget
  key: number
}

// The table each kind of feature is a row of.
const TAB_BY_KIND: Record<CrossrefTarget['kind'], ReportTab> = {
  route: 'routes',
  stop: 'stops',
  cluster: 'stop-clusters',
  flex: 'flex',
  geography: 'stops-aggregated',
}

export function crossrefReportTab (target: CrossrefTarget): ReportTab {
  return TAB_BY_KIND[target.kind]
}

// A target as a string, the same one its table row gives (reportRowKey).
export function crossrefKey (target: CrossrefTarget): string {
  switch (target.kind) {
    case 'route':
    case 'stop':
    case 'cluster':
      return String(target.id)
    case 'flex':
      return `${target.feedOnestopId}:${target.locationId}`
    case 'geography':
      return target.geoid
  }
}

// A flex area by its feed and location id, as a table row, a map feature's
// properties and a popup all carry them.
export function flexTarget (feedOnestopId: unknown, locationId: unknown): CrossrefTarget | undefined {
  return feedOnestopId == null || feedOnestopId === '' || locationId == null
    ? undefined
    : { kind: 'flex', feedOnestopId: String(feedOnestopId), locationId: String(locationId) }
}

// A numeric id as a route or stop target.
function idTarget (kind: 'route' | 'stop', value: unknown): CrossrefTarget | undefined {
  const id = Number(value)
  return value == null || value === '' || !Number.isFinite(id) ? undefined : { kind, id }
}

// The target a table row names. Agencies have no one shape to show, and the
// Transfer Analyst is not a table of features, so their rows name none.
export function reportRowTarget (tab: ReportTab, row: Record<string, any>): CrossrefTarget | undefined {
  switch (tab) {
    case 'routes':
      return idTarget('route', row.id)
    case 'stops':
      return idTarget('stop', row.id)
    case 'stop-clusters':
      return row.id == null ? undefined : { kind: 'cluster', id: String(row.id) }
    case 'flex':
      return flexTarget(row.feed_onestop_id, row.location_id)
    case 'stops-aggregated':
      return row.geoid == null ? undefined : { kind: 'geography', geoid: String(row.geoid) }
    default:
      return undefined
  }
}

// The target a map popup's feature names, for "See in data table".
export function popupFeatureTarget (feature: PopupFeature): CrossrefTarget | undefined {
  switch (feature.featureType) {
    case 'stop':
    case 'route':
      return idTarget(feature.featureType, feature.featureId)
    case 'cluster':
      return feature.featureId == null ? undefined : { kind: 'cluster', id: String(feature.featureId) }
    case 'flex':
      return flexTarget(feature.data?.feed_onestop_id, feature.data?.location_id)
    default:
      return undefined
  }
}

// A table row's key, matching crossrefKey of the target it names.
export function reportRowKey (tab: ReportTab, row: Record<string, any>): string | undefined {
  const target = reportRowTarget(tab, row)
  return target ? crossrefKey(target) : undefined
}

// A table row's name, as its table shows it, for naming its actions.
export function reportRowLabel (tab: ReportTab, row: Record<string, any>): string | undefined {
  const pick = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      if (row[k] != null && row[k] !== '') {
        return String(row[k])
      }
    }
    return undefined
  }
  switch (tab) {
    case 'routes':
      return pick('route_name', 'route_id')
    case 'stops':
      return pick('stop_name', 'stop_id')
    case 'stop-clusters':
      return pick('cluster')
    case 'flex':
      return pick('location_name', 'location_id')
    case 'stops-aggregated':
      return pick('name', 'geoid')
    default:
      return undefined
  }
}

// The map display mode each table shows, so the map draws the kind of feature
// the table lists. The Transfer Analyst has none of its own.
export const REPORT_TAB_DISPLAY_MODES: Partial<Record<ReportTab, DataDisplayMode>> = {
  'routes': 'Transit mode',
  'stops': 'Stop visits',
  'stops-aggregated': 'Stop visits',
  'stop-clusters': 'Stop visits',
  'agencies': 'Agency',
  'flex': 'Service area',
}

// The display mode to switch to for a table, or undefined when the current
// one already shows its features: Route frequency shows routes as Transit mode
// does, so a route keeps it.
export function displayModeForReportTab (tab: ReportTab, current: DataDisplayMode): DataDisplayMode | undefined {
  const mode = REPORT_TAB_DISPLAY_MODES[tab]
  if (!mode || mode === current) {
    return undefined
  }
  if (tab === 'routes' && current === 'Route frequency') {
    return undefined
  }
  return mode
}
