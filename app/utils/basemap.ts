import { layers as protomapsLayers, namedFlavor } from '@protomaps/basemaps'
import type { StyleSpecification } from 'maplibre-gl'

// Credits for the basemap's data.
export const BASEMAP_ATTRIBUTION = '<a href="https://protomaps.com">Protomaps</a> | &copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'

// Protomaps basemap label layers (street/place labels), rendered above transit overlays.
// The vendored font directories use hyphenated, space-free names (see
// scripts/vendor-basemaps-assets.sh) so they serve reliably from static hosts,
// as spaces in the path can fall through to the SPA fallback; so rewrite the
// text-font names to match the directories the glyphs URL requests. Built once,
// as every map draws the same ones.
let labelLayers: ReturnType<typeof protomapsLayers> | undefined
export function protomapsLabelLayers () {
  labelLayers ??= JSON.parse(
    JSON.stringify(protomapsLayers('protomaps-base', namedFlavor('white'), { lang: 'en', labelsOnly: true }))
      .replaceAll('Noto Sans Regular', 'Noto-Sans-Regular')
      .replaceAll('Noto Sans Medium', 'Noto-Sans-Medium')
      .replaceAll('Noto Sans Italic', 'Noto-Sans-Italic'),
  ) as ReturnType<typeof protomapsLayers>
  return labelLayers
}

// Protomaps basemap base layers (everything except labels). @protomaps/basemaps has no
// direct "no labels" generator, so derive it as the full set minus the labels-only set.
let baseLayers: ReturnType<typeof protomapsLayers> | undefined
export function protomapsBaseLayers () {
  if (!baseLayers) {
    const labelIds = new Set(protomapsLabelLayers().map(l => l.id))
    baseLayers = protomapsLayers('protomaps-base', namedFlavor('white'), { lang: 'en' })
      .filter(l => !labelIds.has(l.id))
  }
  return baseLayers
}

// The basemap without its labels, as the app's maps draw it: Protomaps
// tiles, with glyphs and sprites self-hosted. MapLibre requires an absolute
// sprite URL, so the assets are anchored to the app's own origin (glyphs
// too, for consistency).
export function basemapStyle (apiKey: string, attribution = BASEMAP_ATTRIBUTION): StyleSpecification {
  const assetOrigin = window.location.origin
  return {
    glyphs: `${assetOrigin}/basemaps-assets/fonts/{fontstack}/{range}.pbf`,
    sprite: `${assetOrigin}/basemaps-assets/sprites/v4/white`,
    version: 8,
    sources: {
      'protomaps-base': {
        type: 'vector',
        tiles: [`https://api.protomaps.com/tiles/v4/{z}/{x}/{y}.mvt?key=${apiKey}`],
        maxzoom: 15,
        attribution,
      },
    },
    layers: protomapsBaseLayers(),
  }
}
