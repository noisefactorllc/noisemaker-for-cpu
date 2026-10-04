import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { compileCsl } from '../src/csl/compiler.js'
import { EffectDefinition } from '../src/effects/definition.js'
import { EffectRegistry } from '../src/effects/registry.js'
import { CpuRenderer } from '../src/runtime/renderer.js'
import { evaluateAutomation, isAutomationValue, resolveAutomationUniform } from '../src/runtime/automation.js'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// The fixture's expected values were captured from the pinned upstream tree's own
// automation evaluator (Pipeline.prototype.resolveUniformValue) at the recorded
// sourceRevision; the env-gated test below re-proves them against a live tree.
const fixture = JSON.parse(await readFile(new URL('./fixtures/osc-automation-golden.json', import.meta.url), 'utf8'))

function portValue(config, time, spec) {
  return resolveAutomationUniform(JSON.parse(JSON.stringify(config)), time, spec === undefined ? undefined : JSON.parse(JSON.stringify(spec)))
}

test('osc automation evaluation matches the upstream oracle captured at the pinned revision', () => {
  assert.equal(fixture.cases.length > 0, true)
  for (const { label, time, specIndex, config, expected } of fixture.cases) {
    const spec = [undefined, { min: 0, max: 1 }, { min: -2, max: 3 }, { type: 'int' }, { type: 'int', min: 1, max: 5 }][specIndex]
    assert.equal(portValue(config, time, spec), expected, `${label} t=${time} spec=${specIndex}`)
  }
})

test('every noise2d (kind 6) case from the upstream range is covered', () => {
  const labels = new Set(fixture.cases.filter((entry) => entry.config.oscType === 6).map((entry) => entry.label))
  for (const suffix of ['defaults', 'range', 'speed2.5', 'offset0.3', 'seed42', 'fm-speed', 'nested-min', 'negative-speed']) {
    assert.equal(labels.has(`kind6-${suffix}`), true, `missing kind6-${suffix}`)
  }
})

test('osc automation re-proves against the live pinned upstream tree when NM_REFERENCE_ROOT is available', { skip: !process.env.NM_REFERENCE_ROOT }, async () => {
  const upstream = await import(pathToFileURL(resolve(process.env.NM_REFERENCE_ROOT, 'shaders', 'src', 'runtime', 'pipeline.js')).href)
  const resolveUniformValue = upstream.Pipeline.prototype.resolveUniformValue
  for (const { config, time, specIndex } of fixture.cases) {
    const spec = [undefined, { min: 0, max: 1 }, { min: -2, max: 3 }, { type: 'int' }, { type: 'int', min: 1, max: 5 }][specIndex]
    const expected = resolveUniformValue.call({ externalState: null }, JSON.parse(JSON.stringify(config)), time, spec === undefined ? undefined : JSON.parse(JSON.stringify(spec)))
    assert.equal(portValue(config, time, spec), expected, `live oracle mismatch t=${time} spec=${specIndex}`)
  }
})

test('evaluateAutomation keeps the 0..1 oscillator contract and depth guard', () => {
  const sine = { type: 'Oscillator', oscType: 0, min: 0, max: 1, speed: 1, offset: 0, seed: 1 }
  assert.ok(Math.abs(evaluateAutomation(sine, 0.25) - 0.5) < 1e-12)
  assert.equal(evaluateAutomation(sine, 0), 0)
  assert.ok(Math.abs(evaluateAutomation(sine, 1)) < 1e-12)
  assert.equal(isAutomationValue(sine), true)
  assert.equal(isAutomationValue({ type: 'Midi' }), false)
  // Depth > 8 collapses nested fields to the range-scaled zero, as upstream's
  // evaluator does; the top-level oscillator still evaluates deterministically.
  let deep = sine
  for (let i = 0; i < 10; i++) deep = { type: 'Oscillator', oscType: 0, min: deep, max: 1, speed: 1, offset: 0, seed: 1 }
  const deepValue = evaluateAutomation(deep, 0.5)
  assert.ok(Number.isFinite(deepValue) && deepValue >= 0 && deepValue <= 1)
})

function automationFixture() {
  const definitions = [
    new EffectDefinition({
      namespace: 'synth', func: 'solid', kind: 'generator',
      params: { color: { type: 'color', default: [0.5, 0.5, 0.5] }, alpha: { type: 'float', default: 1 } },
      passes: [{ kernel: 'solid' }],
    }),
    new EffectDefinition({
      namespace: 'filter', func: 'lift', kind: 'filter',
      params: { amount: { type: 'float', default: 0.1, min: 0, max: 1 } },
      passes: [{ kernel: 'lift' }],
    }),
    new EffectDefinition({
      namespace: 'filter', func: 'step', kind: 'filter',
      params: { mode: { type: 'int', default: 0, choices: { off: 0, on: 1 } } },
      passes: [{ kernel: 'step' }],
    }),
  ]
  const registry = new EffectRegistry(definitions)
  const kernels = new Map([
    ['solid', compileCsl('uniform vec3 color; uniform float alpha; vec4 main() { return vec4(color * alpha, alpha); }')],
    ['lift', compileCsl('uniform sampler2D inputTex; uniform float amount; vec4 main() { vec4 c = texture(inputTex, uv); return vec4(c.rgb + amount, c.a); }')],
    ['step', compileCsl('uniform sampler2D inputTex; uniform int mode; vec4 main() { vec4 c = texture(inputTex, uv); return vec4(vec3(float(mode) * 0.25) + c.rgb * 0.5, 1.0); }')],
  ])
  return new CpuRenderer({ registry, kernels, tileRows: 2 })
}

