// Deletes a saved geography

import { setResponseStatus } from 'h3'
import { iwaFetch } from '~~/server/utils/iwa'
import { findSavedGeographyAsset } from '~~/server/utils/saved-geographies'

export default defineEventHandler(async (event) => {
  // Only this app's saved geographies can be deleted here
  const { id } = await findSavedGeographyAsset(event)
  await iwaFetch<null>(event, `/assets/${id}`, { method: 'DELETE' })
  setResponseStatus(event, 204)
  return null
})
