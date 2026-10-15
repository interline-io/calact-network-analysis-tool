import { describe, it, expect } from 'vitest'
import { parseDate } from '~~/src/core'
import { scenarioInputsToPin, type ScenarioInputsForPin } from '../../app/composables/scenarioInputsToPin'

const inputs = (partial: Partial<ScenarioInputsForPin>): ScenarioInputsForPin => ({
  geomSource: 'bbox',
  cannedBbox: 'downtown-portland',
  startDate: parseDate('2026-10-19')!,
  endDate: parseDate('2026-10-25')!,
  geoDatasetName: 'tiger2024',
  ...partial,
})

const dates = { startDate: '2026-10-19', endDate: '2026-10-25', geoDatasetName: 'tiger2024' }

describe('scenarioInputsToPin', () => {
  it('records a canned area by its example key, with the default dates and dataset', () => {
    expect(scenarioInputsToPin(inputs({}))).toEqual({ ...dates, example: 'downtown-portland' })
  })

  it('leaves a drawn or dragged bbox already in the URL as it is', () => {
    expect(scenarioInputsToPin(inputs({ bboxParam: '-122.7,45.5,-122.6,45.6' }))).toEqual(dates)
  })

  it('records an administrative boundary by the dataset its geographyIds belong to', () => {
    expect(scenarioInputsToPin(inputs({ geomSource: 'adminBoundary' }))).toEqual(dates)
  })

  it('records a map-extent area by its URL bbox, or by the canned key before the map reports one', () => {
    expect(scenarioInputsToPin(inputs({ geomSource: 'mapExtent', bboxParam: '-121.3,44.0,-121.2,44.1' }))).toEqual(dates)
    expect(scenarioInputsToPin(inputs({ geomSource: 'mapExtent' }))).toEqual({ ...dates, example: 'downtown-portland' })
  })
})
