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
