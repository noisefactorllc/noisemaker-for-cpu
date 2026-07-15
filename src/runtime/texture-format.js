const floatBitsBuffer = new ArrayBuffer(4)
const floatBitsValue = new Float32Array(floatBitsBuffer)
const floatBitsUint = new Uint32Array(floatBitsBuffer)

function decodeFloat16(bits) {
  const sign = (bits & 0x8000) === 0 ? 1 : -1
  const exponent = (bits >>> 10) & 0x1f
  const fraction = bits & 0x3ff
  if (exponent === 0) return sign * fraction * 2 ** -24
  if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : NaN
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15)
}

// A 256 KiB table removes exponentiation and branching from every pass-output
// channel. The table is shared for the lifetime of the module.
const float16Values = new Float32Array(0x10000)
for (let bits = 0; bits < float16Values.length; bits += 1) float16Values[bits] = decodeFloat16(bits)

/** Match the reference WebGL rgba16f attachment conversion (round toward zero). */
export function float16Truncate(value) {
  floatBitsValue[0] = value
  const bits = floatBitsUint[0]
  const sign = (bits >>> 16) & 0x8000
  const sourceExponent = (bits >>> 23) & 0xff
  const fraction = bits & 0x7fffff
  if (sourceExponent === 0xff) {
    return fraction === 0 ? (sign === 0 ? Infinity : -Infinity) : NaN
  }
  const exponent = sourceExponent - 127 + 15
  let halfBits
  if (exponent >= 0x1f) {
    halfBits = sign | 0x7bff
  } else if (exponent <= 0) {
    halfBits = exponent < -10
      ? sign
      : sign | (((fraction | 0x800000) >>> (1 - exponent)) >>> 13)
  } else {
    halfBits = sign | (exponent << 10) | (fraction >>> 13)
  }
  return float16Values[halfBits]
}

export function quantizeTexture(surface, format = 'rgba16f') {
  const data = surface.data
  if (format === 'rgba16f' || format === 'rgba16float') {
    for (let index = 0; index < data.length; index += 1) data[index] = float16Truncate(data[index])
  } else if (format === 'rgba8' || format === 'rgba8unorm') {
    const scale = 1 / 255
    for (let index = 0; index < data.length; index += 1) {
      const value = data[index]
      data[index] = value <= 0 ? 0 : value >= 1 ? 1 : Math.round(value * 255) * scale
    }
  }
  return surface
}
