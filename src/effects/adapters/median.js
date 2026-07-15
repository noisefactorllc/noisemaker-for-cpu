const bitsBuffer = new ArrayBuffer(4)
const bitsFloat = new Float32Array(bitsBuffer)
const bitsUint = new Uint32Array(bitsBuffer)

function floatBits(value) {
  bitsFloat[0] = value
  return bitsUint[0]
}

function floatToHalf(value) {
  if (Number.isNaN(value)) return 0x7e00
  if (value === Number.POSITIVE_INFINITY) return 0x7c00
  if (value === Number.NEGATIVE_INFINITY) return 0xfc00
  const bits = floatBits(value)
  const sign = (bits >>> 16) & 0x8000
  let exponent = ((bits >>> 23) & 0xff) - 127 + 15
  let fraction = bits & 0x7fffff
  if (exponent <= 0) {
    if (exponent < -10) return sign
    fraction = (fraction | 0x800000) >>> (1 - exponent)
    return sign | ((fraction + 0x1000) >>> 13)
  }
  if (exponent >= 31) return sign | 0x7c00
  fraction += 0x1000
  if (fraction & 0x800000) {
    fraction = 0
    exponent += 1
    if (exponent >= 31) return sign | 0x7c00
  }
  return sign | (exponent << 10) | (fraction >>> 13)
}

function halfToFloat(value) {
  const sign = value & 0x8000 ? -1 : 1
  const exponent = (value >>> 10) & 0x1f
  const fraction = value & 0x3ff
  if (exponent === 0) return sign * Math.pow(2, -14) * fraction / 1024
  if (exponent === 0x1f) return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY
  return sign * Math.pow(2, exponent - 15) * (1 + fraction / 1024)
}

export function medianFactory($bindings, $runtime) {
  const brightness = new Uint32Array(49)
  const redGreen = new Uint32Array(49)
  const blue = new Uint32Array(49)

  function less(left, right) {
    if (brightness[left] !== brightness[right]) return brightness[left] < brightness[right]
    if (redGreen[left] !== redGreen[right]) return redGreen[left] < redGreen[right]
    return blue[left] < blue[right]
  }

  function swap(left, right) {
    let value = brightness[left]
    brightness[left] = brightness[right]
    brightness[right] = value
    value = redGreen[left]
    redGreen[left] = redGreen[right]
    redGreen[right] = value
    value = blue[left]
    blue[left] = blue[right]
    blue[right] = value
  }

  return function medianKernel(context, out) {
    $runtime.beginPixel(context)
    const surface = $bindings.inputTex
    const radius = $bindings.RADIUS | 0
    const centerX = context.fragCoord[0] | 0
    const centerY = context.fragCoord[1] | 0
    const centerRow = surface.height - 1 - centerY
    const centerOffset = (centerRow * surface.width + centerX) * 4
    const originalRed = surface.data[centerOffset]
    const originalGreen = surface.data[centerOffset + 1]
    const originalBlue = surface.data[centerOffset + 2]
    let index = 0
    for (let y = -radius; y <= radius; y += 1) {
      const sampleY = Math.min(Math.max(centerY + y, 0), surface.height - 1)
      const sampleRow = surface.height - 1 - sampleY
      for (let x = -radius; x <= radius; x += 1) {
        const sampleX = Math.min(Math.max(centerX + x, 0), surface.width - 1)
        const offset = (sampleRow * surface.width + sampleX) * 4
        const red = surface.data[offset]
        const green = surface.data[offset + 1]
        const sampleBlue = surface.data[offset + 2]
        const luminance = Math.fround(Math.fround(Math.fround(red * 0.2126) + Math.fround(green * 0.7152)) + Math.fround(sampleBlue * 0.0722))
        const packedRed = floatToHalf(red)
        const packedGreen = floatToHalf(green)
        brightness[index] = floatBits(luminance)
        redGreen[index] = ((packedRed << 16) | packedGreen) >>> 0
        blue[index] = floatToHalf(sampleBlue)
        index += 1
      }
    }
    const count = index
    const medianIndex = (count - 1) >> 1
    let left = 0
    let right = count - 1
    while (left < right) {
      const pivotBrightness = brightness[medianIndex]
      const pivotRedGreen = redGreen[medianIndex]
      const pivotBlue = blue[medianIndex]
      let scanLeft = left
      let scanRight = right
      const lessPivot = (record) => brightness[record] !== pivotBrightness
        ? brightness[record] < pivotBrightness
        : redGreen[record] !== pivotRedGreen ? redGreen[record] < pivotRedGreen : blue[record] < pivotBlue
      const pivotLess = (record) => pivotBrightness !== brightness[record]
        ? pivotBrightness < brightness[record]
        : pivotRedGreen !== redGreen[record] ? pivotRedGreen < redGreen[record] : pivotBlue < blue[record]
      while (scanLeft <= scanRight) {
        while (lessPivot(scanLeft)) scanLeft += 1
        while (pivotLess(scanRight)) scanRight -= 1
        if (scanLeft <= scanRight) {
          swap(scanLeft, scanRight)
          scanLeft += 1
          scanRight -= 1
        }
      }
      if (scanRight < medianIndex) left = scanLeft
      if (medianIndex < scanLeft) right = scanRight
    }
    const packed = redGreen[medianIndex]
    const medianRed = halfToFloat(packed >>> 16)
    const medianGreen = halfToFloat(packed & 0xffff)
    const medianBlue = halfToFloat(blue[medianIndex])
    const maximumDifference = Math.max(Math.abs(originalRed - medianRed), Math.abs(originalGreen - medianGreen), Math.abs(originalBlue - medianBlue))
    const replace = $bindings.threshold <= 0 || maximumDifference >= $bindings.threshold / 100
    out[0] = replace ? medianRed : originalRed
    out[1] = replace ? medianGreen : originalGreen
    out[2] = replace ? medianBlue : originalBlue
    out[3] = surface.data[centerOffset + 3]
  }
}
