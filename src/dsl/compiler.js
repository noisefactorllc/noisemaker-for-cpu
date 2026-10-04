import { DslError } from './error.js'
import { parseDsl } from './parser.js'

// Mirrors upstream std_enums.js oscKind (sine..noise2d; noise/noise1d alias kind 5,
// noise2d is the two-stage periodic noise added upstream at eabb537e).
const OSC_KINDS = { sine: 0, tri: 1, saw: 2, sawInv: 3, square: 4, noise: 5, noise1d: 5, noise2d: 6 }
const OSC_PARAM_ORDER = ['type', 'min', 'max', 'speed', 'offset', 'seed']
const MAX_AUTOMATION_DEPTH = 8

function isOscValue(value) {
  return !!value && typeof value === 'object' && value.type === 'Oscillator'
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value))
}

// Compiles an `osc(...)` value-position call into the automation value shape the
// runtime evaluator consumes ({type: 'Oscillator', oscType, min, max, speed,
// offset, seed}), mirroring upstream's parser transformOscInvocation plus the
// validator's compileAutomationDescriptor: positional args fill
// type/min/max/speed/offset/seed in order, kwargs select by name, every field
// defaults as upstream defaults, min/max clamp into [0,1], nested osc() fields
// are allowed, and the oscType resolves from an integer 0..6 or an oscKind name
// (bare or oscKind-qualified). Invalid programs throw DslError, as everywhere
// else in this compiler.
function compileOscillator(call, bindings, depth) {
  if (depth > MAX_AUTOMATION_DEPTH) {
    throw new DslError(`Automation nesting exceeds the maximum depth of ${MAX_AUTOMATION_DEPTH}`, call.loc)
  }
  const fields = {}
  if (call.argMode === 'named') {
    for (const arg of call.args) {
      if (!OSC_PARAM_ORDER.includes(arg.name)) {
        throw new DslError(`osc() unknown parameter '${arg.name}'; valid: ${OSC_PARAM_ORDER.join(', ')}`, call.loc)
      }
      fields[arg.name] = arg.value
    }
  } else {
    call.args.forEach((arg, index) => {
      if (index < OSC_PARAM_ORDER.length) fields[OSC_PARAM_ORDER[index]] = arg.value
    })
  }

  const rawType = fields.type === undefined ? 0 : evaluateValue(fields.type, bindings, depth + 1)
  let oscType
  if (typeof rawType === 'number') {
    if (!Number.isInteger(rawType) || rawType < 0 || rawType > 6) {
      throw new DslError('osc() type must resolve to a supported oscKind value (0-6)', call.loc)
    }
    oscType = rawType
  } else if (typeof rawType === 'string') {
    const kindName = rawType.startsWith('oscKind.') ? rawType.slice('oscKind.'.length) : rawType
    if (!(kindName in OSC_KINDS)) {
      throw new DslError(`osc() type must resolve to a supported oscKind value; got "${rawType}"`, call.loc)
    }
    oscType = OSC_KINDS[kindName]
  } else {
    throw new DslError('osc() type must resolve to a supported oscKind value', call.loc)
  }

  const numberField = (node, name, fallback, clamp) => {
    if (node === undefined) return fallback
    const value = evaluateValue(node, bindings, depth + 1)
    if (isOscValue(value)) return value
    if (value === true) return 1
    if (value === false) return 0
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new DslError(`osc() ${name} must be a number or a nested osc()`, call.loc)
    }
    return clamp ? clamp01(value) : value
  }

  return {
    type: 'Oscillator',
    oscType,
    min: numberField(fields.min, 'min', 0, true),
    max: numberField(fields.max, 'max', 1, true),
    speed: numberField(fields.speed, 'speed', 1, false),
    offset: numberField(fields.offset, 'offset', 0, false),
    seed: numberField(fields.seed, 'seed', 1, false),
  }
}

