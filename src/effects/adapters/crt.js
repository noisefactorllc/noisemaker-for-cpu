// Direct float32 translation of the pinned canonical crt.glsl. This explicit
// compatibility adapter is an implementation route for the same effect, not a
// different algorithm: every operation rounds to float32 in the order that
// ANGLE's Metal build evaluates the shader on the Apple M2 / macOS 14 host,
// whose capture matches the retained golden within one byte. The M4 / macOS 26
// compile differs. docs/CRT-PARITY.md records the probes behind each rule below.
const F = Math.fround
const f32 = new Float32Array(1)
const u32 = new Uint32Array(f32.buffer)

function bitsOf(value) { f32[0] = value; return u32[0] }
function fromBits(bits) { u32[0] = bits; return f32[0] }

// Exactly rounded float32 fused multiply-add of float32 operands. The float64
// product is exact; TwoSum recovers the addition error so a float32 tie
// produced by the float64 sum resolves in the direction of the exact result.
export function fma32(a, b, c) {
  const product = a * b
  const sum = product + c
  const back = sum - product
  const error = (product - (sum - back)) + (c - back)
  const rounded = F(sum)
  if (error === 0 || rounded === sum) return rounded
  const towardSum = sum > rounded ? 1 : -1
  const neighbor = rounded === 0
    ? towardSum * fromBits(1)
    : fromBits(bitsOf(rounded) + ((rounded > 0) === (towardSum > 0) ? 1 : -1))
  if ((rounded + neighbor) / 2 !== sum) return rounded
  return error > 0 ? Math.max(rounded, neighbor) : Math.min(rounded, neighbor)
}

const add = (a, b) => F(a + b)
const sub = (a, b) => F(a - b)
const mul = (a, b) => F(a * b)
// Metal lowers a / b to a times the float32 reciprocal of b.
const div = (a, b) => F(a * F(1 / b))
const fract = (value) => F(value - Math.floor(value))
const clamp = (value, low, high) => Math.min(Math.max(value, low), high)
const clamp01 = (value) => clamp(value, 0, 1)
const sqrt = (value) => F(Math.sqrt(value))
// mix(a, b, t) lowers to fma(t, b - a, a).
const mix = (a, b, t) => fma32(t, sub(b, a), a)
// length(): one rounded square, then the second square fused into it.
const length2 = (x, y) => sqrt(fma32(y, y, mul(x, x)))
const dot3 = (ax, ay, az, bx, by, bz) => fma32(az, bz, fma32(ay, by, mul(ax, bx)))

const INV_TAU = F(1 / (2 * Math.PI))
const TAU = F(6.28318530717958647692)
const PI = F(3.14159265358979323846)
const INV_THREE = F(0.3333333333333333)
const HASH = F(43758.5453123)
const HASH3 = F(43758.5453)

// Apple GPU sine. The angle reduces to quadrants as r = 4 * fract(x * (1/tau))
// in float32. The hardware folds r to y in [0, 1] (quadrants 1 and 3 mirror,
// quadrants 2 and 3 negate) and returns the float32 product y * P(y), where P is
// its float32 approximation of sin(pi*y/2)/y. Probes measured both properties
// with no exception: one output per reduced r, and the fold symmetry.
//
// P's exact hardware formula is unknown, so it is modelled as the exact quotient
// minus a residual in units of 2^-23 (the ulp of P), a three-term Chebyshev
// series in z = 2y^2 - 1. The coefficients are a least-violation linear-program
// fit to M2 hardware sine values (WebGL2, ANGLE Metal, macOS 14.8.3). The probe
// inputs were a uniform grid of 262,144 angles over one turn and 262,144 random
// angles in [90, 140], the range of the CRT hash inputs. Together they give
// 270,605 distinct folded positions. They are not values from a CRT fixture.
// The fit reproduces 234,624 of those values (86.7%) bit-exactly and the rest
// within 2 ulp. See docs/CRT-PARITY.md.
function quadrantSine(r) {
  const n = Math.floor(r)
  const f = r - n
  const y = (n & 1) ? 1 - f : f
  if (y === 0) return n >= 2 ? -0 : 0
  const z = 2 * y * y - 1
  const quotient = Math.sin(y * Math.PI / 2) / y
  const p = F(quotient - 2 ** -23 * (0.783734 + 0.010102 * z + 0.052674 * (2 * z * z - 1)))
  const value = F(y * p)
  return n >= 2 ? -value : value
}
const quadrantOfTurns = (turns) => F(4 * (turns - Math.floor(turns)))
const sin = (x) => quadrantSine(quadrantOfTurns(F(x * INV_TAU)))
// The compiler merges the reduction multiply into a preceding constant
// multiply: sin(t * TAU) reduces t itself, cos(t * TAU) reduces t + 1/4, and
// cos(m * PI) reduces fma(m, 1/2, 1/4).
const sinTurns = (turns) => quadrantSine(quadrantOfTurns(turns))
const cosTurns = (turns) => quadrantSine(quadrantOfTurns(add(turns, 0.25)))
const cosHalfTurns = (halfTurns) => quadrantSine(quadrantOfTurns(fma32(halfTurns, 0.5, 0.25)))

