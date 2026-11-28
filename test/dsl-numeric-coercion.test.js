import test from 'node:test'
import assert from 'node:assert/strict'

import { compileDsl } from '../src/dsl/compiler.js'
import { createDefaultRegistry } from '../src/effects/catalog.js'

const registry = createDefaultRegistry()

function compileProgram(body) {
  const source = `search synth, filter, mixer\nseed 3\n${body}\nrender(o0)`
  return compileDsl(source, registry)
}

// All ten GAP-068 issue programs, plus out-of-range fractional ints and controls,
// verified against noisemaker 2.x at 9a33fc9c3166a80b11c34afa7aa770c02480948e.
for (const [label, body, stepIndex, parameter, expected, warning] of [
  ['octaves: false (boolean out of range)', 'noise(octaves: false).write(o0)', 0, 'octaves', 1, "Argument out of range for 'octaves' in noise() (got 0, clamped to 1)"],
  ['octaves: true (boolean in range)', 'noise(octaves: true).write(o0)', 0, 'octaves', 1, null],
  ['scaleX: true (boolean float in range)', 'noise(scaleX: true).write(o0)', 0, 'scaleX', 1, null],
  ['tint alpha: false (boolean float in range)', 'noise().tint(alpha: false).write(o0)', 1, 'alpha', 0, null],
  ['scaleX: oscKind.sine (enum out of range)', 'noise(scaleX: oscKind.sine).write(o0)', 0, 'scaleX', 1, "Argument out of range for 'scaleX' in noise() (got 0, clamped to 1)"],
  ['octaves: oscKind.tri (enum in range)', 'noise(octaves: oscKind.tri).write(o0)', 0, 'octaves', 1, null],
  ['octaves: midiMode.polyPressure (enum out of range)', 'noise(octaves: midiMode.polyPressure).write(o0)', 0, 'octaves', 8, "Argument out of range for 'octaves' in noise() (got 10, clamped to 8)"],
  ['scaleX: synth.noise.colorMode.rgb (registered enum in range)', 'noise(scaleX: synth.noise.colorMode.rgb).write(o0)', 0, 'scaleX', 1, null],
  ['octaves: 3.5 (fractional int in range)', 'noise(octaves: 3.5).write(o0)', 0, 'octaves', 3.5, null],
  ['seed: 2.5 (fractional int in range)', 'noise(seed: 2.5).write(o0)', 0, 'seed', 2.5, null],
  ['octaves: 0.5 (fractional int below min)', 'noise(octaves: 0.5).write(o0)', 0, 'octaves', 1, "Argument out of range for 'octaves' in noise() (got 0.5, clamped to 1)"],
  ['octaves: 10.5 (fractional int above max)', 'noise(octaves: 10.5).write(o0)', 0, 'octaves', 8, "Argument out of range for 'octaves' in noise() (got 10.5, clamped to 8)"],
  ['octaves: -1.5 (negative fractional int below min)', 'noise(octaves: -1.5).write(o0)', 0, 'octaves', 1, "Argument out of range for 'octaves' in noise() (got -1.5, clamped to 1)"],
  ['control octaves: 3', 'noise(octaves: 3).write(o0)', 0, 'octaves', 3, null],
  ['control scaleX: 1.5', 'noise(scaleX: 1.5).write(o0)', 0, 'scaleX', 1.5, null],
  ['control wrap: true', 'noise(wrap: true).write(o0)', 0, 'wrap', true, null],
]) {
  test(`GAP-068: ${label} matches the authority value and S002 diagnostic`, () => {
    const compiled = compileProgram(body)
    assert.equal(compiled.chains[0].steps[stepIndex].params[parameter], expected)
    assert.deepEqual(compiled.diagnostics, warning ? [{
      code: 'S002',
      severity: 'warning',
      message: warning,
    }] : [])
  })
}

