export const cannedBboxes = new Map<string, string>(Object.entries({
  'Downtown Portland, OR': '-122.69075,45.51358,-122.66809,45.53306',
  'Downtown Portland, OR (zoomed)': '-122.68308,45.52780,-122.68077,45.52932',
  'Portland, OR': '-122.8,45.4,-122.5,45.7',
  'Bend, OR': '-121.32895,44.04474,-121.29887,44.06547',
  'Eugene, OR': '-123.11829,44.02712,-123.07870,44.05676',
  'Salem, OR': '-123.04563,44.93167,-123.01971,44.94815',
}))


export const routeTypes = new Map<string, string>(Object.entries({
  0: 'Light rail',
  1: 'Intercity rail',
  2: 'Subway',
  3: 'Bus',
  4: 'Ferry',
}))

export const routeTypeColorMap = new Map<string, string>(Object.entries({
 0: '#e41a1c',
 1: '#ff7f00',
 2: '#fee08b',
 3: '#1f78b4',
 4: '#984ea3',
}))

export const dowValues = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday'
]

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
  'Streets',
  'Satellite',
]

export const selectedDayOfWeekModes = [
  'All',
  'Any',
]

export const selectedTimeOfDayModes = [
  'All',
  'Partial',
]

