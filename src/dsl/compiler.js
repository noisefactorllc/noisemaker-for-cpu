import { DslError } from './error.js'
import { joinKey, pathSegment } from './draws.js'
import { parseDsl } from './parser.js'
import { canInheritSeed, containsRandom, containsRandomDeep, drawContext, inheritedSeed, isRandomCall, isSeedParam, resolveRandomCall } from './random.js'
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

// The origin of an `_id:` written in a let's value (upstream `_letIdOrigin`).
// An enumerable symbol, so a copy of the argument keeps the same origin.
const ID_ORIGIN = Symbol('letIdOrigin')

// The positional order of midi() and audio() arguments (upstream parser), and
// the fields upstream resolves random calls in (randomize.js).
const AUTOMATION_ORDER = { midi: ['channel', 'mode', 'min', 'max', 'sensitivity'], audio: ['band', 'min', 'max'] }
const AUTOMATION_FIELDS = {
  midi: new Set(['channel', 'mode', 'cc', 'nrpn', 'zone', 'members', 'min', 'max', 'sensitivity']),
  audio: new Set(['band', 'min', 'max']),
}

const AUTOMATION_KEYWORD_ONLY = { midi: ['name', 'id', 'cc', 'nrpn', 'zone', 'members'], audio: ['channel', 'name', 'id'] }

// Upstream's parser fills positional arguments into the slots no keyword set,
// in order, and keeps the last value of a keyword written twice. It refuses an
// excess positional, an unknown keyword and a name or id that is not a string.
function automationFields(call) {
  const order = AUTOMATION_ORDER[call.name]
  const valid = [...order, ...AUTOMATION_KEYWORD_ONLY[call.name]]
  const positional = call.args.filter((arg) => arg.name === null)
  if (positional.length > order.length) {
    throw new DslError(`${call.name}() ${AUTOMATION_KEYWORD_ONLY[call.name].join(', ').replace(/, ([^,]*)$/, ' and $1')} are keyword-only`, call.loc)
  }
  const named = new Map(call.args.filter((arg) => arg.name !== null).map((arg) => [arg.name, arg.value]))
  for (const [name, value] of named) {
    if (!valid.includes(name)) throw new DslError(`${call.name}() unknown parameter '${name}'. Valid: ${valid.join(', ')}`, call.loc)
    if ((name === 'name' || name === 'id') && typeof value !== 'string') {
      throw new DslError(`${call.name}() '${name}' requires a quoted string`, call.loc)
    }
  }
  const free = order.filter((name) => !named.has(name))
  if (positional.length > free.length) throw new DslError(`${call.name}() has an excess positional argument`, call.loc)
  const fields = new Map()
  positional.forEach((arg, index) => fields.set(free[index], arg.value))
  for (const [name, value] of named) fields.set(name, value)
  return fields
}

