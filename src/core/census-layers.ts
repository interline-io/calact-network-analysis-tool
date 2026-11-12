import { geoidFips } from './census-buffer'

// Census layers from smallest to largest, the order the layer dropdowns list
// them in (#468). Layers not named here follow, alphabetically by label.
const CENSUS_LAYER_SIZE_ORDER = [
  'bg',
  'tract',
  'place',
  'county',
  'uac20',
  'fta-uac20-nonurban',
  'cbsa',
  'csa',
  'state',
]

export function sortCensusLayerOptions<T extends { value: string, label: string }> (options: T[]): T[] {
  const rank = (value: string) => {
    const i = CENSUS_LAYER_SIZE_ORDER.indexOf(value)
    return i < 0 ? CENSUS_LAYER_SIZE_ORDER.length : i
  }
  return [...options].sort((a, b) => rank(a.value) - rank(b.value) || a.label.localeCompare(b.label))
}

// A tract code as the Census writes it: `005102` is 51.02, `010100` is 101.
function tractNumber (code: string): string {
  const base = String(Number(code.slice(0, 4)))
  const suffix = code.slice(4)
  return suffix === '00' ? base : `${base}.${suffix}`
}

// A geography's name, as the Census gives it. Some TIGER datasets name a tract
// by its bare number ("51.02") and leave block groups unnamed, so those two
// are built from the GEOID ("Block Group 2, Census Tract 51.02"), whatever
// the dataset holds. The county isn't part of it: tract numbers repeat across
// counties.
export function censusGeographyName (layer: string | undefined, geoid: string, name?: string | null): string {
  const fips = geoidFips(geoid)
  if (layer === 'tract' && /^\d{11}$/.test(fips)) {
    return `Census Tract ${tractNumber(fips.slice(5))}`
  }
  if (layer === 'bg' && /^\d{12}$/.test(fips)) {
    return `Block Group ${fips.slice(11)}, Census Tract ${tractNumber(fips.slice(5, 11))}`
  }
  return name || geoid
}

// A geography's name with its state, as the boundary pickers show it:
// "Multnomah, Oregon".
export function censusGeographyStateName (geo: {
  geoid: string
  name?: string | null
  layer?: { name: string } | null
  adm1_name?: string | null
}): string {
  const name = censusGeographyName(geo.layer?.name, geo.geoid, geo.name)
  return geo.adm1_name ? `${name}, ${geo.adm1_name}` : name
}