test('GAP-068: booleans, member paths, and fractional ints work through bindings, pick, unary +, and standard enums', () => {
  for (const [body, parameter, expected, warning] of [
    ['let b = false\nnoise(octaves: b).write(o0)', 'octaves', 1, "Argument out of range for 'octaves' in noise() (got 0, clamped to 1)"],
    ['let k = oscKind.sine\nnoise(scaleX: k).write(o0)', 'scaleX', 1, "Argument out of range for 'scaleX' in noise() (got 0, clamped to 1)"],
    ['let n = synth.noise\nnoise(scaleX: n.colorMode.rgb).write(o0)', 'scaleX', 1, null],
    ['let a = oscKind.sine\nlet b = pick(a, oscKind.tri)\nnoise(scaleX: b).write(o0)', 'scaleX', 1, "Argument out of range for 'scaleX' in noise() (got 0, clamped to 1)"],
    ['noise(octaves: pick(false, true)).write(o0)', 'octaves', 1, null],
    ['noise(scaleX: pick(oscKind.sine, oscKind.tri)).write(o0)', 'scaleX', 1, null],
    ['noise(octaves: +true).write(o0)', 'octaves', 1, null],
    ['noise(octaves: +oscKind.tri).write(o0)', 'octaves', 1, null],
    ['noise(scaleX: palette.afterimage).write(o0)', 'scaleX', 3, null],
    ['noise(scaleX: audioBand.raw).write(o0)', 'scaleX', 4, null],
    ['noise(scaleX: channel.a).write(o0)', 'scaleX', 3, null],
    ['noise(scaleX: color.hsv).write(o0)', 'scaleX', 2, null],
    ['noise(scaleX: oscType.square).write(o0)', 'scaleX', 4, null],
    ['noise(10, oscKind.sine).write(o0)', 'octaves', 1, "Argument out of range for 'octaves' in noise() (got 0, clamped to 1)"],
    ['noise(octaves: false, octaves: 3).write(o0)', 'octaves', 3, null],
  ]) {
    const compiled = compileProgram(body)
    assert.equal(compiled.chains[0].steps[0].params[parameter], expected, body)
    assert.deepEqual(compiled.diagnostics, warning ? [{
      code: 'S002',
      severity: 'warning',
      message: warning,
    }] : [], body)
  }

  const ordered = compileProgram('noise(seed: false, octaves: midiMode.polyPressure, scaleX: oscKind.sine).write(o0)')
  assert.deepEqual(ordered.diagnostics, [
    { code: 'S002', severity: 'warning', message: "Argument out of range for 'octaves' in noise() (got 10, clamped to 8)" },
    { code: 'S002', severity: 'warning', message: "Argument out of range for 'scaleX' in noise() (got 0, clamped to 1)" },
    { code: 'S002', severity: 'warning', message: "Argument out of range for 'seed' in noise() (got 0, clamped to 1)" },
  ])
})

test('GAP-068: quoted strings and unresolvable member paths remain refused for numeric parameters', () => {
  for (const body of [
    'noise(scaleX: "oscKind.sine").write(o0)',
    'noise(scaleX: "true").write(o0)',
    'noise(octaves: "3").write(o0)',
    'let s = "oscKind.sine"\nnoise(scaleX: s).write(o0)',
    'let s = "oscKind.sine"\nlet p = pick(s, "oscKind.tri")\nnoise(scaleX: p).write(o0)',
    'noise(scaleX: oscKind.nope).write(o0)',
    'noise(scaleX: foo.bar).write(o0)',
    'noise(scaleX: filter.palette.index.afterimage).write(o0)',
    'let m = midiMode\nnoise(octaves: m.polyPressure).write(o0)',
  ]) {
    assert.throws(() => compileProgram(body), body)
  }
})

test('GAP-068: direct EffectDefinition.normalizeArguments validation remains unchanged', () => {
  const definition = registry.resolve('noise', ['synth'])
  assert.throws(() => definition.normalizeArguments([{ name: 'octaves', value: false }]), /must be an integer/)
  assert.throws(() => definition.normalizeArguments([{ name: 'octaves', value: 3.5 }]), /must be an integer/)
  assert.throws(() => definition.normalizeArguments([{ name: 'scaleX', value: true }]), /must be a finite number/)
  assert.throws(() => definition.normalizeArguments([{ name: 'scaleX', value: 'oscKind.sine' }]), /must be a finite number/)
  assert.throws(() => definition.normalizeArguments([{ name: 'scaleX', value: 0 }]), /must be at least 1/)
})