function compileAutomationCall(call, bindings, depth, resolving = [], at = null) {
  if (call.name !== 'osc') {
    // The input is ignored, but a random call in an argument still draws and is
    // checked, as upstream resolves it before the input is read.
    for (const [name, value] of automationFields(call)) {
      if (AUTOMATION_FIELDS[call.name].has(name) && containsRandom(value)) {
        evaluateValue(value, bindings, depth + 1, resolving, at && { key: at.key, path: [...at.path, pathSegment.named(name)] })
      }
    }
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
    if (bindings.has(value.name)) throw new DslError(`'${value.name}' is a variable here and cannot be called`, value.loc)
    if (!at) throw new DslError(`A random call is not allowed here: ${value.name}()`, value.loc)
    const ctx = { seed: bindings.scopeSeed(), key: at.key, draw: bindings.draws.draw, choicesFor: bindings.choicesFor, isShadowed: (name) => bindings.has(name) }
    return resolveRandomCall(value, ctx, at.path, (item, path, defer = false) => {
      const outer = bindings.deferChains
      if (defer) bindings.deferChains = true
      try {
        return evaluateValue(item, bindings, oscDepth, resolving, { key: at.key, path })
      } finally {
        bindings.deferChains = outer
      }
    })
  }
  if (value.kind === 'Call') {
    if (VALUE_CALLS.has(value.name)) return compileAutomationCall(value, bindings, oscDepth, resolving, at)
    throw new DslError(`Unsupported DSL value ${value.kind} "${value.name}"`, value.loc)
  }
  if (value.kind === 'identifier') {
    // A let's own partial or alias is the one in force where that let was written.
    if (value.boundPartial || bindings.has(value.name)) {
      const binding = value.boundPartial ?? bindings.get(value.name)
      // A let that holds an effect, passed as a value, compiles as that effect,
      // under the let's key (upstream `let:<name>/<op>@<occurrence>`).
      if (binding.kind === 'partial') {
        // The call carries the binding in force here, so a later let of the
        // same name does not change what it stands for.
        const call = { kind: 'Call', name: value.name, args: [], argMode: null, loc: value.loc, boundPartial: binding }
        const chain = { kind: 'Chain', calls: [call], loc: value.loc }
        if (bindings.deferChains) return chain
        if (!bindings.pending) throw new DslError(`Effect partial "${value.name}" cannot be used as a value`, value.loc)
        return bindings.compileInlineChain(chain, at, { count: true })
      }
      // An effect alias used as a value stays the effect's bare name.
      if (binding.kind === 'alias') return binding.name
      // A value binding resolves lazily at its first use. Statement order
      // (upstream 9cc041d0) makes a chain see only lets declared at or before
      // its own index, so a name declared by a later let is pending here and
      // reading it reports S003, as upstream does.
      // An effect a value let chose compiles where it is used, under that
      // place's key, and is not counted as an element (upstream).
      if (binding.resolved && binding.value?.kind === 'Chain') {
        if (bindings.deferChains) return binding.value
        if (bindings.pending) return bindings.compileInlineChain(binding.value, at, { count: false })
      }
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
  // A value let keeps an effect it holds as written until it is used.
  if (value.kind === 'Chain' && bindings.deferChains) return value
  if (value.kind === 'Chain' && bindings.pending) return bindings.compileInlineChain(value, at)
  throw new DslError(`Unsupported DSL value ${value.kind}`, value.loc)
}

// Look through value aliases without evaluating expressions that may compile
// inline chains. evaluateValue handles pending names and cycles at evaluation.
function boundExpression(value, bindings) {
  if (value?.kind !== 'identifier') return value
  const seen = new Set()
  while (value?.kind === 'identifier' && !seen.has(value.name)) {
    seen.add(value.name)
    const binding = bindings.get(value.name)
    if (binding?.kind !== 'value') break
    value = binding.expr
  }
  return value
}

// Each argument draws under its element's key and its canonical parameter name,
// whether it is written by position or by name.
function resolveArgs(args, bindings, call, definition, elementKey) {
  let positional = 0
  return args.map((arg, index) => {
    const chain = boundExpression(arg.value, bindings)
    if (definition && chain?.kind === 'Chain' && chain.calls.some(entry =>
      entry.kind !== 'Call' || entry.name === 'read' || entry.name === 'read3d')) {
      const name = definition?.paramAliases?.[arg.name] ?? arg.name ?? definition?.paramNames[index]
      throw new DslError(`Chain for argument '${name}' in ${call.name}() may contain only effect calls`, chain.loc, 'S001')
    }
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
    // Effects passed as values inside a let that holds an effect: counted once,
    // where the let is written, and not again where the let is called.
    this.letChains = new WeakSet()
    this.deferChains = false
    // Key names (upstream: the naming body's _id: values, the ids already
    // claimed and the names already given) and the `_seed:` scopes in force.
    this.bodyIds = new Set()
    this.claimedIds = new Set()
    this.givenNames = new Set()
    this.seedScopes = []
    this.choicesFor = (effectName, paramName, loc) => {
      // A two-part name, `synth.noise`, names its namespace.
      const parts = effectName.split('.')
      const candidates = parts.length === 2 ? [registry.resolve(parts[1], [parts[0]])].filter(Boolean)
        : this.search.map((namespace) => registry.resolve(effectName, [namespace])).filter(Boolean)
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

  // A let whose value carries an `_id:` may be used once: its uses would share
  // the id (upstream S011).
  // An `_id:` written in a let's value is one id however the let is reached;
  // an element that takes it a second time would share it (upstream S011).
  takeId(arg, loc) {
    const origin = arg[ID_ORIGIN]
    if (!origin) return
    if (origin.taken) throw new DslError(`_id: "${arg.value}" is in a 'let' value used more than once, so its uses would share one id`, loc)
    origin.taken = true
  }

  // Mark every `_id:` written in a let's value.
  markLetIds(value) {
    if (Array.isArray(value)) return value.forEach((item) => this.markLetIds(item))
    if (!value || typeof value !== 'object') return
    if (value.kind === 'Chain') return value.calls.forEach((call) => this.markLetIds(call.kind === 'Subchain' ? call.body : call))
    if (value.kind === 'Call') {
      for (const arg of value.args) {
        if (arg.name === '_id' && !arg[ID_ORIGIN]) arg[ID_ORIGIN] = { taken: false }
        this.markLetIds(arg.value)
      }
    } else if (value.kind === 'binary') { this.markLetIds(value.left); this.markLetIds(value.right) }
    else if (value.kind === 'unary') this.markLetIds(value.argument)
    else if (value.kind === 'vector') this.markLetIds(value.values)
  }

  // The seed draws use here: the innermost `_seed:` scope's, else the program's.
  scopeSeed() {
    return this.seedScopes.length ? this.seedScopes.at(-1) : this.draws.seed
  }

  // Upstream's key name: an element's `_id:` unless an earlier element took it,
  // else its occurrence name, with `'` added while it is another element's
  // `_id:` in the body or a name already given.
  keyNameFor(occurrence, id) {
    if (id !== undefined && !this.claimedIds.has(id)) {
      this.claimedIds.add(id)
      this.givenNames.add(id)
      return id
    }
    let name = occurrence
    while (this.bodyIds.has(name) || this.givenNames.has(name)) name += "'"
    this.givenNames.add(name)
    return name
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
  compileInlineChain(chain, at, { count = !this.letChains.has(chain) } = {}) {
    const keyBase = at ? joinKey(at.key, ...at.path) : null
    const compiled = compileChain(chain, this, { inline: true, keyBase, count })
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
  const merged = { ...call, name: stored.name, args: [...positional, ...named.values()], argMode: positional.length ? 'merged' : 'named' }
  // A parameter bound before a positional colour limits it to its indexed
  // slot. Metadata binds no slot, and later keywords override only their slot.
  if (positional.length && stored.args.some(arg => arg.name !== null && arg.name !== '_id' && arg.name !== '_skip')) {
    merged.colorSplatLimit = stored.colorSplatLimit ?? stored.args.filter(arg => arg.name === null).length
  }
  return merged
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

function effectArguments(call, definition, bindings) {
  let args = call.args
  if (args.filter((arg) => arg.name === null).length > definition.paramNames.length) {
    console.warn(`Too many positional arguments for ${call.name}(): '${call.name}' takes ${definition.paramNames.length}`)
    let positionalIndex = 0
    args = args.filter((arg) => arg.name !== null || positionalIndex++ < definition.paramNames.length)
  }
  const positional = args.filter(arg => arg.name === null)
  const r = definition.paramNames.indexOf('r')
  if (r >= 0 && r < positional.length && r < (call.colorSplatLimit ?? Infinity) &&
      definition.params.r.type !== 'color' && definition.paramNames[r + 1] === 'g' && definition.paramNames[r + 2] === 'b') {
    const arg = positional[r]
    const color = boundExpression(arg.value, bindings)
    if (color?.kind === 'color') {
      // A hex colour stands in three indexed slots. Positionals at the g
      // and b indexes are ignored; a fourth positional keeps its own index.
      positional.splice(r, 3, ...color.slice(0, 3).map(value => ({ ...arg, value })))
      if (call.argMode !== 'merged') return positional
    }
  }
  if (call.argMode === 'merged') {
    // Discard overridden values before resolving them or compiling inline chains.
    const named = args.filter(arg => arg.name !== null)
    const overridden = new Set(named.map(arg => definition.paramAliases?.[arg.name] ?? arg.name))
    return positional.map((arg, index) => ({ ...arg, name: definition.paramNames[index] }))
      .filter(arg => !overridden.has(arg.name)).concat(named)
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
function compileChain(chain, bindings, { inline = false, keyBase = null, count = true } = {}) {
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
    const partial = call.boundPartial ?? bindings.get(call.name)
    let heldKey = null
    let target = partial
    // An alias names an effect; its target name resolves where it is called, so
    // a let that later makes that name a partial is followed (upstream
    // substitutes the alias's name).
    // Upstream follows it for an effect passed as a value; a statement element
    // calls the alias's effect itself.
    for (let hops = 0; target?.kind === 'alias' && hops < 16; hops += 1) {
      call = { ...call, name: target.name }
      const next = inline ? bindings.get(target.name) : null
      target = next && next !== target ? next : null
    }
    if (partial?.kind === 'alias' && target?.kind !== 'partial') {
      // The alias's target is the effect itself.
    } else if (target) {
      const partial = target
      if (partial.kind !== 'partial') throw new DslError(`Binding "${call.name}" is not callable`, call.loc)
      // An `_id:` written where the let is called names the element at this
      // use, with `'` added while it is one of the let's own names (upstream).
      // An id an earlier element claimed falls back to the let's name, and one
      // written inside another let's value is the let's (upstream letKeyName).
      const writtenSiteId = validId(call.args.findLast((arg) => arg.name === '_id')?.value)
      const siteId = count ? writtenSiteId : undefined
      call = mergePartial(partial.call, call)
      // An element held by a let draws under the let's key and the name the let
      // gave it.
      heldKey = partial.key
      if (siteId !== undefined && partial.letKey && !bindings.claimedIds.has(siteId)) {
        bindings.claimedIds.add(siteId)
        let name = siteId
        while (partial.ownNames.has(name)) name += "'"
        heldKey = joinKey(partial.letKey, `${partial.op}@${name}`)
      }
    }
    const isRead = call.name === 'read' || call.name === 'read3d'
    const metadata = {}
    const parameters = call.args.filter(arg => {
      if (arg.name === '_id') {
        // The last `_id:` is the element's; it must be an identifier string (upstream S001).
        if (arg !== call.args.findLast((other) => other.name === '_id')) return false
        if (validId(arg.value) === undefined) throw new DslError("_id: takes a string literal of letters, digits and '_' that starts with a letter", call.loc)
        bindings.takeId(arg, call.loc)
        metadata._id = arg.value
        return false
      }
      // `_seed: <n>` gives the element's draws the seed n (upstream scopes).
      // Only the last `_seed:` is read, as upstream's keywords keep one, and
      // constant arithmetic folds first.
      if (arg.name === '_seed') {
        if (arg !== call.args.findLast((other) => other.name === '_seed')) return false
        if (containsRandomDeep(arg.value)) throw new DslError('A random call cannot set _seed', call.loc)
        const seed = foldConstant(arg.value)
        if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) {
          throw new DslError('_seed must be a whole number from 0 to 4294967295', call.loc)
        }
        metadata._seed = seed === 0 ? 0 : seed
        return false
      }
      // The upstream expander binds built-in reads before it checks effect
      // skipping. Its read steps retain the flag and still fetch the texture.
      if (isRead && arg.name === '_skip') {
        if (arg.value === true) metadata._skip = true
        else delete metadata._skip
        return false
      }
      return arg.name !== '_skip' || arg.value !== false
    })
    if (parameters.length !== call.args.length) call = { ...call, args: parameters }
    const namespaces = call.namespace ? [call.namespace] : search
    const definition = registry.resolve(call.name, namespaces)
    const rawArgs = definition ? effectArguments(call, definition, bindings) : call.args
    // The element's key for its draws (upstream validator): its occurrence name
    // at the top level, under its let, or under the value it is passed as. The
    // occurrence is counted before the element's arguments, so an element
    // passed as a value counts after the element that takes it.
    let elementKey = null
    if (definition && !['read', 'write', 'write3d'].includes(call.name) && !(index === 0 && call.name === 'read3d' && read3dReferences(call))) {
      const op = `${definition.namespace}.${definition.func}`
      let keyName = null
      if (!heldKey && count) keyName = bindings.keyNameFor(bindings.nextOccurrence(definition.func), metadata._id)
      // An element with its own `_seed:` restarts its keys at itself.
      if (metadata._seed !== undefined) elementKey = op
      else if (heldKey) elementKey = heldKey
      else elementKey = inline && keyBase !== null ? joinKey(keyBase, `e:${op}`) : `${op}@${keyName}`
    }
    const ownSeed = elementKey !== null && metadata._seed !== undefined
    if (ownSeed) bindings.seedScopes.push(metadata._seed)
    // Chain arguments compile while the arguments resolve; they belong to this call.
    const outerPending = bindings.pending
    bindings.pending = []
    let args
    let inlineChains
    try {
      args = resolveArgs(lastOfEachName(rawArgs, definition), bindings, call, definition, elementKey)
    } catch (error) {
      if (ownSeed) bindings.seedScopes.pop()
      throw error
    } finally {
      inlineChains = bindings.pending
      bindings.pending = outerPending
    }
    if (call.name === 'read') {
      if (index !== 0 || args.length !== 1 || args[0].value?.kind !== 'surface') throw new DslError('read(surface) must begin a chain', call.loc)
      steps.push({ kind: 'read', ...metadata, surface: args[0].value.name, loc: call.loc })
      hasInput = true
      hasImage = true
      continue
    }
    if (call.name === 'write') {
      if (openLoop) throw new DslError('loopBegin must be closed by loopEnd before write', call.loc)
      if (!hasImage || args.length !== 1 || args[0].value?.kind !== 'surface') throw new DslError('write(surface) requires a current image', call.loc)
      steps.push({ kind: 'write', ...metadata, surface: args[0].value.name, loc: call.loc })
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
      steps.push({ kind: 'write3d', ...metadata, volume: references[0], geometry: references[1], loc: call.loc })
      continue
    }
    if (index === 0 && call.name === 'read3d' && read3dReferences(call)) {
      const [volume, geometry] = read3dReferences(call)
      steps.push({ kind: 'read3d', ...metadata, volume, geometry, loc: call.loc })
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
    // Inside a `_seed:` scope too, with that scope's seed.
    if ((bindings.draws.directive || bindings.seedScopes.length) && elementKey) {
      let inherited = null
      for (const name of definition.paramNames) {
        if (!isSeedParam(definition, name) || explicitParams.includes(name) || !canInheritSeed(definition.params[name])) continue
        inherited ??= {}
        inherited[name] = inheritedSeed(bindings.draws.draw(bindings.scopeSeed(), joinKey(elementKey, name, 'inherit')), definition.params[name])
      }
      if (inherited) params = Object.isFrozen(params) ? Object.freeze({ ...params, ...inherited }) : Object.assign(params, inherited)
    }
    if (ownSeed) bindings.seedScopes.pop()
    const step = { kind: 'effect', ...metadata, definition, params, explicitParams, loc: call.loc }
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

// Upstream substitutes a known hex colour into the new binding at declaration.
function captureHexColors(value, bindings) {
  if (value?.kind === 'Call') {
    return { ...value, args: value.args.map(arg => ({ ...arg, value: captureHexColors(arg.value, bindings) })) }
  }
  if (value?.kind === 'Chain') {
    return { ...value, calls: value.calls.map(call => captureHexColors(call, bindings)) }
  }
  const resolved = boundExpression(value, bindings)
  return resolved?.kind === 'color' ? resolved : value
}

// A whole-number literal or arithmetic on literals, as upstream reads `_seed:`;
// undefined for anything else, a let's name included.
function foldConstant(value) {
  if (typeof value === 'number') return value
  if (value?.kind === 'unary') {
    const input = foldConstant(value.argument)
    return input === undefined ? undefined : value.operator === '-' ? -input : input
  }
  if (value?.kind === 'binary') {
    const left = foldConstant(value.left)
    const right = foldConstant(value.right)
    if (left === undefined || right === undefined) return undefined
    return value.operator === '+' ? left + right : value.operator === '-' ? left - right : value.operator === '*' ? left * right : left / right
  }
  return undefined
}

// An `_id:` value the port keeps: a string that is an identifier.
function validId(value) {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(value) ? value : undefined
}

// Every `_id:` string written in a value, in calls at any depth.
function collectIds(value, ids) {
  if (Array.isArray(value)) return value.forEach((item) => collectIds(item, ids))
  if (!value || typeof value !== 'object') return
  if (value.kind === 'Chain') return value.calls.forEach((call) => collectIds(call.kind === 'Subchain' ? call.body : call, ids))
  if (value.kind === 'Call') {
    for (const arg of value.args) {
      if (arg.name === '_id' && typeof arg.value === 'string') ids.add(arg.value)
      collectIds(arg.value, ids)
    }
  } else if (value.kind === 'binary') { collectIds(value.left, ids); collectIds(value.right, ids) }
  else if (value.kind === 'unary') collectIds(value.argument, ids)
  else if (value.kind === 'vector') collectIds(value.values, ids)
}

// A keyword written twice keeps its last value, as upstream's keyword object
// does, so an earlier one neither draws nor is checked.
function lastOfEachName(args, definition) {
  if (!definition) return args
  const canonical = (arg) => definition.paramAliases?.[arg.name] ?? arg.name
  const last = new Map()
  args.forEach((arg, index) => { if (arg.name !== null) last.set(canonical(arg), index) })
  return args.filter((arg, index) => arg.name === null || last.get(canonical(arg)) === index)
}

// Count the effects passed as values inside a let's arguments, where the let is
// written, outer before inner.
function countLetValues(args, bindings) {
  for (const arg of args) {
    const value = arg.value
    if (value?.kind !== 'Chain') {
      if (Array.isArray(value)) countLetValues(value.map((item) => ({ value: item })), bindings)
      continue
    }
    bindings.letChains.add(value)
    for (const entry of value.calls.flatMap((call) => (call.kind === 'Subchain' ? call.body : [call]))) {
      const definition = elementDefinition(entry, bindings)
      // An element that calls another let's partial is that let's element, counted where it was written.
      const held = (entry.boundPartial ?? bindings.get(entry.name))?.kind === 'partial'
      if (definition && !held) bindings.nextOccurrence(definition.func)
      countLetValues(lastOfEachName(entry.args, definition), bindings)
    }
  }
}

// The definition a chain element's name stands for here: through an alias or a
// partial a let holds, then the registry.
function elementDefinition(entry, bindings) {
  const binding = entry.boundPartial ?? bindings.get(entry.name)
  const name = binding?.kind === 'alias' ? binding.name : binding?.kind === 'partial' ? binding.call.name : entry.name
  const namespace = binding?.kind === 'partial' ? (entry.namespace ?? binding.call.namespace) : entry.namespace
  return bindings.registry.resolve(name, namespace ? [namespace] : bindings.search)
}

// Mark each chain element in a value that names a let partial or alias with the
// binding in force now, as upstream substitutes it where the let is written, so
// a later let of the same name does not change it.
function bindCalls(value, bindings) {
  if (Array.isArray(value)) return value.forEach((item) => bindCalls(item, bindings))
  if (!value || typeof value !== 'object') return
  if (value.kind === 'identifier') {
    // A name the value reads is the binding in force here, a value let's too.
    const binding = bindings.get(value.name)
    if (!value.boundPartial && binding) value.boundPartial = binding
  } else if (value.kind === 'Chain') {
    for (const entry of value.calls.flatMap((call) => (call.kind === 'Subchain' ? call.body : [call]))) {
      const binding = bindings.get(entry.name)
      if (!entry.boundPartial && (binding?.kind === 'partial' || binding?.kind === 'alias')) entry.boundPartial = binding
      entry.args.forEach((arg) => bindCalls(arg.value, bindings))
    }
  } else if (value.kind === 'Call') value.args.forEach((arg) => bindCalls(arg.value, bindings))
  else if (value.kind === 'binary') { bindCalls(value.left, bindings); bindCalls(value.right, bindings) }
  else if (value.kind === 'unary') bindCalls(value.argument, bindings)
  else if (value.kind === 'vector') bindCalls(value.values, bindings)
}

// Whether a let's argument holds a random call, in effects passed as values too,
// reading only the last of a keyword written twice at every depth.
function randomInLetValue(value, bindings) {
  if (Array.isArray(value)) return value.some((item) => randomInLetValue(item, bindings))
  if (value?.kind !== 'Chain') return containsRandomDeep(value)
  return value.calls.flatMap((call) => (call.kind === 'Subchain' ? call.body : [call])).some((entry) => {
    const definition = elementDefinition(entry, bindings)
    return lastOfEachName(entry.args, definition).some((arg) => randomInLetValue(arg.value, bindings))
  })
}

// Whether a value names a value let that chose an effect, as upstream
// substitutes it into an effect let. The port does not key that yet.
function namesChosenEffect(value, bindings) {
  if (Array.isArray(value)) return value.some((item) => namesChosenEffect(item, bindings))
  if (value?.kind !== 'identifier') return false
  const binding = bindings.get(value.name)
  return binding?.kind === 'value' && binding.resolved && binding.value?.kind === 'Chain'
}

// Declares one let. Statement order (upstream 9cc041d0): a chain sees only the
// lets declared at or before its own statement index; a later `let` of the same
// name reassigns it for later statements; reading a pending name reports S003.
// A bare identifier value must name something resolvable now (an earlier
// binding, an alias, or an effect), as upstream's declareVar requires.
function declareBinding(binding, bindings) {
  // Upstream substitutes a value let that chose an effect into the let that
  // names it: `let w = v` holds v's effect, and an argument that names v holds
  // that effect as written.
  const chosen = (value) => {
    const bound = value?.kind === 'identifier' ? (value.boundPartial ?? bindings.get(value.name)) : null
    return bound?.kind === 'value' && bound.resolved && bound.value?.kind === 'Chain' ? bound.value : null
  }
  const copied = chosen(binding.value)
  if (copied) {
    if (copied.calls.length !== 1 || copied.calls[0].kind !== 'Call') {
      throw new DslError(`A let cannot copy another let's chosen chain of several effects yet: '${binding.name}'`, binding.loc)
    }
    // A chosen call of another let's partial is that partial, keyed where it was written.
    const call = copied.calls[0]
    const held = call.boundPartial ?? bindings.get(call.name)
    if (held?.kind === 'partial' && call.args.length === 0) {
      // It is still a let of this name, counted as one that holds an effect.
      bindings.letKey(binding.name, 'effect')
      bindings.set(binding.name, held)
      return
    }
    return declareBinding({ ...binding, value: call }, bindings)
  }
  // Substitute chosen effects at any depth of the let's arguments. Nodes with
  // nothing to substitute are kept as they are, with every mark they carry.
  const substituteArgs = (args) => {
    const next = args.map((arg) => {
      const value = substitute(arg.value)
      return value === arg.value ? arg : { ...arg, value }
    })
    return next.every((arg, index) => arg === args[index]) ? args : next
  }
  const substitute = (value) => {
    if (chosen(value)) return chosen(value)
    if (Array.isArray(value)) {
      const next = value.map(substitute)
      return next.every((item, index) => item === value[index]) ? value : next
    }
    if (value?.kind === 'Chain') {
      const calls = value.calls.map((call) => {
        if (call.kind === 'Subchain') {
          const body = call.body.map((entry) => { const args = substituteArgs(entry.args); return args === entry.args ? entry : { ...entry, args } })
          return body.every((entry, index) => entry === call.body[index]) ? call : { ...call, body }
        }
        const args = substituteArgs(call.args)
        return args === call.args ? call : { ...call, args }
      })
      return calls.every((call, index) => call === value.calls[index]) ? value : { ...value, calls }
    }
    return value
  }
  if (binding.value?.kind === 'Call') {
    const args = substituteArgs(binding.value.args)
    if (args !== binding.value.args) binding = { ...binding, value: { ...binding.value, args } }
  }
  if (binding.value?.kind === 'Call' && !VALUE_CALLS.has(binding.value.name) && !isRandomCall(binding.value)) {
    // Other partial arguments keep their existing use-site resolution. The
    // let's element is counted here, where the let is written, and draws under
    // the let's key wherever it is called. A let of another let's name keys
    // the element under its own name, with the occurrence name the other let
    // gave it.
    let call = captureHexColors(binding.value, bindings)
    const own = call
    const previous = bindings.get(call.name)
    if (previous?.kind === 'partial') call = mergePartial(previous.call, call)
    if (previous?.kind === 'alias') call = { ...call, name: previous.name }
    const definition = bindings.registry.resolve(call.name, call.namespace ? [call.namespace] : bindings.search)
    // The arguments this let writes, with only the last of a keyword written
    // twice (upstream keeps one). The merge above keeps these same nodes.
    const written = lastOfEachName(own.args, definition)
    written.forEach((arg) => bindCalls(arg.value, bindings))
    if (written.some((arg) => randomInLetValue(arg.value, bindings))) {
      throw new DslError(`Random calls in an effect held by a let are not supported yet: '${binding.name}'`, binding.loc)
    }
    if (written.some((arg) => namesChosenEffect(arg.value, bindings))) {
      throw new DslError(`A let that holds an effect cannot take another let's chosen effect yet: '${binding.name}'`, binding.loc)
    }
    // A let names its element as a body does: an `_id:` written in the let,
    // else its occurrence name.
    const op = definition ? `${definition.namespace}.${definition.func}` : null
    let ownName = null
    const writtenId = validId(own.args.findLast((arg) => arg.name === '_id')?.value)
    if (previous?.kind === 'partial') ownName = writtenId ?? previous.ownName
    else if (definition) {
      const occurrence = bindings.nextOccurrence(definition.func)
      ownName = writtenId ?? occurrence
    }
    const element = ownName ? `${op}@${ownName}` : null
    const letKey = element ? bindings.letKey(binding.name, 'effect') : null
    const key = element ? joinKey(letKey, element) : null
    countLetValues(written, bindings)
    bindings.markLetIds(call)
    bindings.set(binding.name, { kind: 'partial', call, key, element, op, ownName, letKey, ownNames: new Set(ownName ? [ownName] : []) })
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
  if (namesChosenEffect(binding.value, bindings)) {
    throw new DslError(`A let cannot copy another let's chosen effect yet: '${binding.name}'`, binding.loc)
  }
  const entry = { kind: 'value', expr: captureHexColors(binding.value, bindings), resolved: false, value: null, at: { key: bindings.letKey(binding.name, 'value'), path: [] } }
  // Bound before the let's own name is set, so the value sees the earlier binding of that name.
  bindCalls(entry.expr, bindings)
  bindings.markLetIds(entry.expr)
  bindings.set(binding.name, entry)
  if (containsRandom(binding.value)) {
    bindings.deferChains = true
    try {
      entry.value = evaluateValue(entry.expr, bindings, 0, [binding.name], entry.at)
    } finally {
      bindings.deferChains = false
    }
    entry.resolved = true
    // An effect the let chose is compiled where the let is used, uncounted.
    if (entry.value?.kind === 'Chain') bindings.letChains.add(entry.value)
  }
}

export function compileDsl(source, registry, options = {}) {
  const ast = parseDsl(source, options)
  if (ast.search.length === 0) throw new DslError('Missing required search directive', ast.loc)

  const bindings = new CompileScope(registry, ast.search, drawContext(ast.seed?.value ?? null, options.onDraw))
  // The naming body's ids: every `_id:` written in the program.
  collectIds([...ast.bindings.map((binding) => binding.value), ...ast.chains], bindings.bodyIds)
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
