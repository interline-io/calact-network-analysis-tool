import { asDateString } from '~~/src/core'

export interface ScenarioInputsForPin {
  geomSource: string
  // The explicit `bbox` URL param, if any (a drawn, dragged, or map-extent area).
  bboxParam?: string
  // The canned area in force when there is no explicit bbox.
  cannedBbox: string
  startDate: Date
  endDate: Date
  geoDatasetName: string
}

// The URL params that record the inputs a run uses, defaults included, so a
// link to the results reruns the same scenario: the default dates are
// computed from today, and the default area or geography dataset could
// change. The area is recorded the way it was chosen, so the URL reads back
// to the same thing:
// - an administrative boundary is its geographyIds, already in the URL;
// - a drawn, dragged, or map-extent area is its explicit bbox, already in the
//   URL;
// - otherwise the area is a canned one, recorded by its example key rather
//   than a bbox rounded from the canned definition, which would differ from
//   it and stop the area picker from restoring it. That includes map-extent
//   mode before the map has reported an extent.
// The geography dataset matters in every mode: it names the geographyIds and
// drives the census aggregation.
export function scenarioInputsToPin (v: ScenarioInputsForPin): Record<string, string | undefined> {
  const pin: Record<string, string | undefined> = {
    startDate: asDateString(v.startDate),
    endDate: asDateString(v.endDate),
    geoDatasetName: v.geoDatasetName,
  }
  if (v.geomSource !== 'adminBoundary' && !v.bboxParam) {
    pin.example = v.cannedBbox
  }
  return pin
}
