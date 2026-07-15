import { canonicalKernelFactories } from '../generated/canonical-kernels.js'

const F32 = Math.fround
const TAU = F32(6.28318530718)
const HASH_DENOMINATOR = F32(0xffffffff)
const bitsBuffer = new ArrayBuffer(4)
const bitsFloat = new Float32Array(bitsBuffer)
const bitsUint = new Uint32Array(bitsBuffer)

function add(left, right) { return F32(left + right) }
function sub(left, right) { return F32(left - right) }
function mul(left, right) { return F32(left * right) }
function div(left, right) { return F32(left / right) }
function fract(value) { return F32(value - Math.floor(value)) }
function mod(value, divisor) { return F32(value - divisor * Math.floor(value / divisor)) }

function floatBitsToUint(value) {
  bitsFloat[0] = value
  return bitsUint[0]
}

function pcgX(x, y, z) {
  x = (Math.imul(x, 1664525) + 1013904223) >>> 0
  y = (Math.imul(y, 1664525) + 1013904223) >>> 0
  z = (Math.imul(z, 1664525) + 1013904223) >>> 0
  x = (x + Math.imul(y, z)) >>> 0
  y = (y + Math.imul(z, x)) >>> 0
  z = (z + Math.imul(x, y)) >>> 0
  x = (x ^ (x >>> 16)) >>> 0
  y = (y ^ (y >>> 16)) >>> 0
  z = (z ^ (z >>> 16)) >>> 0
  x = (x + Math.imul(y, z)) >>> 0
  y = (y + Math.imul(z, x)) >>> 0
  z = (z + Math.imul(x, y)) >>> 0
  return x
}

function periodic(value) {
  return mul(add(F32(Math.sin(mul(value, TAU))), 1), 0.5)
}

function randomX(stX, stY, xFrequency, yFrequency, seed, offsetX) {
  const latticeX = mul(stX, xFrequency)
  const latticeY = mul(stY, yFrequency)
  const floorX = Math.floor(latticeX)
  const floorY = Math.floor(latticeY)
  const fracX = sub(latticeX, floorX)
  const seedInteger = Math.floor(seed) | 0
  const seedFraction = fract(seed)
  const xi = (floorX + offsetX + seedInteger + Math.floor(fracX + seedFraction)) | 0
  const yi = floorY | 0
  const seedBits = floatBitsToUint(seed)
  const fractionBits = floatBitsToUint(seedFraction)
  const jitterX = (Math.imul(fractionBits, 374761393) ^ 0x9e3779b9) >>> 0
  const jitterY = (Math.imul(fractionBits, 668265263) ^ 0x7f4a7c15) >>> 0
  const jitterZ = (Math.imul(fractionBits, 2246822519) ^ 0x94d049b4) >>> 0
  const value = pcgX((xi >>> 0) ^ jitterX, (yi >>> 0) ^ jitterY, seedBits ^ jitterZ)
  return div(F32(value), HASH_DENOMINATOR)
}

function constant(stX, stY, xFrequency, yFrequency, seed, time, speed) {
  const randomTime = randomX(stX, stY, xFrequency, yFrequency, seed, 40)
  const speedScale = div(mul(Math.abs(speed), F32(0.333)), 100)
  const scaledTime = mul(periodic(sub(randomTime, time)), speedScale)
  const random = randomX(stX, stY, xFrequency, yFrequency, seed, 0)
  return periodic(sub(random, scaledTime))
}

function maskValue(stX, stY, xFrequency, yFrequency, seed, time, speed) {
  return constant(stX, stY, xFrequency, yFrequency, seed, time, speed)
}

function invaders(stX, stY, frequency, seed, time, speed) {
  const xMod = mod(Math.floor(mul(stX, frequency)), frequency)
  const yMod = mod(Math.floor(mul(stY, frequency)), frequency)
  if (xMod === 0 || yMod === 0 || xMod === frequency - 1 || yMod === frequency - 1) return 0
  if (xMod >= mul(frequency, 0.5)) {
    const mirrorX = add(Math.floor(stX), sub(1, fract(stX)))
    return maskValue(mirrorX, stY, frequency, frequency, seed, time, speed)
  }
  return maskValue(stX, stY, frequency, frequency, seed, time, speed)
}

function glyphs(stX, stY, frequency, seed, time, speed) {
  const xFrequency = Math.floor(mul(frequency, 0.75))
  const xMod = mod(Math.floor(mul(stX, xFrequency)), xFrequency)
  const yMod = mod(Math.floor(mul(stY, frequency)), frequency)
  if (xMod === 0 || yMod === 0 || xMod === xFrequency - 1 || yMod === frequency - 1) return 0
  return maskValue(stX, stY, xFrequency, frequency, seed, time, speed)
}

