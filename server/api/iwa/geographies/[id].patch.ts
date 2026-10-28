// Renames a saved geography or changes its metadata (such as starring it).
// The geography itself can't change: save a new one instead.

import { readBody } from 'h3'
import type { SavedGeography, SavedGeographyUpdate } from '~~/src/core'
import { iwaFetch } from '~~/server/utils/iwa'
import { assetIdParam, checkMetadata, checkName, toSavedGeography, type IwaAsset } from '~~/server/utils/saved-geographies'

export default defineEventHandler(async (event): Promise<SavedGeography> => {
  const id = assetIdParam(event)
  const body = await readBody<SavedGeographyUpdate>(event)
  const update: SavedGeographyUpdate = {}
  if (body?.name !== undefined) {
    update.name = checkName(body.name)
  }
  if (body?.metadata !== undefined) {
    // IWA replaces metadata whole, so the caller sends all of it
    update.metadata = checkMetadata(body.metadata)
  }
  const asset = await iwaFetch<IwaAsset>(event, `/assets/${id}`, { method: 'PATCH', body: update })
  return toSavedGeography(asset)
})
