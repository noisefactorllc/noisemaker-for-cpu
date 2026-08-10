// Hand-ported CPU scatter adapter for the billboard-quad deposit vertex/fragment pair:
//   render/pointsBillboardRender:deposit / deposit_alpha
//     <- shaders/effects/render/pointsBillboardRender/glsl/deposit.{vert,frag}
// (pinned upstream clone; read-only reference, never modified by this repo)
//
// One registered adapter serves BOTH of the effect's deposit passes (`deposit`, blend `true`
// additive; `deposit_alpha`, blend `['ONE','ONE_MINUS_SRC_ALPHA']` premultiplied-over) - both
// pass entries share `program: "deposit"`, so both key to the same
// `render/pointsBillboardRender:deposit` registry slot; the blend op is read off `pass.blend`
// per invocation (see `isPremultipliedBlend`), never assumed from which pass name ran.
//
// Geometry: each particle is a quad (6 vertices / 2 triangles in the GLSL source, corners
// `(-1,-1) (1,-1) (-1,1) (1,1)` in local offset space, split along the TL-BR diagonal). The map
// from local offset to clip space is affine (rotate the unit offset, then scale by
// `sizeClip`, then translate by the clip-space center) - `finalPos = clipCenter + R(rotation) *
// offset * sizeClip`. Because it's affine and the two triangles exactly tile the offset-space
// unit square with no gap or overlap, "is destination pixel P inside triangle A or triangle B"
// is identical (same covered-pixel set, same interpolated `vSpriteUV`, no possible double-count
// on the shared diagonal) to "is P's PRE-IMAGE under the inverse affine map inside
// `[-1,1]x[-1,1]`" - so each candidate pixel is tested by inverting the affine map directly
// instead of by literal per-triangle edge functions. This uses the same
// `floor(center)+0.5` sample-point convention as the rest of this port; it is a closed-form
// equivalent of "scanline-fill both triangles" for the pixel-center-membership test itself.
//
// Boundary convention: the pre-image bound (see the `offsetX`/`offsetY` check below) is CLOSED on
// all four sides - a sample point landing exactly on the quad edge is included. Real GPU triangle
// rasterization uses a top-left fill rule, which is half-open on two of the four edges (a boundary
// sample can be excluded there instead). This is a deliberate simplification, not the half-open
// rule, so it is NOT exact GPU-rasterization equivalence in the boundary case - only everywhere
// else. The two conventions can only disagree for a sample point that lands EXACTLY on a quad
// edge (measure-zero for a continuous `clipCenter`/rotation), and none of these 21 stateful/
// particle effects has a GPU-rendered golden to compare against, so in practice the difference is
// unobservable.
import { computeClipCenter, fract, texelFetchAgent, GOLDEN_RATIO_CONJUGATE } from './points-deposit.js'
import { sampleBilinear, sampleNearestBottomLeft } from '../../runtime/sampler.js'

// deposit.vert's literal rotation-range constant. NOT `2 * Math.PI` - ported as the exact
// (slightly truncated) literal upstream authored, per "no creative reinterpretation".
const TAU_APPROX = 6.283185

// The 4 distinct quad corners in local offset space (vertex 2/3 and 1/4 of the GLSL source's
// 6-vertex list are duplicates of these same corners - the two triangles share the TL-BR edge).
const QUAD_CORNER_OFFSETS = [
  [-1, -1], // bottom-left
  [1, -1], // bottom-right
  [-1, 1], // top-left
  [1, 1], // top-right
]

function clampNum(value, low, high) {
  return Math.min(Math.max(value, low), high)
}

