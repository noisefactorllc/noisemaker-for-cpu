import { sampleBilinear, sampleNearestBottomLeft } from '../runtime/sampler.js'

const F32 = Math.fround
const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI

function isVector(value) {
  return ArrayBuffer.isView(value) || Array.isArray(value)
}

function component(value, index) {
  return isVector(value) ? value[index] : value
}

export function glslMod(x, y) {
  return x - y * Math.floor(x / y)
}

export function uint32(value) {
  return value >>> 0
}

export function pcg3d(value, out = [0, 0, 0]) {
  out[0] = value[0] >>> 0
  out[1] = value[1] >>> 0
  out[2] = value[2] >>> 0
  out[0] = (Math.imul(out[0], 1664525) + 1013904223) >>> 0
  out[1] = (Math.imul(out[1], 1664525) + 1013904223) >>> 0
  out[2] = (Math.imul(out[2], 1664525) + 1013904223) >>> 0
  out[0] = (out[0] + Math.imul(out[1], out[2])) >>> 0
  out[1] = (out[1] + Math.imul(out[2], out[0])) >>> 0
  out[2] = (out[2] + Math.imul(out[0], out[1])) >>> 0
  out[0] = (out[0] ^ (out[0] >>> 16)) >>> 0
  out[1] = (out[1] ^ (out[1] >>> 16)) >>> 0
  out[2] = (out[2] ^ (out[2] >>> 16)) >>> 0
  out[0] = (out[0] + Math.imul(out[1], out[2])) >>> 0
  out[1] = (out[1] + Math.imul(out[2], out[0])) >>> 0
  out[2] = (out[2] + Math.imul(out[0], out[1])) >>> 0
  return out
}

export function hashUint32(value) {
  let result = value >>> 0
  result = (result ^ (result >>> 16)) >>> 0
  result = Math.imul(result, 0x7feb352d) >>> 0
  result = (result ^ (result >>> 15)) >>> 0
  result = Math.imul(result, 0x846ca68b) >>> 0
  result = (result ^ (result >>> 16)) >>> 0
  return result
}

function halfToFloat(value) {
  const sign = (value & 0x8000) ? -1 : 1
  const exponent = (value >>> 10) & 0x1f
  const fraction = value & 0x3ff
  if (exponent === 0) return sign * Math.pow(2, -14) * (fraction / 1024)
  if (exponent === 0x1f) return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY
  return sign * Math.pow(2, exponent - 15) * (1 + fraction / 1024)
}

