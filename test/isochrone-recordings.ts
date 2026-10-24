import { readFileSync } from 'node:fs'
import type { IsochroneParams } from '../src/tl/isochrone'

// A real router response, from scripts/record-isochrone-fixtures.ts, with
// the request it answered. tlrouter can't run in the test stack, so the
// isochrone tests answer its one fetch with these.
export interface IsochroneRecording {
  params: IsochroneParams
  query: string
  status: number
  // As the router sent it.
  body: string
}

export function isochroneRecording (name: string): IsochroneRecording {
  const r = JSON.parse(readFileSync(new URL(`../testdata/isochrone/${name}.json`, import.meta.url), 'utf8'))
  // The recorder keeps a JSON body parsed, for readable diffs.
  return { ...r, body: typeof r.body === 'string' ? r.body : JSON.stringify(r.body) }
}
