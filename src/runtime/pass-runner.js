export function runPass(options) {
  const {
    kernel,
    destination,
    uniforms = {},
    textures = {},
    time = 0,
    seed = 1,
    tileRows = 32,
    onTile = null,
  } = options

  if (typeof kernel !== 'function') throw new TypeError('kernel must be a function')
  if (!destination?.data) throw new TypeError('destination must be a Surface')
  if (!Number.isInteger(tileRows) || tileRows <= 0) throw new RangeError('tileRows must be a positive integer')

  const start = performance.now()
  const width = destination.width
  const height = destination.height
  const inverseWidth = 1 / width
  const inverseHeight = 1 / height
  const uv = new Float32Array(2)
  const fragCoord = new Float32Array(2)
  const resolution = new Float32Array([width, height])
  const out = new Float32Array(4)
  const context = { uv, fragCoord, resolution, time: Math.fround(time), seed: Math.fround(seed), uniforms, textures }
  const data = destination.data
  let tiles = 0

  for (let yStart = 0; yStart < height; yStart += tileRows) {
    const yEnd = Math.min(yStart + tileRows, height)
    if (onTile) onTile({ yStart, yEnd })
    tiles += 1
    for (let y = yStart; y < yEnd; y += 1) {
      // Surface rows are stored top-down for Canvas, PNG, and ImageData APIs,
      // while GLSL fragment coordinates have a bottom-left origin.
      const fy = height - y - 0.5
      fragCoord[1] = fy
      uv[1] = fy * inverseHeight
      let destinationIndex = (y * width) * 4
      for (let x = 0; x < width; x += 1) {
        const fx = x + 0.5
        fragCoord[0] = fx
        uv[0] = fx * inverseWidth
        kernel(context, out)
        data[destinationIndex] = out[0]
        data[destinationIndex + 1] = out[1]
        data[destinationIndex + 2] = out[2]
        data[destinationIndex + 3] = out[3]
        destinationIndex += 4
      }
    }
  }

  return { pixels: width * height, tiles, elapsedMs: performance.now() - start }
}

export async function runPassAsync(options) {
  const {
    kernel,
    destination,
    uniforms = {},
    textures = {},
    time = 0,
    seed = 1,
    tileRows = 32,
    onTile = null,
    scheduler = () => new Promise((resolve) => setTimeout(resolve, 0)),
  } = options

  if (typeof kernel !== 'function') throw new TypeError('kernel must be a function')
  if (!destination?.data) throw new TypeError('destination must be a Surface')
  if (!Number.isInteger(tileRows) || tileRows <= 0) throw new RangeError('tileRows must be a positive integer')
  if (typeof scheduler !== 'function') throw new TypeError('scheduler must be a function')

  const start = performance.now()
  const width = destination.width
  const height = destination.height
  const inverseWidth = 1 / width
  const inverseHeight = 1 / height
  const uv = new Float32Array(2)
  const fragCoord = new Float32Array(2)
  const resolution = new Float32Array([width, height])
  const out = new Float32Array(4)
  const context = { uv, fragCoord, resolution, time: Math.fround(time), seed: Math.fround(seed), uniforms, textures }
  const data = destination.data
  let tiles = 0

  for (let yStart = 0; yStart < height; yStart += tileRows) {
    const yEnd = Math.min(yStart + tileRows, height)
    if (onTile) onTile({ yStart, yEnd })
    tiles += 1
    for (let y = yStart; y < yEnd; y += 1) {
      const fy = height - y - 0.5
      fragCoord[1] = fy
      uv[1] = fy * inverseHeight
      let destinationIndex = (y * width) * 4
      for (let x = 0; x < width; x += 1) {
        const fx = x + 0.5
        fragCoord[0] = fx
        uv[0] = fx * inverseWidth
        kernel(context, out)
        data[destinationIndex] = out[0]
        data[destinationIndex + 1] = out[1]
        data[destinationIndex + 2] = out[2]
        data[destinationIndex + 3] = out[3]
        destinationIndex += 4
      }
    }
    await scheduler()
  }

  return { pixels: width * height, tiles, elapsedMs: performance.now() - start }
}
