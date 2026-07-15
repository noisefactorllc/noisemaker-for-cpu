function assertDimension(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`)
  }
}

function byteFromFloat(value) {
  if (!Number.isFinite(value)) return 0
  if (value <= 0) return 0
  if (value >= 1) return 255
  return Math.round(value * 255)
}

export class Surface {
  constructor(width, height, data = null) {
    assertDimension(width, 'width')
    assertDimension(height, 'height')

    const length = width * height * 4
    if (data !== null && (!(data instanceof Float32Array) || data.length !== length)) {
      throw new TypeError(`data must be a Float32Array of length ${length}`)
    }

    this.width = width
    this.height = height
    this.data = data ?? new Float32Array(length)
  }

  static fromRgba8(width, height, bytes) {
    assertDimension(width, 'width')
    assertDimension(height, 'height')
    const length = width * height * 4
    if (!(bytes instanceof Uint8Array) && !(bytes instanceof Uint8ClampedArray)) {
      throw new TypeError('bytes must be a Uint8Array or Uint8ClampedArray')
    }
    if (bytes.length !== length) {
      throw new TypeError(`bytes must have length ${length}`)
    }

    const data = new Float32Array(length)
    const scale = 1 / 255
    for (let i = 0; i < length; i += 1) data[i] = bytes[i] * scale
    return new Surface(width, height, data)
  }

  clone() {
    return new Surface(this.width, this.height, this.data.slice())
  }

  clear(color = [0, 0, 0, 0]) {
    if (!Array.isArray(color) && !(color instanceof Float32Array)) {
      throw new TypeError('color must be an array-like RGBA value')
    }
    if (color.length !== 4) throw new TypeError('color must contain four components')

    const r = Math.fround(color[0])
    const g = Math.fround(color[1])
    const b = Math.fround(color[2])
    const a = Math.fround(color[3])
    const data = this.data
    for (let i = 0; i < data.length; i += 4) {
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = a
    }
    return this
  }

  toRgba8(target = null) {
    const out = target ?? new Uint8ClampedArray(this.data.length)
    if (!(out instanceof Uint8Array) && !(out instanceof Uint8ClampedArray)) {
      throw new TypeError('target must be a Uint8Array or Uint8ClampedArray')
    }
    if (out.length !== this.data.length) {
      throw new TypeError(`target must have length ${this.data.length}`)
    }

    const data = this.data
    for (let i = 0; i < data.length; i += 1) out[i] = byteFromFloat(data[i])
    return out
  }
}
