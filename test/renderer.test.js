import test from 'node:test'
import assert from 'node:assert/strict'

import { compileCsl } from '../src/csl/compiler.js'
import { EffectDefinition } from '../src/effects/definition.js'
import { EffectRegistry } from '../src/effects/registry.js'
import { createDefaultRegistry, kernelFactories, kernels } from '../src/effects/catalog.js'
import { CpuRenderer } from '../src/runtime/renderer.js'

function fixture() {
  const definitions = [
    new EffectDefinition({
      namespace: 'synth', func: 'solid', kind: 'generator',
      params: { color: { type: 'color', default: [0.5, 0.5, 0.5] }, alpha: { type: 'float', default: 1 } },
      passes: [{ kernel: 'solid' }],
    }),
    new EffectDefinition({
      namespace: 'synth', func: 'seedProbe', kind: 'generator',
      paramAliases: { probeSeed: 'seed' },
      params: { seed: { type: 'int', default: 1 } },
      passes: [{ kernel: 'seedProbe' }],
    }),
    new EffectDefinition({
      namespace: 'filter', func: 'invert', kind: 'filter', params: {}, passes: [{ kernel: 'invert' }],
    }),
    new EffectDefinition({
      namespace: 'filter', func: 'doubleLift', kind: 'filter', params: { amount: { type: 'float', default: 0.1 } },
      passes: [{ kernel: 'lift' }, { kernel: 'lift' }],
    }),
    new EffectDefinition({
      namespace: 'mixer', func: 'average', kind: 'mixer',
      params: { other: { type: 'surface', texture: 'otherTex' } }, passes: [{ kernel: 'average' }],
    }),
  ]
  const registry = new EffectRegistry(definitions)
  const kernels = new Map([
    ['solid', compileCsl('uniform vec3 color; uniform float alpha; vec4 main() { return vec4(color * alpha, alpha); }')],
    ['seedProbe', compileCsl('uniform int seed; vec4 main() { return vec4(float(seed) / 10.0, 0.0, 0.0, 1.0); }')],
    ['invert', compileCsl('uniform sampler2D inputTex; vec4 main() { vec4 c = texture(inputTex, uv); return vec4(vec3(1.0) - c.rgb, c.a); }')],
    ['lift', compileCsl('uniform sampler2D inputTex; uniform float amount; vec4 main() { vec4 c = texture(inputTex, uv); return vec4(c.rgb + amount, c.a); }')],
    ['average', compileCsl('uniform sampler2D inputTex; uniform sampler2D otherTex; vec4 main() { return mix(texture(inputTex, uv), texture(otherTex, uv), 0.5); }')],
  ])
  return new CpuRenderer({ registry, kernels, tileRows: 2 })
}

test('CpuRenderer executes generator and filter chains', () => {
  const result = fixture().render(`
    search synth, filter
    solid(color: [0.2, 0.4, 0.6]).invert().write(o0)
    render(o0)
  `, { width: 2, height: 2, seed: 7, time: 0.25 })

  const pixel = [...result.surface.data.slice(0, 4)]
  assert.ok(Math.abs(pixel[0] - 0.8) < 1e-6)
  assert.ok(Math.abs(pixel[1] - 0.6) < 1e-6)
  assert.ok(Math.abs(pixel[2] - 0.4) < 1e-6)
  assert.equal(pixel[3], 1)
  assert.equal(result.seed, 7)
  assert.equal(result.stats.passes, 2)
})

test('CpuRenderer preserves canonical effect seed defaults and explicit overrides', () => {
  const renderer = fixture()
  const inherited = renderer.render('search synth\nseedProbe().write(o0)\nrender(o0)', { width: 1, height: 1, seed: 7 })
  const explicit = renderer.render('search synth\nseedProbe(seed: 2).write(o0)\nrender(o0)', { width: 1, height: 1, seed: 7 })
  const explicitAlias = renderer.render('search synth\nseedProbe(probeSeed: 3).write(o0)\nrender(o0)', { width: 1, height: 1, seed: 7 })

  assert.ok(Math.abs(inherited.surface.data[0] - 0.7) < 1e-6)
  assert.ok(Math.abs(explicit.surface.data[0] - 0.2) < 1e-6)
  assert.ok(Math.abs(explicitAlias.surface.data[0] - 0.3) < 1e-6)
})