const periodicValue = (time, value) => fma32(sinTurns(sub(time, value)), 0.5, 0.5)
const C289 = F(1 / 289)
const mod289 = (x) => sub(x, mul(Math.floor(mul(x, C289)), 289))
const permute = (x) => mod289(mul(fma32(x, 34, 1), x))
const TAYLOR_A = F(1.79284291400159)
const TAYLOR_B = F(0.85373472095314)
const C_X = F(1 / 6)
const C_Y = F(1 / 3)
const N_ = F(0.14285714285714285)
const NS_X = mul(N_, 2)
const NS_Y = sub(mul(N_, 0.5), 1)
const NS_Z = N_
const M0 = F(0.6)

const gradient = new Float32Array(12)
const corners = new Float32Array(12)
function simplexNoise(vx, vy, vz) {
  const dv = dot3(vx, vy, vz, C_Y, C_Y, C_Y)
  const i0x = Math.floor(add(vx, dv))
  const i0y = Math.floor(add(vy, dv))
  const i0z = Math.floor(add(vz, dv))
  const di = dot3(i0x, i0y, i0z, C_X, C_X, C_X)
  const x0x = add(sub(vx, i0x), di)
  const x0y = add(sub(vy, i0y), di)
  const x0z = add(sub(vz, i0z), di)
  const s1x = x0x < x0y ? 0 : 1
  const s1y = x0y < x0z ? 0 : 1
  const s1z = x0z < x0x ? 0 : 1
  const lx = 1 - s1z
  const ly = 1 - s1x
  const lz = 1 - s1y
  const i1x = Math.min(s1x, lx), i1y = Math.min(s1y, ly), i1z = Math.min(s1z, lz)
  const i2x = Math.max(s1x, lx), i2y = Math.max(s1y, ly), i2z = Math.max(s1z, lz)
  corners[0] = x0x; corners[1] = x0y; corners[2] = x0z
  corners[3] = add(sub(x0x, i1x), C_X); corners[4] = add(sub(x0y, i1y), C_X); corners[5] = add(sub(x0z, i1z), C_X)
  corners[6] = add(sub(x0x, i2x), C_Y); corners[7] = add(sub(x0y, i2y), C_Y); corners[8] = add(sub(x0z, i2z), C_Y)
  corners[9] = sub(x0x, 0.5); corners[10] = sub(x0y, 0.5); corners[11] = sub(x0z, 0.5)
  const ix = mod289(i0x)
  const iy = mod289(i0y)
  const iz = mod289(i0z)
  const offsetsX = [0, i1x, i2x, 1]
  const offsetsY = [0, i1y, i2y, 1]
  const offsetsZ = [0, i1z, i2z, 1]
  const p = [0, 0, 0, 0]
  for (let k = 0; k < 4; k += 1) {
    const pz = permute(add(iz, offsetsZ[k]))
    const py = permute(add(add(pz, iy), offsetsY[k]))
    p[k] = permute(add(add(py, ix), offsetsX[k]))
  }
  const x = [0, 0, 0, 0]
  const y = [0, 0, 0, 0]
  const h = [0, 0, 0, 0]
  for (let k = 0; k < 4; k += 1) {
    const j = sub(p[k], mul(49, Math.floor(mul(mul(p[k], NS_Z), NS_Z))))
    const xi = Math.floor(mul(j, NS_Z))
    const yi = Math.floor(sub(j, mul(7, xi)))
    x[k] = fma32(xi, NS_X, NS_Y)
    y[k] = fma32(yi, NS_X, NS_Y)
    h[k] = sub(sub(1, Math.abs(x[k])), Math.abs(y[k]))
  }
  const b0 = [x[0], x[1], y[0], y[1]]
  const b1 = [x[2], x[3], y[2], y[3]]
  const s0 = b0.map((value) => add(mul(Math.floor(value), 2), 1))
  const s1 = b1.map((value) => add(mul(Math.floor(value), 2), 1))
  const sh = h.map((value) => (value > 0 ? 0 : -1))
  gradient[0] = fma32(s0[0], sh[0], b0[0]); gradient[1] = fma32(s0[2], sh[0], b0[2]); gradient[2] = h[0]
  gradient[3] = fma32(s0[1], sh[1], b0[1]); gradient[4] = fma32(s0[3], sh[1], b0[3]); gradient[5] = h[1]
  gradient[6] = fma32(s1[0], sh[2], b1[0]); gradient[7] = fma32(s1[2], sh[2], b1[2]); gradient[8] = h[2]
  gradient[9] = fma32(s1[1], sh[3], b1[1]); gradient[10] = fma32(s1[3], sh[3], b1[3]); gradient[11] = h[3]
  let sum = 0
  for (let k = 0; k < 4; k += 1) {
    const g = k * 3
    const gx = gradient[g], gy = gradient[g + 1], gz = gradient[g + 2]
    const norm = fma32(-TAYLOR_B, dot3(gx, gy, gz, gx, gy, gz), TAYLOR_A)
    const cx = corners[g], cy = corners[g + 1], cz = corners[g + 2]
    const m = Math.max(sub(M0, dot3(cx, cy, cz, cx, cy, cz)), 0)
    const msq = mul(m, m)
    const term = dot3(mul(gx, norm), mul(gy, norm), mul(gz, norm), cx, cy, cz)
    sum = k === 0 ? mul(mul(msq, msq), term) : fma32(mul(msq, msq), term, sum)
  }
  return mul(42, sum)
}

