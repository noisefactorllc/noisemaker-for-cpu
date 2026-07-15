/**
 * Pure Polymorphic-DSL builder for the CPU demo pipeline.
 *
 * No DOM, no engine imports — importable in Node for tests. Given the pipeline
 * `state` and a `createDefaultRegistry()` result, it emits the DSL text the
 * renderer consumes. See docs/superpowers/specs/2026-07-15-noisemaker-cpu-demo-design.md.
 *
 * state shape:
 *   { generator: { id, values }, filters: [ { id, values, skipped } ] }
 * where `values` maps paramName -> state value (enum/choice params store the
 * choice KEY string; color params store an RGB(A) array in 0..1; others store
 * the native number/boolean/string).
 */

export const namespaceOf = (id) => id.split('/')[0]
export const funcOf = (id) => id.split('/').slice(1).join('/')

const hasChoices = (spec) => Boolean(spec && spec.choices && typeof spec.choices === 'object')

/** For a choices param, the key whose numeric value equals the schema default. */
export function defaultKey(spec) {
  if (!hasChoices(spec)) return undefined
  const entry = Object.entries(spec.choices).find(([, v]) => v === spec.default)
  return entry ? entry[0] : Object.keys(spec.choices)[0]
}

/** The initial state value for a param (enum -> default key, color -> array copy, else default). */
export function stateDefault(spec) {
  if (hasChoices(spec)) return defaultKey(spec)
  if (spec.type === 'color') return Array.isArray(spec.default) ? spec.default.slice() : [0, 0, 0]
  return spec.default
}

const sameArray = (a, b) =>
  Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i])

export function isDefaultValue(spec, value) {
  const def = stateDefault(spec)
  if (Array.isArray(def)) return sameArray(def, value)
  return def === value
}

const toHex = (c) => Math.max(0, Math.min(255, Math.round(c * 255))).toString(16).padStart(2, '0')

/** Format a state value as a DSL literal for its param spec. */
export function formatDslValue(spec, value) {
  if (hasChoices(spec)) return String(value) // bare enum/int-choice key -> resolved by the compiler
  switch (spec.type) {
    case 'bool':
    case 'boolean':
      return value ? 'true' : 'false'
    case 'color': {
      const [r, g, b, a] = value
      return `#${toHex(r)}${toHex(g)}${toHex(b)}${a === undefined ? '' : toHex(a)}`
    }
    case 'vec2':
    case 'vec3':
    case 'vec4':
      return `${spec.type}(${value.join(', ')})`
    case 'string':
      return JSON.stringify(value)
    default:
      return String(value) // float / int
  }
}

/** Render one effect call, emitting only params that differ from their default. */
function callFor(id, values, registry) {
  const def = registry.get(namespaceOf(id), funcOf(id))
  if (!def) throw new Error(`Unknown effect ${id}`)
  const args = []
  for (const name of def.paramNames) {
    if (name === 'seed') continue // render-level seed drives all effect seeds
    const spec = def.params[name]
    if (spec.type === 'surface') continue // mixer inputs -> code view only
    const value = name in values ? values[name] : stateDefault(spec)
    if (value === undefined || isDefaultValue(spec, value)) continue
    args.push(`${name}: ${formatDslValue(spec, value)}`)
  }
  return `${funcOf(id)}(${args.join(', ')})`
}

/** Build the full DSL program for the current pipeline state. */
export function buildDsl(state, registry) {
  const active = [state.generator, ...state.filters.filter((f) => !f.skipped)]
  const namespaces = []
  for (const step of active) {
    const ns = namespaceOf(step.id)
    if (!namespaces.includes(ns)) namespaces.push(ns)
  }
  const chain = active.map((step) => callFor(step.id, step.values, registry)).join('.') + '.write(o0)'
  return `search ${namespaces.join(', ')}\n${chain}\nrender(o0)`
}