function evaluateValue(value, bindings, oscDepth = 0) {
  if (Array.isArray(value)) return value.map((item) => evaluateValue(item, bindings, oscDepth))
  if (!value || typeof value !== 'object') return value
  if (value.kind === 'surface') return value
  if (value.kind === 'Call') {
    if (value.name === 'osc') return compileOscillator(value, bindings, oscDepth)
    throw new DslError(`Unsupported DSL value ${value.kind} "${value.name}"`, value.loc)
  }
  if (value.kind === 'identifier') {
    if (bindings.has(value.name)) {
      const binding = bindings.get(value.name)
      if (binding.kind === 'partial') throw new DslError(`Effect partial "${value.name}" cannot be used as a value`, value.loc)
      return binding.value
    }
    return value.name
  }
  if (value.kind === 'vector') {
    const components = value.values.map((item) => evaluateValue(item, bindings))
    if (components.length !== value.width || components.some((item) => typeof item !== 'number')) {
      throw new DslError(`vec${value.width} requires ${value.width} numeric values`, value.loc)
    }
    return components
  }
  if (value.kind === 'unary') {
    const input = evaluateValue(value.argument, bindings)
    if (typeof input !== 'number') throw new DslError('Unary arithmetic requires a number', value.loc)
    return value.operator === '-' ? -input : input
  }
  if (value.kind === 'binary') {
    const left = evaluateValue(value.left, bindings)
    const right = evaluateValue(value.right, bindings)
    if (typeof left !== 'number' || typeof right !== 'number') throw new DslError('Arithmetic requires numeric values', value.loc)
    if (value.operator === '+') return left + right
    if (value.operator === '-') return left - right
    if (value.operator === '*') return left * right
    return left / right
  }
  throw new DslError(`Unsupported DSL value ${value.kind}`, value.loc)
}

function resolveArgs(args, bindings) {
  return args.map((arg) => ({ ...arg, value: evaluateValue(arg.value, bindings) }))
}

function mergePartial(stored, call) {
  if (!stored.argMode) return { ...call, name: stored.name }
  if (!call.argMode) return { ...stored, loc: call.loc }
  if (stored.argMode !== call.argMode) throw new DslError('Partial and call arguments must use the same named or positional form', call.loc)
  if (stored.argMode === 'positional') return { ...call, name: stored.name, args: [...stored.args, ...call.args] }
  const merged = new Map(stored.args.map((arg) => [arg.name, arg]))
  for (const arg of call.args) merged.set(arg.name, arg)
  return { ...call, name: stored.name, args: [...merged.values()], argMode: 'named' }
}