function wrapFloat(value, limit) {
  if (limit <= 0) return 0
  let result = fma32(-Math.floor(div(value, limit)), limit, value)
  if (result < 0) result = add(result, limit)
  return result
}

function freqForShape(baseFreq, width, height) {
  const freq = Math.max(baseFreq, 1)
  const widthSafe = Math.max(width, 1)
  const heightSafe = Math.max(height, 1)
  if (Math.abs(sub(widthSafe, heightSafe)) < F(1e-5)) return [freq, freq]
  if (heightSafe < widthSafe) return [freq, Math.max(Math.floor(div(mul(freq, widthSafe), heightSafe)), 1)]
  return [Math.max(Math.floor(div(mul(freq, heightSafe), widthSafe)), 1), freq]
}

function valueNoiseHash(cx, cy, cz, seed) {
  const dotValue = fma32(seed, F(0.001), dot3(cx, cy, cz, F(12.9898), F(78.233), F(37.719)))
  return fract(mul(sin(dotValue), HASH3))
}
const fade = (value) => mul(mul(value, value), fma32(-2, value, 3))
const lerp = (a, b, t) => fma32(sub(b, a), t, a)

function valueNoise3d(x, y, z, seed) {
  const cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z)
  const tx = fade(sub(x, cx)), ty = fade(sub(y, cy)), tz = fade(sub(z, cz))
  const h = (dx, dy, dz) => valueNoiseHash(cx + dx, cy + dy, cz + dz, seed)
  const x00 = lerp(h(0, 0, 0), h(1, 0, 0), tx)
  const x10 = lerp(h(0, 1, 0), h(1, 1, 0), tx)
  const x01 = lerp(h(0, 0, 1), h(1, 0, 1), tx)
  const x11 = lerp(h(0, 1, 1), h(1, 1, 1), tx)
  return lerp(lerp(x00, x10, ty), lerp(x01, x11, ty), tz)
}

