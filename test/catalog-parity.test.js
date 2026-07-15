import assert from 'node:assert/strict'
import test from 'node:test'

import { effectCatalog } from '../src/effects/catalog.js'
import { eligibleEffectIds, effectRecords } from '../src/effects/generated/upstream-snapshot.js'

test('runtime catalog is the exact 169-effect canonical inventory', () => {
  assert.equal(effectCatalog.length, 169)
  assert.deepEqual(effectCatalog.map((effect) => effect.id), eligibleEffectIds)
})

test('runtime definitions preserve canonical metadata and pass schemas', () => {
  const catalog = new Map(effectCatalog.map((effect) => [effect.id, effect]))
  const records = new Map(effectRecords.map((effect) => [effect.id, effect]))

  for (const id of ['filter/adjust', 'filter/bloom', 'filter/normalize', 'filter/text', 'synth/media', 'mixer/blendMode']) {
    const definition = catalog.get(id)
    const record = records.get(id)
    assert.equal(definition.name, record.name)
    assert.deepEqual(definition.paramAliases, record.paramAliases)
    assert.deepEqual(definition.passes, record.passes)
    assert.deepEqual(definition.textures, record.textures)
    assert.equal(definition.externalTexture, record.externalTexture)
  }
})

test('runtime definitions deeply freeze shared catalog metadata', () => {
  const noise = effectCatalog.find((effect) => effect.id === 'synth/noise')
  const gradient = effectCatalog.find((effect) => effect.id === 'synth/gradient')
  const blend = effectCatalog.find((effect) => effect.id === 'mixer/blendMode')
  assert.ok(Object.isFrozen(gradient.params.color1.default))
  assert.ok(Object.isFrozen(noise.params.type.choices))
  assert.ok(Object.isFrozen(blend.passes[0].inputs))
  assert.throws(() => { gradient.params.color1.default[0] = 99 }, TypeError)
  assert.throws(() => { blend.passes[0].inputs.tex = 'corrupt' }, TypeError)
})

test('canonical aliases, member enums, strings, booleans, and hex colors normalize without schema drift', () => {
  const catalog = new Map(effectCatalog.map((effect) => [effect.id, effect]))
  const noise = catalog.get('synth/noise').normalizeArguments([
    { name: 'noiseType', value: 'simplex' },
  ])
  assert.equal(noise.type, 10)
  assert.equal(noise.wrap, true)

  const channel = catalog.get('filter/channel').normalizeArguments([
    { name: 'channel', value: 'channel.a' },
  ])
  assert.equal(channel.channel, 3)

  const text = catalog.get('filter/text').normalizeArguments([
    { name: 'font', value: 'font.monospace' },
    { name: 'matteColor', value: '#336699' },
  ])
  assert.equal(text.font, 'monospace')
  assert.deepEqual(text.matteColor, [0.2, 0.4, 0.6])

  const lighting = catalog.get('filter/lighting').normalizeArguments([])
  assert.deepEqual(lighting.heightMap, { kind: 'input' })
})

test('input-free classic programs are generators, including fractal', () => {
  const fractal = effectCatalog.find((effect) => effect.id === 'classicNoisedeck/fractal')
  assert.equal(fractal.kind, 'generator')
})