function arecibo(stX, stY, xFrequency, yFrequency, seed, time, speed) {
  const xMod = mod(Math.floor(mul(stX, xFrequency)), xFrequency)
  const yMod = mod(Math.floor(mul(stY, yFrequency)), yFrequency)
  if (xMod === 0 || yMod === 0 || xMod === xFrequency - 1 || yMod === yFrequency - 1) return 0
  if (yMod === 1) return xMod === 1 ? 1 : 0
  return maskValue(stX, stY, xFrequency, yFrequency, seed, time, speed)
}

function bitMaskValue(stX, stY, frequency, seed, formula, time, speed) {
  if (formula === 10 || formula === 11) return invaders(stX, stY, frequency, seed, time, speed)
  if (formula === 20) return glyphs(stX, stY, frequency, seed, time, speed)
  if (formula === 30) {
    return arecibo(stX, stY, Math.floor(mul(frequency, 0.5)) + 1, Math.floor(frequency), seed, time, speed)
  }
  return 1
}

function hsvToRgb(hue, saturation, value, out) {
  const h = fract(hue)
  const c = mul(value, saturation)
  const x = mul(c, sub(1, Math.abs(sub(mod(mul(h, 6), 2), 1))))
  const m = sub(value, c)
  let r = 0
  let g = 0
  let b = 0
  if (h < F32(1 / 6)) {
    r = c; g = x
  } else if (h < F32(2 / 6)) {
    r = x; g = c
  } else if (h < F32(3 / 6)) {
    g = c; b = x
  } else if (h < F32(4 / 6)) {
    g = x; b = c
  } else if (h < F32(5 / 6)) {
    r = x; b = c
  } else if (h < 1) {
    r = c; b = x
  }
  out[0] = add(r, m)
  out[1] = add(g, m)
  out[2] = add(b, m)
}

function bitMaskKernel($bindings, $runtime) {
  const fullResolution = $bindings.fullResolution
  const tileOffset = $bindings.tileOffset
  const seed = $bindings.seed
  const time = $bindings.time
  const speed = $bindings.speed
  const tiles = $bindings.tiles
  const complexity = $bindings.complexity
  const formula = $bindings.MASK_FORMULA
  const colorScheme = $bindings.MASK_COLOR_SCHEME
  const baseHueRange = $bindings.baseHueRange
  const hueRange = $bindings.hueRange
  const hueRotation = $bindings.hueRotation
  const aspect = div(fullResolution[0], fullResolution[1])
  const halfAspect = mul(0.5, aspect)
  const frequency = Math.floor(F32(5 + F32(12 - 5) * div(sub(complexity, 1), F32(100 - 1))))

  return function bitMaskPixel(context, out) {
    $runtime.beginPixel(context)
    const globalX = add(context.fragCoord[0], tileOffset[0])
    const globalY = add(context.fragCoord[1], tileOffset[1])
    let stX = add(div(globalX, fullResolution[1]), add(seed, 1000))
    let stY = add(div(globalY, fullResolution[1]), add(seed, 1000))
    stX = sub(stX, halfAspect)
    stY = sub(stY, 0.5)
    stX = mul(stX, tiles)
    stY = mul(stY, tiles)
    stX = add(stX, halfAspect)
    stY = add(stY, 0.5)
    stX = sub(stX, halfAspect)
    if (formula === 11) stY = mul(stY, 2)

    const mask = bitMaskValue(stX, stY, frequency, -100, formula, time, speed) > 0.5 ? 1 : 0
    if (colorScheme === 0) {
      out[0] = mask
      out[1] = mask
      out[2] = mask
      out[3] = 1
      return
    }

    const baseHue = add(0.01, mul(mul(maskValue(stX, stY, 1, 1, -100, time, speed), baseHueRange), 0.01))
    const hue = mul(fract(add(add(baseHue, mul(mul(bitMaskValue(stX, stY, frequency, 0, formula, time, speed), hueRange), 0.01)), sub(1, div(hueRotation, 360)))), mask)
    const saturation = colorScheme === 3
      ? mask
      : mul(bitMaskValue(stX, stY, frequency, 25, formula, time, speed), mask)
    const value = colorScheme === 2 || colorScheme === 3
      ? mask
      : mul(bitMaskValue(stX, stY, frequency, 50, formula, time, speed), mask)
    hsvToRgb(hue, saturation, value, out)
    out[3] = 1
  }
}

export function bitEffectsFactory($bindings, $runtime) {
  if ($bindings.MODE === 0) {
    return canonicalKernelFactories['classicNoisedeck/bitEffects:bitEffects']($bindings, $runtime)
  }
  return bitMaskKernel($bindings, $runtime)
}
