// Vehicle trails as the map's WebGL layer draws them: every stretch a vehicle
// drives between consecutive stops, with the times it starts and finishes.
// The layer fades each stretch by how long ago the vehicle drove it, so this
// is built once per set of tracks, and every frame only moves the clock.

import type { VehicleTrack } from '~~/src/tl'

// Floats per segment: start x and y, end x and y, start time, end time.
export const TRAIL_SEGMENT_FLOATS = 6

export interface TrailSegments {
  // The Web Mercator point positions are measured from, so they keep their
  // precision as 32-bit floats.
  origin: [number, number]
  // TRAIL_SEGMENT_FLOATS per segment, positions in Web Mercator world units
  // (0 to 1 across the world) and times in seconds from midnight.
  positions: Float32Array
  // RGBA bytes per segment.
  colors: Uint8Array
  count: number
}

// Web Mercator world units, as MapLibre's MercatorCoordinate measures them:
// 0 to 1 from west to east, and from north to south.
function mercatorX (lon: number): number {
  return (180 + lon) / 360
}

function mercatorY (lat: number): number {
  return (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))) / 360
}

// '#rgb' or '#rrggbb' as bytes; gray for anything else.
function colorBytes (color: string): [number, number, number] {
  const hex = color.startsWith('#') ? color.slice(1) : ''
  const full = hex.length === 3 ? [...hex].map(c => c + c).join('') : hex
  if (!/^[0-9a-f]{6}$/i.test(full)) {
    return [170, 170, 170]
  }
  return [0, 2, 4].map(i => Number.parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
}

// The segments of every track whose route has a color. A wait at a stop
// covers no ground and is left out.
export function buildTrailSegments (tracks: VehicleTrack[], routeColors: Map<number, string>): TrailSegments {
  let capacity = 0
  for (const track of tracks) {
    if (routeColors.has(track.routeId)) {
      capacity += Math.max(0, track.times.length - 1)
    }
  }
  const positions = new Float32Array(capacity * TRAIL_SEGMENT_FLOATS)
  const colors = new Uint8Array(capacity * 4)
  let origin: [number, number] | undefined
  let count = 0
  for (const track of tracks) {
    const color = routeColors.get(track.routeId)
    if (!color) {
      continue
    }
    const [r, g, b] = colorBytes(color)
    const { times, coords } = track
    for (let i = 1; i < times.length; i++) {
      const x0 = mercatorX(coords[2 * i - 2]!)
      const y0 = mercatorY(coords[2 * i - 1]!)
      const x1 = mercatorX(coords[2 * i]!)
      const y1 = mercatorY(coords[2 * i + 1]!)
      if (x0 === x1 && y0 === y1) {
        continue
      }
      origin ??= [x0, y0]
      positions.set([x0 - origin[0], y0 - origin[1], x1 - origin[0], y1 - origin[1], times[i - 1]!, times[i]!], count * TRAIL_SEGMENT_FLOATS)
      colors.set([r, g, b, 255], count * 4)
      count++
    }
  }
  return {
    origin: origin ?? [0, 0],
    positions: positions.subarray(0, count * TRAIL_SEGMENT_FLOATS),
    colors: colors.subarray(0, count * 4),
    count,
  }
}