test('CpuRenderer validates finite time and integer render seeds', () => {
  const renderer = fixture()
  const source = 'search synth\nsolid().write(o0)\nrender(o0)'
  assert.throws(() => renderer.render(source, { width: 1, height: 1, time: Number.NaN }), /time must be finite/)
  assert.throws(() => renderer.render(source, { width: 1, height: 1, seed: 1.5 }), /seed must be an integer/)
})

test('CpuRenderer feeds each multi-pass kernel from the previous pass', () => {
  const result = fixture().render(`
    search synth, filter
    solid(color: [0.2, 0.3, 0.4]).doubleLift(amount: 0.1).write(o0)
    render(o0)
  `, { width: 1, height: 1 })

  assert.deepEqual([...result.toRgba8()], [102, 128, 153, 255])
  assert.equal(result.stats.passes, 3)
})

test('CpuRenderer resolves mixer surface parameters', () => {
  const result = fixture().render(`
    search synth, mixer
    solid(color: [1.0, 0.0, 0.0]).write(o0)
    solid(color: [0.0, 0.0, 1.0]).write(o1)
    read(o0).average(other: o1).write(o2)
    render(o2)
  `, { width: 1, height: 1 })

  assert.deepEqual([...result.toRgba8()], [128, 0, 128, 255])
})

test('CpuRenderer sync and async paths are deterministic and byte-identical', async () => {
  const renderer = fixture()
  const source = 'search synth, filter\nsolid(color: [0.1, 0.2, 0.3]).invert().write(o0)\nrender(o0)'
  const sync = renderer.render(source, { width: 5, height: 3, seed: 4 })
  let yields = 0
  const asyncResult = await renderer.renderAsync(source, { width: 5, height: 3, seed: 4, scheduler: async () => { yields += 1 } })

  assert.deepEqual([...asyncResult.toRgba8()], [...sync.toRgba8()])
  assert.ok(yields >= 4)
})

test('CpuRenderer reports reads of unwritten surfaces', () => {
  assert.throws(
    () => fixture().render('search filter\nread(o4).invert().write(o0)\nrender(o0)', { width: 1, height: 1 }),
    /Surface o4 has not been written/,
  )
})

test('CpuRenderer configures and submits successful sync and async frames to registered sinks', async () => {
  const renderer = fixture()
  const events = []
  const sink = {
    configure(descriptor) { events.push(['configure', { ...descriptor }]) },
    submit(result, timestamp) { events.push(['submit', result, timestamp]); return true },
    close() { events.push(['close']) },
  }
  const remove = renderer.addSink(sink)
  const source = 'search synth\nsolid(color: [0.2, 0.4, 0.6]).write(o0)\nrender(o0)'

  const sync = renderer.render(source, { width: 2, height: 1, presentationTimestamp: 100 })
  const asyncResult = await renderer.renderAsync(source, { width: 3, height: 1, presentationTimestamp: 200, scheduler: async () => {} })

  assert.equal(events.length, 4)
  assert.deepEqual(events[0], ['configure', { width: 2, height: 1, format: 'rgba8unorm', colorSpace: 'srgb', alphaMode: 'straight', fps: 60 }])
  assert.deepEqual(events[1], ['submit', sync, 100])
  assert.deepEqual(events[2], ['configure', { width: 3, height: 1, format: 'rgba8unorm', colorSpace: 'srgb', alphaMode: 'straight', fps: 60 }])
  assert.deepEqual(events[3], ['submit', asyncResult, 200])
  assert.deepEqual(renderer.sinkStats.get(sink), { accepted: 2, dropped: 0, failed: 0 })
  remove()
  assert.deepEqual(events.at(-1), ['close'])
})

test('CpuRenderer does not submit failed renders to sinks', () => {
  const renderer = fixture()
  let submissions = 0
  renderer.addSink({ configure() {}, submit() { submissions += 1; return true }, close() {} })

  assert.throws(() => renderer.render('search filter\nread(o4).invert().write(o0)\nrender(o0)', { width: 1, height: 1 }))
  assert.equal(submissions, 0)
})

test('CpuRenderer disposal closes sinks once while preserving existing render disposal behavior', () => {
  const renderer = fixture()
  let closes = 0
  renderer.addSink({ configure() {}, submit() { return true }, close() { closes += 1 } })

  renderer.dispose()
  renderer.dispose()

  assert.equal(closes, 1)
  assert.throws(() => renderer.addSink({ configure() {}, submit() { return true }, close() {} }), /closed/)
})
