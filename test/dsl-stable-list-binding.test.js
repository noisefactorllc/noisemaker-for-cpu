import test from 'node:test'
import assert from 'node:assert/strict'

import { compileDsl } from '../src/dsl/compiler.js'
import { createDefaultRegistry, kernels, kernelFactories } from '../src/effects/catalog.js'
import { CpuRenderer } from '../src/runtime/renderer.js'

const registry = createDefaultRegistry()

function noiseStep(source) {
  return compileDsl(`search synth\n${source}.write(o0)\nrender(o0)`, registry).chains[0].steps[0]
}

test('trailing commas keep array components and named or positional call arguments', () => {
  for (const call of [
    'solid(color: [1, 0.25, 0.5,])',
    'solid(color: [1, 0.25, 0.5,],)',
    'solid([1, 0.25, 0.5,],)',
    'solid(color: [/* red */ 1, 0.25, 0.5, /* end */], /* end */)',
  ]) {
    const source = `search synth\n${call}.write(o0)\nrender(o0)`
    const renderer = new CpuRenderer({ registry, kernels, kernelFactories })
    assert.deepEqual([...renderer.render(source, { width: 1, height: 1 }).toRgba8()], [255, 64, 128, 255], call)
  }
  assert.equal(noiseStep('noise(3,)').params.type, 3)
  assert.equal(noiseStep('noise(scaleX: 12,)').params.scaleX, 12)
})

test('trailing commas do not admit missing argument or array elements', () => {
  for (const call of ['solid([1,,0])', 'solid([,1,0])', 'solid([1,0,,])', 'noise(,)', 'noise(12,,)', 'noise(scaleX: ,)']) {
    assert.throws(() => compileDsl(`search synth\n${call}.write(o0)\nrender(o0)`, registry), /Expected DSL value/, call)
  }
})

test('trailing commas in vector calls preserve every component', () => {
  for (const [namespace, call, parameter, want] of [
    ['synth', 'media(imageSize: vec2(32, 24,))', 'imageSize', [32, 24]],
    ['classicNoisedeck', 'noise(paletteOffset: vec3(0.1, 0.2, 0.3,))', 'paletteOffset', [0.1, 0.2, 0.3]],
    ['synth', 'remap(zone0_bounds: vec4(0, 0.2, 0.5, 1,))', 'zone0_bounds', [0, 0.2, 0.5, 1]],
  ]) {
    const plan = compileDsl(`search ${namespace}\n${call}.write(o0)\nrender(o0)`, registry)
    assert.deepEqual(plan.chains[0].steps[0].params[parameter], want)
  }
})

test('let merges bind positionals by their original index and keywords override their own slot', () => {
  for (const [source, want] of [
    ['let tuned = noise(seed: 7)\ntuned(3, 4)', [3, 4, 7]],
    ['let tuned = noise(3, 4)\ntuned(seed: 7)', [3, 4, 7]],
    ['let tuned = noise(type: 11)\ntuned(3, 4)', [11, 4, 1]],
    ['let tuned = noise(3, 4)\ntuned(type: 11)', [11, 4, 1]],
    ['let tuned = noise(seed: 7)\nlet alias = tuned\nalias(3, 4)', [3, 4, 7]],
  ]) {
    const step = noiseStep(source)
    assert.deepEqual([step.params.type, step.params.octaves, step.params.seed], want, source)
    assert.deepEqual([...step.explicitParams].sort(), source.includes('type: 11') ? ['octaves', 'type'] : ['octaves', 'seed', 'type'])
  }
})

test('mixed calls bind positionals to unclaimed slots while object literals remain refused', () => {
  for (const call of ['noise(12, seed: 7)', 'noise(seed: 7, 12)']) {
    const step = noiseStep(call)
    assert.equal(step.params.type, 12, call)
    assert.equal(step.params.seed, 7, call)
    assert.equal(step.params.scaleX, 75, call)
  }
  assert.throws(() => noiseStep('noise({seed: 7})'), /Expected DSL value|Unexpected character/)
})

test('excess positional arguments warn without rejecting the stable call', (t) => {
  const warnings = []
  t.mock.method(console, 'warn', (message) => warnings.push(message))
  for (const call of ['solid(#ff0000, 1, 99)', 'let red = solid(#ff0000)\nred(1, 99)']) {
    const source = `search synth\n${call}.write(o0)\nrender(o0)`
    const renderer = new CpuRenderer({ registry, kernels, kernelFactories })
    assert.deepEqual([...renderer.render(source, { width: 1, height: 1 }).toRgba8()], [255, 0, 0, 255])
  }
  assert.deepEqual(warnings, [
    "Too many positional arguments for solid(): 'solid' takes 2",
    "Too many positional arguments for solid(): 'solid' takes 2",
  ])
})

test('ignored positional arguments are discarded before evaluating values or compiling chains', (t) => {
  t.mock.method(console, 'warn', () => {})
  for (const unused of ['bogus()', 'noise()']) {
    const source = `search synth\nsolid(#ff0000, 1, ${unused}).write(o0)\nrender(o0)`
    const step = compileDsl(source, registry).chains[0].steps[0]
    assert.deepEqual(step.params, { color: [1, 0, 0], alpha: 1 })
    assert.equal(step.inlineChains, undefined)

    const merged = noiseStep(`let tuned = noise(type: 3)\ntuned(${unused}, 4)`)
    assert.equal(merged.params.type, 3)
    assert.equal(merged.params.octaves, 4)
    assert.equal(merged.inlineChains, undefined)
  }
})
