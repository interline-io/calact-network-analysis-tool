// Saved geographies are IWA user assets of this app and kind
// (src/core/saved-geography.ts). These helpers keep the routes in
// server/api/iwa/geographies to that app and kind, and check what they send.

import type { H3Event } from 'h3'
import { iwaFetch } from '~~/server/utils/iwa'
import { createError, getRouterParam } from 'h3'
import {
  isAdminBoundaryDocument,
  isUploadDocument,
  SAVED_GEOGRAPHY_APP,
  SAVED_GEOGRAPHY_KIND,
  SAVED_GEOGRAPHY_MAX_BYTES,
  type SavedGeography,
  type SavedGeographyContent,
  type SavedGeographyMetadata,
  type SavedGeographyWithContent,
  jsonByteLength,
} from '~~/src/core'

// A user asset as IWA returns it
export interface IwaAsset {
  id: string
  app: string
  kind: string
  name: string
  byte_size: number
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
  content?: unknown
}

const MAX_NAME_LENGTH = 200
const SOURCES = ['upload', 'admin_boundary']
const ASSET_ID = /^[0-9a-f-]{36}$/i

function isSavedGeographyAsset (asset: IwaAsset): boolean {
  return asset.app === SAVED_GEOGRAPHY_APP && asset.kind === SAVED_GEOGRAPHY_KIND
}

// The route's saved geography. The user's other assets, from other apps or of
// other kinds, are a 404, so these routes can't read or change them.
export async function findSavedGeographyAsset (event: H3Event): Promise<IwaAsset> {
  const asset = await iwaFetch<IwaAsset>(event, `/assets/${assetIdParam(event)}`)
  if (!isSavedGeographyAsset(asset)) {
    throw createError({ statusCode: 404, statusMessage: 'No such saved geography' })
  }
  return asset
}

export function toSavedGeography (asset: IwaAsset): SavedGeography {
  return {
    id: asset.id,
    name: asset.name,
    metadata: asset.metadata as unknown as SavedGeographyMetadata,
    byte_size: asset.byte_size,
    created_at: asset.created_at,
    updated_at: asset.updated_at,
  }
}

export function toSavedGeographyWithContent (asset: IwaAsset): SavedGeographyWithContent {
  return { ...toSavedGeography(asset), content: asset.content as SavedGeographyContent }
}

// The route's asset id, checked so it can't reach another IWA path
export function assetIdParam (event: H3Event): string {
  const id = getRouterParam(event, 'id') || ''
  if (!ASSET_ID.test(id)) {
    throw createError({ statusCode: 404, statusMessage: 'No such saved geography' })
  }
  return id
}

export function checkName (name: unknown): string {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (!trimmed || trimmed.length > MAX_NAME_LENGTH) {
    throw createError({ statusCode: 422, statusMessage: `Give the geography a name of up to ${MAX_NAME_LENGTH} characters.` })
  }
  return trimmed
}

export function checkMetadata (metadata: unknown): SavedGeographyMetadata {
  const m = metadata as SavedGeographyMetadata | undefined
  if (!m || typeof m !== 'object' || !SOURCES.includes(m.source)) {
    throw createError({ statusCode: 422, statusMessage: 'Saved geography metadata needs a source of upload or admin_boundary.' })
  }
  return m
}

// The content for a source, and the content type IWA keeps it as
export function checkContent (source: SavedGeographyMetadata['source'], content: unknown): { content: SavedGeographyContent, contentType: string } {
  let checked: { content: SavedGeographyContent, contentType: string } | undefined
  if (source === 'upload' && isUploadDocument(content) && content.features.length > 0) {
    checked = { content, contentType: 'application/geo+json' }
  } else if (source === 'admin_boundary' && isAdminBoundaryDocument(content) && content.geographies.length > 0) {
    checked = { content, contentType: 'application/json' }
  }
  if (!checked) {
    throw createError({ statusCode: 422, statusMessage: `This isn't a geography of the ${source} kind.` })
  }
  if (jsonByteLength(checked.content) > SAVED_GEOGRAPHY_MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'This geography is too large to save. Turn on rounding and simplifying under Simplification options, or choose fewer features.' })
  }
  return checked
}
