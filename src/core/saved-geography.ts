// Saved geographies (#477): query areas a user keeps in their Interline
// account, as IWA user assets (interline-web-app#784) of this app and kind.
// The server routes in server/api/iwa/geographies read and write them.

import { isPolygonal, mergePolygons, type PolygonalGeometry, type QueryPolygon } from './geom'

export const SAVED_GEOGRAPHY_APP = 'calact_nat'
export const SAVED_GEOGRAPHY_KIND = 'geography'
// The metadata tag that stars a saved geography
export const FAVORITE_TAG = 'favorite'

// IWA roles for each thing the app does with saved geographies
export const SAVED_GEOGRAPHY_ROLES = {
  list: 'iwa_user_asset_list',
  save: 'iwa_user_asset_upload',
  update: 'iwa_user_asset_update',
  delete: 'iwa_user_asset_delete',
  download: 'iwa_user_asset_download_authed',
} as const

export type SavedGeographyPermission = keyof typeof SAVED_GEOGRAPHY_ROLES

// What each permission lets the user do, as a verb, in the order to list them
export const SAVED_GEOGRAPHY_ACTIONS: Record<SavedGeographyPermission, string> = {
  list: 'view',
  save: 'save',
  update: 'rename',
  download: 'download',
  delete: 'delete',
}

// - upload: an uploaded GeoJSON file's chosen features, kept as GeoJSON
// - admin_boundary: a set of census geographies, kept as references
export type SavedGeographySource = 'upload' | 'admin_boundary'

export interface SavedGeographyMetadata {
  source: SavedGeographySource
  // [west, south, east, north], as GeoJSON's bbox
  bbox?: [number, number, number, number]
  feature_count?: number
  tags?: string[]
  // For an upload, the file it came from
  filename?: string
  // For an admin_boundary set, the census dataset its geographies are from
  dataset?: string
}

// A saved geography as listed, without its content
export interface SavedGeography {
  id: string
  name: string
  metadata: SavedGeographyMetadata
  byte_size: number
  created_at: string
  updated_at: string
}

// The census geographies of an admin_boundary geography. Their integer ids
// are what a query uses; the geoids check that the ids still name the same
// places, as ids aren't stable across census data loads.
export interface AdminBoundaryDocument {
  type: 'admin_boundaries'
  dataset: string
  geographies: { id: number, geoid: string, name: string, layer: string }[]
}

export type UploadDocument = GeoJSON.FeatureCollection<PolygonalGeometry>

export type SavedGeographyContent = UploadDocument | AdminBoundaryDocument

export interface SavedGeographyWithContent extends SavedGeography {
  content: SavedGeographyContent
}

export interface SavedGeographyCreate {
  name: string
  metadata: SavedGeographyMetadata
  content: SavedGeographyContent
}

// What the save modal saves, with the name it suggests and a description
export interface SaveGeographyRequest {
  defaultName: string
  summary: string
  geography: Omit<SavedGeographyCreate, 'name'>
}

export interface SavedGeographyUpdate {
  name?: string
  metadata?: SavedGeographyMetadata
}

// A document's size as IWA measures it: its JSON in UTF-8 bytes, not
// characters, so names in other scripts count fully
export function jsonByteLength (content: unknown): number {
  return new TextEncoder().encode(JSON.stringify(content)).length
}

export function isFavorite (g: Pick<SavedGeography, 'metadata'>): boolean {
  return g.metadata.tags?.includes(FAVORITE_TAG) ?? false
}

// The metadata with the favorite tag set or cleared
export function withFavorite (metadata: SavedGeographyMetadata, favorite: boolean): SavedGeographyMetadata {
  const tags = (metadata.tags || []).filter(t => t !== FAVORITE_TAG)
  if (favorite) {
    tags.push(FAVORITE_TAG)
  }
  return { ...metadata, tags }
}

// Favorites first, then by name
export function sortSavedGeographies<T extends SavedGeography> (list: T[]): T[] {
  return [...list].sort((a, b) => {
    const fa = isFavorite(a)
    const fb = isFavorite(b)
    if (fa !== fb) {
      return fa ? -1 : 1
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
  })
}

export function isAdminBoundaryDocument (content: unknown): content is AdminBoundaryDocument {
  const c = content as AdminBoundaryDocument | undefined
  return c?.type === 'admin_boundaries' && typeof c.dataset === 'string' && Array.isArray(c.geographies)
}

export function isUploadDocument (content: unknown): content is UploadDocument {
  const c = content as UploadDocument | undefined
  return c?.type === 'FeatureCollection' && Array.isArray(c.features)
}

// An uploaded geography's polygons, as one query area
export function uploadDocumentPolygon (content: UploadDocument): QueryPolygon {
  return mergePolygons(content.features.map(f => f.geometry).filter(isPolygonal))
}

// The bbox metadata for a polygon
export function bboxMetadata (b: { sw: { lon: number, lat: number }, ne: { lon: number, lat: number } } | undefined): SavedGeographyMetadata['bbox'] {
  return b ? [b.sw.lon, b.sw.lat, b.ne.lon, b.ne.lat] : undefined
}
