import { Surface } from '../../runtime/surface.js'

const TAU = Math.PI * 2

class SeededRng {
  constructor(seed) {
    this.state = ((seed >>> 0) * 747796405 + 2891336453) >>> 0
  }

  next() {
    this.state = (this.state * 747796405 + 2891336453) >>> 0
    const word = (((this.state >>> ((this.state >>> 28) + 4)) ^ this.state) * 277803737) >>> 0
    return ((word >>> 22) ^ word) >>> 0
  }

  float() {
    return this.next() / 4294967295
  }

  normal(mean = 0, deviation = 1) {
    const u1 = Math.max(this.float(), 1e-10)
    const u2 = this.float()
    return mean + deviation * Math.sqrt(-2 * Math.log(u1)) * Math.cos(TAU * u2)
  }
}

function valueNoiseField(width, height, frequency, rng) {
  const gridWidth = Math.ceil(frequency) + 2
  const gridHeight = Math.ceil(frequency) + 2
  const grid = new Float32Array(gridWidth * gridHeight)
  for (let index = 0; index < grid.length; index += 1) grid[index] = rng.float()
  const field = new Float32Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const fieldX = x / width * frequency
      const fieldY = y / height * frequency
      const integerX = Math.floor(fieldX)
      const integerY = Math.floor(fieldY)
      const deltaX = fieldX - integerX
      const deltaY = fieldY - integerY
      const smoothX = deltaX * deltaX * (3 - 2 * deltaX)
      const smoothY = deltaY * deltaY * (3 - 2 * deltaY)
      const topLeft = grid[integerY * gridWidth + integerX]
      const topRight = grid[integerY * gridWidth + integerX + 1]
      const bottomLeft = grid[(integerY + 1) * gridWidth + integerX]
      const bottomRight = grid[(integerY + 1) * gridWidth + integerX + 1]
      field[y * width + x] = (topLeft * (1 - smoothX) + topRight * smoothX) * (1 - smoothY) +
        (bottomLeft * (1 - smoothX) + bottomRight * smoothX) * smoothY
    }
  }
  return field
}

function drawSegment(surface, x0, y0, x1, y1, lineWidth, color, alpha) {
  if (alpha <= 0) return
  const radius = lineWidth * 0.5
  const minX = Math.max(0, Math.floor(Math.min(x0, x1) - radius - 1))
  const maxX = Math.min(surface.width - 1, Math.ceil(Math.max(x0, x1) + radius + 1))
  const minY = Math.max(0, Math.floor(Math.min(y0, y1) - radius - 1))
  const maxY = Math.min(surface.height - 1, Math.ceil(Math.max(y0, y1) + radius + 1))
  const dx = x1 - x0
  const dy = y1 - y0
  const lengthSquared = dx * dx + dy * dy
  const data = surface.data
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const px = x + 0.5
      const py = y + 0.5
      const amount = lengthSquared > 0 ? Math.min(Math.max(((px - x0) * dx + (py - y0) * dy) / lengthSquared, 0), 1) : 0
      const nearestX = x0 + dx * amount
      const nearestY = y0 + dy * amount
      const distance = Math.hypot(px - nearestX, py - nearestY)
      const coverage = Math.min(Math.max(radius + 0.5 - distance, 0), 1)
      const sourceAlpha = alpha * coverage
      if (sourceAlpha <= 0) continue
      const offset = (y * surface.width + x) * 4
      const destinationAlpha = data[offset + 3]
      const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha)
      for (let channel = 0; channel < 3; channel += 1) {
        data[offset + channel] = outputAlpha > 0
          ? (color[channel] * sourceAlpha + data[offset + channel] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha
          : 0
      }
      data[offset + 3] = outputAlpha
    }
  }
}

