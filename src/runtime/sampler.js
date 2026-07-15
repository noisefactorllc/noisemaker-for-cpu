function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value
}

function assertSampleTarget(out, offset) {
  if (!out || out.length < offset + 4) throw new TypeError('sample target must have room for four components')
}

export function sampleNearest(surface, u, v, out, offset = 0) {
  assertSampleTarget(out, offset)
  const x = clamp(Math.floor(u * surface.width), 0, surface.width - 1)
  const y = clamp(Math.floor(v * surface.height), 0, surface.height - 1)
  const source = (y * surface.width + x) * 4
  const data = surface.data
  out[offset] = data[source]
  out[offset + 1] = data[source + 1]
  out[offset + 2] = data[source + 2]
  out[offset + 3] = data[source + 3]
  return out
}

// GLSL samplers address rows from the bottom. Surfaces stay top-down for fast
// Canvas/ImageData and PNG handoff, so flip the integer texel index rather than
// the normalized coordinate. `1 - v` is wrong exactly on texel boundaries.
export function sampleNearestBottomLeft(surface, u, v, out, offset = 0) {
  assertSampleTarget(out, offset)
  const x = clamp(Math.floor(u * surface.width), 0, surface.width - 1)
  const shaderY = clamp(Math.floor(v * surface.height), 0, surface.height - 1)
  const y = surface.height - 1 - shaderY
  const source = (y * surface.width + x) * 4
  const data = surface.data
  out[offset] = data[source]
  out[offset + 1] = data[source + 1]
  out[offset + 2] = data[source + 2]
  out[offset + 3] = data[source + 3]
  return out
}

export function sampleBilinear(surface, u, v, out, offset = 0) {
  assertSampleTarget(out, offset)
  const width = surface.width
  const height = surface.height
  const px = clamp(u * width - 0.5, 0, width - 1)
  const py = clamp(v * height - 0.5, 0, height - 1)
  const x0 = Math.floor(px)
  const y0 = Math.floor(py)
  const x1 = Math.min(x0 + 1, width - 1)
  const y1 = Math.min(y0 + 1, height - 1)
  const tx = px - x0
  const ty = py - y0
  const data = surface.data
  const row0 = y0 * width * 4
  const row1 = y1 * width * 4
  const p00 = row0 + x0 * 4
  const p10 = row0 + x1 * 4
  const p01 = row1 + x0 * 4
  const p11 = row1 + x1 * 4

  for (let channel = 0; channel < 4; channel += 1) {
    const top = data[p00 + channel] + (data[p10 + channel] - data[p00 + channel]) * tx
    const bottom = data[p01 + channel] + (data[p11 + channel] - data[p01 + channel]) * tx
    out[offset + channel] = Math.fround(top + (bottom - top) * ty)
  }
  return out
}
