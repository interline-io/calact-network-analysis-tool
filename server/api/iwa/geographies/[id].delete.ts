// Deletes a saved geography

import { setResponseStatus } from 'h3'
import { iwaFetch } from '~~/server/utils/iwa'
import { assetIdParam } from '~~/server/utils/saved-geographies'

export default defineEventHandler(async (event) => {
  await iwaFetch<null>(event, `/assets/${assetIdParam(event)}`, { method: 'DELETE' })
  setResponseStatus(event, 204)
  return null
})
