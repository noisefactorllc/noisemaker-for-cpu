import test from 'node:test'
import assert from 'node:assert/strict'

import { compileDsl } from '../src/dsl/compiler.js'
import { createDefaultRegistry } from '../src/effects/catalog.js'

const registry = createDefaultRegistry()

// Values, warning text and draws recorded from noisemaker 2.x at
// 9a33fc9c3166a80b11c34afa7aa770c02480948e with the full effect catalog.
for (const [parameter, expression, original, expected, draw] of [
  ['scaleX', '0', 0, 1],
  ['scaleX', '-2', -2, 1],
  ['scaleX', '100000', 100000, 100],
  ['scaleX', '-rand(1, 5)', -1.0225846767425537, 1, ['scaleX/o0', 24250170]],
  ['scaleX', 'rand(-5, 0)', -3.910190463066101, 1, ['scaleX', 936139365]],
  ['scaleX', 'rand(1, 5) * 1000', 1022.5846767425537, 100, ['scaleX/o0', 24250170]],
  ['octaves', 'randInt(20, 30)', 29, 8, ['octaves', 1804517339]],
  ['scaleX', '1', 1, 1],
  ['scaleX', '100', 100, 100],
  ['scaleX', '50', 50, 50],
  ['scaleX', '2 - 5', -3, 1],
  ['octaves', '100.5', 100.5, 8],
]) {
  test(`${parameter}: ${expression} matches the authority's value, S002 warning and draws`, () => {
    const source = `search synth, filter, mixer\nseed 3\nnoise(${parameter}: ${expression}).write(o0)\nrender(o0)`
    const draws = []
    const compiled = compileDsl(source, registry, { onDraw: (entry) => draws.push(entry) })
    assert.equal(compiled.chains[0].steps[0].params[parameter], expected)
    assert.deepEqual(compiled.diagnostics, original === expected ? [] : [{
      code: 'S002',
      severity: 'warning',
      message: `Argument out of range for '${parameter}' in noise() (got ${original}, clamped to ${expected})`,
    }])
    assert.deepEqual(draws, [
      ...(draw ? [{ seed: 3, key: `synth.noise@noise_1/${draw[0]}`, u: draw[1] }] : []),
      { seed: 3, key: 'synth.noise@noise_1/seed/inherit', u: 221463811 },
    ])
  })
}

test('direct effect argument normalization retains its range validation', () => {
  const definition = registry.resolve('noise', ['synth'])
  assert.throws(() => definition.normalizeArguments([{ name: 'scaleX', value: 0 }]), /must be at least 1/)
  assert.throws(() => definition.normalizeArguments([{ name: 'scaleX', value: 100000 }]), /must be at most 100/)
})

test('range warnings follow parameter order rather than named argument order', () => {
  const compiled = compileDsl('search synth\nnoise(seed: 0, scaleY: 100000, scaleX: 0).write(o0)', registry)
  assert.deepEqual(compiled.diagnostics, [
    { code: 'S002', severity: 'warning', message: "Argument out of range for 'scaleX' in noise() (got 0, clamped to 1)" },
    { code: 'S002', severity: 'warning', message: "Argument out of range for 'scaleY' in noise() (got 100000, clamped to 100)" },
    { code: 'S002', severity: 'warning', message: "Argument out of range for 'seed' in noise() (got 0, clamped to 1)" },
  ])
})

test('overridden arguments and later compilations produce no stale range warnings', () => {
  const clamped = compileDsl('search synth\nnoise(scaleX: 0).write(o0)', registry)
  assert.equal(clamped.diagnostics.length, 1)
  const replaced = compileDsl('search synth\nnoise(scaleX: 0, scaleX: 50).write(o0)', registry)
  assert.equal(replaced.chains[0].steps[0].params.scaleX, 50)
  assert.deepEqual(replaced.diagnostics, [])
})

test('inline-chain range warnings retain their parameter position', () => {
  const compiled = compileDsl('search synth, mixer\nsolid().blendMode(mix: 1000, tex: noise(scaleX: 0)).write(o0)', registry)
  assert.deepEqual(compiled.diagnostics, [
    { code: 'S002', severity: 'warning', message: "Argument out of range for 'scaleX' in noise() (got 0, clamped to 1)" },
    { code: 'S002', severity: 'warning', message: "Argument out of range for 'mix' in blendMode() (got 1000, clamped to 100)" },
  ])
})
