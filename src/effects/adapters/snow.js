const F32 = Math.fround
const TAU = F32(6.283185307179586)
const INV_TAU = F32(1 / 6.283185307179586)
const TIME_SEED_OFFSETS = new Float32Array([97, 57, 131])
const STATIC_SEED = new Float32Array([37, 17, 53])
const LIMITER_SEED = new Float32Array([113, 71, 193])

function add(left, right) { return F32(left + right) }
function sub(left, right) { return F32(left - right) }
function mul(left, right) { return F32(left * right) }
function div(left, right) { return F32(left / right) }
function fract(value) { return F32(value - Math.floor(value)) }
function clamp01(value) { return value <= 0 ? 0 : value >= 1 ? 1 : value }

function sine(value) {
  const turns = F32(value * INV_TAU)
  const phase = turns - Math.floor(turns)
  return F32(Math.sin(phase * TAU))
}
function cosine(value) { return F32(Math.cos(value)) }

function periodicValue(time, value) {
  return mul(add(sine(mul(sub(time, value), TAU)), 1), 0.5)
}

function snowHash(x, y, z) {
  const sx = fract(mul(x, F32(0.1031)))
  const sy = fract(mul(y, F32(0.1031)))
  const sz = fract(mul(z, F32(0.1031)))
  const dot = F32(
    F32(sx * add(sy, F32(33.33)) + mul(sy, add(sz, F32(33.33)))) +
    sz * add(sx, F32(33.33)),
  )
  const shiftedXY = F32(sx + sy + F32(2 * dot))
  return clamp01(fract(F32(shiftedXY * add(sz, dot))))
}

function snowNoise(x, y, time, speed, seed) {
  const angle = mul(time, TAU)
  const cosineValue = cosine(angle)
  const zBase = Math.abs(cosineValue) < F32(0.0000001) ? 0 : mul(cosineValue, speed)
  const baseValue = snowHash(add(x, seed[0]), add(y, seed[1]), add(zBase, seed[2]))
  if (speed === 0 || time === 0) return baseValue

  const timeSeedX = add(seed[0], TIME_SEED_OFFSETS[0])
  const timeSeedY = add(seed[1], TIME_SEED_OFFSETS[1])
  const timeSeedZ = add(seed[2], TIME_SEED_OFFSETS[2])
  const timeValue = snowHash(add(x, timeSeedX), add(y, timeSeedY), add(1, timeSeedZ))
  const scaledTime = mul(periodicValue(time, timeValue), speed)
  return clamp01(periodicValue(scaledTime, baseValue))
}

function texelOffset(surface, shaderX, shaderY) {
  const x = Math.min(Math.max(shaderX | 0, 0), surface.width - 1)
  const y = surface.height - 1 - Math.min(Math.max(shaderY | 0, 0), surface.height - 1)
  return (y * surface.width + x) * 4
}

export function snowFactory($bindings, $runtime) {
  return function snowKernel(context, out) {
    $runtime.beginPixel(context)
    const x = context.fragCoord[0]
    const y = context.fragCoord[1]
    const offset = texelOffset($bindings.inputTex, x, y)
    const source = $bindings.inputTex.data
    const alpha = clamp01($bindings.alpha)
    if (alpha === 0) {
      out.set(source.subarray(offset, offset + 4))
      return
    }

    const time = $bindings.pause > 0.5 ? 0 : $bindings.time
    const speed = F32(100)
    const staticValue = snowNoise(x, y, time, speed, STATIC_SEED)
    const limiterValue = snowNoise(x, y, time, speed, LIMITER_SEED)
    const density = Math.max(mul($bindings.density, F32(0.01)), F32(0.0001))
    const exponent = div(sub(1, density), density)
    const limiterMask = mul(F32(Math.pow(Math.min(limiterValue, F32(0.99)), exponent)), alpha)
    const inverseMask = sub(1, limiterMask)
    out[0] = F32(source[offset] * inverseMask + staticValue * limiterMask)
    out[1] = F32(source[offset + 1] * inverseMask + staticValue * limiterMask)
    out[2] = F32(source[offset + 2] * inverseMask + staticValue * limiterMask)
    out[3] = source[offset + 3]
  }
}