test('an osc() parameter renders byte-identically to its resolved numeric value', () => {
  const renderer = automationFixture()
  const time = 0.25
  const animated = renderer.render('search synth, filter\nsolid().lift(amount: osc(type: sine, min: 0.1, max: 0.4)).write(o0)\nrender(o0)', { width: 3, height: 2, time })
  const expectedValue = evaluateAutomation(
    { type: 'Oscillator', oscType: 0, min: 0.1, max: 0.4, speed: 1, offset: 0, seed: 1 }, time)
  const numeric = renderer.render(`search synth, filter\nsolid().lift(amount: ${expectedValue}).write(o0)\nrender(o0)`, { width: 3, height: 2, time })
  assert.deepEqual(animated.toRgba8(), numeric.toRgba8())
})

test('an osc() value survives compile unchanged and animates across time', () => {
  const renderer = automationFixture()
  const source = 'search synth, filter\nsolid().lift(amount: osc(tri)).write(o0)\nrender(o0)'
  const early = renderer.render(source, { width: 2, height: 1, time: 0.1 })
  const mid = renderer.render(source, { width: 2, height: 1, time: 0.5 })
  assert.notDeepEqual(early.toRgba8(), mid.toRgba8())
})

test('int choices params round the resolved automation value (conditional selector contract)', () => {
  const renderer = automationFixture()
  // The conditional int selector receives Math.round of the resolved automation
  // value (upstream resolveUniformValue's spec.type === 'int' contract); a
  // fractional value leaking into the integer uniform would render differently.
  const time = 0.25
  const raw = evaluateAutomation({ type: 'Oscillator', oscType: 0, min: 0, max: 1, speed: 1, offset: 0, seed: 1 }, time)
  const result = renderer.render('search synth, filter\nsolid().step(mode: osc(sine)).write(o0)\nrender(o0)', { width: 2, height: 1, time })
  const numeric = renderer.render(`search synth, filter\nsolid().step(mode: ${Math.round(raw)}).write(o0)\nrender(o0)`, { width: 2, height: 1, time })
  assert.deepEqual(result.toRgba8(), numeric.toRgba8())
  // And the rounded selection is observable: mode 0 and mode 1 render differently.
  assert.notDeepEqual(
    renderer.render('search synth, filter\nsolid().step(mode: 0).write(o0)\nrender(o0)', { width: 2, height: 1, time }).toRgba8(),
    renderer.render('search synth, filter\nsolid().step(mode: 1).write(o0)\nrender(o0)', { width: 2, height: 1, time }).toRgba8())
})

test('osc() compile errors mirror the upstream contract', () => {
  const renderer = automationFixture()
  assert.throws(() => renderer.render('search synth, filter\nsolid().lift(amount: osc(wobble)).write(o0)\nrender(o0)', { width: 1, height: 1 }), /oscKind/)
  assert.throws(() => renderer.render('search synth, filter\nsolid().lift(amount: osc(7)).write(o0)\nrender(o0)', { width: 1, height: 1 }), /oscKind/)
  assert.throws(() => renderer.render('search synth, filter\nsolid().lift(amount: osc(type: sine, phase: 1)).write(o0)\nrender(o0)', { width: 1, height: 1 }), /unknown parameter 'phase'/)
  assert.throws(() => renderer.render('search synth, filter\nsolid().lift(amount: osc(type: sine, min: [1, 2])).write(o0)\nrender(o0)', { width: 1, height: 1 }), /min must be a number/)
  assert.throws(() => renderer.render('search synth\nsolid(color: osc(sine)).write(o0)\nrender(o0)', { width: 1, height: 1 }), /must be an RGB or RGBA color/)
})

test('osc() nesting beyond the upstream depth limit is rejected at compile time', () => {
  const renderer = automationFixture()
  let nested = 'osc(type: sine)'
  for (let i = 0; i < 9; i++) nested = `osc(type: sine, min: ${nested})`
  assert.throws(
    () => renderer.render(`search synth, filter\nsolid().lift(amount: ${nested}).write(o0)\nrender(o0)`, { width: 1, height: 1 }),
    /Automation nesting exceeds the maximum depth of 8/,
  )
})

test('a binding can hold an osc() value for reuse across steps', () => {
  const renderer = automationFixture()
  const time = 0.25
  const bound = renderer.render('search synth, filter\nlet wobble = osc(type: sine, min: 0.1, max: 0.4)\nsolid().lift(amount: wobble).write(o0)\nrender(o0)', { width: 3, height: 2, time })
  const expectedValue = evaluateAutomation(
    { type: 'Oscillator', oscType: 0, min: 0.1, max: 0.4, speed: 1, offset: 0, seed: 1 }, time)
  const numeric = renderer.render(`search synth, filter\nsolid().lift(amount: ${expectedValue}).write(o0)\nrender(o0)`, { width: 3, height: 2, time })
  assert.deepEqual(bound.toRgba8(), numeric.toRgba8())
})