function rgbToHsv(r, g, b, out) {
  const cMax = Math.max(Math.max(r, g), b)
  const cMin = Math.min(Math.min(r, g), b)
  const delta = sub(cMax, cMin)
  let hue = 0
  if (delta > 0) {
    if (cMax === r) {
      let segment = div(sub(g, b), delta)
      if (segment < 0) segment = add(segment, 6)
      hue = segment
    } else if (cMax === g) {
      hue = add(div(sub(b, r), delta), 2)
    } else {
      hue = add(div(sub(r, g), delta), 4)
    }
    hue = wrapUnit(div(hue, 6))
  }
  out[0] = hue
  out[1] = cMax !== 0 ? div(delta, cMax) : 0
  out[2] = cMax
  return out
}
function wrapUnit(value) {
  let wrapped = sub(value, Math.floor(value))
  if (wrapped < 0) wrapped = add(wrapped, 1)
  return wrapped
}
function hsvToRgb(h, s, v, out) {
  const dh = mul(h, 6)
  const oneMinusS = sub(1, s)
  out[0] = clamp01(mul(fma32(s, clamp01(sub(Math.abs(sub(dh, 3)), 1)), oneMinusS), v))
  out[1] = clamp01(mul(fma32(s, clamp01(add(-Math.abs(sub(dh, 2)), 2)), oneMinusS), v))
  out[2] = clamp01(mul(fma32(s, clamp01(add(-Math.abs(sub(dh, 4)), 2)), oneMinusS), v))
  return out
}
const hsv = new Float32Array(3)
function adjustHue(r, g, b, amount, out) {
  rgbToHsv(r, g, b, hsv)
  return hsvToRgb(wrapUnit(add(hsv[0], amount)), clamp01(hsv[1]), clamp01(hsv[2]), out)
}
function adjustSaturation(r, g, b, amount, out) {
  rgbToHsv(r, g, b, hsv)
  return hsvToRgb(hsv[0], clamp01(mul(hsv[1], amount)), clamp01(hsv[2]), out)
}
const applyVignette = (value, brightness, mask, alpha) => mix(value, mix(value, brightness, mask), clamp01(alpha))