export function compileDsl(source, registry, options = {}) {
  const ast = parseDsl(source, options)
  if (ast.search.length === 0) throw new DslError('Missing required search directive', ast.loc)

  const bindings = new Map()
  for (const binding of ast.bindings) {
    if (bindings.has(binding.name)) throw new DslError(`Duplicate binding "${binding.name}"`, binding.loc)
    if (binding.value?.kind === 'Call' && binding.value.name !== 'osc') {
      bindings.set(binding.name, { kind: 'partial', call: { ...binding.value, args: resolveArgs(binding.value.args, bindings) } })
    } else {
      bindings.set(binding.name, { kind: 'value', value: evaluateValue(binding.value, bindings) })
    }
  }

  const chains = ast.chains.map((chain) => {
    const steps = []
    let hasInput = false
    let hasImage = false
    let hasVolume = false
    let startsWithGenerator = false
    let openLoop = null
    for (let index = 0; index < chain.calls.length; index += 1) {
      let call = chain.calls[index]
      const partial = bindings.get(call.name)
      if (partial) {
        if (partial.kind !== 'partial') throw new DslError(`Binding "${call.name}" is not callable`, call.loc)
        call = mergePartial(partial.call, call)
      }
      const args = resolveArgs(call.args, bindings)
      if (call.name === 'read') {
        if (index !== 0 || args.length !== 1 || args[0].value?.kind !== 'surface') throw new DslError('read(surface) must begin a chain', call.loc)
        steps.push({ kind: 'read', surface: args[0].value.name, loc: call.loc })
        hasInput = true
        hasImage = true
        continue
      }
      if (call.name === 'write') {
        if (openLoop) throw new DslError('loopBegin must be closed by loopEnd before write', call.loc)
        if (!hasImage || args.length !== 1 || args[0].value?.kind !== 'surface') throw new DslError('write(surface) requires a current image', call.loc)
        steps.push({ kind: 'write', surface: args[0].value.name, loc: call.loc })
        continue
      }
      const definition = registry.resolve(call.name, ast.search)
      if (!definition) throw new DslError(`Unknown effect "${call.name}" in search namespaces ${ast.search.join(', ')}`, call.loc)
      if (definition.domain === 'volume-generator') {
        if (index !== 0 && !(definition.iterated && hasVolume)) {
          throw new DslError(`Generator ${definition.id} must begin a chain`, call.loc)
        }
        if (index === 0) startsWithGenerator = true
        hasInput = true
        hasVolume = true
      } else if (definition.domain === 'volume-filter') {
        if (!hasVolume) throw new DslError(`volume filter ${definition.id} requires a volume input`, call.loc)
        hasInput = true
      } else if (definition.domain === 'volume-renderer') {
        if (!hasVolume) throw new DslError(`volume renderer ${definition.id} requires a volume input`, call.loc)
        hasInput = true
        hasImage = true
      } else if (definition.domain === 'loop-begin') {
        if (!hasImage) throw new DslError(`${definition.id} requires a current image`, call.loc)
        if (openLoop) throw new DslError('nested loopBegin regions are not supported', call.loc)
        openLoop = call.loc
      } else if (definition.domain === 'loop-end') {
        if (!openLoop) throw new DslError('loopEnd has no matching loopBegin', call.loc)
        if (!hasImage) throw new DslError(`${definition.id} requires a current image`, call.loc)
        openLoop = null
      } else if (definition.kind === 'generator') {
        if (index !== 0) throw new DslError(`Generator ${definition.id} must begin a chain`, call.loc)
        startsWithGenerator = true
        hasInput = true
        hasImage = true
      } else if (!hasImage) {
        const requiresInputTex = definition.passes.some((pass) => Object.values(pass.inputs ?? {}).includes('inputTex'))
        if (requiresInputTex) {
          throw new DslError(`${definition.kind} ${definition.id} requires an input; begin with a generator or read(oN)`, call.loc)
        }
        hasInput = true
        hasImage = true
      }
      let params
      try {
        params = definition.normalizeArguments(args)
      } catch (error) {
        throw new DslError(error.message, call.loc)
      }
      const explicitParams = Object.freeze(args.map((arg, argumentIndex) => {
        const suppliedName = arg.name ?? definition.paramNames[argumentIndex]
        return definition.paramAliases[suppliedName] ?? suppliedName
      }))
      steps.push({ kind: 'effect', definition, params, explicitParams, loc: call.loc })
    }
    if (openLoop) throw new DslError('loopBegin must be closed by loopEnd before the chain ends', openLoop)
    if (startsWithGenerator && steps.at(-1)?.kind !== 'write') throw new DslError('Generator chain must end with write(oN)', chain.loc)
    return { steps, loc: chain.loc }
  })

  let lastWrittenSurface = null
  for (const chain of chains) {
    for (const step of chain.steps) if (step.kind === 'write') lastWrittenSurface = step.surface
  }
  const renderSurface = ast.render?.name ?? lastWrittenSurface
  if (!renderSurface) throw new DslError('No render surface specified and no write() found - add render(oN) or write(oN)', ast.loc)

  return Object.freeze({ search: Object.freeze(ast.search.slice()), chains: Object.freeze(chains), renderSurface, ast })
}
