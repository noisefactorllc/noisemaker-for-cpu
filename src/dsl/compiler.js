import { DslError } from './error.js'
import { chanceFrom, joinKey, pathSegment } from './draws.js'
import { parseDsl } from './parser.js'
import { canInheritSeed, containsRandom, containsRandomDeep, drawContext, inheritedSeed, isRandomCall, isSeedParam, resolveRandomCall } from './random.js'
import { isAutomationValue } from '../runtime/automation.js'

// Mirrors upstream std_enums.js oscKind (sine..noise2d; noise/noise1d alias kind 5,
// noise2d is the two-stage periodic noise added upstream at eabb537e).
const OSC_KINDS = { sine: 0, tri: 1, saw: 2, sawInv: 3, square: 4, noise: 5, noise1d: 5, noise2d: 6 }
const OSC_PARAM_ORDER = ['type', 'min', 'max', 'speed', 'offset', 'seed']
const MAX_AUTOMATION_DEPTH = 8
const VALUE_CALLS = new Set(['osc', 'midi', 'audio'])

function nullMap(entries = {}) {
  return Object.assign(Object.create(null), entries)
}

// Mirrors upstream shaders/src/lang/std_enums.js (palette entries come from the
// registry's filter/palette definition so they stay in lockstep with the catalog).
const STATIC_STD_ENUMS = nullMap({
  channel: nullMap({ r: 0, g: 1, b: 2, a: 3 }),
  color: nullMap({ mono: 0, rgb: 1, hsv: 2 }),
  oscType: nullMap({ sine: 0, linear: 1, sawtooth: 2, sawtoothInv: 3, square: 4, noise1d: 5, noise2d: 6 }),
  oscKind: nullMap(OSC_KINDS),
  midiMode: nullMap({
    noteChange: 0, gateNote: 1, gateVelocity: 2, triggerNote: 3, velocity: 4,
    cc: 5, cc14: 6, nrpn: 7, pitchBend: 8, pressure: 9, polyPressure: 10,
  }),
  midiZone: nullMap({ lower: 0, upper: 1 }),
  audioBand: nullMap({ low: 0, mid: 1, high: 2, vol: 3, raw: 4 }),
})

// Mirrors upstream shaders/src/renderer/canvas.js sanitizeEnumName.
function sanitizeEnumName(name) {
  const result = name.replace(/\s+(.)/g, (_, ch) => ch.toUpperCase()).replace(/\s+/g, '').replace(/[^a-zA-Z0-9_]/g, '')
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(result) ? result : null
}

const conditionEnumCache = new WeakMap()

