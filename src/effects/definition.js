function cloneValue(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(cloneValue))
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)])))
  }
  return value
}

function enumValue(param, value, name) {
  if (typeof value === 'string') {
    const key = value.includes('.') ? value.split('.').at(-1) : value
    if (!(key in (param.choices ?? {})) || param.choices[key] === null) {
      const choices = Object.entries(param.choices ?? {}).filter(([, item]) => item !== null).map(([choice]) => choice)
      throw new TypeError(`Parameter "${name}" must be one of ${choices.join(', ')}`)
    }
    return param.choices[key]
  }
  return value
}

function colorValue(value, name) {
  if (typeof value === 'string') {
    const match = value.match(/^#([\da-f]{6}|[\da-f]{8})$/i)
    if (!match) throw new TypeError(`Parameter "${name}" must be an RGB or RGBA color`)
    const channels = match[1].match(/../g)
    return channels.map((channel) => Number.parseInt(channel, 16) / 255)
  }
  return value
}

function normalizeValue(param, value, name) {
  switch (param.type) {
    case 'float':
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`Parameter "${name}" must be a finite number`)
      break
    case 'int':
      value = param.choices ? enumValue(param, value, name) : value
      if (typeof value !== 'number' || !Number.isInteger(value)) throw new TypeError(`Parameter "${name}" must be an integer`)
      break
    case 'bool':
    case 'boolean':
      if (typeof value !== 'boolean') throw new TypeError(`Parameter "${name}" must be boolean`)
      break
    case 'color':
      value = colorValue(value, name)
      if (!Array.isArray(value) || (value.length !== 3 && value.length !== 4) || value.some((item) => typeof item !== 'number')) {
        throw new TypeError(`Parameter "${name}" must be an RGB or RGBA color`)
      }
      break
    case 'vec2':
    case 'vec3':
    case 'vec4': {
      const width = Number(param.type.at(-1))
      if (!Array.isArray(value) || value.length !== width || value.some((item) => typeof item !== 'number')) {
        throw new TypeError(`Parameter "${name}" must be a ${param.type}`)
      }
      break
    }
    case 'mat3':
      if (!Array.isArray(value) || value.length !== 9 || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
        throw new TypeError(`Parameter "${name}" must be a mat3`)
      }
      break
    case 'enum': {
      value = enumValue(param, value, name)
      if (typeof value !== 'number') throw new TypeError(`Parameter "${name}" must be an enum value`)
      break
    }
    case 'member':
    case 'palette':
      value = enumValue(param, value, name)
      if (typeof value !== 'number' || !Number.isInteger(value)) throw new TypeError(`Parameter "${name}" must be an enum value`)
      break
    case 'string': {
      if (typeof value !== 'string') throw new TypeError(`Parameter "${name}" must be a string`)
      if (param.choices) {
        const key = value.includes('.') ? value.split('.').at(-1) : value
        if (key in param.choices) value = param.choices[key]
        else if (!Object.values(param.choices).includes(value)) throw new TypeError(`Parameter "${name}" must be one of ${Object.keys(param.choices).join(', ')}`)
      }
      break
    }
    case 'surface':
      if (value === 'none' || value === null) return null
      if (value === 'inputTex') return Object.freeze({ kind: 'input' })
      if (!value || value.kind !== 'surface') throw new TypeError(`Parameter "${name}" must be a surface reference`)
      break
    case 'volume':
    case 'geometry':
      if (typeof value !== 'string' || value.length === 0) throw new TypeError(`Parameter "${name}" must be a ${param.type} reference`)
      break
    default:
      throw new TypeError(`Unsupported parameter type "${param.type}"`)
  }
  if (typeof value === 'number') {
    if (param.min !== undefined && value < param.min) throw new RangeError(`Parameter "${name}" must be at least ${param.min}`)
    if (param.max !== undefined && value > param.max) throw new RangeError(`Parameter "${name}" must be at most ${param.max}`)
  }
  return cloneValue(value)
}

export class EffectDefinition {
  constructor(spec) {
    if (!spec?.namespace || !spec?.func) throw new TypeError('Effect definition requires namespace and func')
    if (!['generator', 'filter', 'mixer'].includes(spec.kind)) throw new TypeError(`Invalid effect kind "${spec.kind}"`)
    if (!Array.isArray(spec.passes) || spec.passes.length === 0) throw new TypeError('Effect definition requires at least one pass')

    this.namespace = spec.namespace
    this.func = spec.func
    this.id = `${spec.namespace}/${spec.func}`
    this.kind = spec.kind
    this.domain = spec.domain ?? 'image'
    if (!['image', 'volume-generator', 'volume-filter', 'volume-renderer', 'loop-begin', 'loop-end'].includes(this.domain)) {
      throw new TypeError(`Invalid effect domain "${this.domain}"`)
    }
    // CPU-only stateful/particle effects re-run their passes `params.iterationCount.default`
    // times per frame. Surfaced here (not just on the raw snapshot record) so renderer and
    // tooling code that walks the runtime catalog can skip or special-case them without a
    // second lookup against the generated snapshot.
    this.iterated = spec.iterated === true
    this.name = spec.name ?? spec.func
    this.tags = cloneValue(spec.tags ?? [])
    this.description = spec.description ?? ''
    this.paramAliases = cloneValue(spec.paramAliases ?? {})
    this.params = cloneValue(spec.params ?? {})
    this.paramNames = Object.freeze(Object.keys(this.params))
    this.passes = cloneValue(spec.passes)
    this.textures = cloneValue(spec.textures ?? {})
    this.externalTexture = spec.externalTexture ?? null
    this.outputTex = spec.outputTex ?? null
    this.outputTex3d = spec.outputTex3d ?? null
    this.outputGeo = spec.outputGeo ?? null
    this.loopRole = spec.loopRole ?? null
    Object.freeze(this)
  }

  normalizeArguments(args) {
    const values = {}
    for (const name of this.paramNames) {
      const param = this.params[name]
      if ('default' in param) values[name] = normalizeValue(param, param.default, name)
    }
    const named = args.length > 0 && args[0].name !== null
    for (let index = 0; index < args.length; index += 1) {
      const suppliedName = named ? args[index].name : this.paramNames[index]
      const name = this.paramAliases[suppliedName] ?? suppliedName
      if (!name || !(name in this.params)) {
        const badName = suppliedName ?? `argument ${index + 1}`
        const accepted = [...this.paramNames, ...Object.keys(this.paramAliases)]
        throw new TypeError(`Unknown parameter "${badName}" for ${this.id}; accepted: ${accepted.join(', ')}`)
      }
      values[name] = normalizeValue(this.params[name], args[index].value, name)
    }
    for (const name of this.paramNames) {
      if (!(name in values)) throw new TypeError(`Missing required parameter "${name}" for ${this.id}`)
    }
    return Object.freeze(values)
  }
}
