// Vehicle trails as the map's WebGL layer draws them: the stretches of shape
// each vehicle drove in the trail's time before now, with the times it
// started and finished each. Rebuilt every frame, since the stretches follow
// the vehicles; the layer fades each by how long ago it was driven.

import { shapePoint, type VehicleShape, type VehicleTrack } from '~~/src/tl'

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

// The index of the first of a shape's points past a distance along it.
function firstPointPast (distances: number[], distance: number): number {
  let lo = 0
  let hi = distances.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (distances[mid]! <= distance) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  return lo
}

// The segments driven between time - trailSeconds and time by every track
// whose route has a color. Between two stops, a trail follows the shape's
// points, reached at times between the stops' in proportion to distance.
export function buildTrailSegments (
  tracks: VehicleTrack[],
  shapes: Map<number, VehicleShape>,
  routeColors: Map<number, string>,
  time: number,
  trailSeconds: number,
): TrailSegments {
  const from = time - trailSeconds
  const positions: number[] = []
  const colors: number[] = []
  let origin: [number, number] | undefined
  function add (a: [number, number], ta: number, b: [number, number], tb: number, rgb: [number, number, number]) {
    // Only what the trail shows: driven after it begins, and not after now.
    if (tb < from || ta > time) {
      return
    }
    const x0 = mercatorX(a[0])
    const y0 = mercatorY(a[1])
    const x1 = mercatorX(b[0])
    const y1 = mercatorY(b[1])
    if (x0 === x1 && y0 === y1) {
      return
    }
    origin ??= [x0, y0]
    positions.push(x0 - origin[0], y0 - origin[1], x1 - origin[0], y1 - origin[1], ta, tb)
    colors.push(rgb[0], rgb[1], rgb[2], 255)
  }

  for (const track of tracks) {
    const color = routeColors.get(track.routeId)
    const shape = shapes.get(track.shapeId)
    const { times, distances } = track
    if (!color || !shape || times.length < 2 || times[times.length - 1]! < from || times[0]! > time) {
      continue
    }
    const rgb = colorBytes(color)
    for (let k = 1; k < times.length; k++) {
      const t0 = times[k - 1]!
      const t1 = times[k]!
      if (t1 < from) {
        continue
      }
      if (t0 > time) {
        break
      }
      const d0 = distances[k - 1]!
      const d1 = distances[k]!
      // A wait at a stop covers no ground.
      if (d1 <= d0) {
        continue
      }
      let a = shapePoint(shape, d0)
      let ta = t0
      for (let v = firstPointPast(shape.distances, d0); v < shape.distances.length && shape.distances[v]! < d1 && ta <= time; v++) {
        const b: [number, number] = [shape.coords[2 * v]!, shape.coords[2 * v + 1]!]
        const tb = t0 + (shape.distances[v]! - d0) / (d1 - d0) * (t1 - t0)
        add(a, ta, b, tb, rgb)
        a = b
        ta = tb
      }
      add(a, ta, shapePoint(shape, d1), t1, rgb)
    }
  }
  return {
    origin: origin ?? [0, 0],
    positions: new Float32Array(positions),
    colors: new Uint8Array(colors),
    count: colors.length / 4,
  }
}
