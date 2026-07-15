import { sampleBilinear, sampleNearestBottomLeft } from '../runtime/sampler.js'

const CHANNELS = Object.freeze({ x: 0, r: 0, s: 0, y: 1, g: 1, t: 1, z: 2, b: 2, p: 2, w: 3, a: 3, q: 3 })

function component(value, index) {
  if (value === undefined) return undefined
  return typeof value === 'number' || typeof value === 'boolean' ? value : value[index]
}

function float(value) {
  return Math.fround(value)
}

function unaryScalar(operator, value) {
  if (operator === '-') return -value
  if (operator === '+') return value
  return !value
}

function binaryScalar(operator, left, right) {
  switch (operator) {
    case '+': return left + right
    case '-': return left - right
    case '*': return left * right
    case '/': return left / right
    case '%': return left % right
    case '<': return left < right
    case '<=': return left <= right
    case '>': return left > right
    case '>=': return left >= right
    case '==': return left === right
    case '!=': return left !== right
    case '&&': return left && right
    case '||': return left || right
    case '&': return (left | 0) & (right | 0)
    case '|': return (left | 0) | (right | 0)
    case '^': return (left | 0) ^ (right | 0)
    case '<<': return (left | 0) << (right | 0)
    case '>>': return (left | 0) >> (right | 0)
    default: throw new Error(`Unsupported CSL operator ${operator}`)
  }
}

function componentScalar(name, a, b, c) {
  switch (name) {
    case 'abs': return Math.abs(a)
    case 'sin': return Math.sin(a)
    case 'cos': return Math.cos(a)
    case 'tan': return Math.tan(a)
    case 'asin': return Math.asin(a)
    case 'acos': return Math.acos(a)
    case 'atan': return b === undefined ? Math.atan(a) : Math.atan2(a, b)
    case 'floor': return Math.floor(a)
    case 'ceil': return Math.ceil(a)
    case 'round': return Math.round(a)
    case 'fract': return a - Math.floor(a)
    case 'sqrt': return Math.sqrt(a)
    case 'exp': return Math.exp(a)
    case 'log': return Math.log(a)
    case 'min': return Math.min(a, b)
    case 'max': return Math.max(a, b)
    case 'mod': return a - b * Math.floor(a / b)
    case 'pow': return Math.pow(a, b)
    case 'clamp': return Math.min(Math.max(a, b), c)
    case 'mix': return a * (1 - c) + b * c
    case 'step': return b < a ? 0 : 1
    case 'smoothstep': {
      const t = Math.min(Math.max((c - a) / (b - a), 0), 1)
      return t * t * (3 - 2 * t)
    }
    default: throw new Error(`Unsupported CSL builtin ${name}`)
  }
}

export class CslRuntime {
  constructor() {
    this.pools = { 2: [], 3: [], 4: [] }
    this.indices = { 2: 0, 3: 0, 4: 0 }
  }

  beginPixel() {
    this.indices[2] = 0
    this.indices[3] = 0
    this.indices[4] = 0
  }

  alloc(width) {
    const index = this.indices[width]++
    return (this.pools[width][index] ??= new Float32Array(width))
  }

  copy(value, width) {
    if (width === 1) return value
    const out = this.alloc(width)
    for (let i = 0; i < width; i += 1) out[i] = component(value, i)
    return out
  }

  construct(width, a, b, c, d) {
    const out = this.alloc(width)
    if ((typeof a === 'number' || typeof a === 'boolean') && b === undefined) {
      const value = float(a)
      out.fill(value)
      return out
    }
    let offset = 0
    for (let argumentIndex = 0; argumentIndex < 4; argumentIndex += 1) {
      const value = argumentIndex === 0 ? a : argumentIndex === 1 ? b : argumentIndex === 2 ? c : d
      if (value === undefined) continue
      if (typeof value === 'number' || typeof value === 'boolean') {
        if (offset < width) out[offset++] = float(value)
      } else {
        for (let i = 0; i < value.length && offset < width; i += 1) out[offset++] = float(value[i])
      }
    }
    return out
  }

  unary(operator, value, width) {
    if (width === 1) {
      const result = unaryScalar(operator, value)
      return typeof result === 'boolean' ? result : float(result)
    }
    const out = this.alloc(width)
    for (let i = 0; i < width; i += 1) out[i] = float(unaryScalar(operator, value[i]))
    return out
  }

  binary(operator, left, right, width) {
    if (width === 1) {
      const result = binaryScalar(operator, left, right)
      return typeof result === 'boolean' ? result : float(result)
    }
    const out = this.alloc(width)
    for (let i = 0; i < width; i += 1) out[i] = float(binaryScalar(operator, component(left, i), component(right, i)))
    return out
  }

  intDivide(left, right) {
    const quotient = left / right
    return quotient < 0 ? Math.ceil(quotient) : Math.floor(quotient)
  }

  swizzle(value, property) {
    if (property.length === 1) return value[CHANNELS[property]]
    const out = this.alloc(property.length)
    for (let i = 0; i < property.length; i += 1) out[i] = value[CHANNELS[property[i]]]
    return out
  }

  assignSwizzle(target, property, value) {
    for (let i = 0; i < property.length; i += 1) target[CHANNELS[property[i]]] = float(component(value, i))
    return value
  }

  assignIndex(target, index, value) {
    target[index | 0] = float(value)
    return value
  }

  componentWise(name, a, b, c, width) {
    if (width === 1) return float(componentScalar(name, a, b, c))
    const out = this.alloc(width)
    for (let i = 0; i < width; i += 1) out[i] = float(componentScalar(name, component(a, i), component(b, i), component(c, i)))
    return out
  }

  length(value, width) {
    if (width === 1) return float(Math.abs(value))
    let sum = 0
    for (let i = 0; i < width; i += 1) sum += value[i] * value[i]
    return float(Math.sqrt(sum))
  }

  dot(a, b, width) {
    let sum = 0
    for (let i = 0; i < width; i += 1) sum += a[i] * b[i]
    return float(sum)
  }

  distance(a, b, width) {
    let sum = 0
    for (let i = 0; i < width; i += 1) {
      const delta = a[i] - b[i]
      sum += delta * delta
    }
    return float(Math.sqrt(sum))
  }

  normalize(value, width) {
    const length = this.length(value, width)
    const out = this.alloc(width)
    if (length === 0) {
      out.fill(0)
      return out
    }
    for (let i = 0; i < width; i += 1) out[i] = float(value[i] / length)
    return out
  }

  texture(surface, uv) {
    if (!surface?.data) throw new Error('CSL texture sampler received no surface')
    const out = this.alloc(4)
    if (surface.filter === 'linear') return sampleBilinear(surface, uv[0], 1 - uv[1], out)
    return sampleNearestBottomLeft(surface, uv[0], uv[1], out)
  }

  textureSize(surface) {
    if (!surface?.data) throw new Error('CSL textureSize received no surface')
    return this.construct(2, surface.width, surface.height)
  }
}

export const cslRuntime = new CslRuntime()
