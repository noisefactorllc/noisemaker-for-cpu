// External data-texture surfaces for the reactive (MIDI) and mesh (OBJ) effects.
//
// Data textures uploaded from JS arrays on WebGL2 place array row 0 at GL texture
// coordinate y = 0 (bottom-left origin). This port's CPU surfaces store rows top-down
// and the GLSL samplers (`sampleNearestBottomLeft`, `#texelFetch`) flip the y
// coordinate, so a data-texture surface must store the uploaded array's rows reversed
// for both `texture()` and `texelFetch()` to read the same texel the GPU reads.
// `flipRgbaRows` builds that flipped RGBA surface; the mesh triangles adapter reads
// the raw uploaded arrays directly (GPU `texelFetch(x, y)` = data[(y * width + x) * 4],
// no flip) via `renderOptions.externalInputs`.

export function flipRgbaRows(data, width, height) {
  const flipped = new Float32Array(width * height * 4)
  for (let row = 0; row < height; row++) {
    const source = (height - 1 - row) * width * 4
    flipped.set(data.subarray(source, source + width * 4), row * width * 4)
  }
  return flipped
}

export function externalDataSurface(Surface, data, width, height, format = 'rgba32f') {
  const rows = flipRgbaRows(data instanceof Float32Array ? data : Float32Array.from(data), width, height)
  const surface = new Surface(width, height, rows)
  surface.format = format
  surface.filter = 'nearest'
  return surface
}