// GLSL `smoothstep(edge0, edge1, x)`: Hermite interpolation, 0 at/below edge0, 1 at/above edge1.
function smoothstep(edge0, edge1, x) {
  const t = clampNum((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

const floatBitsBuffer = new ArrayBuffer(4)
const floatBitsFloatView = new Float32Array(floatBitsBuffer)
const floatBitsUintView = new Uint32Array(floatBitsBuffer)

// `floatBitsToUint`: reinterpret (not convert) an IEEE-754 float32's bit pattern as a uint32.
function floatBitsToUint(value) {
  floatBitsFloatView[0] = value
  return floatBitsUintView[0]
}

// `hash_uint(uint s)` from deposit.vert - a PCG-style integer hash. GLSL `uint` arithmetic wraps
// modulo 2^32 and shifts are logical (unsigned); `Math.imul` + `>>> 0` give the same wrapping
// unsigned 32-bit semantics in JS, and `>>>` is JS's logical right shift.
function hashUint32(seedBits) {
  const state = (Math.imul(seedBits >>> 0, 747796405) + 2891336453) >>> 0
  const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0
  return ((word >>> 22) ^ word) >>> 0
}

// `float hash(float n)` from deposit.vert, seeded by the pass's own `seed` uniform:
// `hash_uint(floatBitsToUint(n + seed)) / 4294967295.0`. Exported for direct unit testing.
export function hash(n, seed) {
  return hashUint32(floatBitsToUint(Math.fround(n + seed))) / 4294967295
}

// Procedural SDFs from deposit.frag, `shapeMode` 1..6 (circle/ring/square/diamond/triangle/star).
// `px`/`py` is `vSpriteUV - 0.5` (sprite-local coordinates, origin at the quad center).
function signedDistanceForShape(shapeMode, px, py) {
  if (shapeMode === 1) return Math.sqrt(px * px + py * py) - 0.45 // circle
  if (shapeMode === 2) return Math.abs(Math.sqrt(px * px + py * py) - 0.35) - 0.08 // ring
  if (shapeMode === 3) return Math.max(Math.abs(px), Math.abs(py)) - 0.4 // square
  if (shapeMode === 4) return Math.abs(px) + Math.abs(py) - 0.45 // diamond

  if (shapeMode === 5) {
    // Equilateral triangle (Inigo Quilez SDF).
    const r = 0.25
    const k = 1.732050808 // sqrt(3)
    let tx = Math.abs(px) - r
    let ty = py - 0.04 + r / k
    if (tx + k * ty > 0.0) {
      const nextTx = tx - k * ty
      const nextTy = -k * tx - ty
      tx = nextTx / 2.0
      ty = nextTy / 2.0
    }
    tx -= clampNum(tx, -2.0 * r, 0.0)
    return -Math.sqrt(tx * tx + ty * ty) * Math.sign(ty)
  }

  // shapeMode === 6: 5-point star (Inigo Quilez SDF, straight edges).
  const r = 0.35
  const rf = 0.4
  const k1x = 0.809016994375
  const k1y = -0.587785252292
  const k2x = -k1x
  const k2y = k1y
  let sx = Math.abs(px)
  let sy = py
  const dot1 = k1x * sx + k1y * sy
  const m1 = Math.max(dot1, 0.0)
  sx -= 2.0 * m1 * k1x
  sy -= 2.0 * m1 * k1y
  const dot2 = k2x * sx + k2y * sy
  const m2 = Math.max(dot2, 0.0)
  sx -= 2.0 * m2 * k2x
  sy -= 2.0 * m2 * k2y
  sx = Math.abs(sx)
  sy -= r
  const bax = rf * -k1y - 0.0
  const bay = rf * k1x - 1.0
  const dotSBa = sx * bax + sy * bay
  const dotBaBa = bax * bax + bay * bay
  const h = clampNum(dotSBa / dotBaBa, 0.0, r)
  const remX = sx - bax * h
  const remY = sy - bay * h
  return Math.sqrt(remX * remX + remY * remY) * Math.sign(sy * bax - sx * bay)
}

// Alpha coverage for the non-texture `shapeMode`s (1..6 via SDF + smoothstep; 7, and upstream's
// own fallthrough for any other non-zero value, via the soft gaussian). `u`/`v` is `vSpriteUV`
// (sprite-local [0,1]). Exported for direct unit testing of the fragment math in isolation from
// the rasterizer/AABB machinery.
export function billboardShapeAlpha(shapeMode, u, v) {
  const px = u - 0.5
  const py = v - 0.5
  if (shapeMode >= 1 && shapeMode <= 6) return 1.0 - smoothstep(-0.02, 0.02, signedDistanceForShape(shapeMode, px, py))
  return Math.exp(-(px * px + py * py) * 8.0) // "soft" (7) and any out-of-domain shapeMode
}

const spriteSampleScratch = new Float32Array(4)

// `texture(spriteTex, uv)` for the billboard sprite. `spriteTex` is bound
// via the `tex` effect param (`type: "surface"`), NOT `definition.externalTexture` (`null` for
// `render/pointsBillboardRender` - confirmed against its catalog record) - `buildBindings`'s
// surface-param branch never sets `.filter` on the resolved `Surface`, so there is no blanket
// "sprites are always linear" rule to lean on here. This instead follows the port-wide canonical
// convention (README: "internal texture sampling is nearest unless a source is explicitly
// linear; external image inputs use linear sampling" - the same rule `GlslCpuRuntime#texture`
// implements): bilinear only when the bound `Surface` itself carries `filter === 'linear'`
// (i.e. it was routed in from an external/image source that marked itself that way), nearest
// otherwise. Row convention matches `GlslCpuRuntime#texture` exactly in both branches.
function sampleSprite(surface, u, v) {
  if (surface.filter === 'linear') return sampleBilinear(surface, u, 1 - v, spriteSampleScratch)
  return sampleNearestBottomLeft(surface, u, v, spriteSampleScratch)
}

// deposit.frag, in full: shapeMode 0 samples `spriteTex`; anything else is a procedural alpha
// shape. `agentColor` is `[r,g,b,a]` (`vColor`, constant across one particle's whole quad - no
// per-vertex interpolation needed). Writes into (and returns) `out`, defaulting to a fresh array
// so this can be called standalone from tests without threading a scratch buffer.
export function evaluateBillboardFragment(shapeMode, spriteTex, u, v, agentColor, opacity, out = [0, 0, 0, 0]) {
  if (shapeMode === 0) {
    const sample = sampleSprite(spriteTex, u, v)
    out[0] = sample[0] * agentColor[0] * opacity
    out[1] = sample[1] * agentColor[1] * opacity
    out[2] = sample[2] * agentColor[2] * opacity
    out[3] = sample[3] * agentColor[3] * opacity
    return out
  }
  const alpha = billboardShapeAlpha(shapeMode, u, v)
  out[0] = agentColor[0] * alpha * opacity
  out[1] = agentColor[1] * alpha * opacity
  out[2] = agentColor[2] * alpha * opacity
  out[3] = alpha * agentColor[3] * opacity
  return out
}

// `deposit`'s `blend: true` -> additive (GL_ONE, GL_ONE); `deposit_alpha`'s
// `blend: ['ONE', 'ONE_MINUS_SRC_ALPHA']` -> premultiplied-over. These are the only two shapes
// the real catalog ever sends this adapter (see `render/pointsBillboardRender`'s two pass
// records); anything else falls back to additive.
export function isPremultipliedBlend(pass) {
  if (!Array.isArray(pass.blend)) return false
  const [src, dst] = pass.blend
  return String(src).toUpperCase() === 'ONE' && String(dst).toUpperCase() === 'ONE_MINUS_SRC_ALPHA'
}

// Unbound-uniform note: like the other four ported shaders,
// deposit.vert declares `uniform vec2 resolution` with no entry in the pass's own `uniforms`
// map - but UNLIKE the other four (where it's simply dead code), billboard's copy IS read
// (`vec2 pixelToClip = 2.0 / resolution;`, converting `pointSize` pixels to clip-space units).
// Rather than default it to 0 (which would divide-by-zero the whole quad into +/-Infinity), this
// port uses `destination.width`/`destination.height` directly wherever the shader reads
// `resolution` - the actual value a real renderer would bind it to (the render target's own
// pixel dimensions), not a stand-in default.
export function pointsBillboardRenderDepositAdapter({ pass, uniforms, inputs, destination }) {
  const xyzTex = inputs.xyzTex
  const rgbaTex = inputs.rgbaTex
  const spriteTex = inputs.spriteTex
  const width = xyzTex.width
  const height = xyzTex.height
  // Same square-state-texture assumption as points-deposit.js's adapters (every particle-state
  // texture in the current catalog has `stateSize` sizing both dimensions identically) - see that
  // file's header comment for upstream's own per-shader formulas this is equivalent to.
  const count = width * height
  const destWidth = destination.width
  const destHeight = destination.height
  const data = destination.data
  const premultiplied = isPremultipliedBlend(pass)

  const cullThreshold = uniforms.density / 100.0
  const shapeMode = uniforms.shapeMode | 0
  const opacity = uniforms.depositOpacity / 100.0
  const seed = uniforms.seed
  const sizeVariationFraction = uniforms.sizeVariation / 100.0
  const rotationVarFraction = uniforms.rotationVar / 100.0
  const pointSize = uniforms.pointSize

  const src = [0, 0, 0, 0]
  let pixels = 0

  for (let v = 0; v < count; v += 1) {
    // Density cull first, using the raw particle index - matches deposit.vert's order exactly
    // (culled particles never even reach the xyzTex/rgbaTex reads below).
    const particleRandom = fract(v * GOLDEN_RATIO_CONJUGATE)
    if (particleRandom > cullThreshold) continue

    const sx = v % width
    const sy = Math.floor(v / width)
    const pos = texelFetchAgent(xyzTex, sx, sy)
    if (pos[3] < 0.5) continue // alive = pos.w

    const agentColor = texelFetchAgent(rgbaTex, sx, sy)
    const [clipCenterX, clipCenterY] = computeClipCenter(pos[0], pos[1], pos[2], uniforms)

    const sizeNoise = hash(v, seed)
    const sizeMultiplier = 1.0 - sizeVariationFraction * (sizeNoise - 0.5)
    const finalSize = pointSize * sizeMultiplier
    if (!(finalSize > 0)) continue // degenerate/zero-area quad draws nothing

    const rotationNoise = hash(v + 1234.5, seed)
    const rotation = rotationVarFraction * rotationNoise * TAU_APPROX
    const cosR = Math.cos(rotation)
    const sinR = Math.sin(rotation)

    const halfSize = finalSize * 0.5
    const sizeClipX = halfSize * (2.0 / destWidth)
    const sizeClipY = halfSize * (2.0 / destHeight)

    // AABB (in destination GL-pixel space, bottom-up) over the 4 rotated+scaled corners.
    let minPxf = Infinity
    let maxPxf = -Infinity
    let minPyf = Infinity
    let maxPyf = -Infinity
    for (const [ox, oy] of QUAD_CORNER_OFFSETS) {
      const rotatedOffsetX = ox * cosR - oy * sinR
      const rotatedOffsetY = ox * sinR + oy * cosR
      const cornerClipX = clipCenterX + rotatedOffsetX * sizeClipX
      const cornerClipY = clipCenterY + rotatedOffsetY * sizeClipY
      const pxf = (cornerClipX * 0.5 + 0.5) * destWidth
      const pyf = (cornerClipY * 0.5 + 0.5) * destHeight
      if (pxf < minPxf) minPxf = pxf
      if (pxf > maxPxf) maxPxf = pxf
      if (pyf < minPyf) minPyf = pyf
      if (pyf > maxPyf) maxPyf = pyf
    }

    const colStart = Math.max(0, Math.floor(minPxf))
    const colEnd = Math.min(destWidth - 1, Math.ceil(maxPxf))
    const rowStart = Math.max(0, Math.floor(minPyf))
    const rowEnd = Math.min(destHeight - 1, Math.ceil(maxPyf))

    for (let glRow = rowStart; glRow <= rowEnd; glRow += 1) {
      const sampleClipY = ((glRow + 0.5) / destHeight) * 2 - 1
      const dy = sampleClipY - clipCenterY
      const b = dy / sizeClipY
      const storageRow = destHeight - 1 - glRow

      for (let col = colStart; col <= colEnd; col += 1) {
        const sampleClipX = ((col + 0.5) / destWidth) * 2 - 1
        const dx = sampleClipX - clipCenterX
        const a = dx / sizeClipX

        // Invert `[dx,dy] = R(rotation) * (offset * sizeClip)` for `offset` (R is orthonormal,
        // so its inverse is its transpose): offset = R(-rotation) * (a, b).
        const offsetX = a * cosR + b * sinR
        const offsetY = -a * sinR + b * cosR
        // Closed bound on all four sides (see the file-header note on boundary convention) - not
        // the half-open rule GPU rasterization uses on two of its four edges.
        if (offsetX < -1 || offsetX > 1 || offsetY < -1 || offsetY > 1) continue

        const u = offsetX * 0.5 + 0.5
        const spriteV = offsetY * 0.5 + 0.5
        evaluateBillboardFragment(shapeMode, spriteTex, u, spriteV, agentColor, opacity, src)

        const offset = (storageRow * destWidth + col) * 4
        if (premultiplied) {
          const inverseSrcAlpha = 1 - src[3]
          data[offset] = src[0] + data[offset] * inverseSrcAlpha
          data[offset + 1] = src[1] + data[offset + 1] * inverseSrcAlpha
          data[offset + 2] = src[2] + data[offset + 2] * inverseSrcAlpha
          data[offset + 3] = src[3] + data[offset + 3] * inverseSrcAlpha
        } else {
          data[offset] += src[0]
          data[offset + 1] += src[1]
          data[offset + 2] += src[2]
          data[offset + 3] += src[3]
        }
        pixels += 1
      }
    }
  }

  return { pixels }
}
