const F32 = Math.fround

function add(left, right) { return F32(left + right) }
function sub(left, right) { return F32(left - right) }
function mul(left, right) { return F32(left * right) }
function div(left, right) { return F32(left / right) }

function clamp01(value) {
  return value <= 0 ? 0 : value >= 1 ? 1 : value
}

function srgbToLinear(value) {
  value = clamp01(value)
  if (value <= F32(0.04045)) return div(value, F32(12.92))
  return F32(Math.pow(div(add(value, F32(0.055)), F32(1.055)), F32(2.4)))
}

function cubeRoot(value) {
  if (value === 0) return 0
  return mul(value >= 0 ? 1 : -1, F32(Math.pow(Math.abs(value), div(1, 3))))
}

function oklabLightness(red, green, blue) {
  const r = srgbToLinear(red)
  const g = srgbToLinear(green)
  const b = srgbToLinear(blue)
  const l = add(add(mul(F32(0.4121656120), r), mul(F32(0.5362752080), g)), mul(F32(0.0514575653), b))
  const m = add(add(mul(F32(0.2118591070), r), mul(F32(0.6807189584), g)), mul(F32(0.1074065790), b))
  const s = add(add(mul(F32(0.0883097947), r), mul(F32(0.2818474174), g)), mul(F32(0.6302613616), b))
  return clamp01(add(add(mul(F32(0.2104542553), cubeRoot(l)), mul(F32(0.7936177850), cubeRoot(m))), mul(F32(-0.0040720468), cubeRoot(s))))
}

function texelOffset(surface, shaderX, shaderY) {
  const x = Math.min(Math.max(shaderX | 0, 0), surface.width - 1)
  const y = surface.height - 1 - Math.min(Math.max(shaderY | 0, 0), surface.height - 1)
  return (y * surface.width + x) * 4
}

function lightnessAt(surface, shaderX, shaderY) {
  const offset = texelOffset(surface, shaderX, shaderY)
  return oklabLightness(surface.data[offset], surface.data[offset + 1], surface.data[offset + 2])
}

export function pixelSortLuminanceFactory($bindings, $runtime) {
  return function pixelSortLuminanceKernel(context, out) {
    $runtime.beginPixel(context)
    const x = context.fragCoord[0] | 0
    const y = context.fragCoord[1] | 0
    out[0] = lightnessAt($bindings.inputTex, x, y)
    out[1] = F32(x / ($bindings.inputTex.width - 1))
    out[2] = 0
    out[3] = 1
  }
}

export function reindexStatsFactory($bindings, $runtime) {
  return function reindexStatsKernel(context, out) {
    $runtime.beginPixel(context)
    const originX = context.fragCoord[0] | 0
    const originY = context.fragCoord[1] | 0
    if (originX % 8 !== 0 || originY % 8 !== 0) {
      out.fill(0)
      return
    }
    let minimum = F32(3.402823466e38)
    let maximum = F32(-3.402823466e38)
    for (let y = originY; y < Math.min(originY + 8, $bindings.inputTex.height); y += 1) {
      for (let x = originX; x < Math.min(originX + 8, $bindings.inputTex.width); x += 1) {
        const value = lightnessAt($bindings.inputTex, x, y)
        minimum = Math.min(minimum, value)
        maximum = Math.max(maximum, value)
      }
    }
    out[0] = minimum
    out[1] = maximum
    out[2] = 0
    out[3] = 1
  }
}

export function reindexApplyFactory($bindings, $runtime) {
  return function reindexApplyKernel(context, out) {
    $runtime.beginPixel(context)
    const input = $bindings.inputTex
    const x = context.fragCoord[0] | 0
    const y = context.fragCoord[1] | 0
    const reference = lightnessAt(input, x, y)
    const statsOffset = texelOffset($bindings.statsTex, 0, 0)
    const minimum = $bindings.statsTex.data[statsOffset]
    const maximum = $bindings.statsTex.data[statsOffset + 1]
    const range = sub(maximum, minimum)
    let normalized = reference
    if (range > F32(0.0001)) normalized = clamp01(div(sub(reference, minimum), range))
    const dimension = Math.min(input.width, input.height)
    const offsetValue = add(mul(mul(normalized, F32($bindings.uDisplacement)), F32(dimension)), normalized)
    const sampleX = Math.min(F32((offsetValue / input.width - Math.floor(offsetValue / input.width)) * input.width) | 0, input.width - 1)
    const sampleY = Math.min(F32((offsetValue / input.height - Math.floor(offsetValue / input.height)) * input.height) | 0, input.height - 1)
    const offset = texelOffset(input, sampleX, sampleY)
    out[0] = input.data[offset]
    out[1] = input.data[offset + 1]
    out[2] = input.data[offset + 2]
    out[3] = input.data[offset + 3]
  }
}
