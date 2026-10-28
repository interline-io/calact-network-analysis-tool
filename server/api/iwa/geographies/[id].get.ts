// One saved geography, with its content

import { createError } from 'h3'
import type { SavedGeographyWithContent } from '~~/src/core'
import { findSavedGeographyAsset, toSavedGeographyWithContent } from '~~/server/utils/saved-geographies'

export default defineEventHandler(async (event): Promise<SavedGeographyWithContent> => {
  const asset = await findSavedGeographyAsset(event)
  if (asset.content === undefined) {
    throw createError({ statusCode: 403, statusMessage: 'This account\'s plan doesn\'t allow loading saved geographies.' })
  }
  return toSavedGeographyWithContent(asset)
})
