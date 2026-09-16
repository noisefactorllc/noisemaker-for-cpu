// Hand-written CPU adapter for synth/remap (reference synth/remap/glsl/remap.glsl).
//
// glsl-transpiler mishandles the reference GLSL's `struct ZoneTest { bool inside; float d2; }`:
// it generates code that treats each struct FIELD as if the struct itself were a 2-component
// vector (`t.inside[0] = ...`, `min(t.d2, ...).reduce(...)` on a plain float), crashing at
// runtime ("min(...).reduce is not a function"). This is a structural transpiler limitation,
// not a narrow one-line quirk (unlike the texelFetch().swizzle fix in glsl-normalize.js), so —
// same as the julia/fractal/palette adapters this file sits beside — the effect gets a
// hand-written CPU implementation instead of chasing the transpiler further. The generated
// kernel for `synth/remap:remap` still exists (glsl-coverage.js keeps it classified
// "generated") but is never invoked: canonicalAdapterFactories overrides it (see
// src/effects/adapters/index.js, src/effects/catalog.js).
//
// This works from the semantic DSL uniforms directly ($bindings.zone{N}_*, .bgColor, ...) —
// not the packed std140 `data[275]` array the GPU shader's UBO needs (see
// src/runtime/renderer.js#remapUniformData), which only that now-unused generated kernel reads.

const MAX_ZONES = 8
const MAX_PAIRS = 32 // MAX_VERTS_PER_ZONE / 2

