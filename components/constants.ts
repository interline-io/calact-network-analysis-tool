export const cannedBboxes = new Map<string, string>(Object.entries({
  'Downtown Portland, OR': '-122.69075,45.51358,-122.66809,45.53306',
  'Downtown Portland, OR (zoomed)': '-122.68308,45.52780,-122.68077,45.52932',
  'Portland, OR': '-122.8,45.4,-122.5,45.7',
  'Bend, OR': '-121.315,44.045,-121.295,44.055',
  'Eugene, OR': '-123.125,44.025,-123.105,44.035',
  'Salem, OR': '-123.015,44.935,-122.995,44.945',
  'Corvallis, OR': '-123.255,44.555,-123.235,44.565',
  'Astoria, OR': '-123.830,46.180,-123.810,46.190',  
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
  'Type',
  'Agency',
  'Frequency',
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

