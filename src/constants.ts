interface CannedBbox {
  label: string
  bboxString: string
}
export const cannedBboxes = new Map<string, CannedBbox>(Object.entries({
  'downtown-portland': { label: 'Downtown Portland, OR', bboxString: '-122.69075,45.51358,-122.66809,45.53306' },
  'downtown-portland-zoomed': { label: 'Downtown Portland, OR (zoomed)', bboxString: '-122.68308,45.52780,-122.68077,45.52932' },
  'greater-seattle': { label: 'Greater Seattle, WA', bboxString: '-124.876557,46.704561,-120.899506,49.018513' },
  'portland': { label: 'Portland, OR', bboxString: '-122.8,45.4,-122.5,45.7' },
  'bend': { label: 'Bend, OR', bboxString: '-121.32895,44.04474,-121.29887,44.06547' },
  'eugene': { label: 'Eugene, OR', bboxString: '-123.11829,44.02712,-123.07870,44.05676' },
  'salem': { label: 'Salem, OR', bboxString: '-123.04563,44.93167,-123.01971,44.94815' },
  'wa': { label: 'Washington', bboxString: '-124.905719,45.959815,-116.935138,49.046038' },
  'wa+or': { label: 'Washington and Oregon', bboxString: '-127.300423,44.772916,-113.320321,47.625345' },
}))

export const routeTypes = new Map<number, string>([
  [0, 'Light rail'],
  [1, 'Subway'],
  [2, 'Intercity rail'],
  [3, 'Bus'],
  [4, 'Ferry'],
])

export const colors = [
  '#e41a1c', // red
  '#ff7f00', // orange
  '#fee08b', // yellow
  '#1f78b4', // blue
  '#984ea3', // purple
  '#333333' // black
]

export type dow = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'

export const dowValues: dow[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday'
]

export const geomSources = {
  mapExtent: 'Covering extent of map',
  bbox: 'Dragging bounding box',
  adminBoundary: 'Administrative Boundary',
}

export const routeColorModes = [
  'Mode',
  'Frequency',
  'Fare',
]

export const dataDisplayModes = [
  'Agency',
  'Route',
  'Stop',
]

export const baseMapStyles = [
  { name: 'Streets', icon: 'map-search', available: true },
  { name: 'Satellite', icon: 'satellite', available: false },
]

export const selectedDayOfWeekModes = [
  'All',
  'Any',
]

export const selectedTimeOfDayModes = [
  'All',
  'Partial',
]
