export class RenderResult {
  constructor(surface, metadata = {}) {
    if (!surface || !Number.isInteger(surface.width) || !Number.isInteger(surface.height)) {
      throw new TypeError('surface must be a Surface-compatible object')
    }

    this.surface = surface
    this.width = surface.width
    this.height = surface.height
    this.elapsedMs = metadata.elapsedMs ?? 0
    this.seed = metadata.seed ?? 1
    this.time = metadata.time ?? 0
    this.stats = Object.freeze({ ...(metadata.stats ?? {}) })
  }

  toRgba8() {
    return this.surface.toRgba8()
  }

  toImageData() {
    if (typeof ImageData !== 'function') {
      throw new Error('ImageData is unavailable in this environment')
    }
    return new ImageData(this.toRgba8(), this.width, this.height)
  }
}
