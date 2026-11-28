import test from 'node:test'
import assert from 'node:assert/strict'

import { compileDsl } from '../src/dsl/compiler.js'
import { createDefaultRegistry } from '../src/effects/catalog.js'

const registry = createDefaultRegistry()

// Values and diagnostics verified against noisemaker 2.x at
// 9a33fc9c3166a80b11c34afa7aa770c02480948e with the full effect catalog.
const cases = [
  ['filter/palette', 'index', 'synth, filter', 'noise().palette(index: %).write(o0)', 7, 'seventiesShirt', 1],
  ['filter/channel', 'channel', 'synth, filter', 'noise().channel(channel: %).write(o0)', 0, 'g', 1],
  ['synth/osc2d', 'oscType', 'synth, filter', 'osc2d(oscType: %).write(o0)', 0, 'square', 4],
  ['filter3d/palette3d', 'index', 'synth3d, filter3d, render', 'noise3d(volumeSize: 8).palette3d(index: %).render3d().write(o0)', 7, 'seventiesShirt', 1],
]

for (const [id, parameter, search, body, fallback, choice, choiceValue] of cases) {
  const source = (value, tail = '') => `search ${search}\nseed 3\n${body.replace('%', value)}\n${tail}\nrender(o0)`
  const result = (value) => compileDsl(source(value), registry)
  const param = (compiled) => compiled.chains.flatMap(chain => chain.steps).find(step => step.definition?.id === id).params[parameter]

  test(`${id} resolves an unknown bare member name to its authority default without diagnostics`, () => {
    const compiled = result('zzz')
    assert.equal(param(compiled), fallback)
    assert.deepEqual(compiled.diagnostics, [])
  })

  test(`${id} keeps valid member choices`, () => {
    const compiled = result(choice)
    assert.equal(param(compiled), choiceValue)
    assert.deepEqual(compiled.diagnostics, [])
  })

  test(`${id} keeps S003 for a later let in a member argument`, () => {
    assert.throws(() => compileDsl(source('zzz', 'let zzz = 1'), registry),
      { code: 'S003', message: /: Variable used before assignment: 'zzz'$/ })
  })

  test(`${id} still refuses an unknown member string literal`, () => {
    assert.throws(() => result('"zzz"'))
  })

  test(`${id} keeps direct API validation for unknown members`, () => {
    const [namespace, name] = id.split('/')
    const definition = registry.resolve(name, [namespace])
    assert.throws(() => definition.normalizeArguments([{ name: parameter, value: 'zzz' }]), /must be one of/)
  })
}