export function crtFactory($bindings, $runtime) {
  const { stdlib } = $runtime
  const input = $bindings.inputTex
  const resolution = $bindings.resolution
  const tileOffset = $bindings.tileOffset
  const renderScale = $bindings.renderScale
  const alphaVal = clamp01($bindings.alpha)
  const rs = Math.max(renderScale, 1)
  const fullRes = $bindings.fullResolution[0] > 0 ? $bindings.fullResolution : resolution
  const widthF = Math.max(div(fullRes[0], rs), 1)
  const heightF = Math.max(div(fullRes[1], rs), 1)
  const time = $bindings.time
  const speed = $bindings.speed
  const seed = $bindings.seed
  const freq = freqForShape(2, widthF, heightF)
  const freqX = Math.max(freq[1], 1)
  const freqY = Math.max(freq[0], 1)
  const widthSafe = Math.max(widthF, 1)
  const heightSafe = Math.max(heightF, 1)
  const displacement = 0.0625

  // animated_simplex_value's per-render terms.
  const zBase = mul(cosTurns(time), speed)
  const s = mul(seed, 73)
  const baseSeedX = add(17, s)
  const baseSeedY = fma32(s, F(1.1), 29)
  const baseSeedZ = fma32(s, F(0.7), 47)
  const timeSeedX = add(baseSeedX, 54)
  const timeSeedY = add(baseSeedY, 82)
  const timeSeedZ = add(baseSeedZ, 124)
  const animated = speed !== 0 && time !== 0

  function animatedSimplexValue(u, v) {
    const baseNoise = simplexNoise(add(u, baseSeedX), add(v, baseSeedY), add(zBase, baseSeedZ))
    let value = clamp01(fma32(baseNoise, 0.5, 0.5))
    if (animated) {
      const timeNoise = simplexNoise(add(u, timeSeedX), add(v, timeSeedY), timeSeedZ)
      const timeValue = clamp01(fma32(timeNoise, 0.5, 0.5))
      value = clamp01(periodicValue(mul(periodicValue(time, timeValue), speed), value))
    }
    return clamp01(value)
  }

  const aspect = div(widthSafe, heightSafe)
  const maxRadius = length2(mul(aspect, 0.5), 0.5)
  function lensOffsets(sampleX, sampleY, out) {
    const wrappedX = wrapFloat(sampleX, widthSafe)
    const wrappedY = wrapFloat(sampleY, heightSafe)
    const noise = animatedSimplexValue(mul(div(wrappedX, widthSafe), freqX), mul(div(wrappedY, heightSafe), freqY))
    const dx = Math.abs(sub(div(add(wrappedX, 0.5), widthSafe), 0.5))
    const dy = Math.abs(sub(div(add(wrappedY, 0.5), heightSafe), 0.5))
    let mask = 0
    if (maxRadius > 0) {
      const normalized = clamp01(div(length2(mul(dx, aspect), dy), maxRadius))
      const masked = sqrt(normalized)
      const squared = mul(masked, masked)
      mask = mul(mul(squared, squared), masked)
    }
    const distortion = mul(fma32(noise, 2, -1), mask)
    out[0] = mul(mul(cosTurns(distortion), displacement), widthSafe)
    out[1] = mul(mul(sinTurns(distortion), displacement), heightSafe)
    return out
  }

  // get_scanline_base_values.
  const timeScaled = mul(mul(time, speed), F(0.1))
  const noiseSeed = fma32(seed, 31, F(19.37))
  const scanBase0 = valueNoise3d(0, 0, timeScaled, noiseSeed)
  const scanBase1 = valueNoise3d(1, 0, timeScaled, noiseSeed)
  const PIXELS_PER_BAR = 2.5
  const scanRow = (row) => (Math.trunc(Math.floor(div(row, PIXELS_PER_BAR))) % 2 === 0 ? scanBase0 : scanBase1)
  function sampleScanline(sampleX, sampleY) {
    let wrappedX = fma32(-Math.floor(div(sampleX, widthF)), widthF, sampleX)
    let wrappedY = fma32(-Math.floor(div(sampleY, heightF)), heightF, sampleY)
    if (wrappedX < 0) wrappedX = add(wrappedX, widthF)
    if (wrappedY < 0) wrappedY = add(wrappedY, heightF)
    wrappedX = clamp(wrappedX, 0, sub(widthF, 1))
    wrappedY = clamp(wrappedY, 0, sub(heightF, 1))
    const y0 = Math.floor(wrappedY)
    const y1 = Math.min(add(y0, 1), sub(heightF, 1))
    const xFract = clamp01(sub(wrappedX, Math.floor(wrappedX)))
    const yFract = clamp01(sub(wrappedY, y0))
    const top = scanRow(y0)
    const bottom = scanRow(y1)
    return mix(mix(top, top, xFract), mix(bottom, bottom, xFract), yFract)
  }

  // The four seed hashes. The compiler distributes the sine reduction
  // multiply over seed_base + c: the reduced turns are
  // fma(seed, 73/tau, (17 + c)/tau), never a rounded seed_base + c.
  const seedHash = (offset) => fract(mul(sinTurnsFromSeed(offset), HASH))
  function sinTurnsFromSeed(offset) {
    return quadrantSine(quadrantOfTurns(fma32(seed, F(73 * INV_TAU), F(F(17 + F(offset)) * INV_TAU))))
  }
  const displacementBase = fma32(seedHash(0.37), F(0.00625), F(0.0125))
  const simplexValue = seedHash(0.73)
  const displacementPixels = mul(mul(displacementBase, widthF), simplexValue)
  const hueShift = fma32(seedHash(1.91), 0.25, -0.125)
  const vignetteAlpha = mul(seedHash(3.17), F(0.175))

  // blend_cosine: mix() expands to a*(1-w) + b*w. With w = (1 - cos)*0.5 the
  // compiler folds 1 - w to 0.5 + 0.5*cos, so the lerp is not re-formed into
  // fma(w, b - a, a); the b*w product fuses into the final add.
  function blendCosine(a, b, value) {
    const c = cosHalfTurns(clamp01(value))
    const weight = mul(sub(1, c), 0.5)
    return fma32(b, weight, mul(a, fma32(0.5, c, 0.5)))
  }

  const offsets = new Float32Array(2)
  const red = new Float32Array(3)
  const green = new Float32Array(3)
  const blue = new Float32Array(3)
  const color = new Float32Array(3)
  const coord = new Int32Array(2)
  const fetch = (x, y) => { coord[0] = x; coord[1] = y; return stdlib.texelFetch(input, coord, 0) }
  const blendScan = (value, scan) => mix(value, mul(add(value, scan), scan), 0.5)

  return function crtKernel(context, out) {
    $runtime.beginPixel(context)
    const gx = context.fragCoord[0] | 0
    const gy = context.fragCoord[1] | 0
    const baseSample = fetch(gx, gy)
    const baseR = baseSample[0], baseG = baseSample[1], baseB = baseSample[2], baseA = baseSample[3]
    if (alphaVal === 0) {
      out[0] = baseR; out[1] = baseG; out[2] = baseB; out[3] = baseA
      return
    }
    const x = div(add(gx, tileOffset[0]), rs)
    const y = div(add(gy, tileOffset[1]), rs)
    lensOffsets(x, y, offsets)
    const scanValue = sampleScanline(add(x, offsets[0]), add(y, offsets[1]))
    const greenR = clamp01(blendScan(baseR, scanValue))
    const greenG = clamp01(blendScan(baseG, scanValue))
    const greenB = clamp01(blendScan(baseB, scanValue))

    const dx = div(sub(x, mul(widthF, 0.5)), widthF)
    const dy = div(sub(y, mul(heightF, 0.5)), heightF)
    const singularity = length2(dx, dy)
    const aberMask = mul(mul(singularity, singularity), singularity)
    const gradientX = clamp01(div(x, sub(widthF, 1)))

    const redX = mix(Math.min(add(x, displacementPixels), sub(widthF, 1)), x, gradientX)
    const redSampleX = blendCosine(x, redX, aberMask)
    const redFetch = fetch(Math.trunc(sub(mul(redSampleX, renderScale), tileOffset[0])), gy)
    const redR = redFetch[0], redG = redFetch[1], redB = redFetch[2]
    lensOffsets(redSampleX, y, offsets)
    const redScan = sampleScanline(add(redSampleX, offsets[0]), add(y, offsets[1]))

    const blueX = mix(x, Math.max(sub(x, displacementPixels), 0), gradientX)
    const blueSampleX = blendCosine(x, blueX, aberMask)
    const blueFetch = fetch(Math.trunc(sub(mul(blueSampleX, renderScale), tileOffset[0])), gy)
    const blueR = blueFetch[0], blueG = blueFetch[1], blueB = blueFetch[2]
    lensOffsets(blueSampleX, y, offsets)
    const blueScan = sampleScanline(add(blueSampleX, offsets[0]), add(y, offsets[1]))

    adjustHue(blendScan(redR, redScan), blendScan(redG, redScan), blendScan(redB, redScan), hueShift, red)
    adjustHue(greenR, greenG, greenB, hueShift, green)
    adjustHue(blendScan(blueR, blueScan), blendScan(blueG, blueScan), blendScan(blueB, blueScan), hueShift, blue)
    adjustHue(red[0], green[1], blue[2], -hueShift, color)
    adjustSaturation(color[0], color[1], color[2], 1.125, color)
    for (let channel = 0; channel < 3; channel += 1) color[channel] = applyVignette(color[channel], 0, singularity, vignetteAlpha)
    const localMean = mul(add(add(color[0], color[1]), color[2]), INV_THREE)
    const base = [baseR, baseG, baseB]
    for (let channel = 0; channel < 3; channel += 1) {
      const normalized = clamp01(fma32(sub(color[channel], localMean), 1.25, localMean))
      const quantized = div(Math.floor(fma32(clamp01(normalized), 255, 0.5)), 255)
      out[channel] = mix(base[channel], quantized, alphaVal)
    }
    out[3] = baseA
  }
}
