import type * as maplibre from 'maplibre-gl'
import { TRAIL_SEGMENT_FLOATS, type TrailSegments } from '~~/src/scenario'

// In CSS pixels. Wider than a route line, so a trail shows over its own
// route, which is drawn in the same color.
const TRAIL_WIDTH = 6

// Each segment is one instance: a quad stretched from its start to its end and
// widened across it in screen pixels. Time runs along the quad with the
// vehicle, so the fragment shader can tell how long ago each point was driven.
const VERTEX_SHADER = `#version 300 es
uniform mat4 u_matrix;
uniform vec2 u_viewport;
uniform float u_width;
// The quad's corner: along the segment (0 or 1) and across it (-1 or 1).
in vec2 a_corner;
in vec4 a_ends;
in vec2 a_times;
in vec4 a_color;
out float v_time;
out vec4 v_color;
void main() {
  vec4 start = u_matrix * vec4(a_ends.xy, 0.0, 1.0);
  vec4 end = u_matrix * vec4(a_ends.zw, 0.0, 1.0);
  vec2 d = (end.xy / end.w - start.xy / start.w) * u_viewport;
  float len = length(d);
  vec2 dir = len > 0.0 ? d / len : vec2(1.0, 0.0);
  vec4 p = mix(start, end, a_corner.x);
  p.xy += vec2(-dir.y, dir.x) * a_corner.y * u_width / u_viewport * p.w;
  gl_Position = p;
  v_time = mix(a_times.x, a_times.y, a_corner.x);
  v_color = a_color;
}`

// Nothing ahead of the vehicle, and nothing older than the trail; in between,
// fading with age. Premultiplied, as MapLibre blends.
const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform float u_time;
uniform float u_trail;
in float v_time;
in vec4 v_color;
out vec4 fragColor;
void main() {
  float age = u_time - v_time;
  if (age < 0.0 || age > u_trail) {
    discard;
  }
  float alpha = 1.0 - age / u_trail;
  fragColor = vec4(v_color.rgb * alpha, alpha);
}`

// Two triangles covering a segment's quad.
const QUAD_CORNERS = new Float32Array([0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1])

// A failed compile or link is logged, and the layer draws nothing.
function compileProgram (gl: WebGL2RenderingContext): WebGLProgram | undefined {
  const program = gl.createProgram()
  for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX_SHADER], [gl.FRAGMENT_SHADER, FRAGMENT_SHADER]] as const) {
    const shader = gl.createShader(type)
    if (!shader) {
      return undefined
    }
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('[VehicleTrailLayer] shader compile failed:', gl.getShaderInfoLog(shader))
      return undefined
    }
    gl.attachShader(program, shader)
  }
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('[VehicleTrailLayer] program link failed:', gl.getProgramInfoLog(program))
    return undefined
  }
  return program
}

// The vehicle playback's fading trails, drawn on the GPU, which fades each
// segment by how long ago its vehicle drove it.
export class VehicleTrailLayer implements maplibre.CustomLayerInterface {
  readonly id = 'vehicle-trails'
  readonly type = 'custom'
  readonly renderingMode = '2d'

  private map?: maplibre.Map
  private program?: WebGLProgram
  private vao?: WebGLVertexArrayObject
  private positionBuffer?: WebGLBuffer
  private colorBuffer?: WebGLBuffer
  private uniforms: Record<string, WebGLUniformLocation | null> = {}

  private segments?: TrailSegments
  // Segments set since the last upload.
  private pending = false
  private time = 0
  // Schedule seconds a trail takes to fade out; 0 draws none.
  private trailSeconds = 0

  setSegments (segments: TrailSegments | undefined): void {
    this.segments = segments
    this.pending = true
    this.map?.triggerRepaint()
  }

  setTime (time: number): void {
    this.time = time
    this.map?.triggerRepaint()
  }

  setTrailSeconds (seconds: number): void {
    this.trailSeconds = seconds
    this.map?.triggerRepaint()
  }

  onAdd (map: maplibre.Map, gl: WebGL2RenderingContext): void {
    this.map = map
    this.program = compileProgram(gl)
    if (!this.program) {
      return
    }
    const program = this.program
    for (const name of ['u_matrix', 'u_viewport', 'u_width', 'u_time', 'u_trail']) {
      this.uniforms[name] = gl.getUniformLocation(program, name)
    }

    // Our own vertex array, so the per-instance divisors stay out of the
    // state MapLibre draws with.
    this.vao = gl.createVertexArray()
    gl.bindVertexArray(this.vao)

    const cornerBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, QUAD_CORNERS, gl.STATIC_DRAW)
    const corner = gl.getAttribLocation(program, 'a_corner')
    gl.enableVertexAttribArray(corner)
    gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0)

    this.positionBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer)
    const stride = TRAIL_SEGMENT_FLOATS * 4
    const ends = gl.getAttribLocation(program, 'a_ends')
    gl.enableVertexAttribArray(ends)
    gl.vertexAttribPointer(ends, 4, gl.FLOAT, false, stride, 0)
    gl.vertexAttribDivisor(ends, 1)
    const times = gl.getAttribLocation(program, 'a_times')
    gl.enableVertexAttribArray(times)
    gl.vertexAttribPointer(times, 2, gl.FLOAT, false, stride, 16)
    gl.vertexAttribDivisor(times, 1)

    this.colorBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer)
    const color = gl.getAttribLocation(program, 'a_color')
    gl.enableVertexAttribArray(color)
    gl.vertexAttribPointer(color, 4, gl.UNSIGNED_BYTE, true, 0, 0)
    gl.vertexAttribDivisor(color, 1)

    gl.bindVertexArray(null)
  }

  onRemove (_map: maplibre.Map, gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program ?? null)
    gl.deleteVertexArray(this.vao ?? null)
    gl.deleteBuffer(this.positionBuffer ?? null)
    gl.deleteBuffer(this.colorBuffer ?? null)
    this.map = undefined
  }

  render (gl: WebGL2RenderingContext, options: maplibre.CustomRenderMethodInput): void {
    const segments = this.segments
    if (!this.program || !this.vao || !segments) {
      return
    }
    if (this.pending) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer ?? null)
      gl.bufferData(gl.ARRAY_BUFFER, segments.positions, gl.STATIC_DRAW)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer ?? null)
      gl.bufferData(gl.ARRAY_BUFFER, segments.colors, gl.STATIC_DRAW)
      this.pending = false
    }
    if (segments.count === 0 || this.trailSeconds <= 0) {
      return
    }

    // Positions are relative to the segments' origin, so the matrix moves
    // there first. Only its last column changes, computed in 64 bits before
    // the upload rounds it.
    const m = options.defaultProjectionData.mainMatrix
    const [ox, oy] = segments.origin
    const matrix = new Float32Array(m)
    for (let r = 0; r < 4; r++) {
      matrix[12 + r] = m[r]! * ox + m[4 + r]! * oy + m[12 + r]!
    }

    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)
    gl.uniformMatrix4fv(this.uniforms.u_matrix ?? null, false, matrix)
    gl.uniform2f(this.uniforms.u_viewport ?? null, gl.drawingBufferWidth, gl.drawingBufferHeight)
    gl.uniform1f(this.uniforms.u_width ?? null, TRAIL_WIDTH * (this.map?.getPixelRatio() ?? 1))
    gl.uniform1f(this.uniforms.u_time ?? null, this.time)
    gl.uniform1f(this.uniforms.u_trail ?? null, this.trailSeconds)
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, segments.count)
    gl.bindVertexArray(null)
  }
}
