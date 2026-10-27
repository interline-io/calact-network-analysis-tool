// One saved geography, with its content

import { createError } from 'h3'
import type { SavedGeographyWithContent } from '~~/src/core'
import { iwaFetch } from '~~/server/utils/iwa'
import { assetIdParam, isSavedGeographyAsset, toSavedGeographyWithContent, type IwaAsset } from '~~/server/utils/saved-geographies'

export default defineEventHandler(async (event): Promise<SavedGeographyWithContent> => {
  const asset = await iwaFetch<IwaAsset>(event, `/assets/${assetIdParam(event)}`)
  // The user's other assets aren't geographies
  if (!isSavedGeographyAsset(asset)) {
    throw createError({ statusCode: 404, statusMessage: 'No such saved geography' })
  }
  if (asset.content === undefined) {
    throw createError({ statusCode: 403, statusMessage: 'This account\'s plan doesn\'t allow loading saved geographies.' })
  }
  return toSavedGeographyWithContent(asset)
})
