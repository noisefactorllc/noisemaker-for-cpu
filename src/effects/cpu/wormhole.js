import { float16Truncate } from '../../runtime/texture-format.js'

const TAU = 6.28318530717959
const F32 = Math.fround

function add(left, right) { return F32(left + right) }
function mul(left, right) { return F32(left * right) }
function div(left, right) { return F32(left / right) }

function oklabLightness(red, green, blue) {
  const r = Math.min(Math.max(red, 0), 1)
  const g = Math.min(Math.max(green, 0), 1)
  const b = Math.min(Math.max(blue, 0), 1)
  const l = add(add(mul(F32(0.4122214708), r), mul(F32(0.5363325363), g)), mul(F32(0.0514459929), b))
  const m = add(add(mul(F32(0.2119034982), r), mul(F32(0.6806995451), g)), mul(F32(0.1073969566), b))
  const s = add(add(mul(F32(0.0883024619), r), mul(F32(0.2817188376), g)), mul(F32(0.6299787005), b))
  const exponent = div(1, 3)
  const lr = F32(Math.pow(Math.max(l, 0), exponent))
  const mr = F32(Math.pow(Math.max(m, 0), exponent))
  const sr = F32(Math.pow(Math.max(s, 0), exponent))
  return add(add(mul(F32(0.2104542553), lr), mul(F32(0.793617785), mr)), mul(F32(-0.0040720468), sr))
}

function wrapRepeat(value, size) {
  return ((value % size) + size) % size
}

function wrapMirror(value, size) {
  const doubled = size * 2
  const mirrored = wrapRepeat(value, doubled)
  return size - 1 - Math.abs(mirrored - size + 1)
}

export function runWormholeDeposit(input, destination, uniforms) {
  if (input.width !== destination.width || input.height !== destination.height) {
    throw new RangeError('wormhole deposit requires matching source and destination dimensions')
  }
  const width = input.width
  const height = input.height
  const inputData = input.data
  const outputData = destination.data
  const kink = uniforms.kink
  const pixelStride = 1024 * uniforms.stride
  const rotation = div(mul(F32(uniforms.rotation), F32(Math.PI)), 180)
  const wrap = uniforms.wrap | 0
  // Vertex IDs enumerate GL texels bottom-up. Surface storage remains top-down.
  for (let sourceY = 0; sourceY < height; sourceY += 1) {
    for (let sourceX = 0; sourceX < width; sourceX += 1) {
      const sourceRow = height - 1 - sourceY
      const sourceOffset = (sourceRow * width + sourceX) * 4
      const lightness = oklabLightness(inputData[sourceOffset], inputData[sourceOffset + 1], inputData[sourceOffset + 2])
      const angle = add(mul(mul(lightness, F32(TAU)), F32(kink)), rotation)
      const offsetX = mul(add(F32(Math.cos(angle)), 1), F32(pixelStride))
      const offsetY = mul(add(F32(Math.sin(angle)), 1), F32(pixelStride))
      let destinationX = Math.floor(add(sourceX, offsetX))
      let destinationY = Math.floor(add(sourceY, offsetY))
      if (wrap === 0) {
        destinationX = wrapMirror(destinationX, width)
        destinationY = wrapMirror(destinationY, height)
      } else if (wrap === 2) {
        destinationX = Math.min(Math.max(destinationX, 0), width - 1)
        destinationY = Math.min(Math.max(destinationY, 0), height - 1)
      } else {
        destinationX = wrapRepeat(destinationX, width)
        destinationY = wrapRepeat(destinationY, height)
      }
      const destinationRow = height - 1 - destinationY
      const destinationOffset = (destinationRow * width + destinationX) * 4
      const weight = mul(lightness, lightness)
      outputData[destinationOffset] = float16Truncate(add(outputData[destinationOffset], mul(inputData[sourceOffset], weight)))
      outputData[destinationOffset + 1] = float16Truncate(add(outputData[destinationOffset + 1], mul(inputData[sourceOffset + 1], weight)))
      outputData[destinationOffset + 2] = float16Truncate(add(outputData[destinationOffset + 2], mul(inputData[sourceOffset + 2], weight)))
    }
  }
  return { pixels: width * height }
}