function trace(surface, options) {
  const rng = new SeededRng(options.seed)
  const minDimension = Math.min(surface.width, surface.height)
  const maxDimension = Math.max(surface.width, surface.height)
  const strideScale = maxDimension / 1024
  const flow = valueNoiseField(surface.width, surface.height, options.flowFrequency, new SeededRng(options.seed * 31337))
  const count = Math.max(1, Math.floor(maxDimension * options.density))
  const sharedRotation = rng.float() * TAU
  const worms = Array.from({ length: count }, (_, index) => ({
    x: rng.float() * surface.width,
    y: rng.float() * surface.height,
    stride: rng.normal(options.stride, options.strideDeviation) * strideScale,
    rotation: options.behavior === 'obedient' ? sharedRotation : rng.float() * TAU,
    color: options.color(rng, index),
  }))
  const iterations = Math.max(1, Math.floor(Math.sqrt(minDimension) * options.duration))
  for (const worm of worms) {
    let x = worm.x
    let y = worm.y
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const lifetime = iterations > 1 ? iteration / (iterations - 1) : 1
      const exposure = 1 - Math.abs(1 - lifetime * 2)
      const flowX = Math.floor(((x % surface.width) + surface.width) % surface.width)
      const flowY = Math.floor(((y % surface.height) + surface.height) % surface.height)
      let angle = flow[flowY * surface.width + flowX] * TAU * options.kink
      angle += options.behavior === 'obedient' ? sharedRotation : worm.rotation
      const nextX = x + Math.sin(angle) * worm.stride
      const nextY = y + Math.cos(angle) * worm.stride
      drawSegment(surface, x, y, nextX, nextY, options.lineWidth, worm.color, options.alpha * exposure)
      x = nextX
      y = nextY
    }
  }
}

export function renderCanonicalWormOverlay(effectId, width, height, params) {
  const surface = new Surface(width, height)
  const seed = params.seed || 1
  const density = params.density
  if (effectId === 'filter/fibers') {
    const baseDensity = 0.5 + density * 2
    for (let layer = 0; layer < 4; layer += 1) {
      const layerSeed = seed * 1000 + layer * 137
      trace(surface, {
        seed: layerSeed,
        density: baseDensity,
        kink: 5 + layerSeed % 5,
        stride: 0.75,
        strideDeviation: 0.125,
        duration: 1,
        behavior: 'chaotic',
        flowFrequency: 4,
        lineWidth: Math.max(1.5, width / 384),
        color: (rng) => [Math.floor(rng.float() * 200 + 55) / 255, Math.floor(rng.float() * 200 + 55) / 255, Math.floor(rng.float() * 200 + 55) / 255],
        alpha: 0.5,
      })
    }
  } else if (effectId === 'filter/scratches') {
    for (let layer = 0; layer < 4; layer += 1) {
      const layerSeed = seed * 1000 + layer * 251
      trace(surface, {
        seed: layerSeed,
        density: 0.1 + density * 0.4,
        kink: 0.125 + layerSeed % 50 / 400,
        stride: 0.75,
        strideDeviation: 0.5,
        duration: 2 + layerSeed % 3,
        behavior: layerSeed % 2 === 0 ? 'obedient' : 'unruly',
        flowFrequency: 2 + layerSeed % 3,
        lineWidth: Math.max(0.5, width / 1024),
        color: () => [1, 1, 1],
        alpha: 1,
      })
    }
  } else if (effectId === 'filter/strayHair') {
    const layerSeed = seed * 1000 + 42
    trace(surface, {
      seed: layerSeed,
      density: 0.001 + density * 0.004,
      kink: 5 + layerSeed % 45,
      stride: 0.5,
      strideDeviation: 0.25,
      duration: 8 + layerSeed % 8,
      behavior: 'unruly',
      flowFrequency: 4,
      lineWidth: Math.max(1, width / 400),
      color: (rng) => [Math.floor(rng.float() * 30) / 255, Math.floor(rng.float() * 30) / 255, Math.floor(rng.float() * 30) / 255],
      alpha: 0.666,
    })
  } else throw new Error(`Unsupported canonical CPU overlay ${effectId}`)
  for (let index = 0; index < surface.data.length; index += 1) surface.data[index] = Math.round(Math.min(Math.max(surface.data[index], 0), 1) * 255) / 255
  return surface
}
