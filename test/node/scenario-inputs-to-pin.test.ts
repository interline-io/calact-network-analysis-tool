import { describe, it, expect } from 'vitest'
import { parseBbox, parseDate } from '~~/src/core'
import { scenarioInputsToPin, type ScenarioInputsForPin } from '../../app/composables/scenarioInputsToPin'

const inputs = (partial: Partial<ScenarioInputsForPin>): ScenarioInputsForPin => ({
  geomSource: 'bbox',
  cannedBbox: 'downtown-portland',
  bbox: parseBbox('-122.69075,45.51358,-122.66809,45.53306'),
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

  it('writes a map-extent area as its bbox when the URL has none yet', () => {
    expect(scenarioInputsToPin(inputs({ geomSource: 'mapExtent' }))).toEqual({ ...dates, bbox: '-122.69075,45.51358,-122.66809,45.53306' })
  })

  it('never writes an invalid bbox', () => {
    expect(scenarioInputsToPin(inputs({ geomSource: 'mapExtent', bbox: parseBbox('') }))).toEqual(dates)
  })
})