function floatToHalf(value) {
  if (Number.isNaN(value)) return 0x7e00
  if (value === Number.POSITIVE_INFINITY) return 0x7c00
  if (value === Number.NEGATIVE_INFINITY) return 0xfc00
  const bits = new Uint32Array(new Float32Array([value]).buffer)[0]
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

export class GlslCpuRuntime {
  constructor() {
    this.pools = Array.from({ length: 17 }, () => [])
    this.indices = new Uint32Array(17)
    this.unsignedPools = Array.from({ length: 5 }, () => [])
    this.unsignedIndices = new Uint32Array(5)
    this.signedPools = Array.from({ length: 5 }, () => [])
    this.signedIndices = new Uint32Array(5)
    this.unsignedBaseIndices = null
    this.signedBaseIndices = null
    this.fragCoord = new Float32Array(4)
    this.varyings = {
      vUv: new Float32Array(2),
      v_texCoord: new Float32Array(2),
      vColor: new Float32Array(4),
    }
    this.bitsBuffer = new ArrayBuffer(4)
    this.bitsFloat = new Float32Array(this.bitsBuffer)
    this.bitsUint = new Uint32Array(this.bitsBuffer)
    this.inverseWidth = 1
    this.inverseHeight = 1
    this.derivativeMode = 'approximate'
    this.derivativeIndex = 0
    this.derivativeRecords = null
    this.derivativeValues = null
    const runtime = this
    this.PooledFloat32Array = function PooledFloat32Array(initializer) {
      const length = typeof initializer === 'number' ? initializer : initializer.length
      const out = runtime.alloc(length)
      if (typeof initializer === 'number') out.fill(0)
      else out.set(initializer)
      return out
    }
    this.stdlib = this.#createStdlib()
  }

  alloc(length) {
    const pool = this.pools[length] ?? (this.pools[length] = [])
    const index = this.indices[length]++
    return (pool[index] ??= new Float32Array(length))
  }

  copy(value) {
    const out = this.alloc(value.length)
    out.set(value)
    return out
  }

  beginPixel(context) {
    this.indices.fill(0)
    if (!this.unsignedBaseIndices) this.unsignedBaseIndices = this.unsignedIndices.slice()
    if (!this.signedBaseIndices) this.signedBaseIndices = this.signedIndices.slice()
    this.unsignedIndices.set(this.unsignedBaseIndices)
    this.signedIndices.set(this.signedBaseIndices)
    this.derivativeIndex = 0
    const fragCoord = context.fragCoord
    this.fragCoord[0] = fragCoord[0]
    this.fragCoord[1] = fragCoord[1]
    this.fragCoord[2] = fragCoord[2] ?? 0
    this.fragCoord[3] = fragCoord[3] ?? 1
    const uv = context.uv
    this.inverseWidth = 1 / (context.resolution?.[0] ?? 1)
    this.inverseHeight = 1 / (context.resolution?.[1] ?? 1)
    this.varyings.vUv[0] = uv[0]
    this.varyings.vUv[1] = uv[1]
    this.varyings.v_texCoord[0] = uv[0]
    this.varyings.v_texCoord[1] = uv[1]
    const color = context.varyings?.vColor
    if (color) this.varyings.vColor.set(color)
  }

  writeColor(color, out) {
    out[0] = F32(color[0])
    out[1] = F32(color[1])
    out[2] = F32(color[2])
    out[3] = F32(color[3])
    return out
  }

  #unary(value, operation) {
    if (!isVector(value)) return F32(operation(value))
    const out = this.alloc(value.length)
    for (let index = 0; index < value.length; index += 1) out[index] = F32(operation(value[index]))
    return out
  }

  #binary(left, right, operation) {
    if (!isVector(left) && !isVector(right)) return F32(operation(left, right))
    const length = isVector(left) ? left.length : right.length
    const out = this.alloc(length)
    for (let index = 0; index < length; index += 1) out[index] = F32(operation(component(left, index), component(right, index)))
    return out
  }

  #ternary(a, b, c, operation) {
    if (!isVector(a) && !isVector(b) && !isVector(c)) return F32(operation(a, b, c))
    const length = isVector(a) ? a.length : isVector(b) ? b.length : c.length
    const out = this.alloc(length)
    for (let index = 0; index < length; index += 1) {
      out[index] = F32(operation(component(a, index), component(b, index), component(c, index)))
    }
    return out
  }

  #relational(left, right, operation) {
    if (!isVector(left) && !isVector(right)) return operation(left, right)
    const length = isVector(left) ? left.length : right.length
    const out = this.alloc(length)
    for (let index = 0; index < length; index += 1) out[index] = operation(component(left, index), component(right, index)) ? 1 : 0
    return out
  }

  #texture(surface, coord) {
    if (!surface?.data) throw new TypeError('GLSL texture sampler must be a Surface')
    if (surface.filter === 'linear') return sampleBilinear(surface, coord[0], 1 - coord[1], this.alloc(4))
    return sampleNearestBottomLeft(surface, coord[0], coord[1], this.alloc(4))
  }

  #texelFetch(surface, coord) {
    if (!surface?.data) throw new TypeError('GLSL texelFetch sampler must be a Surface')
    const x = Math.min(Math.max(coord[0] | 0, 0), surface.width - 1)
    const shaderY = Math.min(Math.max(coord[1] | 0, 0), surface.height - 1)
    const y = surface.height - 1 - shaderY
    const offset = (y * surface.width + x) * 4
    const out = this.alloc(4)
    out[0] = surface.data[offset]
    out[1] = surface.data[offset + 1]
    out[2] = surface.data[offset + 2]
    out[3] = surface.data[offset + 3]
    return out
  }

  #createStdlib() {
    const unary = (operation) => (value) => this.#unary(value, operation)
    const binary = (operation) => (left, right) => this.#binary(left, right, operation)
    const ternary = (operation) => (a, b, c) => this.#ternary(a, b, c, operation)
    const relational = (operation) => (left, right) => this.#relational(left, right, operation)
    const add = binary((a, b) => a + b)
    const subtract = binary((a, b) => a - b)
    const multiply = binary((a, b) => a * b)
    const divide = binary((a, b) => a / b)
    const mod = binary(glslMod)
    const min = binary(Math.min)
    const max = binary(Math.max)
    const clamp = ternary((x, low, high) => Math.min(Math.max(x, low), high))
    const mix = ternary((x, y, amount) => x * (1 - amount) + y * amount)
    const vectorType = Object.freeze({
      add(out, left, right) {
        for (let index = 0; index < left.length; index += 1) out[index] = F32(left[index] + right[index])
        return out
      },
      subtract(out, left, right) {
        for (let index = 0; index < left.length; index += 1) out[index] = F32(left[index] - right[index])
        return out
      },
      multiply(out, left, right) {
        for (let index = 0; index < left.length; index += 1) out[index] = F32(left[index] * right[index])
        return out
      },
      divide(out, left, right) {
        for (let index = 0; index < left.length; index += 1) out[index] = F32(left[index] / right[index])
        return out
      },
      xor(out, left, right) {
        for (let index = 0; index < left.length; index += 1) out[index] = (left[index] ^ right[index]) >>> 0
        return out
      },
    })

    const dot = (left, right) => {
      let sum = 0
      for (let index = 0; index < left.length; index += 1) sum += left[index] * right[index]
      return F32(sum)
    }
    const length = (value) => F32(Math.sqrt(dot(value, value)))
    const normalize = (value) => {
      const magnitude = length(value)
      const out = this.alloc(value.length)
      if (magnitude === 0) {
        out.fill(0)
      } else {
        for (let index = 0; index < value.length; index += 1) out[index] = F32(value[index] / magnitude)
      }
      return out
    }
    const matrixMult = (left, right) => {
      if (left.length !== right.length) {
        const matrix = left.length > right.length ? left : right
        const vector = left.length > right.length ? right : left
        const dimension = vector.length
        const out = this.alloc(dimension)
        for (let row = 0; row < dimension; row += 1) {
          let sum = 0
          for (let column = 0; column < dimension; column += 1) {
            const matrixValue = left.length > right.length
              ? matrix[column * dimension + row]
              : matrix[row * dimension + column]
            sum += matrixValue * vector[column]
          }
          out[row] = F32(sum)
        }
        return out
      }
      const dimension = left.length === 16 ? 4 : left.length === 9 ? 3 : 2
      const out = this.alloc(left.length)
      for (let column = 0; column < dimension; column += 1) {
        for (let row = 0; row < dimension; row += 1) {
          let sum = 0
          for (let inner = 0; inner < dimension; inner += 1) {
            sum += left[inner * dimension + row] * right[column * dimension + inner]
          }
          out[column * dimension + row] = F32(sum)
        }
      }
      return out
    }

    const ivec2 = (a, b) => this.#integerVector(2, false, a, b)
    const ivec3 = (a, b, c) => this.#integerVector(3, false, a, b, c)
    const ivec4 = (a, b, c, d) => this.#integerVector(4, false, a, b, c, d)
    Object.assign(ivec2, vectorType)
    Object.assign(ivec3, vectorType)
    Object.assign(ivec4, vectorType)

    return Object.freeze({
      bool: (value) => Boolean(value),
      int: (value) => value | 0,
      uint: (value) => value >>> 0,
      umul: (left, right) => Math.imul(left, right) >>> 0,
      hashUint: hashUint32,
      float: (value) => F32(value),
      vec2: vectorType,
      vec3: vectorType,
      vec4: vectorType,
      uvec2: (a, b) => this.#integerVector(2, true, a, b),
      uvec3: (a, b, c) => this.#integerVector(3, true, a, b, c),
      uvec4: (a, b, c, d) => this.#integerVector(4, true, a, b, c, d),
      ivec2,
      ivec3,
      ivec4,
      radians: unary((value) => value * DEG_TO_RAD),
      degrees: unary((value) => value * RAD_TO_DEG),
      sin: unary(Math.sin),
      cos: unary(Math.cos),
      tan: unary(Math.tan),
      asin: unary(Math.asin),
      acos: unary(Math.acos),
      atan: (y, x) => x === undefined ? unary(Math.atan)(y) : binary(Math.atan2)(y, x),
      pow: binary(Math.pow),
      exp: unary(Math.exp),
      log: unary(Math.log),
      log2: unary(Math.log2),
      exp2: unary((value) => Math.pow(2, value)),
      sqrt: unary(Math.sqrt),
      inversesqrt: unary((value) => 1 / Math.sqrt(value)),
      abs: unary(Math.abs),
      sign: unary(Math.sign),
      floor: unary(Math.floor),
      ceil: unary(Math.ceil),
      round: unary(Math.round),
      fract: unary((value) => value - Math.floor(value)),
      tanh: unary(Math.tanh),
      mod,
      min,
      max,
      clamp,
      mix,
      step: binary((edge, value) => value < edge ? 0 : 1),
      smoothstep: ternary((edge0, edge1, value) => {
        const amount = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1)
        return amount * amount * (3 - 2 * amount)
      }),
      length,
      distance: (left, right) => length(subtract(left, right)),
      dot,
      normalize,
      reflect: (incident, normal) => subtract(incident, multiply(normal, 2 * dot(normal, incident))),
      refract: (incident, normal, eta) => {
        const product = dot(normal, incident)
        const k = 1 - eta * eta * (1 - product * product)
        if (k < 0) {
          const out = this.alloc(incident.length)
          out.fill(0)
          return out
        }
        return subtract(multiply(incident, eta), multiply(normal, eta * product + Math.sqrt(k)))
      },
      lessThan: relational((a, b) => a < b),
      lessThanEqual: relational((a, b) => a <= b),
      greaterThan: relational((a, b) => a > b),
      greaterThanEqual: relational((a, b) => a >= b),
      equal: relational((a, b) => a === b),
      notEqual: relational((a, b) => a !== b),
      any: (value) => {
        for (let index = 0; index < value.length; index += 1) if (value[index]) return true
        return false
      },
      all: (value) => {
        for (let index = 0; index < value.length; index += 1) if (!value[index]) return false
        return true
      },
      add,
      subtract,
      multiply,
      divide,
      matrixMult,
      texture: (surface, coord) => this.#texture(surface, coord),
      textureLod: (surface, coord) => this.#texture(surface, coord),
      textureSize: (surface) => {
        const out = this.alloc(2)
        out[0] = surface.width
        out[1] = surface.height
        return out
      },
      texelFetch: (surface, coord) => this.#texelFetch(surface, coord),
      dFdx: (value) => this.#derivative(value, 'x'),
      dFdy: (value) => this.#derivative(value, 'y'),
      fwidth: (value) => this.#derivative(value, 'width'),
      floatBitsToUint: (value) => {
        this.bitsFloat[0] = value
        return this.bitsUint[0]
      },
      packHalf2x16: (value) => uint32(floatToHalf(value[0]) | (floatToHalf(value[1]) << 16)),
      unpackHalf2x16: (value) => {
        const out = this.alloc(2)
        out[0] = halfToFloat(value & 0xffff)
        out[1] = halfToFloat((value >>> 16) & 0xffff)
        return out
      },
      pcg3d: (value) => pcg3d(value, this.#allocInteger(3, true)),
    })
  }

  #allocInteger(width, unsigned) {
    const pools = unsigned ? this.unsignedPools : this.signedPools
    const indices = unsigned ? this.unsignedIndices : this.signedIndices
    const index = indices[width]++
    return (pools[width][index] ??= unsigned ? new Array(width).fill(0) : new Int32Array(width))
  }

  #integerVector(width, unsigned, a, b, c, d) {
    const out = this.#allocInteger(width, unsigned)
    const input = b === undefined && isVector(a) ? a : null
    const broadcast = b === undefined && !input
    for (let index = 0; index < width; index += 1) {
      const value = input ? input[index] : broadcast ? a : index === 0 ? a : index === 1 ? b : index === 2 ? c : d
      out[index] = unsigned ? (value ?? 0) >>> 0 : (value ?? 0) | 0
    }
    return out
  }

  #derivative(value, kind) {
    const index = this.derivativeIndex++
    if (this.derivativeMode === 'record') {
      this.derivativeRecords[index] = isVector(value) ? Array.from(value) : value
      if (!isVector(value)) return 0
      const out = this.alloc(value.length)
      out.fill(0)
      return out
    }
    if (this.derivativeMode === 'replay') {
      const derivatives = this.derivativeValues[index]
      if (derivatives !== undefined) {
        const selected = kind === 'x' ? derivatives.x : kind === 'y' ? derivatives.y : derivatives.width
        if (!isVector(selected)) return F32(selected)
        const out = this.alloc(selected.length)
        out.set(selected)
        return out
      }
    }
    if (!isVector(value)) return F32(kind === 'x' ? this.inverseWidth : kind === 'y' ? this.inverseHeight : this.inverseWidth + this.inverseHeight)
    const out = this.alloc(value.length)
    out.fill(0)
    if (kind !== 'y' && out.length > 0) out[0] = F32(this.inverseWidth)
    if (kind !== 'x' && out.length > 1) out[1] = F32(this.inverseHeight)
    else if (kind === 'y' && out.length > 0) out[0] = F32(this.inverseHeight)
    return out
  }

  wrapDerivatives(kernel) {
    const cache = new Map()
    const temporary = new Float32Array(4)
    const probe = (context, x, y) => {
      const fragCoord = new Float32Array([x, y])
      const resolution = context.resolution
      const probeContext = {
        ...context,
        fragCoord,
        uv: new Float32Array([x / resolution[0], y / resolution[1]]),
      }
      this.derivativeMode = 'record'
      this.derivativeRecords = []
      kernel(probeContext, temporary)
      return this.derivativeRecords
    }
    return (context, out) => {
      const pixelX = Math.floor(context.fragCoord[0] - 0.5)
      const pixelY = Math.floor(context.fragCoord[1] - 0.5)
      const quadX = pixelX >> 1
      const quadY = pixelY >> 1
      const key = `${quadX}:${quadY}`
      let lanes = cache.get(key)
      if (!lanes) {
        const x0 = quadX * 2 + 0.5
        const y0 = quadY * 2 + 0.5
        lanes = [probe(context, x0, y0), probe(context, x0 + 1, y0), probe(context, x0, y0 + 1), probe(context, x0 + 1, y0 + 1)]
        cache.set(key, lanes)
      }
      const xParity = pixelX & 1
      const yParity = pixelY & 1
      const left = lanes[yParity * 2]
      const right = lanes[yParity * 2 + 1]
      const bottom = lanes[xParity]
      const top = lanes[xParity + 2]
      const count = Math.max(left.length, right.length, bottom.length, top.length)
      this.derivativeValues = Array.from({ length: count }, (_, index) => {
        const fallback = 0
        const leftValue = left[index] ?? fallback
        const rightValue = right[index] ?? leftValue
        const bottomValue = bottom[index] ?? fallback
        const topValue = top[index] ?? bottomValue
        if (!isVector(leftValue) && !isVector(rightValue) && !isVector(bottomValue) && !isVector(topValue)) {
          const x = rightValue - leftValue
          const y = topValue - bottomValue
          return { x, y, width: Math.abs(x) + Math.abs(y) }
        }
        const width = Math.max(leftValue.length ?? 0, rightValue.length ?? 0, bottomValue.length ?? 0, topValue.length ?? 0)
        const x = new Float32Array(width)
        const y = new Float32Array(width)
        const footprint = new Float32Array(width)
        for (let componentIndex = 0; componentIndex < width; componentIndex += 1) {
          x[componentIndex] = component(rightValue, componentIndex) - component(leftValue, componentIndex)
          y[componentIndex] = component(topValue, componentIndex) - component(bottomValue, componentIndex)
          footprint[componentIndex] = Math.abs(x[componentIndex]) + Math.abs(y[componentIndex])
        }
        return { x, y, width: footprint }
      })
      this.derivativeMode = 'replay'
      try {
        kernel(context, out)
      } finally {
        this.derivativeMode = 'approximate'
        this.derivativeRecords = null
        this.derivativeValues = null
        const lastX = pixelX === context.resolution[0] - 1
        const firstYInTraversal = pixelY === 0
        if ((xParity === 1 || lastX) && (yParity === 0 || firstYInTraversal)) cache.delete(key)
      }
    }
  }
}

export function bindGlslKernel(factory, bindings) {
  if (typeof factory !== 'function') throw new TypeError('GLSL kernel factory must be a function')
  const runtime = new GlslCpuRuntime()
  let kernel = factory(Object.freeze({ ...bindings }), runtime)
  if (typeof kernel !== 'function') throw new TypeError('GLSL kernel factory must return a pixel kernel')
  if (factory.usesDerivatives) kernel = runtime.wrapDerivatives(kernel)
  return kernel
}
