// Resolution of the DSL's random constructs, ported from upstream
// shaders/src/lang/randomize.js. A random call draws from the seed of its
// scope and from a key: the key of the place its value is written, extended
// by the call's path inside the value. The compiled program holds the drawn
// values; the source keeps the calls.
import { DslError } from './error.js'
import {
  PIN_KEY, chanceFrom, drawU32, joinKey, pathSegment, pickIndex, randColorFrom, randFrom, randIntFrom,
} from './draws.js'

// The names a random call can have. They are not keywords.
export const RANDOM_FUNCTIONS = new Set(['rand', 'randInt', 'pick', 'chance', 'randColor', 'choices'])

// Arguments by position and name, for the calls with a fixed signature.
const SIGNATURES = {
  rand: ['min', 'max'],
  randInt: ['min', 'max'],
  chance: ['p'],
  randColor: ['h', 's', 'v'],
}

export function isRandomCall(value) {
  return value?.kind === 'Call' && RANDOM_FUNCTIONS.has(value.name)
}

// Whether a value holds a random call. An effect passed as a value is its own
// element, so the walk stops at a chain.
export function containsRandom(value) {
  if (Array.isArray(value)) return value.some(containsRandom)
  if (!value || typeof value !== 'object') return false
  if (isRandomCall(value)) return true
  if (value.kind === 'binary') return containsRandom(value.left) || containsRandom(value.right)
  if (value.kind === 'unary') return containsRandom(value.argument)
  if (value.kind === 'vector') return containsRandom(value.values)
  if (value.kind === 'Call') return value.args.some((arg) => containsRandom(arg.value))
  return false
}

function numberOf(value, what, loc) {
  if (typeof value === 'number') return value
  throw new DslError(`${what} requires a numeric argument`, loc)
}

function hexToColor(hex) {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255).concat(1)
}

// Bind a call's arguments to its signature: positionals in order, then
// keywords. `seed` is the call-level seed and is not an argument.
function bindArguments(call, names) {
  const bound = {}
  const positional = call.args.filter((arg) => arg.name === null)
  if (positional.length > names.length) {
    throw new DslError(`${call.name}() takes at most ${names.length} argument${names.length === 1 ? '' : 's'}`, call.loc)
  }
  positional.forEach((arg, index) => { bound[names[index]] = arg.value })
  for (const arg of call.args) {
    if (arg.name === null || arg.name === 'seed') continue
    if (!names.includes(arg.name)) throw new DslError(`${call.name}() has no argument '${arg.name}'`, call.loc)
    if (bound[arg.name] !== undefined) throw new DslError(`'${arg.name}' is passed twice to ${call.name}()`, call.loc)
    bound[arg.name] = arg.value
  }
  return bound
}

// The draw of a random call: from its call-level seed under the constant key,
// or from the scope's seed under the call's key.
function drawFor(call, ctx, path) {
  const own = call.args.find((arg) => arg.name === 'seed')
  if (own) {
    if (typeof own.value !== 'number' || !Number.isInteger(own.value) || own.value < 0 || own.value > 4294967295) {
      throw new DslError(`${call.name}(seed:) must be a whole number from 0 to 4294967295`, call.loc)
    }
    return ctx.draw(own.value, PIN_KEY)
  }
  return ctx.draw(ctx.seed, joinKey(ctx.key, ...path))
}

function rangeError(call, error) {
  if (error instanceof RangeError) return new DslError(error.message, call.loc)
  return error
}

function resolveChoices(call, ctx) {
  const [effect, param] = call.args.map((arg) => arg.value)
  if (call.args.length !== 2 || call.args.some((arg) => arg.name !== null) || effect?.kind !== 'identifier' || param?.kind !== 'identifier') {
    throw new DslError('choices(effect, parameter) requires an effect and a parameter', call.loc)
  }
  return ctx.choicesFor(effect.name, param.name, call.loc)
}

