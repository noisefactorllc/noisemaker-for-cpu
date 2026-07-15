import test from 'node:test'
import assert from 'node:assert/strict'

import { createDefaultRegistry, compileDsl } from '../src/index.js'
import {
  namespaceOf,
  funcOf,
  defaultKey,
  stateDefault,
  isDefaultValue,
  formatDslValue,
  buildDsl,
} from '../examples/browser/pipeline.js'
import { widgetKindForParam } from '../examples/browser/control-factory.js'

const registry = createDefaultRegistry()
const noise = registry.get('synth', 'noise')
const solid = registry.get('synth', 'solid')

test('namespaceOf / funcOf split the id', () => {
  assert.equal(namespaceOf('synth/noise'), 'synth')
  assert.equal(funcOf('synth/noise'), 'noise')
  assert.equal(namespaceOf('classicNoisedeck/kaleido'), 'classicNoisedeck')
  assert.equal(funcOf('classicNoisedeck/kaleido'), 'kaleido')
})

test('formatDslValue: numbers, bools, enum keys, colors', () => {
  assert.equal(formatDslValue(noise.params.scaleX, 18), '18')
  assert.equal(formatDslValue(noise.params.ridges, true), 'true')
  assert.equal(formatDslValue(noise.params.ridges, false), 'false')
  assert.equal(formatDslValue(noise.params.type, 'sine'), 'sine') // int-with-choices -> bare key
  assert.equal(formatDslValue(solid.params.color, [1, 0, 0]), '#ff0000')
  assert.equal(formatDslValue(solid.params.color, [0, 0.5, 1]), '#0080ff')
})

test('defaultKey / stateDefault', () => {
  assert.equal(defaultKey(noise.params.type), 'simplex') // default 10 -> simplex
  assert.equal(stateDefault(noise.params.type), 'simplex')
  assert.equal(stateDefault(noise.params.scaleX), noise.params.scaleX.default)
  assert.deepEqual(stateDefault(solid.params.color), [0.5, 0.5, 0.5])
})

test('isDefaultValue compares against schema default', () => {
  assert.equal(isDefaultValue(noise.params.scaleX, noise.params.scaleX.default), true)
  assert.equal(isDefaultValue(noise.params.scaleX, 18), false)
  assert.equal(isDefaultValue(noise.params.type, 'simplex'), true)
  assert.equal(isDefaultValue(noise.params.type, 'sine'), false)
  assert.equal(isDefaultValue(solid.params.color, [0.5, 0.5, 0.5]), true)
  assert.equal(isDefaultValue(solid.params.color, [1, 0, 0]), false)
})

test('buildDsl: generator with non-default args, seed omitted', () => {
  const state = {
    generator: { id: 'synth/noise', values: { scaleX: 18, scaleY: 12, ridges: true, seed: 7 } },
    filters: [],
  }
  const dsl = buildDsl(state, registry)
  assert.match(dsl, /^search synth\n/)
  assert.match(dsl, /scaleX: 18/)
  assert.match(dsl, /scaleY: 12/)
  assert.match(dsl, /ridges: true/)
  assert.doesNotMatch(dsl, /seed/) // per-effect seed is never emitted
  assert.match(dsl, /\.write\(o0\)/)
  assert.match(dsl, /\nrender\(o0\)\s*$/)
})

test('buildDsl: enum emits the choice key, defaults are omitted', () => {
  const state = {
    generator: { id: 'synth/noise', values: { type: 'sine' } },
    filters: [],
  }
  const dsl = buildDsl(state, registry)
  assert.match(dsl, /noise\(type: sine\)/)
})

test('buildDsl: filter chain; search order = generator ns first, then filters by first use', () => {
  const state = {
    generator: { id: 'synth/noise', values: {} },
    filters: [
      { id: 'filter/posterize', values: { levels: 8 }, skipped: false },
      { id: 'classicNoisedeck/kaleido', values: {}, skipped: false },
    ],
  }
  const dsl = buildDsl(state, registry)
  assert.match(dsl, /^search synth, filter, classicNoisedeck\n/)
  assert.match(dsl, /noise\(\)\.posterize\(levels: 8\)\.kaleido\(\)\.write\(o0\)/)
})

test('buildDsl: skipped filter is omitted from chain and search', () => {
  const state = {
    generator: { id: 'synth/noise', values: {} },
    filters: [{ id: 'filter/posterize', values: { levels: 8 }, skipped: true }],
  }
  const dsl = buildDsl(state, registry)
  assert.equal(dsl.includes('posterize'), false)
  assert.match(dsl, /^search synth\n/)
})

test('widgetKindForParam maps every param type', () => {
  assert.equal(widgetKindForParam({ type: 'float', min: 0, max: 1 }), 'slider')
  assert.equal(widgetKindForParam({ type: 'int' }), 'slider')
  assert.equal(widgetKindForParam({ type: 'int', choices: { a: 0, b: 1 } }), 'dropdown')
  assert.equal(widgetKindForParam({ type: 'enum', choices: { a: 0 } }), 'dropdown')
  assert.equal(widgetKindForParam({ type: 'member', choices: { a: 0 } }), 'dropdown')
  assert.equal(widgetKindForParam({ type: 'palette', choices: { a: 0 } }), 'dropdown')
  assert.equal(widgetKindForParam({ type: 'bool' }), 'toggle')
  assert.equal(widgetKindForParam({ type: 'boolean' }), 'toggle')
  assert.equal(widgetKindForParam({ type: 'color' }), 'color')
  assert.equal(widgetKindForParam({ type: 'vec2' }), 'vector')
  assert.equal(widgetKindForParam({ type: 'vec3' }), 'vector')
  assert.equal(widgetKindForParam({ type: 'string', choices: { a: 'a' } }), 'dropdown')
  assert.equal(widgetKindForParam({ type: 'string' }), 'text')
  assert.equal(widgetKindForParam({ type: 'surface' }), 'omit')
})

test('every real effect param maps to a known widget kind', () => {
  const kinds = new Set(['slider', 'dropdown', 'toggle', 'color', 'vector', 'text', 'omit'])
  for (const def of registry.list()) {
    for (const name of def.paramNames) {
      const kind = widgetKindForParam(def.params[name])
      assert.ok(kinds.has(kind), `${def.id}.${name} (${def.params[name].type}) -> ${kind}`)
    }
  }
})

test('buildDsl output compiles against the real registry', () => {
  // compileDsl throws DslError on any malformed program / unknown effect / bad arg
  const state = {
    generator: { id: 'synth/noise', values: { scaleX: 18, scaleY: 12, type: 'sine' } },
    filters: [{ id: 'filter/posterize', values: { levels: 8 }, skipped: false }],
  }
  const dsl = buildDsl(state, registry)
  const compiled = compileDsl(dsl, registry)
  assert.deepEqual([...compiled.search], ['synth', 'filter'])
  assert.equal(compiled.renderSurface, 'o0')
})
