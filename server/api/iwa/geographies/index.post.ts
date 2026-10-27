// Saves a geography to the signed-in user's Interline account

import { readBody } from 'h3'
import { SAVED_GEOGRAPHY_APP, SAVED_GEOGRAPHY_KIND, type SavedGeography, type SavedGeographyCreate } from '~~/src/core'
import { iwaFetch } from '~~/server/utils/iwa'
import { checkContent, checkMetadata, checkName, toSavedGeography, type IwaAsset } from '~~/server/utils/saved-geographies'

export default defineEventHandler(async (event): Promise<SavedGeography> => {
  const body = await readBody<Partial<SavedGeographyCreate>>(event)
  const name = checkName(body?.name)
  const metadata = checkMetadata(body?.metadata)
  const { content, contentType } = checkContent(metadata.source, body?.content)

  const asset = await iwaFetch<IwaAsset>(event, '/assets', {
    method: 'POST',
    body: {
      app: SAVED_GEOGRAPHY_APP,
      kind: SAVED_GEOGRAPHY_KIND,
      storage: 'json',
      name,
      metadata,
      content,
      content_type: contentType,
    },
  })
  return toSavedGeography(asset)
})