// Builds the condition enum tables for a registry: registered effect choices
// (excluding palette params which live under standard `palette.*`, matching
// upstream registerEffectWithRuntime) and standard enums. Kept separate from
// argument choice coercion in EffectDefinition.
function conditionEnumsFor(registry) {
  const count = registry.effects?.size ?? 0
  const cached = conditionEnumCache.get(registry)
  if (cached && cached.count === count) return cached.tables

  const registered = Object.create(null)
  const palette = Object.create(null)
  const paletteChoices = registry.get('filter', 'palette')?.params?.index?.choices
  if (paletteChoices && typeof paletteChoices === 'object') {
    for (const [name, val] of Object.entries(paletteChoices)) {
      if (!name.endsWith(':') && val !== null) palette[name] = val
    }
  }
  for (const effect of registry.list()) {
    for (const [paramName, spec] of Object.entries(effect.params ?? {})) {
      if (!spec?.choices || typeof spec.choices !== 'object' || spec.enum || spec.enumPath) continue
      const ns = (registered[effect.namespace] ??= Object.create(null))
      const fn = (ns[effect.func] ??= Object.create(null))
      const table = (fn[paramName] ??= Object.create(null))
      for (const [choiceName, val] of Object.entries(spec.choices)) {
        if (choiceName.endsWith(':') || val === null) continue
        table[choiceName] = val
        const sanitized = sanitizeEnumName(choiceName)
        if (sanitized && sanitized !== choiceName) table[sanitized] = val
      }
    }
  }
  const standard = nullMap({ ...STATIC_STD_ENUMS, palette })
  const tables = { registered, standard }
  conditionEnumCache.set(registry, { count, tables })
  return tables
}

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
  // written by position or by name. Keywords claim their own slots and
  // positionals fill the remaining slots left to right (upstream transformOscInvocation).
  const fieldAt = (name) => at && { key: at.key, path: [...at.path, pathSegment.named(name)] }
  const positional = []
  for (const arg of call.args) {
    if (arg.name !== null) {
      if (!OSC_PARAM_ORDER.includes(arg.name)) {
        throw new DslError(`osc() unknown parameter '${arg.name}'; valid: ${OSC_PARAM_ORDER.join(', ')}`, call.loc)
      }
      fields[arg.name] = arg.value
    } else {
      positional.push(arg.value)
    }
  }
  let posCursor = 0
  for (const paramName of OSC_PARAM_ORDER) {
    if (fields[paramName] === undefined && posCursor < positional.length) {
      fields[paramName] = positional[posCursor++]
    }
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

function unassignedVariable(name, loc) {
  const message = 'Variable used before assignment'
  // Upstream appends the name only when the diagnostic does not already contain it.
  return new DslError(message.includes(name) ? message : `${message}: '${name}'`, loc, 'S003')
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
    if (bindings.boundOf(value) || bindings.has(value.name)) {
      const binding = bindings.boundOf(value) ?? bindings.get(value.name)
      if (binding.kind === 'chainLet') {
        if (bindings.deferChains || !bindings.pending) return binding.chain
        return bindings.compileInlineChain(binding.chain, at, { count: false })
      }
      // A let that holds an effect, passed as a value, compiles as that effect,
      // under the let's key (upstream `let:<name>/<op>@<occurrence>`).
      if (binding.kind === 'partial') {
        // The call carries the binding in force here, so a later let of the
        // same name does not change what it stands for.
        const call = { kind: 'Call', name: value.name, args: [], argMode: null, loc: value.loc }
        bindings.bind(call, binding)
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
        if (bindings.pending) {
          // Its chain reading the let again is a cycle.
          if (binding.evaluating) throw new DslError(`Automation cycle detected: ${value.name} -> ${value.name}`, value.loc, 'S001')
          binding.evaluating = true
          try {
            return bindings.compileInlineChain(binding.value, at, { count: false })
          } finally {
            binding.evaluating = false
          }
        }
      }
      if (binding.resolved) return binding.value
      // An inline chain resolves its arguments afresh, so a let read again
      // while it evaluates is a cycle too; a shadowed earlier binding is distinct.
      if (binding.evaluating) {
        const start = resolving.findIndex((entry) => entry.binding === binding)
        const cycle = start >= 0 ? [...resolving.slice(start).map((entry) => entry.name), value.name] : [value.name, value.name]
        throw new DslError(`Automation cycle detected: ${cycle.join(' -> ')}`, value.loc, 'S001')
      }
      binding.evaluating = true
      try {
        binding.value = evaluateValue(binding.expr, bindings, oscDepth, [...resolving, { name: value.name, binding }], binding.at)
      } finally {
        binding.evaluating = false
      }
      binding.resolved = true
      return binding.value
    }
    if (bindings.pendingNames?.has(value.name)) {
      throw unassignedVariable(value.name, value.loc)
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
    if (value.operator === '+') return input
    if (typeof input !== 'number') throw new DslError("'-' requires a numeric argument", value.loc, 'S012')
    return -input
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
    const binding = bindings.boundOf(value) ?? bindings.get(value.name)
    if (binding?.kind === 'chainLet') return binding.chain
    if (binding?.kind !== 'value') break
    if (binding.resolved && binding.value?.kind === 'Chain') return binding.value
    value = binding.expr
  }
  return value
}

// Each argument draws under its element's key and its canonical parameter name,
// whether it is written by position or by name.
function resolveArgs(args, bindings, call, definition, elementKey) {
  let positional = 0
  const diagnosticGroups = []
  const resolvedArgs = args.map((arg) => {
    const diagnosticStart = bindings.diagnostics.length
    const written = arg.name ?? definition?.paramNames[positional++]
    const name = definition?.paramAliases?.[written] ?? written
    const chain = boundExpression(arg.value, bindings)
    if (definition && chain?.kind === 'Chain' && chain.calls.some(entry =>
      entry.kind !== 'Call' || entry.name === 'read' || entry.name === 'read3d')) {
      throw new DslError(`Chain for argument '${name}' in ${call.name}() may contain only effect calls`, chain.loc, 'S001')
    }
    const at = elementKey && name ? { key: joinKey(elementKey, name), path: [] } : null
    const param = definition?.params[name]
    const value = arg.value
    let resolved
    if (value?.kind === 'identifier' && !value.name.includes('.') &&
        !bindings.boundOf(value) && !bindings.has(value.name) &&
        !STATE_VALUES.has(value.name) && !REFERENCE_NAME.test(value.name) &&
        ['float', 'int', 'bool', 'boolean', 'enum', 'member', 'palette'].includes(param?.type) &&
        !(Object.hasOwn(param.choices ?? {}, value.name) && param.choices[value.name] !== null)) {
      if (param.type !== 'member' || bindings.pendingNames?.has(value.name)) {
        throw unassignedVariable(value.name, value.loc)
      }
      resolved = param.default
    } else {
      resolved = evaluateValue(arg.value, bindings, 0, [], at)
    }
    if ((param?.type === 'float' || param?.type === 'int') && typeof resolved === 'number' && Number.isFinite(resolved)) {
      const clamped = typeof param.min === 'number' && resolved < param.min ? param.min
        : typeof param.max === 'number' && resolved > param.max ? param.max : resolved
      if (clamped !== resolved) {
        bindings.diagnostics.push(Object.freeze({
          code: 'S002',
          severity: 'warning',
          message: `Argument out of range for '${name}' in ${call.name}() (got ${resolved}, clamped to ${clamped})`,
        }))
        resolved = clamped
      }
    }
    diagnosticGroups.push({ index: definition?.paramNames.indexOf(name) ?? 0, entries: bindings.diagnostics.splice(diagnosticStart) })
    return { ...arg, value: resolved }
  })
  // The authority visits parameters in definition order, including inline chains.
  // Keep that warning order without changing the existing random evaluation order.
  diagnosticGroups.sort((a, b) => a.index - b.index)
  for (const group of diagnosticGroups) bindings.diagnostics.push(...group.entries)
  return resolvedArgs
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
    this.diagnostics = []
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
    this.letElements = new WeakMap()
    this.deferChains = false
    // Key names (upstream: the naming body's _id: values, the ids already
    // claimed and the names already given) and the `_seed:` scopes in force.
    this.bodyIds = new Set()
    this.claimedIds = new Set()
    this.givenNames = new Set()
    this.seedScopes = []
    // The key scope (upstream keyScope): the enclosing `maybe_<n>` blocks and
    // `use@<name>` instances. The parts by name, the parts being expanded, each
    // instance's scope, and the top-level statement being compiled.
    this.keyScope = []
    this.parts = new Map()
    this.partStack = []
    this.partScopes = []
    this.usePath = []
    // The `if` statements of the naming body, numbered from 1, and the
    // control flow the program holds.
    this.ifCount = 0
    this.controlFlow = []
    // The bindings a let's names stand for where the let is written, by node.
    // Each part instance binds in a map of its own, over the enclosing one's,
    // so one instance's bindings never reach another's (upstream substitutes
    // per instance).
    this.boundMaps = [new WeakMap()]
    this.statementIndex = 0
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

  bind(node, binding) {
    this.boundMaps.at(-1).set(node, binding)
  }

  boundHere(node) {
    return this.boundMaps.at(-1).has(node)
  }

  boundOf(node) {
    if (!node || typeof node !== 'object') return undefined
    for (let index = this.boundMaps.length - 1; index >= 0; index -= 1) {
      if (this.boundMaps[index].has(node)) return this.boundMaps[index].get(node)
    }
    return undefined
  }

  // A key in the current scope.
  scoped(...segments) {
    return joinKey(...this.keyScope, ...segments)
  }

  // The scope of the part instance being compiled, '' outside every part.
  partScope() {
    return this.partScopes.length ? this.partScopes.at(-1) : ''
  }

  // A maybe (upstream maybe_<n>): its probability, drawn at `<scope>/maybe_<n>/p`
  // when random, and its decision at `<scope>/maybe_<n>/decide`. Its body
  // compiles inside its scope either way, so its draws happen; returns the
  // decision.
  withMaybe(node, body) {
    const maybeKey = this.nextOccurrence('maybe')
    const at = { key: this.scoped(maybeKey, 'p'), path: [] }
    const p = containsRandom(node.probability) ? evaluateValue(node.probability, this, 0, [], at) : evaluateValue(node.probability, this)
    if (typeof p !== 'number' || !(p >= 0 && p <= 1)) throw new DslError('maybe(p): the probability must be a number between 0 and 1', node.loc)
    const taken = chanceFrom(this.draws.draw(this.scopeSeed(), this.scoped(maybeKey, 'decide')), p)
    this.keyScope.push(maybeKey)
    try {
      body()
    } finally {
      this.keyScope.pop()
    }
    return taken
  }

  // A use of a part (upstream resolvePartTarget and withPart): its key name, its
  // part (named, or drawn by pick() at `<use>/part`), its arguments for the
  // part's lets (drawn at `<use>/arg:<name>`), and the scope, seed and naming
  // body of the instance. `body(part, declare)` compiles the part's items.
  withUse(use, body) {
    const idArg = use.args.findLast((arg) => arg.name === '_id')
    if (idArg && validId(idArg.value) === undefined) throw new DslError("_id: takes a string literal of letters, digits and '_' that starts with a letter", use.loc)
    const useKey = `use@${this.keyNameFor(this.nextOccurrence('use'), idArg?.value)}`
    const part = this.resolvePart(use, useKey)
    let ownSeed = null
    const seedArg = use.args.findLast((arg) => arg.name === '_seed')
    if (seedArg) {
      if (containsRandomDeep(seedArg.value)) throw new DslError('A random call cannot set _seed: it must be a literal', use.loc)
      ownSeed = foldConstant(seedArg.value)
      if (!Number.isInteger(ownSeed) || ownSeed < 0 || ownSeed > 4294967295) throw new DslError('_seed must be a whole number from 0 to 4294967295', use.loc)
    }
    const overrides = new Map()
    for (const arg of lastOfEachName(use.args.filter((entry) => !entry.name.startsWith('_')), null)) {
      const at = { key: this.scoped(useKey, `arg:${arg.name}`), path: [] }
      // Evaluated where the use is written, before the part's own lets exist. A
      // name of a let that holds an effect stands for that let, keyed under it.
      const named = arg.value?.kind === 'identifier' ? (this.boundOf(arg.value) ?? this.get(arg.value.name)) : null
      if (named?.kind === 'partial' || named?.kind === 'alias' || named?.kind === 'chainLet') {
        overrides.set(arg.name, { binding: named })
        continue
      }
      const outer = this.deferChains
      this.deferChains = true
      try {
        const value = containsRandom(arg.value) ? evaluateValue(arg.value, this, 0, [], at) : evaluateValue(arg.value, this)
        if (value?.kind === 'Chain') bindCalls(value, this)
        overrides.set(arg.name, { value })
      } finally {
        this.deferChains = outer
      }
    }
    const saved = {
      keyScope: this.keyScope.splice(0), occurrences: this.occurrences, letCounts: this.letCounts, ifCount: this.ifCount,
      bodyIds: this.bodyIds, claimedIds: this.claimedIds, givenNames: this.givenNames,
    }
    if (ownSeed !== null) {
      this.keyScope.push(`part:${part.name}`)
      this.seedScopes.push(ownSeed)
    } else this.keyScope.push(...saved.keyScope, useKey)
    this.partScopes.push(this.keyScope.join('/'))
    this.occurrences = new Map()
    this.letCounts = { effect: new Map(), value: new Map() }
    // A part body numbers its `if` statements from 1 in each instance.
    this.ifCount = 0
    this.bodyIds = new Set()
    collectIds(part.body.map((item) => (item.kind === 'Binding' ? item.value : item.kind === 'ChainTail' ? { kind: 'Chain', calls: item.calls } : item)), this.bodyIds)
    this.claimedIds = new Set()
    this.givenNames = new Set()
    const shadowed = new Map()
    for (const item of part.body) {
      if (item.kind === 'Binding' && !shadowed.has(item.name)) shadowed.set(item.name, this.has(item.name) ? { value: this.get(item.name) } : null)
    }
    this.partStack.push(part.name)
    this.usePath.push({ hasId: idArg !== undefined })
    this.boundMaps.push(new WeakMap())
    try {
      body(part, (item) => {
        // A part's let, replaced by the use's argument for it or not. A replaced
        // let is still declared and drawn; the argument takes its place.
        declareBinding(item, this)
        if (overrides.has(item.name)) {
          const override = overrides.get(item.name)
          if (override.binding) this.set(item.name, override.binding)
          else if (override.value?.kind === 'Chain') {
            const letKey = this.get(item.name).letKey ?? this.letKey(item.name, 'effect')
            const chain = prepareEffectChain(override.value, this, letKey, { countBody: false })
            const call = singleEffect(chain)
            const held = call && this.boundOf(call)
            const mark = call && this.letElements.get(call)
            if (held?.kind === 'partial') {
              this.set(item.name, { ...held, call: mergePartial(held.call, call) })
            } else if (mark) {
              const effect = held?.kind === 'alias' ? { ...call, name: held.name } : call
              this.set(item.name, { kind: 'partial', call: effect, ...mark })
            } else this.set(item.name, { kind: 'chainLet', chain, letKey })
          } else this.set(item.name, { kind: 'value', expr: override.value, resolved: true, value: override.value, at: null })
        }
      })
    } finally {
      this.partStack.pop()
      this.usePath.pop()
      this.boundMaps.pop()
      for (const [name, previous] of shadowed) {
        if (previous) this.set(name, previous.value)
        else this.delete(name)
      }
      this.partScopes.pop()
      if (ownSeed !== null) this.seedScopes.pop()
      this.keyScope.splice(0, this.keyScope.length, ...saved.keyScope)
      Object.assign(this, { occurrences: saved.occurrences, letCounts: saved.letCounts, ifCount: saved.ifCount, bodyIds: saved.bodyIds, claimedIds: saved.claimedIds, givenNames: saved.givenNames })
    }
  }

  resolvePart(use, useKey) {
    const argNames = use.args.map((arg) => arg.name).filter((name) => !name.startsWith('_'))
    const lookUp = (name) => {
      const part = this.parts.get(name)
      if (!part) throw new DslError(`No part named '${name}'. Parts: ${[...this.parts.keys()].join(', ') || 'none'}`, use.loc)
      if ((part.planIndex ?? 0) > this.statementIndex) throw new DslError(`part '${name}' is used before it is declared`, use.loc)
      const lets = new Set(part.body.filter((item) => item.kind === 'Binding').map((item) => item.name))
      for (const argName of argNames) if (!lets.has(argName)) throw new DslError(`part '${name}' has no let '${argName}'`, use.loc)
      return part
    }
    let target = use.target
    if (isRandomCall(target)) {
      if (target.name !== 'pick') throw new DslError('use() takes a part name, or pick() of part names', use.loc)
      for (const arg of target.args) {
        if (arg.value?.kind !== 'identifier') throw new DslError('use(pick(...)) takes part names', use.loc)
        lookUp(arg.value.name)
      }
      const ctx = { seed: this.scopeSeed(), key: this.scoped(useKey, 'part'), draw: this.draws.draw, choicesFor: this.choicesFor, isShadowed: () => false }
      target = { kind: 'identifier', name: resolveRandomCall(target, ctx, [], (item) => item.name) }
    }
    if (target?.kind !== 'identifier') throw new DslError('use() takes a part name, or pick() of part names', use.loc)
    const part = lookUp(target.name)
    if (this.partStack.includes(part.name)) throw new DslError(`part nesting is circular: ${[...this.partStack, part.name].join(' -> ')}`, use.loc)
    return part
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
    // Counted in each key scope apart (upstream letKeyOf).
    const counted = `${this.keyScope.join('/')}|${name}`
    const k = (this.letCounts[kind].get(counted) ?? 0) + 1
    this.letCounts[kind].set(counted, k)
    return this.scoped(k === 1 ? `let:${name}` : `let:${name}#${k}`)
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
  const writtenMixed = stored.argMode === 'mixed' || call.argMode === 'mixed'
  const merged = { ...call, name: stored.name, args: [...positional, ...named.values()], argMode: positional.length ? (writtenMixed ? 'mixed' : 'merged') : 'named' }
  // A parameter bound before a positional colour limits it to its indexed
  // slot. Metadata binds no slot, and later keywords override only their slot.
  if (!writtenMixed && positional.length && stored.args.some(arg => arg.name !== null && arg.name !== '_id' && arg.name !== '_skip')) {
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
  if (call.argMode === 'mixed') {
    const positional = args.filter((arg) => arg.name === null)
    const named = args.filter((arg) => arg.name !== null)
    const canonicalOf = (arg) => definition.paramAliases?.[arg.name] ?? arg.name
    const namedByCanonical = new Map()
    const extraNamed = []
    const paramSet = new Set(definition.paramNames)
    for (const arg of named) {
      const canonical = canonicalOf(arg)
      if (!paramSet.has(canonical)) {
        extraNamed.push(arg)
        continue
      }
      if (!namedByCanonical.has(canonical)) namedByCanonical.set(canonical, [])
      namedByCanonical.get(canonical).push(arg)
    }
    const bound = []
    let posCursor = 0
    let splatValues = null
    let splatArg = null
    for (let i = 0; i < definition.paramNames.length; i += 1) {
      const paramName = definition.paramNames[i]
      const fromKeyword = namedByCanonical.has(paramName)
      if (posCursor < positional.length && paramName === 'r' && definition.params.r.type !== 'color' &&
          definition.paramNames[i + 1] === 'g' && definition.paramNames[i + 2] === 'b') {
        const color = boundExpression(positional[posCursor].value, bindings)
        if (color?.kind === 'color') {
          splatArg = positional[posCursor++]
          splatValues = { r: color[0], g: color[1], b: color[2] }
        }
      }
      if (fromKeyword) {
        bound.push(...namedByCanonical.get(paramName))
      } else if (splatValues && paramName in splatValues) {
        bound.push({ ...splatArg, name: paramName, value: splatValues[paramName] })
      } else if (posCursor < positional.length) {
        bound.push({ ...positional[posCursor++], name: paramName })
      }
    }
    if (posCursor < positional.length) {
      throw new DslError(
        `Too many positional arguments for ${call.name}(): '${call.name}' takes ${definition.paramNames.length}`,
        positional[posCursor].loc ?? call.loc,
        'S009',
      )
    }
    bound.push(...extraNamed)
    return bound
  }
  const positional = args.filter(arg => arg.name === null)
  if (positional.length > definition.paramNames.length) {
    throw new DslError(
      `Too many positional arguments for ${call.name}(): '${call.name}' takes ${definition.paramNames.length}`,
      positional[definition.paramNames.length].loc ?? call.loc,
      'S009',
    )
  }
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

function singleEffect(chain) {
  if (chain?.kind !== 'Chain' || chain.calls.length !== 1) return null
  const [call] = chain.calls
  return call.kind === 'Call' ? call : null
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
  // One element of the chain. A use or a maybe tail feeds its own elements
  // through this in place, as upstream expands them.
  // An element starts the chain when the chain has no element yet, whether
  // it is written first or comes first from a use or a maybe (upstream reads
  // whether the chain has an input).
  const atStart = () => steps.length === 0 && !hasInput
  const processCall = (call, index) => {
    if (call.kind === 'Use') return expandUse(call, index)
    if (call.kind === 'MaybeTail') return expandMaybeTail(call, index)
    const start = atStart()
    const letElement = bindings.letElements.get(call)
    const binding = bindings.boundOf(call) ?? bindings.get(call.name)
    const chosen = binding?.kind === 'value' && binding.resolved ? singleEffect(binding.value) : null
    if (chosen) call = mergePartial(chosen, call)
    const partial = chosen ? bindings.boundOf(chosen) : binding
    let heldKey = null
    let heldBody = null
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
      heldBody = partial.body
      if (siteId !== undefined && partial.letKey && !bindings.claimedIds.has(siteId)) {
        bindings.claimedIds.add(siteId)
        let name = siteId
        while (partial.ownNames.has(name)) name += "'"
        heldKey = joinKey(partial.letKey, `${partial.op}@${name}`)
      }
    }
    if (letElement) {
      heldKey = letElement.key
      heldBody = letElement.body
    }
    // A let used by a different part instance draws under that instance.
    const partScope = bindings.partScope()
    if (heldKey && partScope && heldBody !== partScope) heldKey = joinKey(partScope, 'outer', heldKey)
    const isRead = call.name === 'read' || call.name === 'read3d'
    const metadata = {}
    const parameters = call.args.filter(arg => {
      if (arg.name === '_id') {
        // The last `_id:` is the element's; it must be an identifier string (upstream S001).
        if (arg !== call.args.findLast((other) => other.name === '_id')) return false
        if (validId(arg.value) === undefined) throw new DslError("_id: takes a string literal of letters, digits and '_' that starts with a letter", call.loc)
        bindings.takeId(arg, call.loc)
        // An id inside a part names one element per instance only when every
        // enclosing use has an id of its own (upstream S001); read and write
        // elements are not checked.
        if (!['read', 'read3d', 'write', 'write3d'].includes(call.name) && bindings.usePath.some((entry) => !entry.hasId)) {
          throw new DslError(`an _id: inside a part needs an _id: on every use of that part: '${call.name}'`, call.loc)
        }
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
    if (definition && !['read', 'write', 'write3d'].includes(call.name) && !(start && call.name === 'read3d' && read3dReferences(call))) {
      const op = `${definition.namespace}.${definition.func}`
      // Calling a let's chosen effect does not take a numbered occurrence.
      let keyName = chosen ? call.name : null
      if (!heldKey && !chosen && count) keyName = bindings.keyNameFor(bindings.nextOccurrence(definition.func), metadata._id)
      // An element with its own `_seed:` restarts its keys at itself.
      if (metadata._seed !== undefined) elementKey = op
      else if (heldKey) elementKey = heldKey
      else elementKey = inline && keyBase !== null ? joinKey(keyBase, `e:${op}`) : bindings.scoped(`${op}@${keyName}`)
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
      if (!start || args.length !== 1 || args[0].value?.kind !== 'surface') throw new DslError('read(surface) must begin a chain', call.loc)
      steps.push({ kind: 'read', ...metadata, surface: args[0].value.name, loc: call.loc })
      hasInput = true
      hasImage = true
      return
    }
    if (call.name === 'write') {
      if (openLoop) throw new DslError('loopBegin must be closed by loopEnd before write', call.loc)
      if (!hasImage || args.length !== 1 || args[0].value?.kind !== 'surface') throw new DslError('write(surface) requires a current image', call.loc)
      steps.push({ kind: 'write', ...metadata, surface: args[0].value.name, loc: call.loc })
      return
    }
    // Built-in volume I/O (upstream `_write3d` and `_read3d`). write3d stores the
    // current volume and geometry under the two names and passes the chain through;
    // read3d starts a chain from them. A mid-chain read3d() is not a starter, so it
    // fails below as an unknown effect, as a one-argument read3d() at a chain start
    // does.
    if (call.name === 'write3d') {
      // Upstream's lexer reserves write3d, so it cannot start a chain.
      if (start) throw new DslError('Expected effect or IO function name', call.loc)
      if (openLoop) throw new DslError('loopBegin must be closed by loopEnd before write', call.loc)
      const references = volumeReferences(call)
      if (!references) throw new DslError('Expected surface reference', call.loc)
      steps.push({ kind: 'write3d', ...metadata, volume: references[0], geometry: references[1], loc: call.loc })
      return
    }
    if (start && call.name === 'read3d' && read3dReferences(call)) {
      const [volume, geometry] = read3dReferences(call)
      steps.push({ kind: 'read3d', ...metadata, volume, geometry, loc: call.loc })
      hasInput = true
      hasVolume = true
      return
    }
    if (!definition) throw new DslError(`Unknown effect "${call.name}" in search namespaces ${namespaces.join(', ')}`, call.loc)
    if (definition.domain === 'volume-generator') {
      if (!start && !(definition.iterated && hasVolume)) {
        throw new DslError(`Generator ${definition.id} must begin a chain`, call.loc)
      }
      if (start) startsWithGenerator = true
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
      if (!start) throw new DslError(`Generator ${definition.id} must begin a chain`, call.loc)
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
  const state = () => ({ steps: steps.length, hasInput, hasImage, hasVolume, startsWithGenerator, openLoop })
  const restore = (saved) => {
    steps.length = saved.steps
    ;({ hasInput, hasImage, hasVolume, startsWithGenerator, openLoop } = saved)
  }
  // A maybe tail (upstream `maybe_<n>`): its elements compile, and draw, whether
  // or not it is taken; an untaken one leaves the chain as it was.
  const expandMaybeTail = (tail, index) => {
    const saved = state()
    const taken = bindings.withMaybe(tail, () => tail.body.forEach((entry, offset) => processCall(entry, index + offset + 1)))
    if (!taken) restore(saved)
  }
  // A use in a chain: the part's lets, then its chain fragments in place.
  const expandUse = (use, index) => {
    bindings.withUse(use, (part, declare) => {
      for (const item of part.body) {
        // A chain fragment, or a chain with no write (a use included), continues
        // this chain; a maybe block or a chain that writes cannot (upstream).
        if (item.kind === 'Binding') declare(item)
        else if (item.kind === 'ChainTail' || (item.kind === 'Chain' && !writes(item))) {
          item.calls.flatMap((entry) => (entry.kind === 'Subchain' ? entry.body : [entry])).forEach((entry, offset) => processCall(entry, index + offset + 1))
        } else throw new DslError(`part '${part.name}' holds statements; use it on its own, as use(${part.name})`, use.loc)
      }
    })
  }
  for (let index = 0; index < calls.length; index += 1) processCall(calls[index], index)
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
  // A maybe block's or tail's body, a binding's value and a use's arguments
  // are written in the same naming body.
  if (value.kind === 'Maybe' || value.kind === 'MaybeTail') return collectIds(value.body, ids)
  if (value.kind === 'If') return collectIds([value.condition, value.then, ...value.elif.flatMap((entry) => [entry.condition, entry.then]), value.else], ids)
  if (value.kind === 'Binding') return collectIds(value.value, ids)
  if (value.kind === 'ChainTail') return collectIds(value.calls, ids)
  if (value.kind === 'Call' || value.kind === 'Use') {
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
    // Its top-level calls, as upstream's chainCalls reads them: not a
    // subchain's body.
    for (const entry of value.calls) {
      if (entry.kind !== 'Call') continue
      const definition = elementDefinition(entry, bindings)
      // An element that calls another let's partial is that let's element, counted where it was written.
      const held = (bindings.boundOf(entry) ?? bindings.get(entry.name))?.kind === 'partial'
      if (definition && !held) bindings.nextOccurrence(definition.func)
      countLetValues(lastOfEachName(entry.args, definition), bindings)
    }
  }
}

// The definition a chain element's name stands for here: through an alias or a
// partial a let holds, then the registry.
function elementDefinition(entry, bindings) {
  const binding = bindings.boundOf(entry) ?? bindings.get(entry.name)
  const name = binding?.kind === 'alias' ? binding.name : binding?.kind === 'partial' ? binding.call.name : entry.name
  const namespace = binding?.kind === 'partial' ? (entry.namespace ?? binding.call.namespace) : entry.namespace
  return bindings.registry.resolve(name, namespace ? [namespace] : bindings.search)
}

function prepareEffectChain(value, bindings, letKey, { countBody = true } = {}) {
  // Part instances can share their parsed body. Copy the calls so that each
  // instance's names belong to its own chain.
  const chain = { ...value, calls: value.calls.map((source) => {
    if (source.kind !== 'Call') return source
    const call = { ...source }
    const captured = bindings.boundOf(source)
    if (captured) bindings.bind(call, captured)
    const element = bindings.letElements.get(source)
    if (element) bindings.letElements.set(call, element)
    return call
  }) }
  bindCalls(chain, bindings)
  bindings.markLetIds(chain)
  bindings.letChains.add(chain)

  const elements = []
  const names = new Set()
  const counts = new Map()
  for (const call of chain.calls) {
    if (call.kind !== 'Call' || bindings.letElements.has(call)) continue
    const held = bindings.boundOf(call)
    const partial = held?.kind === 'partial' ? held : null
    // A part override keeps any key already assigned by an enclosing let.
    if (!countBody && partial) continue
    const definition = elementDefinition(call, bindings)
    if (definition) {
      const func = definition.func
      let occurrence
      if (partial?.ownName) occurrence = partial.ownName
      else if (countBody) occurrence = bindings.nextOccurrence(func)
      else {
        // Override effects take positions in the argument, outside the part's
        // occurrence counts.
        const number = (counts.get(func) ?? 0) + 1
        counts.set(func, number)
        occurrence = `${func}_${number}`
      }
      const id = validId(call.args.findLast((arg) => arg.name === '_id')?.value)
      const name = id !== undefined && !names.has(id) ? id : null
      if (name) names.add(name)
      elements.push({ call, definition, occurrence, name })
    }
    if (countBody) countLetValues(lastOfEachName(call.args, definition), bindings)
  }
  for (const { call, definition, occurrence, name: explicitName } of elements) {
    let name = explicitName ?? occurrence
    if (explicitName === null) {
      while (names.has(name)) name += "'"
      names.add(name)
    }
    const op = `${definition.namespace}.${definition.func}`
    const key = joinKey(letKey, `${op}@${name}`)
    bindings.letElements.set(call, { key, letKey, op, ownName: name, ownNames: names, body: bindings.partScope() })
  }
  return chain
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
    if (!bindings.boundHere(value) && binding) bindings.bind(value, binding)
  } else if (value.kind === 'Chain') {
    for (const entry of value.calls.flatMap((call) => (call.kind === 'Subchain' ? call.body : [call]))) {
      const binding = bindings.get(entry.name)
      if (!bindings.boundHere(entry) && (binding?.kind === 'partial' || binding?.kind === 'alias')) bindings.bind(entry, binding)
      entry.args.forEach((arg) => bindCalls(arg.value, bindings))
    }
  } else if (value.kind === 'Call') value.args.forEach((arg) => bindCalls(arg.value, bindings))
  else if (value.kind === 'binary') { bindCalls(value.left, bindings); bindCalls(value.right, bindings) }
  else if (value.kind === 'unary') bindCalls(value.argument, bindings)
  else if (value.kind === 'vector') bindCalls(value.values, bindings)
}

// Every chain in a value, nested argument chains included, as written in a let:
// its elements were counted there.
function markLetChains(value, bindings) {
  if (Array.isArray(value)) return value.forEach((item) => markLetChains(item, bindings))
  if (!value || typeof value !== 'object') return
  if (value.kind === 'Chain') {
    bindings.letChains.add(value)
    for (const entry of value.calls) if (entry.kind === 'Call') entry.args.forEach((arg) => markLetChains(arg.value, bindings))
  } else if (value.kind === 'Call') value.args.forEach((arg) => markLetChains(arg.value, bindings))
}

// The names a value reads where upstream's substitute reads them: its calls'
// arguments at any depth, vecN() included, but not a use's arguments, a
// subchain's body or a bracket array literal.
function collectNames(value, names) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  if (value.kind === 'identifier') names.add(value.name)
  else if (value.kind === 'Chain') {
    for (const entry of value.calls) if (entry.kind === 'Call') entry.args.forEach((arg) => collectNames(arg.value, names))
  } else if (value.kind === 'Call') value.args.forEach((arg) => collectNames(arg.value, names))
  else if (value.kind === 'binary') { collectNames(value.left, names); collectNames(value.right, names) }
  else if (value.kind === 'unary') collectNames(value.argument, names)
  else if (value.kind === 'vector') value.values.forEach((item) => collectNames(item, names))
}

// Check a let's authored expression for declaration-time cycles, matching
// upstream's declareVar -> substitute(clone(v.expr), [v.name]) resolution stack
// without drawing or compiling deferred effects.
function checkLetCycles(value, bindings, resolving, inExpanded = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  if (value.kind === 'identifier') {
    const bound = bindings.boundOf(value)
    // Inside an already-declared let, an identifier bound when that let was
    // declared has already been substituted in upstream's AST, so it expands
    // inline under the same resolving stack rather than naming a symbol.
    if (inExpanded && bound) {
      if (bound.kind === 'partial') checkLetCycles(bound.call, bindings, resolving, true)
      else if (bound.kind === 'chainLet') checkLetCycles(bound.chain, bindings, resolving, true)
      else if (bound.kind === 'value') checkLetCycles(bound.resolved ? bound.value : bound.expr, bindings, resolving, true)
      return
    }
    if (resolving.includes(value.name)) {
      const start = resolving.indexOf(value.name)
      const cycle = [...resolving.slice(start), value.name]
      throw new DslError(`Automation cycle detected: ${cycle.join(' -> ')}`, value.loc, 'S001')
    }
    const binding = bound ?? bindings.get(value.name)
    if (!binding) return
    const next = [...resolving, value.name]
    if (binding.kind === 'partial') checkLetCycles(binding.call, bindings, next, true)
    else if (binding.kind === 'chainLet') checkLetCycles(binding.chain, bindings, next, true)
    else if (binding.kind === 'value') checkLetCycles(binding.resolved ? binding.value : binding.expr, bindings, next, true)
    return
  }
  if (value.kind === 'Chain') {
    for (const entry of value.calls) {
      if (entry.kind !== 'Call') continue
      const definition = VALUE_CALLS.has(entry.name) || isRandomCall(entry) ? null : elementDefinition(entry, bindings)
      for (const arg of lastOfEachName(entry.args, definition)) checkLetCycles(arg.value, bindings, resolving, inExpanded)
    }
    return
  }
  if (value.kind === 'Call') {
    const definition = VALUE_CALLS.has(value.name) || isRandomCall(value) ? null : elementDefinition(value, bindings)
    for (const arg of lastOfEachName(value.args, definition)) checkLetCycles(arg.value, bindings, resolving, inExpanded)
    return
  }
  if (value.kind === 'binary') {
    checkLetCycles(value.left, bindings, resolving, inExpanded)
    checkLetCycles(value.right, bindings, resolving, inExpanded)
    return
  }
  if (value.kind === 'unary') {
    checkLetCycles(value.argument, bindings, resolving, inExpanded)
    return
  }
  if (value.kind === 'vector') {
    for (const item of value.values) checkLetCycles(item, bindings, resolving, inExpanded)
  }
}

// Whether a let's argument holds a random call, in effects passed as values too,
// reading only the last of a keyword written twice at every depth.
function randomInLetValue(value, bindings) {
  if (Array.isArray(value)) return value.some((item) => randomInLetValue(item, bindings))
  if (value?.kind !== 'Chain') return containsRandomDeep(value)
  return value.calls.some((entry) => {
    // A use's, a maybe tail's, a subchain's and an automation call's arguments
    // are not an element's (upstream S013 skips them).
    if (entry.kind !== 'Call' || VALUE_CALLS.has(entry.name)) return false
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
  const source = binding.value?.kind === 'identifier'
    ? (bindings.boundOf(binding.value) ?? bindings.get(binding.value.name)) : null
  if (source?.kind === 'chainLet') {
    const letKey = bindings.letKey(binding.name, 'effect')
    bindings.set(binding.name, { ...source, letKey })
    return
  }
  // Count compound let elements where they are written. A read chain follows
  // the value path so argument validation still sees the surface read.
  if (binding.value?.kind === 'Chain') {
    // A chain that reads its own let or closes a cycle is S001 at declaration.
    const names = new Set()
    collectNames(binding.value, names)
    if (names.has(binding.name)) throw new DslError(`Automation cycle detected: ${binding.name} -> ${binding.name}`, binding.loc, 'S001')
    checkLetCycles(binding.value, bindings, [binding.name])
    if (randomInLetValue(binding.value, bindings)) {
      throw new DslError(`Random calls in an effect held by a let are not supported yet: '${binding.name}'`, binding.loc)
    }
    if (!['read', 'read3d'].includes(binding.value.calls[0]?.name)) {
      const letKey = bindings.letKey(binding.name, 'effect')
      bindings.set(binding.name, { kind: 'chainLet', chain: prepareEffectChain(binding.value, bindings, letKey), letKey })
      return
    }
    countLetValues([{ value: binding.value }], bindings)
  }
  // Upstream substitutes a value let that chose an effect into the let that
  // names it: `let w = v` holds v's effect, and an argument that names v holds
  // that effect as written.
  const chosen = (value) => {
    const bound = value?.kind === 'identifier' ? (bindings.boundOf(value) ?? bindings.get(value.name)) : null
    return bound?.kind === 'value' && bound.resolved && bound.value?.kind === 'Chain' ? bound.value : null
  }
  const copied = chosen(binding.value)
  if (copied) {
    const call = singleEffect(copied)
    if (!call) return declareBinding({ ...binding, value: copied }, bindings)
    // A chosen call of another let's partial is that partial, keyed where it was written.
    const held = bindings.boundOf(call) ?? bindings.get(call.name)
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
    checkLetCycles(call, bindings, [binding.name])
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
    bindings.set(binding.name, { kind: 'partial', call, key, element, op, ownName, letKey, ownNames: new Set(ownName ? [ownName] : []), body: bindings.partScope() })
    return
  }
  if (aliasBinding(binding.value, bindings)) {
    bindings.set(binding.name, aliasBinding(binding.value, bindings))
    return
  }
  if (binding.value?.kind === 'identifier' && !binding.value.name.includes('.') &&
      !bindings.has(binding.value.name) && !bindings.registry.resolve(binding.value.name, bindings.search)) {
    throw unassignedVariable(binding.value.name, binding.value.loc)
  }
  // A value let draws once, under its own key, wherever it is used. One that
  // holds a random call draws where it is written, used or not, as upstream's
  // validator resolves it at the declaration.
  if (namesChosenEffect(binding.value, bindings)) {
    throw new DslError(`A let cannot copy another let's chosen effect yet: '${binding.name}'`, binding.loc)
  }
  // A read chain is a let that holds effects, counted as upstream counts one.
  const kind = binding.value?.kind === 'Chain' ? 'effect' : 'value'
  const entry = { kind: 'value', expr: captureHexColors(binding.value, bindings), resolved: false, value: null, at: { key: bindings.letKey(binding.name, kind), path: [] } }
  // Bound before the let's own name is set, so the value sees the earlier binding of that name.
  bindCalls(entry.expr, bindings)
  bindings.markLetIds(entry.expr)
  // A read chain's elements were counted where it is written; the chain it
  // stores is not counted again where it is used.
  if (entry.expr?.kind === 'Chain') markLetChains(entry.expr, bindings)
  bindings.set(binding.name, entry)
  checkLetCycles(entry.expr, bindings, [binding.name])
  if (containsRandom(binding.value)) {
    bindings.deferChains = true
    try {
      entry.value = evaluateValue(entry.expr, bindings, 0, [{ name: binding.name, binding: entry }], entry.at)
    } finally {
      bindings.deferChains = false
    }
    entry.resolved = true
    // An effect the let chose is compiled where the let is used, uncounted.
    if (entry.value?.kind === 'Chain') bindings.letChains.add(entry.value)
  }
}

// The run-time state names a condition may read (upstream stateValues).
const STATE_VALUES = new Set(['time', 'frame', 'mouse', 'resolution', 'seed', 'a', 'u1', 'u2', 'u3', 'u4', 's1', 's2', 'b1', 'b2', 'a1', 'a2', 'deltaTime'])

// Names upstream's lexer reads as references, not variables.
const REFERENCE_NAME = /^(s|vol|geo|xyz|vel|rgba|mesh)\d+$/

// The reads of a condition or a return value, as upstream checks them: a let
// written later is S003 at any depth (reportReadsBeforeLet); arithmetic on a
// boolean is refused ("Expected number"); and a condition resolves bindings and
// member paths against scoped bindings, registered choices and standard enums
// (evalCondition / resolveEnum).
function containsDottedIdentifier(node, name) {
  if (Array.isArray(node)) return node.some((item) => containsDottedIdentifier(item, name))
  if (!node || typeof node !== 'object') return false
  if (node.kind === 'identifier') return node.name === name
  if (node.kind === 'Call') return node.args.some((arg) => containsDottedIdentifier(arg.value, name))
  if (node.kind === 'unary') return containsDottedIdentifier(node.argument, name)
  if (node.kind === 'binary') return containsDottedIdentifier(node.left, name) || containsDottedIdentifier(node.right, name)
  if (node.kind === 'vector') return containsDottedIdentifier(node.values, name)
  return false
}

function resolveConditionBinding(binding, bindings, seen) {
  let target = binding.resolved ? binding.value : binding.expr
  while (target?.kind === 'unary' && target.operator === '+') target = target.argument
  if (binding.resolved && typeof target === 'string' && target.includes('.') && containsDottedIdentifier(binding.expr, target)) {
    return resolveConditionEnum(target.split('.'), bindings, seen)
  }
  if (target?.kind === 'identifier') {
    if (target.name.includes('.')) return resolveConditionEnum(target.name.split('.'), bindings, seen)
    const next = bindings.boundOf(target) ?? bindings.get(target.name)
    if (next?.kind === 'value' && !seen.has(target.name)) {
      const nextSeen = new Set(seen)
      nextSeen.add(target.name)
      return resolveConditionBinding(next, bindings, nextSeen)
    }
    return undefined
  }
  return target
}

function resolveConditionEnum(segments, bindings, seen = new Set()) {
  if (!Array.isArray(segments) || segments.length === 0) return undefined
  const [head, ...rest] = segments
  const { registered, standard } = conditionEnumsFor(bindings.registry)
  let cur
  if (bindings.has(head)) {
    const binding = bindings.get(head)
    if (binding.kind !== 'value' || seen.has(head)) return undefined
    const nextSeen = new Set(seen)
    nextSeen.add(head)
    cur = resolveConditionBinding(binding, bindings, nextSeen)
  } else if (Object.hasOwn(registered, head)) {
    cur = registered[head]
  } else if (Object.hasOwn(standard, head)) {
    cur = standard[head]
  } else {
    return undefined
  }
  for (const part of rest) {
    if (cur && typeof cur === 'object' && Object.hasOwn(cur, part)) cur = cur[part]
    else return undefined
  }
  return cur
}

function checkConditionValue(value, bindings, loc, seen = new Set()) {
  while (value?.kind === 'unary' && value.operator === '+') value = value.argument
  if (value?.kind !== 'identifier') return
  const at = value.loc ?? loc
  if (value.name.includes('.')) {
    if (resolveConditionEnum(value.name.split('.'), bindings, seen) === undefined) {
      throw new DslError(`Unknown enum path: '${value.name}'`, at, 'S001')
    }
    return
  }
  const binding = bindings.boundOf(value) ?? bindings.get(value.name)
  if (binding) {
    if (binding.kind !== 'value' || seen.has(value.name)) return
    const nextSeen = new Set(seen)
    nextSeen.add(value.name)
    if (!binding.resolved) {
      checkConditionValue(binding.expr, bindings, at, nextSeen)
    } else if (typeof binding.value === 'string' && binding.value.includes('.') && containsDottedIdentifier(binding.expr, binding.value)) {
      if (resolveConditionEnum(binding.value.split('.'), bindings, nextSeen) === undefined) {
        throw new DslError(`Unknown enum path: '${binding.value}'`, at, 'S001')
      }
    }
    return
  }
  if (!STATE_VALUES.has(value.name) && !REFERENCE_NAME.test(value.name)) {
    throw unassignedVariable(value.name, at)
  }
}

function checkReads(value, bindings, { condition = false } = {}) {
  checkPendingReads(value, bindings)
  if (condition) checkConditionValue(value, bindings, value?.loc)
}

// Upstream folds an operation on constants to a number, and defers one that
// holds a random call (isDeferred). Unary `+` does nothing.
function isDeferredValue(value) {
  if (isRandomCall(value)) return true
  if (value?.kind === 'binary') return isDeferredValue(value.left) || isDeferredValue(value.right)
  if (value?.kind === 'unary') return isDeferredValue(value.argument)
  return false
}

// An operand upstream's parser takes: a number, a folded constant operation,
// or a deferred one (toNumber).
function arithmeticOperand(value) {
  if (typeof value === 'number' || isDeferredValue(value)) return true
  if (value?.kind === 'binary') return arithmeticOperand(value.left) && arithmeticOperand(value.right)
  if (value?.kind === 'unary') return arithmeticOperand(value.argument)
  return false
}

function checkPendingReads(value, bindings) {
  if (Array.isArray(value)) return value.forEach((item) => checkPendingReads(item, bindings))
  if (!value || typeof value !== 'object') return
  if (value.kind === 'identifier') {
    // Upstream's lexer splits a reference followed by more characters, `s5x`,
    // into a reference and a name, which does not parse.
    // So does a reference followed by a member, `s5.x`.
    const segments = value.name.split('.')
    if (segments.some((segment) => /^(o|s|vol|geo|xyz|vel|rgba|mesh)\d+[A-Za-z_]/.test(segment))) throw new DslError("Expect '('", value.loc)
    if (segments.length > 1 && /^(o|s|vol|geo|xyz|vel|rgba|mesh)\d+$/.test(segments[0])) throw new DslError('Expected identifier', value.loc)
    if (!bindings.has(value.name) && bindings.pendingNames?.has(value.name)) {
      throw unassignedVariable(value.name, value.loc)
    }
  } else if (value.kind === 'binary') {
    // Checked only when neither operand is deferred (upstream isDeferred).
    if (!isDeferredValue(value.left) && !isDeferredValue(value.right) && (!arithmeticOperand(value.left) || !arithmeticOperand(value.right))) {
      throw new DslError('Expected number', value.loc)
    }
    checkPendingReads(value.left, bindings)
    checkPendingReads(value.right, bindings)
  } else if (value.kind === 'unary') {
    if (value.operator === '-' && !arithmeticOperand(value.argument)) throw new DslError('Expected number', value.loc)
    checkPendingReads(value.argument, bindings)
  }
  else if (value.kind === 'vector') checkPendingReads(value.values, bindings)
  else if (value.kind === 'Call') value.args.forEach((arg) => checkPendingReads(arg.value, bindings))
  else if (value.kind === 'Chain') value.calls.forEach((call) => checkPendingReads(call, bindings))
}

// One statement, as the chains it renders. A maybe block's chains render only
// when it is taken; its body compiles, and draws, either way. A use on its own
// expands its part's statements in the instance's scope.
function compileStatement(statement, bindings) {
  // Control flow compiles, and draws, as upstream compiles it; its program is
  // not rendered, as upstream's runtime does not execute control flow yet.
  if (statement.kind === 'If') {
    const ifKey = `if_${++bindings.ifCount}`
    const condition = (node, k) => {
      checkReads(node, bindings, { condition: true })
      if (containsRandom(node)) {
        const resolved = evaluateValue(node, bindings, 0, [], { key: bindings.scoped(ifKey, `cond${k}`), path: [] })
        if (typeof resolved === 'string' && resolved.includes('.') && containsDottedIdentifier(node, resolved)) {
          if (resolveConditionEnum(resolved.split('.'), bindings) === undefined) {
            throw new DslError(`Unknown enum path: '${resolved}'`, node.loc, 'S001')
          }
        }
      }
    }
    const branch = (k, body) => {
      bindings.keyScope.push(`${ifKey}/b${k}`)
      try {
        compileBlock(body ?? [], bindings)
      } finally {
        bindings.keyScope.pop()
      }
    }
    bindings.controlFlow.push('if')
    condition(statement.condition, 0)
    branch(0, statement.then)
    statement.elif.forEach((entry, index) => {
      condition(entry.condition, index + 1)
      branch(index + 1, entry.then)
    })
    branch(statement.elif.length + 1, statement.else)
    return []
  }
  if (statement.kind === 'Break' || statement.kind === 'Continue' || statement.kind === 'Return') {
    if (statement.value !== undefined) checkReads(statement.value, bindings)
    bindings.controlFlow.push(statement.kind.toLowerCase())
    return []
  }
  if (statement.kind === 'Maybe') {
    let chains = []
    const taken = bindings.withMaybe(statement, () => { chains = compileBlock(statement.body, bindings) })
    return taken ? chains : []
  }
  const calls = statement.calls ?? []
  if (calls.length === 1 && calls[0].kind === 'Use') {
    const chains = []
    bindings.withUse(calls[0], (part, declare) => {
      for (const item of part.body) {
        if (item.kind === 'Binding') declare(item)
        else if (item.kind === 'Maybe' || item.kind === 'If' || (item.kind === 'Chain' && writes(item))) chains.push(...compileStatement(item, bindings))
        else throw new DslError(`part '${part.name}' continues a chain; use it in a chain`, calls[0].loc)
      }
    })
    return chains
  }
  // A chain with a use or a maybe tail takes its write from its last written
  // element, as upstream reads it from the source.
  if (calls.some((call) => call.kind === 'Use' || call.kind === 'MaybeTail') && !writes(statement)) {
    throw new DslError('Chain must have explicit write()', statement.loc)
  }
  return [compileChain(statement, bindings)]
}

// Whether a chain as written ends in write() or write3d().
function writes(chain) {
  const last = chain.calls?.at(-1)
  return last?.kind === 'Call' && (last.name === 'write' || last.name === 'write3d')
}

// A block's statements in order. Its lets hold until the block ends.
function compileBlock(items, bindings) {
  const shadowed = new Map()
  const chains = []
  try {
    for (const item of items) {
      if (item.kind === 'Binding') {
        if (!shadowed.has(item.name)) shadowed.set(item.name, bindings.has(item.name) ? { value: bindings.get(item.name) } : null)
        declareBinding(item, bindings)
      } else chains.push(...compileStatement(item, bindings))
    }
  } finally {
    for (const [name, previous] of shadowed) {
      if (previous) bindings.set(name, previous.value)
      else bindings.delete(name)
    }
  }
  return chains
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

  // Parts, by name (upstream partDecls). A part expands where it is used.
  for (const part of ast.parts) {
    if (bindings.parts.has(part.name)) throw new DslError(`part '${part.name}' is declared twice`, part.loc)
    for (const item of part.body) {
      if (item.kind === 'Binding' && item.name.startsWith('_')) {
        throw new DslError(`part '${part.name}': a let name may not start with '_': '${item.name}'`, part.loc)
      }
    }
    bindings.parts.set(part.name, part)
  }

  const chains = []
  ast.chains.forEach((statement, chainIndex) => {
    bindings.statementIndex = chainIndex
    declareThrough(chainIndex)
    // pendingNames covers the whole chain compile, including inline chains:
    // every argument position reports a pending read, as upstream does.
    bindings.pendingNames = new Set(ast.bindings.slice(nextBinding).map((binding) => binding.name))
    try {
      chains.push(...compileStatement(statement, bindings))
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
  // A program with control flow is not rendered; upstream finds its surface
  // only where it expands, so it compiles without one.
  if (!renderSurface && !bindings.controlFlow.length) throw new DslError('No render surface specified and no write() found - add render(oN) or write(oN)', ast.loc)

  return Object.freeze({ search: Object.freeze(ast.search.slice()), chains: Object.freeze(chains), renderSurface, controlFlow: Object.freeze(bindings.controlFlow.slice()), diagnostics: Object.freeze(bindings.diagnostics.slice()), ast })
}