// Resolve every random call in a value. `evaluate(value, path)` evaluates a
// value that holds no random call at its path, so the caller keeps its own
// handling of identifiers, surfaces and automation.
export function resolveRandomCall(call, ctx, path, evaluate) {
  if (call.name === 'choices') {
    resolveChoices(call, ctx)
    throw new DslError('choices() produced a list where a single value was expected. Wrap it in pick()', call.loc)
  }
  if (call.name === 'pick') return resolvePick(call, ctx, path, evaluate)

  const names = SIGNATURES[call.name]
  const bound = bindArguments(call, names)
  const value = {}
  for (const name of names) {
    if (bound[name] !== undefined) value[name] = evaluate(bound[name], [...path, pathSegment.named(name)])
  }
  const u = drawFor(call, ctx, path)
  try {
    switch (call.name) {
      case 'rand':
        if ((value.min === undefined) !== (value.max === undefined)) {
          throw new DslError('rand(min, max) requires both bounds or neither', call.loc)
        }
        if (value.min === undefined) return randFrom(u)
        return randFrom(u, numberOf(value.min, 'rand(min, max)', call.loc), numberOf(value.max, 'rand(min, max)', call.loc))
      case 'randInt':
        if (value.min === undefined || value.max === undefined) {
          throw new DslError('randInt(min, max) requires exactly 2 arguments', call.loc)
        }
        return randIntFrom(u, numberOf(value.min, 'randInt(min, max)', call.loc), numberOf(value.max, 'randInt(min, max)', call.loc))
      case 'chance':
        if (value.p === undefined) throw new DslError('chance(p) requires a probability', call.loc)
        return chanceFrom(u, numberOf(value.p, 'chance(p)', call.loc))
      default: {
        const given = {}
        for (const name of names) {
          if (value[name] !== undefined) given[name] = numberOf(value[name], 'randColor()', call.loc)
        }
        return hexToColor(randColorFrom(u, given))
      }
    }
  } catch (error) {
    throw rangeError(call, error)
  }
}

function resolvePick(call, ctx, path, evaluate) {
  const named = call.args.find((arg) => arg.name !== null && arg.name !== 'seed')
  if (named) throw new DslError(`pick() has no argument '${named.name}'`, call.loc)
  const items = []
  call.args.filter((arg) => arg.name === null).forEach((arg, index) => {
    if (arg.value?.kind === 'Call' && arg.value.name === 'choices') items.push(...resolveChoices(arg.value, ctx))
    else items.push(evaluate(arg.value, [...path, pathSegment.arg(index)]))
  })
  if (items.length === 0) throw new DslError('pick() needs at least one value', call.loc)
  const u = drawFor(call, ctx, path)
  return items[pickIndex(u, items.length)]
}

// Seed parameters with another name that inherit as `seed` does, as upstream
// marks them with `inheritsSeed: true` in their definitions.
const INHERITS_SEED = new Set(['classicNoisedeck/splat:speckSeed', 'points/life:matrixSeed'])

export function isSeedParam(definition, name) {
  return name === 'seed' || INHERITS_SEED.has(`${definition.id}:${name}`)
}

// Whether a seed parameter can inherit: it needs a finite range to draw over.
export function canInheritSeed(param) {
  return Number.isFinite(param?.min) && Number.isFinite(param?.max)
}

// An inherited effect seed: `ceil(min) + (u mod r)` over the parameter's
// whole-number range.
export function inheritedSeed(u, param) {
  return randIntFrom(u, Math.ceil(param.min), Math.floor(param.max))
}

// The context a program's draws share: its seed, whether it has a seed
// directive, and an optional observer of every draw.
export function drawContext(seed, onDraw) {
  return {
    seed: seed ?? 0,
    directive: seed !== null && seed !== undefined,
    draw(drawSeed, key) {
      const u = drawU32(drawSeed, key)
      onDraw?.({ seed: drawSeed, key, u })
      return u
    },
  }
}
