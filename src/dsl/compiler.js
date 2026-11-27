import { DslError } from './error.js'
import { joinKey, pathSegment } from './draws.js'
import { parseDsl } from './parser.js'
import { canInheritSeed, containsRandom, drawContext, inheritedSeed, isRandomCall, isSeedParam, resolveRandomCall } from './random.js'
import { isAutomationValue } from '../runtime/automation.js'

// Mirrors upstream std_enums.js oscKind (sine..noise2d; noise/noise1d alias kind 5,
// noise2d is the two-stage periodic noise added upstream at eabb537e).
const OSC_KINDS = { sine: 0, tri: 1, saw: 2, sawInv: 3, square: 4, noise: 5, noise1d: 5, noise2d: 6 }
const OSC_PARAM_ORDER = ['type', 'min', 'max', 'speed', 'offset', 'seed']
const MAX_AUTOMATION_DEPTH = 8
const VALUE_CALLS = new Set(['osc', 'midi', 'audio'])

function isOscValue(value) {
  return isAutomationValue(value)
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
function compileOscillator(call, bindings, depth, resolving = [], at = null) {
  if (depth > MAX_AUTOMATION_DEPTH) {
    throw new DslError(`Automation nesting exceeds the maximum depth of ${MAX_AUTOMATION_DEPTH}`, call.loc)
  }
  const fields = {}
  // A random call in an argument is keyed by the argument's name, whether it is
  // written by position or by name.
  const fieldAt = (name) => at && { key: at.key, path: [...at.path, pathSegment.named(name)] }
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

  const rawType = fields.type === undefined ? 0 : evaluateValue(fields.type, bindings, depth + 1, resolving, fieldAt('type'))
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
    const value = evaluateValue(node, bindings, depth + 1, resolving, fieldAt(name))
    if (value === undefined) return fallback
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

function compileAutomationCall(call, bindings, depth, resolving = [], at = null) {
  if (call.name !== 'osc') {
    console.warn(`Warning: ${call.name}() is unsupported in CPU ports; real-time input is unavailable. Ignoring this unsupported input value.`)
    return undefined
  }
  return compileOscillator(call, bindings, depth, resolving, at)
}

// `at` is where a random call in the value draws: the key of the place the value
// is written and the path inside the value (upstream randomize.js). Without it a
// random call is not allowed here.
function extend(at, segment) {
  return at && { key: at.key, path: [...at.path, segment] }
}

// `resolving` threads the chain of binding names currently being resolved so a
// cyclic let set (`let a = b`, `let b = a`) fails instead of looping forever,
// as upstream's validator substitution detects the same cycle.
function evaluateValue(value, bindings, oscDepth = 0, resolving = [], at = null) {
  if (Array.isArray(value)) return value.map((item, index) => evaluateValue(item, bindings, oscDepth, resolving, extend(at, pathSegment.component(index))))
  if (!value || typeof value !== 'object') return value
  if (value.kind === 'surface') return value
  if (isRandomCall(value)) {
    if (!at) throw new DslError(`A random call is not allowed here: ${value.name}()`, value.loc)
    const ctx = { seed: bindings.draws.seed, key: at.key, draw: bindings.draws.draw, choicesFor: bindings.choicesFor }
    return resolveRandomCall(value, ctx, at.path, (item, path) => evaluateValue(item, bindings, oscDepth, resolving, { key: at.key, path }))
  }
  if (value.kind === 'Call') {
    if (VALUE_CALLS.has(value.name)) return compileAutomationCall(value, bindings, oscDepth, resolving, at)
    throw new DslError(`Unsupported DSL value ${value.kind} "${value.name}"`, value.loc)
  }
  if (value.kind === 'identifier') {
    if (bindings.has(value.name)) {
      const binding = bindings.get(value.name)
      if (binding.kind === 'partial') throw new DslError(`Effect partial "${value.name}" cannot be used as a value`, value.loc)
      // An effect alias used as a value stays the effect's bare name.
      if (binding.kind === 'alias') return binding.name
      // A value binding resolves lazily at its first use. Statement order
      // (upstream 9cc041d0) makes a chain see only lets declared at or before
      // its own index, so a name declared by a later let is pending here and
      // reading it reports S003, as upstream does.
      if (binding.resolved) return binding.value
      if (resolving.includes(value.name)) {
        throw new DslError(`Automation cycle detected: ${[...resolving, value.name].join(' -> ')}`, value.loc)
      }
      binding.value = evaluateValue(binding.expr, bindings, oscDepth, [...resolving, value.name], binding.at)
      binding.resolved = true
      return binding.value
    }
    if (bindings.pendingNames?.has(value.name)) {
      throw new DslError(`Variable used before assignment: '${value.name}'`, value.loc)
    }
    return value.name
  }
  if (value.kind === 'vector') {
    const components = value.values.map((item, index) => evaluateValue(item, bindings, 0, resolving, extend(at, pathSegment.component(index))))
    if (components.length !== value.width || components.some((item) => typeof item !== 'number')) {
      throw new DslError(`vec${value.width} requires ${value.width} numeric values`, value.loc)
    }
    return components
  }
  if (value.kind === 'unary') {
    const input = evaluateValue(value.argument, bindings, 0, resolving, value.operator === '-' ? extend(at, pathSegment.operand(0)) : at)
    if (typeof input !== 'number') throw new DslError('Unary arithmetic requires a number', value.loc)
    return value.operator === '-' ? -input : input
  }
  if (value.kind === 'binary') {
    const left = evaluateValue(value.left, bindings, 0, resolving, extend(at, pathSegment.operand(0)))
    const right = evaluateValue(value.right, bindings, 0, resolving, extend(at, pathSegment.operand(1)))
    if (typeof left !== 'number' || typeof right !== 'number') throw new DslError('Arithmetic requires numeric values', value.loc)
    if (value.operator === '+') return left + right
    if (value.operator === '-') return left - right
    if (value.operator === '*') return left * right
    return left / right
  }
  if (value.kind === 'Chain' && bindings.pending) return bindings.compileInlineChain(value, at)
  throw new DslError(`Unsupported DSL value ${value.kind}`, value.loc)
}

// Each argument draws under its element's key and its canonical parameter name,
// whether it is written by position or by name.
function resolveArgs(args, bindings, definition, elementKey) {
  let positional = 0
  return args.map((arg) => {
    const written = arg.name ?? definition?.paramNames[positional++]
    const name = definition?.paramAliases?.[written] ?? written
    const at = elementKey && name ? { key: joinKey(elementKey, name), path: [] } : null
    return { ...arg, value: evaluateValue(arg.value, bindings, 0, [], at) }
  })
}

// The `let` bindings of a program, plus the compiler of chain arguments. A chain in
// an argument (`tex: solid(color: #f00)`) compiles to its own chain that writes a
// hidden surface. The consuming step carries it in `inlineChains`, and the
// renderer runs it before the step, as upstream's validator compiles the chain into
// temporary steps ahead of the consuming effect.
class CompileScope extends Map {
  constructor(registry, search, draws = drawContext(null)) {
    super()
    this.registry = registry
    this.search = search
    this.pending = null
    this.inlineCount = 0
    // The program's draws, and the occurrence counts that name its elements
    // (upstream: `<effect>_<n>` by source order).
    this.draws = draws
    this.occurrences = new Map()
    // The declarations of each let name, counted apart for lets that hold
    // effects and lets that hold values (upstream `let:<name>#k`).
    this.letCounts = { effect: new Map(), value: new Map() }
    this.choicesFor = (effectName, paramName, loc) => {
      const candidates = this.search.map((namespace) => registry.resolve(effectName, [namespace])).filter(Boolean)
      if (candidates.length > 1) {
        throw new DslError(`choices(): effect name '${effectName}' is ambiguous: ${candidates.map((item) => `${item.namespace}.${item.func}`).join(', ')}`, loc)
      }
      if (candidates.length === 0) throw new DslError(`choices(): unknown effect '${effectName}'`, loc)
      const param = candidates[0].params[paramName]
      if (!param) throw new DslError(`choices(): effect '${effectName}' has no parameter named '${paramName}'`, loc)
      if (!param.choices || typeof param.choices !== 'object') {
        throw new DslError(`choices(): parameter '${paramName}' of '${effectName}' has no choices`, loc)
      }
      return Object.keys(param.choices)
    }
    // Names of the program's lets that a later statement declares. Reading one
    // before its let reports S003, as upstream's validator does.
    this.pendingNames = null
  }

  nextOccurrence(func) {
    const n = (this.occurrences.get(func) ?? 0) + 1
    this.occurrences.set(func, n)
    return `${func}_${n}`
  }

  letKey(name, kind) {
    const k = (this.letCounts[kind].get(name) ?? 0) + 1
    this.letCounts[kind].set(name, k)
    return k === 1 ? `let:${name}` : `let:${name}#${k}`
  }

  // An effect passed as a value draws under the value's key: `<key>/e:<op>/...`.
  compileInlineChain(chain, at) {
    const keyBase = at ? joinKey(at.key, ...at.path) : null
    const compiled = compileChain(chain, this, { inline: true, keyBase })
    const surface = `inline:${this.inlineCount++}`
    this.pending.push(Object.freeze({ surface, chain: compiled }))
    return { kind: 'surface', name: surface, loc: chain.loc }
  }
}

function mergeArgs(stored, call) {
  if (!stored.argMode) return { ...call, name: stored.name }
  if (!call.argMode) return { ...stored, loc: call.loc }
  if (stored.argMode === 'positional' && call.argMode === 'positional') return { ...call, name: stored.name, args: [...stored.args, ...call.args] }
  const args = [...stored.args, ...call.args]
  const positional = args.filter((arg) => arg.name === null)
  const named = new Map(args.filter((arg) => arg.name !== null).map((arg) => [arg.name, arg]))
  return { ...call, name: stored.name, args: [...positional, ...named.values()], argMode: positional.length ? 'merged' : 'named' }
}

// A `from(ns, ...)` namespace on the call site wins over one stored in the partial,
// as in upstream's resolveCall.
function mergePartial(stored, call) {
  const merged = mergeArgs(stored, call)
  const namespace = call.namespace ?? stored.namespace
  if (namespace) merged.namespace = namespace
  else delete merged.namespace
  return merged
}

function effectArguments(call, definition) {
  let args = call.args
  if (args.filter((arg) => arg.name === null).length > definition.paramNames.length) {
    console.warn(`Too many positional arguments for ${call.name}(): '${call.name}' takes ${definition.paramNames.length}`)
    let positionalIndex = 0
    args = args.filter((arg) => arg.name !== null || positionalIndex++ < definition.paramNames.length)
  }
  if (call.argMode === 'merged') {
    // Separate stable calls can meet through a let. Their positionals keep
    // their slot index; a keyword overrides that slot instead of shifting
    // the positional into the next unfilled parameter. Discard ignored values
    // before resolving them, so they cannot create inline render chains.
    const named = args.filter((arg) => arg.name !== null)
    const overridden = new Set(named.map((arg) => definition.paramAliases?.[arg.name] ?? arg.name))
    const positional = args.filter((arg) => arg.name === null)
      .map((arg, index) => ({ ...arg, name: definition.paramNames[index] }))
      .filter((arg) => !overridden.has(arg.name))
    args = [...positional, ...named]
  }
  return args
}

// `read3d(vol, geo)` and `write3d(vol, geo)` take two positional references:
// identifiers such as vol0 and geo0, or surface references (upstream parseWriteCall
// and the validator's Read3D handling).
function volumeReferences(call) {
  if (call.argMode !== 'positional' || call.args.length !== 2) return null
  const names = call.args.map(({ value }) => {
    if (value?.kind === 'surface') return value.name
    if (value?.kind === 'identifier' && !value.name.includes('.')) return value.name
    return null
  })
  return names.includes(null) ? null : names
}

function read3dReferences(call) {
  if (call.argMode === 'named') {
    const named = new Map(call.args.map((arg) => [arg.name, arg]))
    if (!named.has('tex3d') || !named.has('geo')) return null
    return volumeReferences({ argMode: 'positional', args: [named.get('tex3d'), named.get('geo')] })
  }
  return volumeReferences(call)
}

// Compiles one chain. A statement chain that begins with a generator must end with
// write(oN). A chain argument (`inline`) needs no write(): its last image is the
// argument's surface.
function compileChain(chain, bindings, { inline = false, keyBase = null } = {}) {
  const { registry, search } = bindings
  const steps = []
  let hasInput = false
  let hasImage = false
  let hasVolume = false
  let startsWithGenerator = false
  let openLoop = null
  // A subchain block contributes its body calls in place. Upstream's validator
  // wraps them in `_subchain_begin`/`_subchain_end` markers, which its expander
  // passes through without a render pass.
  const calls = chain.calls.flatMap((element) => element.kind === 'Subchain' ? element.body : [element])
  for (let index = 0; index < calls.length; index += 1) {
    let call = calls[index]
    const partial = bindings.get(call.name)
    let heldKey = null
    if (partial?.kind === 'alias') {
      call = { ...call, name: partial.name }
    } else if (partial) {
      if (partial.kind !== 'partial') throw new DslError(`Binding "${call.name}" is not callable`, call.loc)
      call = mergePartial(partial.call, call)
      // An element held by a let draws under the let's key and the occurrence
      // name the let gave it.
      heldKey = partial.key
    }
    const namespaces = call.namespace ? [call.namespace] : search
    const definition = registry.resolve(call.name, namespaces)
    const rawArgs = definition ? effectArguments(call, definition) : call.args
    // The element's key for its draws (upstream validator): its occurrence name
    // at the top level, under its let, or under the value it is passed as. The
    // occurrence is counted before the element's arguments, so an element
    // passed as a value counts after the element that takes it.
    let elementKey = null
    if (definition && !['read', 'write', 'write3d'].includes(call.name) && !(index === 0 && call.name === 'read3d' && read3dReferences(call))) {
      const op = `${definition.namespace}.${definition.func}`
      if (heldKey) elementKey = heldKey
      else {
        const occurrence = bindings.nextOccurrence(definition.func)
        elementKey = inline && keyBase !== null ? joinKey(keyBase, `e:${op}`) : `${op}@${occurrence}`
      }
    }
    // Chain arguments compile while the arguments resolve; they belong to this call.
    const outerPending = bindings.pending
    bindings.pending = []
    let args
    let inlineChains
    try {
      args = resolveArgs(rawArgs, bindings, definition, elementKey)
    } finally {
      inlineChains = bindings.pending
      bindings.pending = outerPending
    }
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
    // Built-in volume I/O (upstream `_write3d` and `_read3d`). write3d stores the
    // current volume and geometry under the two names and passes the chain through;
    // read3d starts a chain from them. A mid-chain read3d() is not a starter, so it
    // fails below as an unknown effect, as a one-argument read3d() at a chain start
    // does.
    if (call.name === 'write3d') {
      // Upstream's lexer reserves write3d, so it cannot start a chain.
      if (index === 0) throw new DslError('Expected effect or IO function name', call.loc)
      if (openLoop) throw new DslError('loopBegin must be closed by loopEnd before write', call.loc)
      const references = volumeReferences(call)
      if (!references) throw new DslError('Expected surface reference', call.loc)
      steps.push({ kind: 'write3d', volume: references[0], geometry: references[1], loc: call.loc })
      continue
    }
    if (index === 0 && call.name === 'read3d' && read3dReferences(call)) {
      const [volume, geometry] = read3dReferences(call)
      steps.push({ kind: 'read3d', volume, geometry, loc: call.loc })
      hasInput = true
      hasVolume = true
      continue
    }
    if (!definition) throw new DslError(`Unknown effect "${call.name}" in search namespaces ${namespaces.join(', ')}`, call.loc)
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
    const explicitParams = Object.freeze([...new Set(args.flatMap((arg, argumentIndex) => {
      if (arg.value === undefined) return []
      // A deprecated alias records its canonical name, as upstream's
      // post-resolution `seen` set does.
      const name = arg.name ?? definition.paramNames[argumentIndex]
      return [definition.paramAliases?.[name] ?? name]
    }))])
    // With a seed directive, an effect seed the program does not set inherits:
    // a draw over the parameter's whole-number range.
    if (bindings.draws.directive && elementKey) {
      let inherited = null
      for (const name of definition.paramNames) {
        if (!isSeedParam(definition, name) || explicitParams.includes(name) || !canInheritSeed(definition.params[name])) continue
        inherited ??= {}
        inherited[name] = inheritedSeed(bindings.draws.draw(bindings.draws.seed, joinKey(elementKey, name, 'inherit')), definition.params[name])
      }
      if (inherited) params = Object.isFrozen(params) ? Object.freeze({ ...params, ...inherited }) : Object.assign(params, inherited)
    }
    const step = { kind: 'effect', definition, params, explicitParams, loc: call.loc }
    if (inlineChains.length > 0) step.inlineChains = Object.freeze(inlineChains)
    steps.push(step)
  }
  if (openLoop) throw new DslError('loopBegin must be closed by loopEnd before the chain ends', openLoop)
  const terminal = steps.at(-1)?.kind
  if (!inline && startsWithGenerator && terminal !== 'write' && terminal !== 'write3d') throw new DslError('Generator chain must end with write(oN)', chain.loc)
  return { steps, loc: chain.loc }
}

// Upstream `let x = noise` makes `x` an alias of the effect function, and
// `let y = x` copies a partial or an alias (the validator stores the symbol's
// expression and substitutes it where `y` is used).
function aliasBinding(value, bindings) {
  if (value?.kind !== 'identifier' || value.name.includes('.')) return null
  const bound = bindings.get(value.name)
  if (bound) return bound.kind === 'partial' || bound.kind === 'alias' ? bound : null
  return bindings.registry.resolve(value.name, bindings.search) ? { kind: 'alias', name: value.name } : null
}

// Declares one let. Statement order (upstream 9cc041d0): a chain sees only the
// lets declared at or before its own statement index; a later `let` of the same
// name reassigns it for later statements; reading a pending name reports S003.
// A bare identifier value must name something resolvable now (an earlier
// binding, an alias, or an effect), as upstream's declareVar requires.
function declareBinding(binding, bindings) {
  if (binding.value?.kind === 'Call' && !VALUE_CALLS.has(binding.value.name) && !isRandomCall(binding.value)) {
    // A partial keeps its call unresolved. Its arguments resolve where it is
    // called, as upstream's validator substitutes a symbol at each use. Its
    // element is counted here, where the let is written, and draws under the
    // let's key wherever it is called.
    if (binding.value.args.some((arg) => containsRandom(arg.value))) {
      throw new DslError(`Random calls in an effect held by a let are not supported yet: '${binding.name}'`, binding.loc)
    }
    const definition = bindings.registry.resolve(binding.value.name, binding.value.namespace ? [binding.value.namespace] : bindings.search)
    const key = definition
      ? joinKey(bindings.letKey(binding.name, 'effect'), `${definition.namespace}.${definition.func}@${bindings.nextOccurrence(definition.func)}`)
      : null
    bindings.set(binding.name, { kind: 'partial', call: binding.value, key })
    return
  }
  if (aliasBinding(binding.value, bindings)) {
    bindings.set(binding.name, aliasBinding(binding.value, bindings))
    return
  }
  if (binding.value?.kind === 'identifier' && !binding.value.name.includes('.') &&
      !bindings.has(binding.value.name) && !bindings.registry.resolve(binding.value.name, bindings.search)) {
    throw new DslError(`Variable used before assignment: '${binding.value.name}'`, binding.value.loc)
  }
  // A value let draws once, under its own key, wherever it is used. One that
  // holds a random call draws where it is written, used or not, as upstream's
  // validator resolves it at the declaration.
  const entry = { kind: 'value', expr: binding.value, resolved: false, value: null, at: { key: bindings.letKey(binding.name, 'value'), path: [] } }
  bindings.set(binding.name, entry)
  if (containsRandom(binding.value)) {
    entry.value = evaluateValue(binding.value, bindings, 0, [binding.name], entry.at)
    entry.resolved = true
  }
}

export function compileDsl(source, registry, options = {}) {
  const ast = parseDsl(source, options)
  if (ast.search.length === 0) throw new DslError('Missing required search directive', ast.loc)

  const bindings = new CompileScope(registry, ast.search, drawContext(ast.seed?.value ?? null, options.onDraw))
  let nextBinding = 0
  const declareThrough = (chainIndex) => {
    while (nextBinding < ast.bindings.length && (ast.bindings[nextBinding].planIndex ?? 0) <= chainIndex) {
      declareBinding(ast.bindings[nextBinding++], bindings)
    }
  }

  const chains = ast.chains.map((chain, chainIndex) => {
    declareThrough(chainIndex)
    // pendingNames covers the whole chain compile, including inline chains:
    // every argument position reports a pending read, as upstream does.
    bindings.pendingNames = new Set(ast.bindings.slice(nextBinding).map((binding) => binding.name))
    try {
      return compileChain(chain, bindings)
    } finally {
      bindings.pendingNames = null
    }
  })
  declareThrough(Infinity)

  let lastWrittenSurface = null
  for (const chain of chains) {
    for (const step of chain.steps) if (step.kind === 'write') lastWrittenSurface = step.surface
  }
  const renderSurface = ast.render?.name ?? lastWrittenSurface
  if (!renderSurface) throw new DslError('No render surface specified and no write() found - add render(oN) or write(oN)', ast.loc)

  return Object.freeze({ search: Object.freeze(ast.search.slice()), chains: Object.freeze(chains), renderSurface, ast })
}
