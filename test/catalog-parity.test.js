import assert from 'node:assert/strict'
import test from 'node:test'

import { effectCatalog } from '../src/effects/catalog.js'
import { eligibleEffectIds, effectRecords } from '../src/effects/generated/upstream-snapshot.js'

test('runtime catalog is the exact 205-effect canonical inventory', () => {
  assert.equal(effectCatalog.length, 205)
  assert.deepEqual(effectCatalog.map((effect) => effect.id), eligibleEffectIds)
  assert.equal(effectCatalog.some((effect) => ['synth/scope', 'synth/spectrum', 'synth/roll'].includes(effect.id)), false)
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

  const volumeNoise = catalog.get('synth3d/noise3d')
  assert.equal(volumeNoise.domain, 'volume-generator')
  assert.equal(volumeNoise.outputTex3d, 'volumeCache')
  assert.equal(volumeNoise.outputGeo, 'geoBuffer')
  const palette3d = catalog.get('filter3d/palette3d')
  assert.equal(palette3d.domain, 'volume-filter')
  assert.equal(palette3d.outputGeo, 'inputGeo')
  const render3d = catalog.get('render/render3d')
  assert.equal(render3d.domain, 'volume-renderer')
  assert.equal(render3d.outputTex3d, 'inputTex3d')
  assert.equal(catalog.get('render/loopBegin').loopRole, 'begin')
  assert.equal(catalog.get('render/loopEnd').loopRole, 'end')
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

test('volume, geometry, and mat3 defaults normalize through runtime definitions', () => {
  const catalog = new Map(effectCatalog.map((effect) => [effect.id, effect]))
  const cellular = catalog.get('synth3d/cellularAutomata3d').normalizeArguments([])
  assert.equal(cellular.source, 'vol0')
  assert.equal(cellular.geoSource, 'geo0')
  const cubemap = catalog.get('render/renderCubemap3d').normalizeArguments([])
  assert.deepEqual(cubemap.cubeBasis, [1, 0, 0, 0, 1, 0, 0, 0, 1])
})
