// The signed-in user's saved geographies, without their content, and where in
// their Interline account they can see everything they've stored

import { SAVED_GEOGRAPHY_APP, SAVED_GEOGRAPHY_KIND, type SavedGeography } from '~~/src/core'
import { iwaFetch } from '~~/server/utils/iwa'
import { toSavedGeography, type IwaAsset } from '~~/server/utils/saved-geographies'

// IWA's largest page. A user with more saved geographies than this sees the
// newest ones.
const PAGE_SIZE = 500

export default defineEventHandler(async (event): Promise<{ geographies: SavedGeography[], manageUrl: string }> => {
  const resp = await iwaFetch<{ assets: IwaAsset[] }>(event, '/assets', {
    query: {
      'app': SAVED_GEOGRAPHY_APP,
      'kind': SAVED_GEOGRAPHY_KIND,
      'page[size]': PAGE_SIZE,
    },
  })
  return {
    geographies: resp.assets.map(toSavedGeography),
    manageUrl: `${useRuntimeConfig(event).iwaBaseUrl}/users/me?tab=assets`,
  }
})
