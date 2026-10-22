import test from 'node:test'
import assert from 'node:assert/strict'

import { compileDsl } from '../src/dsl/compiler.js'
import { EffectDefinition } from '../src/effects/definition.js'
import { EffectRegistry } from '../src/effects/registry.js'
import { createDefaultRegistry } from '../src/effects/catalog.js'

// Deprecated parameter aliases resolve exactly as upstream's
// resolveParamAliases (shaders/src/lang/paramAliases.js): an alias present
// without its canonical name migrates the value; with both present the
// canonical name wins; the alias is always consumed.
function aliasedDefinition() {
  return new EffectDefinition({
    namespace: 'points',
    func: 'tracer',
    kind: 'generator',
    params: {
      heightTex: { type: 'float', default: 2 },
      seed: { type: 'int', default: 1 },
    },
    paramAliases: { fieldTex: 'heightTex' },
    passes: [{ kernel: 'points/tracer/main' }],
  })
}

function aliasedRegistry() {
  const out = new EffectRegistry()
  out.register(aliasedDefinition())
  return out
}

test('a deprecated alias migrates its value when the canonical name is absent', () => {
  const values = aliasedDefinition().normalizeArguments([{ name: 'fieldTex', value: 3 }])
  assert.equal(values.heightTex, 3)
  assert.ok(!('fieldTex' in values))
  assert.equal(values.seed, 1)
})

test('the canonical name wins when both names are present', () => {
  const values = aliasedDefinition().normalizeArguments([
    { name: 'fieldTex', value: 3 },
    { name: 'heightTex', value: 5 },
  ])
  assert.equal(values.heightTex, 5)
  assert.ok(!('fieldTex' in values))
})

test('positional arguments keep their positional names', () => {
  const values = aliasedDefinition().normalizeArguments([{ name: null, value: 3 }])
  assert.equal(values.heightTex, 3)
})

test('an unknown name still reports the supplied name', () => {
  assert.throws(() => aliasedDefinition().normalizeArguments([{ name: 'bogus', value: 1 }]), /Unknown parameter "bogus"/)
})

test('the DSL resolves an alias argument and records the canonical name', () => {
  const plan = compileDsl('search points\ntracer(fieldTex: 3).write(o0)\nrender(o0)', aliasedRegistry())
  const step = plan.chains[0].steps[0]
  assert.equal(step.params.heightTex, 3)
  assert.ok(!('fieldTex' in step.params))
  assert.deepEqual([...step.explicitParams], ['heightTex'])
})

test('the DSL records the canonical name once when both names are present', () => {
  const plan = compileDsl('search points\ntracer(fieldTex: 3, heightTex: 5).write(o0)\nrender(o0)', aliasedRegistry())
  const step = plan.chains[0].steps[0]
  assert.equal(step.params.heightTex, 5)
  assert.deepEqual([...step.explicitParams], ['heightTex'])
})

test('an alias hit warns with the upstream deprecation text', () => {
  const warnings = []
  const original = console.warn
  console.warn = (message) => warnings.push(message)
  try {
    aliasedDefinition().normalizeArguments([{ name: 'fieldTex', value: 3 }])
    aliasedDefinition().normalizeArguments([
      { name: 'fieldTex', value: 3 },
      { name: 'heightTex', value: 5 },
    ])
  } finally {
    console.warn = original
  }
  const expected = "param 'fieldTex' is deprecated, use 'heightTex' instead. Aliases will be removed on 2027-06-01."
  assert.deepEqual(warnings, [expected, expected])
})

test('a canonical argument does not warn', () => {
  const warnings = []
  const original = console.warn
  console.warn = (message) => warnings.push(message)
  try {
    aliasedDefinition().normalizeArguments([{ name: 'heightTex', value: 3 }])
  } finally {
    console.warn = original
  }
  assert.deepEqual(warnings, [])
})

test('the flow, dla and physarum catalog effects accept the heightTex alias', () => {
  const registry = createDefaultRegistry()
  for (const id of ['points/flow', 'points/dla', 'points/physarum']) {
    const definition = registry.get(...id.split('/'))
    assert.ok(definition, id)
    assert.deepEqual(definition.paramAliases, { fieldTex: 'heightTex' }, id)
    const aliased = definition.normalizeArguments([{ name: 'fieldTex', value: 'inputTex' }])
    const canonical = definition.normalizeArguments([{ name: 'heightTex', value: 'inputTex' }])
    assert.deepEqual(aliased, canonical, id)
  }
})

test('a real catalog alias hit emits the upstream deprecation warning', () => {
  const definition = createDefaultRegistry().get('points', 'flow')
  const warnings = []
  const original = console.warn
  console.warn = (message) => warnings.push(message)
  try {
    definition.normalizeArguments([{ name: 'fieldTex', value: 'inputTex' }])
  } finally {
    console.warn = original
  }
  assert.deepEqual(warnings, [
    "param 'fieldTex' is deprecated, use 'heightTex' instead. Aliases will be removed on 2027-06-01.",
  ])
})