function clamp(value, low, high) {
  return Math.min(Math.max(value, low), high)
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

// Folds the edge between vertex (ax,ay) and its predecessor (bx,by) into `t`, mirroring
// reference testEdge(). All positions are global pixel coordinates (top-left origin).
function testEdge(t, ax, ay, bx, by, qx, qy, needDist) {
  const ex = bx - ax
  const ey = by - ay
  const wx = qx - ax
  const wy = qy - ay
  const c1 = qy >= ay
  const c2 = qy < by
  const c3 = ex * wy > ey * wx
  if ((c1 && c2 && c3) || !(c1 || c2 || c3)) t.inside = !t.inside
  if (needDist) {
    const s = clamp((wx * ex + wy * ey) / Math.max(ex * ex + ey * ey, 1e-6), 0, 1)
    const rx = wx - ex * s
    const ry = wy - ey * s
    const d2 = rx * rx + ry * ry
    if (d2 < t.d2) t.d2 = d2
  }
}

// Walks one zone's packed vertex pairs (one uniform fetch per two vertices) and returns the
// inside parity plus the squared pixel distance to the boundary, mirroring reference
// walkZone(). Each `zone{z}_v{pair}` uniform is already the packed [x0,y0,x1,y1] vec4 the
// reference reads from `data[base + pair]`.
function walkZone($bindings, zone, n, fullResX, fullResY, qx, qy, needDist) {
  const t = { inside: false, d2: 1e30 }
  const last = n - 1
  const lastPack = $bindings[`zone${zone}_v${last >> 1}`] ?? [0, 0, 0, 0]
  let prevX
  let prevY
  if (last % 2 === 0) {
    prevX = lastPack[0] * fullResX
    prevY = lastPack[1] * fullResY
  } else {
    prevX = lastPack[2] * fullResX
    prevY = lastPack[3] * fullResY
  }
  const pairs = (n + 1) >> 1
  for (let pair = 0; pair < MAX_PAIRS; pair += 1) {
    if (pair >= pairs) break
    const pack = $bindings[`zone${zone}_v${pair}`] ?? [0, 0, 0, 0]
    const v0x = pack[0] * fullResX
    const v0y = pack[1] * fullResY
    testEdge(t, v0x, v0y, prevX, prevY, qx, qy, needDist)
    prevX = v0x
    prevY = v0y
    if (pair * 2 + 1 < n) {
      const v1x = pack[2] * fullResX
      const v1y = pack[3] * fullResY
      testEdge(t, v1x, v1y, prevX, prevY, qx, qy, needDist)
      prevX = v1x
      prevY = v1y
    }
  }
  return t
}

export function remapFactory($bindings, $runtime) {
  const { texture } = $runtime.stdlib
  return function remapKernel(context, out) {
    $runtime.beginPixel(context)
    const fragX = context.fragCoord[0]
    const fragY = context.fragCoord[1]
    const tileOffset = $bindings.tileOffset ?? [0, 0]
    const fullResolution = $bindings.fullResolution
    const resolution = $bindings.resolution
    const fullResX = fullResolution[0]
    const fullResY = fullResolution[1]

    // Polygon tests use the GLOBAL pixel position so zones land in the same image position
    // regardless of which tile is rendering. gl_FragCoord is bottom-left origin (Y-up); remap
    // JSON is top-left (Y-down), so flip y after the global-coord conversion.
    const globalX = fragX + tileOffset[0]
    const globalY = fragY + tileOffset[1]
    const qx = globalX
    const qy = fullResY - globalY
    const px = qx / fullResX
    const py = qy / fullResY
    // Texture sampling stays TILE-LOCAL: sample at the tile-local pixel position, not the
    // global one, against this pass's own render-target resolution.
    const sampleUv = [fragX / resolution[0], fragY / resolution[1]]

    const activeCount = Math.min(Math.trunc($bindings.zoneCount ?? 0), MAX_ZONES)
    // Feather width in pixels, proportional to the shorter canvas side. smoothEdge is clamped
    // at 0: an automated negative value would otherwise SHRINK every zone's reject box.
    const featherPx = Math.max($bindings.smoothEdge ?? 0, 0) * 0.05 * Math.min(fullResX, fullResY)
    const needDist = featherPx > 0
    const dilateX = featherPx / fullResX
    const dilateY = featherPx / fullResY

    let r = 0
    let g = 0
    let b = 0
    let a = 0
    for (let k = 0; k < MAX_ZONES; k += 1) {
      const z = activeCount - 1 - k // top-down: highest index first
      if (z < 0) break
      const count = $bindings[`zone${z}_count`] ?? 0
      const active = $bindings[`zone${z}_active`] ?? 0
      const alpha = $bindings[`zone${z}_alpha`] ?? 1
      // Clamped: a host-supplied count above the per-zone capacity would otherwise walk past
      // this zone's slots into the next zone's.
      const n = Math.min(Math.trunc(count), MAX_PAIRS * 2)
      if (n < 3 || active < 0.5) continue // degenerate, or source not wired

      // Host-supplied bounding box [minX, minY, maxX, maxY], dilated by the feather. The
      // default [0, 0, 1, 1] never rejects a canvas pixel.
      const bounds = $bindings[`zone${z}_bounds`] ?? [0, 0, 1, 1]
      if (px < bounds[0] - dilateX || py < bounds[1] - dilateY || px > bounds[2] + dilateX || py > bounds[3] + dilateY) continue

      const t = walkZone($bindings, z, n, fullResX, fullResY, qx, qy, needDist)

      let coverage = 1
      if (!t.inside) {
        if (!needDist) continue
        coverage = 1 - smoothstep(0, featherPx, Math.sqrt(t.d2))
        if (coverage <= 0) continue
      }

      // Premultiplied "under": this zone is above everything still to come.
      const surface = $bindings[`zone${z}_tex`]
      const src = texture(surface, sampleUv)
      const weight = coverage * alpha
      const inv = 1 - a
      r += src[0] * weight * inv
      g += src[1] * weight * inv
      b += src[2] * weight * inv
      a += src[3] * weight * inv
      if (a >= 0.999) break
    }

    // Background goes under whatever the zones left uncovered.
    const bg = $bindings.bgColor ?? [0, 0, 0]
    const bgAlpha = $bindings.bgAlpha ?? 1
    const inv = 1 - a
    r += bg[0] * bgAlpha * inv
    g += bg[1] * bgAlpha * inv
    b += bg[2] * bgAlpha * inv
    a += bgAlpha * inv

    out[0] = r
    out[1] = g
    out[2] = b
    out[3] = a
  }
}
